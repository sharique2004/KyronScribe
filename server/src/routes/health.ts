// Health check (PRD §5) for nginx / systemd. Pings the pool with a 1s timeout.
import { Router, type Request, type Response } from 'express';
import { getPool } from '../db.js';
import { getConfig, effectiveProvider } from '../config.js';

const router = Router();

async function pingDb(): Promise<boolean> {
  const client = await getPool().connect();
  try {
    await Promise.race([
      client.query('SELECT 1'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('db ping timeout')), 1000),
      ),
    ]);
    return true;
  } finally {
    client.release();
  }
}

router.get('/', async (_req: Request, res: Response) => {
  let db = false;
  try {
    db = await pingDb();
  } catch {
    db = false;
  }
  // `mock` tells the UI whether generation runs in mock mode (no key / SCRIBE_MOCK) so it can
  // show the mock chip (PRD §2.2 P5); `provider` is the effective AI provider (additive field).
  // Read defensively — never let config break the health probe.
  let mock = false;
  let provider: ReturnType<typeof effectiveProvider> = 'mock';
  try {
    provider = effectiveProvider(getConfig());
    mock = provider === 'mock';
  } catch {
    mock = false;
    provider = 'mock';
  }
  // 503 when the DB ping fails so deploy gates / monitors detect an outage; the
  // body is kept identical in both cases for the UI's mock-mode chip.
  res.status(db ? 200 : 503).json({ ok: db, db, mock, provider });
});

export default router;
