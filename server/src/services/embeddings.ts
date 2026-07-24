// Local ICD-10 semantic search (PRD §6.5, F6). MiniLM (all-MiniLM-L6-v2, 384-dim) runs
// in-process via @xenova/transformers — no external API, no per-keystroke cost. Embeddings are
// computed once by the seed (`embedAll`) and stored as JSONB; at query time we load all vectors
// into memory and cosine-rank. If the model can't load (e.g. offline), we degrade to ILIKE.
import type pg from 'pg';
import { query } from '../db.js';

export interface IcdSearchResult {
  code: string;
  description: string;
  category: string | null;
  score: number; // cosine similarity 0..1 (or 0 for the ILIKE fallback)
}

const MODEL = 'Xenova/all-MiniLM-L6-v2';
const DIM = 384;

// ── Pipeline singleton ────────────────────────────────────────────────────────
// A feature-extraction pipeline is expensive to build and downloads the model on first use.
// We construct it once, lazily, and share the in-flight promise across concurrent callers.
// `pipelineFailed` latches once init throws so we don't retry a broken/offline load per request.
type FeatureExtractor = (
  text: string,
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array | number[] }>;

let extractorPromise: Promise<FeatureExtractor> | null = null;
let pipelineFailed = false;

async function getExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import('@xenova/transformers');
      // @xenova/transformers does NOT read the conventional TRANSFORMERS_CACHE env var —
      // honor it explicitly so the systemd unit's cache path (outside node_modules, so it
      // survives `npm ci` on redeploys) actually takes effect.
      if (process.env.TRANSFORMERS_CACHE) env.cacheDir = process.env.TRANSFORMERS_CACHE;
      // Cast: the library's overloaded signature is wider than the one call shape we use.
      const pipe = (await pipeline('feature-extraction', MODEL)) as unknown as FeatureExtractor;
      return pipe;
    })().catch((err) => {
      pipelineFailed = true;
      extractorPromise = null;
      throw err;
    });
  }
  return extractorPromise;
}

/** Embed a single string → mean-pooled, L2-normalized 384-dim vector. Throws if the model can't load. */
export async function embedText(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as ArrayLike<number>);
}

/** Alias used by callers that think of it as an intent/query embedding. */
export const embedQuery = embedText;

// ── Seed-time bulk embedding ───────────────────────────────────────────────────
// EXACT signature the seed depends on: `embedAll(pool)` → count. Embeds every row whose
// `embedding` is NULL as "{code} {description}", writes the JSONB vector, logs every 50.
export async function embedAll(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<{ code: string; description: string }>(
    'SELECT code, description FROM icd10_codes WHERE embedding IS NULL ORDER BY code',
  );
  if (rows.length === 0) {
    console.log('[embeddings] nothing to embed — all codes already have vectors');
    return 0;
  }
  console.log(`[embeddings] embedding ${rows.length} ICD-10 code(s) with ${MODEL}…`);

  let done = 0;
  for (const row of rows) {
    const vec = await embedText(`${row.code} ${row.description}`);
    await pool.query('UPDATE icd10_codes SET embedding = $1 WHERE code = $2', [
      JSON.stringify(vec),
      row.code,
    ]);
    done += 1;
    if (done % 50 === 0 || done === rows.length) {
      console.log(`[embeddings]   ${done}/${rows.length}`);
    }
  }
  return done;
}

// ── In-memory vector cache + search ────────────────────────────────────────────
interface CachedCode {
  code: string;
  description: string;
  category: string | null;
  embedding: number[];
}

let cache: CachedCode[] | null = null;
let cacheCount = -1;

/** Load (or refresh) the in-memory vector cache. Refreshes when the embedded-row count changes. */
async function ensureCache(): Promise<CachedCode[]> {
  const { rows: countRows } = await query<{ n: string }>(
    'SELECT count(*)::text AS n FROM icd10_codes WHERE embedding IS NOT NULL',
  );
  const current = Number(countRows[0]?.n ?? '0');
  if (cache && current === cacheCount) return cache;

  const { rows } = await query<{
    code: string;
    description: string;
    category: string | null;
    embedding: unknown;
  }>('SELECT code, description, category, embedding FROM icd10_codes WHERE embedding IS NOT NULL');

  const loaded: CachedCode[] = [];
  for (const r of rows) {
    // pg returns JSONB already parsed; tolerate a stringified fallback just in case.
    let vec: unknown = r.embedding;
    if (typeof vec === 'string') {
      try {
        vec = JSON.parse(vec);
      } catch {
        vec = null;
      }
    }
    if (Array.isArray(vec) && vec.length === DIM) {
      loaded.push({
        code: r.code,
        description: r.description,
        category: r.category,
        embedding: vec as number[],
      });
    }
  }
  cache = loaded;
  cacheCount = current;
  return loaded;
}

/** Cosine similarity of two equal-length vectors. Query vectors are normalized, so this ≈ dot. */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** ILIKE keyword fallback (PRD §6.5) — ranked by match position, score 0 (no semantic signal). */
async function ilikeFallback(q: string, limit: number): Promise<IcdSearchResult[]> {
  const like = `%${q}%`;
  const { rows } = await query<{
    code: string;
    description: string;
    category: string | null;
    pos: number;
  }>(
    `SELECT code, description, category,
            position(lower($1) in lower(description)) AS pos
     FROM icd10_codes
     WHERE description ILIKE $2 OR code ILIKE $2
     ORDER BY (position(lower($1) in lower(description)) = 0), pos, description
     LIMIT $3`,
    [q, like, limit],
  );
  return rows.map((r) => ({
    code: r.code,
    description: r.description,
    category: r.category,
    score: 0,
  }));
}

/**
 * Semantic ICD-10 search. Embeds the query, cosine-ranks the in-memory catalog, returns the top N.
 * Degrades to an ILIKE keyword match if the embedding model can't load or nothing is embedded yet.
 */
export async function searchIcd(q: string, limit = 8): Promise<IcdSearchResult[]> {
  const term = q.trim();
  if (!term) return [];

  if (pipelineFailed) return ilikeFallback(term, limit);

  let queryVec: number[];
  try {
    queryVec = await embedText(term);
  } catch (err) {
    console.error('[embeddings] model load/embed failed — falling back to ILIKE', err);
    return ilikeFallback(term, limit);
  }

  const codes = await ensureCache();
  if (codes.length === 0) return ilikeFallback(term, limit);

  const scored = codes.map((c) => ({
    code: c.code,
    description: c.description,
    category: c.category,
    score: cosine(queryVec, c.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
