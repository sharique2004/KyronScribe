// Single pg.Pool per process (PRD §3.1: max 10, idle 30s, connect timeout 5s).
// Lazily constructed so config is guaranteed loaded first. Exposes a typed query helper,
// a transaction helper, a pool error handler, and graceful shutdown.
import pg from 'pg';
import { getConfig } from './config.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

/** Return the process-wide pool, constructing it on first use. */
export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getConfig().databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    // A pooled client can emit 'error' when the backend drops it while idle.
    // Log and let pg discard it; never let it crash the process.
    pool.on('error', (err) => {
      console.error('[db] idle client error', err);
    });
  }
  return pool;
}

/** Parameterized query helper. Always use $1..$n placeholders — never string interpolation. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: readonly unknown[],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params as unknown[] | undefined);
}

/** Run `fn` inside a BEGIN/COMMIT transaction, rolling back on any error. */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Close the pool (used by scripts and graceful shutdown). */
export async function closePool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}

interface ClosableServer {
  close(cb?: (err?: Error) => void): void;
}

let shutdownRegistered = false;

/** Register SIGTERM/SIGINT handlers that drain the HTTP server and close the pool. */
export function registerShutdown(server?: ClosableServer): void {
  if (shutdownRegistered) return;
  shutdownRegistered = true;

  let shuttingDown = false;
  const handle = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received — draining`);
    try {
      if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
      await closePool();
    } catch (err) {
      console.error('[shutdown] error while closing', err);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => void handle('SIGTERM'));
  process.on('SIGINT', () => void handle('SIGINT'));
}
