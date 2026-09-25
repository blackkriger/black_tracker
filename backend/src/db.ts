import pg from 'pg';
import { env } from './env.js';

// A DATE column is a calendar day, not an instant: node-postgres would hand back a Date in the server's zone and shift `due_date` across midnight.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
// Counts come back as INT8 strings; the API answers with numbers.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 6,
  idleTimeoutMillis: 30_000,
});

// An idle client whose connection dies — a Postgres restart, a network blip — raises 'error' on the pool, and an unhandled one takes the process down. The pool discards that client; the next query opens a fresh one.
pool.on('error', (err) => {
  console.error('[db] idle client error', err);
});

// Every write that touches more than one row runs here: one checked-out client with begin/commit/rollback, never `pool.query('begin')`, which scatters a transaction across connections.
export async function inTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
