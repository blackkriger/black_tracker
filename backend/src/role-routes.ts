// Roles — dev, artist, game designer, whatever the team calls itself. They are rows people create, they carry a colour nobody picks by hand, and they are worn, not obeyed: `users.is_admin` is still the only right the code checks. Reading them is open to everyone signed in; making and unmaking them is an admin's job, the same rule tags and statuses follow.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import { requireAdmin, requireAuth } from './auth.js';
import { pickColor } from './colors.js';

interface RoleRow {
  id: string;
  name: string;
  color: string;
}

const publicRole = (r: RoleRow) => ({ id: r.id, name: r.name, color: r.color });

const roleName = z.object({ name: z.string().trim().min(1).max(40) });

async function takenColors(): Promise<string[]> {
  const res = await pool.query<{ color: string }>('select color from roles');
  return res.rows.map((r) => r.color);
}

export function registerRoleRoutes(app: FastifyInstance): void {
  app.get('/roles', async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const res = await pool.query<RoleRow>('select id, name, color from roles order by lower(name)');
    return reply.send({ data: res.rows.map(publicRole) });
  });

  app.post('/roles', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const parsed = roleName.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'A role needs a name.' });
    const { name } = parsed.data;
    const taken = await pool.query('select 1 from roles where lower(name) = lower($1)', [name]);
    if (taken.rowCount) return reply.code(409).send({ error: 'That role already exists.' });
    const res = await pool.query<RoleRow>(
      'insert into roles (name, color) values ($1, $2) returning id, name, color',
      [name, pickColor(await takenColors())]
    );
    return reply.code(201).send({ data: publicRole(res.rows[0]) });
  });

  // Only the name: the colour is the server's business, and it never changes under a role people have learned to recognise.
  app.patch('/roles/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const parsed = roleName.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'A role needs a name.' });
    const { name } = parsed.data;
    const taken = await pool.query('select 1 from roles where lower(name) = lower($1) and id <> $2', [
      name,
      id,
    ]);
    if (taken.rowCount) return reply.code(409).send({ error: 'That role already exists.' });
    const res = await pool.query<RoleRow>(
      'update roles set name = $2 where id = $1 returning id, name, color',
      [id, name]
    );
    if (!res.rowCount) return reply.code(404).send({ error: 'No such role.' });
    return reply.send({ data: publicRole(res.rows[0]) });
  });

  // Whoever wore it simply stops wearing one — the column is nulled by the foreign key.
  app.delete('/roles/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const res = await pool.query('delete from roles where id = $1', [id]);
    if (!res.rowCount) return reply.code(404).send({ error: 'No such role.' });
    return reply.send({ data: { ok: true } });
  });
}
