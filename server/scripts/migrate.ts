// Simple, idempotent migration runner. Applies migrations/*.sql in filename order,
// each in its own transaction, tracking applied files in schema_migrations.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, '..', 'migrations');

interface AppliedRow {
  filename: string;
}

async function main(): Promise<void> {
  await loadConfig();
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await pool.query<AppliedRow>('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.filename));

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[migrate] skip ${file} (already applied)`);
      continue;
    }
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[migrate] applied ${file}`);
      count += 1;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[migrate] FAILED ${file} — rolled back`);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(`[migrate] done — ${count} new migration(s) applied`);
  await closePool();
}

main().catch((err: unknown) => {
  console.error('[migrate] error', err);
  process.exit(1);
});
