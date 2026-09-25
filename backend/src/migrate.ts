import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      create table if not exists schema_migrations (
        id text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const applied = await client.query<{ id: string }>(
      'select id from schema_migrations'
    );
    const appliedIds = new Set(applied.rows.map((r) => r.id));

    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let appliedCount = 0;
    for (const file of files) {
      const id = file.replace(/\.sql$/, '');
      if (appliedIds.has(id)) continue;
      const sql = await readFile(join(migrationsDir, file), 'utf-8');
      console.log(`Applying ${id}...`);
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (id) values ($1)', [id]);
        await client.query('commit');
        appliedCount++;
      } catch (err) {
        await client.query('rollback');
        throw err;
      }
    }

    if (appliedCount === 0) {
      console.log('No new migrations.');
    } else {
      console.log(`Applied ${appliedCount} migration(s).`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
