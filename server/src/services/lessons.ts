// The self-improving diagnostic memory (reflect → store → retrieve).
// - maybeReflect(): fired async after a new encounter is saved. If the patient's primary
//   diagnosis root (3-char ICD) changed vs. their previous encounter, the AI reflects on
//   both encounters and the resulting lesson is stored WITH a MiniLM embedding.
// - getRelevantLessons(): at generation time the transcript is embedded and cosine-matched
//   against all stored lessons; strong matches are injected into the system prompt, so the
//   scribe's differentials provably improve as the practice accumulates revisions.
import { query } from '../db.js';
import { audit } from './audit.js';
import { embedText, embedQuery } from './embeddings.js';
import { reflectOnRevision, type ReflectionEncounter } from './ai/reflect.js';
import type { Lesson } from '../types.js';

const MATCH_THRESHOLD = 0.35;
const MAX_INJECTED = 2;

export interface LessonHit {
  id: string;
  revisedDx: string;
  missedSignals: string;
  recommendedWorkup: string;
  lessonSummary: string;
  score: number;
}

interface EncounterBundle {
  encounterId: string;
  patientId: string;
  providerId: string;
  createdAt: string;
  transcript: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  codes: string[];
}

interface BundleRow {
  encounter_id: string;
  patient_id: string;
  provider_id: string;
  created_at: Date;
  transcript: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  icd_codes: { code: string; description: string }[];
}

const BUNDLE_SELECT = `
  SELECT e.id AS encounter_id, e.patient_id, e.provider_id, e.created_at, e.transcript,
         nv.subjective, nv.objective, nv.assessment, nv.plan, nv.icd_codes
  FROM encounters e
  JOIN notes n  ON n.encounter_id = e.id
  JOIN LATERAL (
    SELECT * FROM note_versions v WHERE v.note_id = n.id ORDER BY v.version_no DESC LIMIT 1
  ) nv ON true`;

function toBundle(r: BundleRow): EncounterBundle {
  return {
    encounterId: r.encounter_id,
    patientId: r.patient_id,
    providerId: r.provider_id,
    createdAt: r.created_at.toISOString(),
    transcript: r.transcript,
    subjective: r.subjective,
    objective: r.objective,
    assessment: r.assessment,
    plan: r.plan,
    codes: (r.icd_codes ?? []).map((c) => c.code),
  };
}

async function describeCode(code: string | undefined, assessmentFallback: string): Promise<string> {
  if (code) {
    const { rows } = await query<{ description: string }>(
      'SELECT description FROM icd10_codes WHERE code = $1',
      [code],
    );
    if (rows[0]) return rows[0].description;
    return code;
  }
  const firstLine = assessmentFallback.split(/[.\n]/)[0]?.trim();
  return firstLine && firstLine.length > 3 ? firstLine.slice(0, 120) : 'undifferentiated presentation';
}

function toReflectionEncounter(b: EncounterBundle, primaryDescription: string): ReflectionEncounter {
  return {
    date: b.createdAt.slice(0, 10),
    transcript: b.transcript,
    subjective: b.subjective,
    objective: b.objective,
    assessment: b.assessment,
    plan: b.plan,
    codes: b.codes,
    primaryDescription,
  };
}

/**
 * Reflect on a possible diagnostic revision after `encounterId` was saved.
 * Fire-and-forget: callers wrap in setImmediate; all failures are logged, never thrown
 * into the request path. Idempotent via the (from,to) unique constraint.
 */
export async function maybeReflect(encounterId: string): Promise<void> {
  const { rows: cur } = await query<BundleRow>(`${BUNDLE_SELECT} WHERE e.id = $1`, [encounterId]);
  if (!cur[0]) return;
  const current = toBundle(cur[0]);

  const { rows: prev } = await query<BundleRow>(
    `${BUNDLE_SELECT}
     WHERE e.patient_id = $1 AND e.id <> $2 AND e.created_at < $3
     ORDER BY e.created_at DESC LIMIT 1`,
    [current.patientId, current.encounterId, current.createdAt],
  );
  if (!prev[0]) return;
  const prior = toBundle(prev[0]);

  const curRoot = current.codes[0]?.slice(0, 3);
  const priorRoot = prior.codes[0]?.slice(0, 3);
  if (!curRoot || !priorRoot || curRoot === priorRoot) return; // no material revision

  const { rows: existing } = await query<{ id: string }>(
    'SELECT id FROM clinical_lessons WHERE from_encounter_id = $1 AND to_encounter_id = $2',
    [prior.encounterId, current.encounterId],
  );
  if (existing[0]) return;

  const [priorDesc, curDesc] = await Promise.all([
    describeCode(prior.codes[0], prior.assessment),
    describeCode(current.codes[0], current.assessment),
  ]);

  const lesson = await reflectOnRevision({
    prior: toReflectionEncounter(prior, priorDesc),
    current: toReflectionEncounter(current, curDesc),
  });

  let embedding: number[] | null = null;
  try {
    embedding = await embedText(`${lesson.lessonSummary} ${lesson.missedSignals}`);
  } catch (err) {
    console.warn('[lessons] embedding failed; lesson stored without vector:', err);
  }

  const { rows: ins } = await query<{ id: string }>(
    `INSERT INTO clinical_lessons
       (patient_id, from_encounter_id, to_encounter_id, initial_dx, revised_dx,
        missed_signals, recommended_workup, lesson_summary, embedding)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (from_encounter_id, to_encounter_id) DO NOTHING
     RETURNING id`,
    [
      current.patientId,
      prior.encounterId,
      current.encounterId,
      lesson.initialDx,
      lesson.revisedDx,
      lesson.missedSignals,
      lesson.recommendedWorkup,
      lesson.lessonSummary,
      embedding ? JSON.stringify(embedding) : null,
    ],
  );
  if (ins[0]) {
    invalidateLessonCache();
    audit(current.providerId, 'lesson.created', 'lesson', ins[0].id, {
      patientId: current.patientId,
      initialDx: lesson.initialDx,
      revisedDx: lesson.revisedDx,
    });
    console.log(`[lessons] recorded diagnostic revision lesson ${ins[0].id} (${lesson.initialDx} → ${lesson.revisedDx})`);
  }
}

// ── Retrieval (generation-time) ───────────────────────────────────────────────

interface CachedLesson {
  id: string;
  revisedDx: string;
  missedSignals: string;
  recommendedWorkup: string;
  lessonSummary: string;
  embedding: number[];
}

let cache: CachedLesson[] | null = null;
let cachedCount = -1;

export function invalidateLessonCache(): void {
  cache = null;
  cachedCount = -1;
}

async function loadCache(): Promise<CachedLesson[]> {
  const { rows: cnt } = await query<{ n: string }>(
    'SELECT count(*)::text AS n FROM clinical_lessons WHERE embedding IS NOT NULL',
  );
  const n = Number(cnt[0]?.n ?? '0');
  if (cache && n === cachedCount) return cache;

  const { rows } = await query<{
    id: string;
    revised_dx: string;
    missed_signals: string;
    recommended_workup: string;
    lesson_summary: string;
    embedding: number[];
  }>(
    `SELECT id, revised_dx, missed_signals, recommended_workup, lesson_summary, embedding
     FROM clinical_lessons WHERE embedding IS NOT NULL`,
  );
  cache = rows.map((r) => ({
    id: r.id,
    revisedDx: r.revised_dx,
    missedSignals: r.missed_signals,
    recommendedWorkup: r.recommended_workup,
    lessonSummary: r.lesson_summary,
    embedding: r.embedding,
  }));
  cachedCount = n;
  return cache;
}

/** MiniLM vectors are L2-normalized, so the dot product IS the cosine similarity. */
function cosine(a: number[], b: number[]): number {
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

/** Top lessons semantically relevant to this transcript (empty on any failure). */
export async function getRelevantLessons(transcript: string): Promise<LessonHit[]> {
  try {
    if (transcript.trim().length < 20) return [];
    const lessons = await loadCache();
    if (lessons.length === 0) return [];
    const qv = await embedQuery(transcript);
    return lessons
      .map((l) => ({ ...l, score: cosine(qv, l.embedding) }))
      .filter((l) => l.score >= MATCH_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_INJECTED)
      .map(({ embedding: _e, ...hit }) => hit);
  } catch (err) {
    console.warn('[lessons] retrieval failed (continuing without):', err);
    return [];
  }
}

/** Prompt section injected into the scribe system prompt when lessons match. */
export function buildLessonsSection(hits: LessonHit[]): string | null {
  if (hits.length === 0) return null;
  const lines = hits.map(
    (h) =>
      `- When a presentation matches: ${h.missedSignals} → actively consider ${h.revisedDx}; discriminating workup: ${h.recommendedWorkup}`,
  );
  return (
    'PRACTICE-LEARNED DIAGNOSTIC PATTERNS (accumulated from prior diagnostic revisions in this practice; ' +
    'weigh them in the differential and Plan when — and only when — the current presentation genuinely matches; do not overfit):\n' +
    lines.join('\n')
  );
}

/** Chart panel: all lessons for a patient, newest first. */
export async function listLessons(patientId: string): Promise<Lesson[]> {
  const { rows } = await query<{
    id: string;
    initial_dx: string;
    revised_dx: string;
    missed_signals: string;
    recommended_workup: string;
    lesson_summary: string;
    from_encounter_id: string;
    to_encounter_id: string;
    created_at: Date;
  }>(
    `SELECT id, initial_dx, revised_dx, missed_signals, recommended_workup, lesson_summary,
            from_encounter_id, to_encounter_id, created_at
     FROM clinical_lessons WHERE patient_id = $1 ORDER BY created_at DESC`,
    [patientId],
  );
  return rows.map((r) => ({
    id: r.id,
    initialDx: r.initial_dx,
    revisedDx: r.revised_dx,
    missedSignals: r.missed_signals,
    recommendedWorkup: r.recommended_workup,
    lessonSummary: r.lesson_summary,
    fromEncounterId: r.from_encounter_id,
    toEncounterId: r.to_encounter_id,
    createdAt: r.created_at.toISOString(),
  }));
}
