import pg from 'pg';
import { env } from './env.js';

// node-postgres parses DATE into a local-zone Date that can shift the day; keep the raw string.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 6,
  idleTimeoutMillis: 30_000,
});

// An unhandled pool 'error' from a dropped idle client would crash the process.
pool.on('error', (err) => {
  console.error('[db] idle client error', err);
});

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

export const ZONE = 'Europe/Moscow';

export const onDays = (column: string, from: string, to: string): string =>
  `(${column} >= coalesce(${from}::date::timestamp at time zone '${ZONE}', '-infinity')
    and ${column} < coalesce((${to}::date + 1)::timestamp at time zone '${ZONE}', 'infinity'))`;
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const UUID_RE = /^[0-9a-f-]{36}$/i;

export const SET_RESOLVED = 'resolved_at = case when $2 then coalesce(resolved_at, now()) else null end';

export const listOf = (value: string | undefined): string[] | null => {
  const items = (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items.slice(0, 100) : null;
};
