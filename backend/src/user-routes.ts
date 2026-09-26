// Accounts, from the admin's side: there is no sign-up, so this is where people come from. Nobody is ever deleted — an account carries authorship of issues, comments and history — it is switched off instead.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import { USER_SELECT, hashPassword, publicUser, requireAdmin, userById } from './auth.js';

// What it takes to become an account, wherever the account comes from: an admin filling this in, or someone filling it in themselves behind an invite link.
export const accountCredentials = z.object({
  login: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Login can hold letters, digits, dot, dash and underscore'),
  password: z.string().min(8).max(200),
  fullName: z.string().trim().max(120).optional(),
});

const userCreate = accountCredentials.extend({ isAdmin: z.boolean().optional() });

const userPatch = z.object({
  fullName: z.string().trim().max(120).optional(),
  isAdmin: z.boolean().optional(),
  active: z.boolean().optional(),
  /** Null takes the role off; leaving it out keeps whatever they wear. */
  roleId: z.string().uuid().nullable().optional(),
});

export function registerUserRoutes(app: FastifyInstance): void {
  // Everyone signed in can read the list: assignee pickers and mentions need names. It carries no secrets — no email, no token, no hash.
  app.get('/users', async (req, reply) => {
    const auth = await requireAdmin(req, reply);
    if (!auth) return;
    const res = await pool.query(
      `${USER_SELECT} order by u.active desc, lower(coalesce(nullif(u.full_name, ''), u.login))`
    );
    return reply.send({ data: res.rows.map(publicUser) });
  });

  app.post('/users', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const parsed = userCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad account.' });
    }
    const { login, password, fullName, isAdmin } = parsed.data;
    const taken = await pool.query('select 1 from users where lower(login) = lower($1)', [login]);
    if (taken.rowCount) return reply.code(409).send({ error: 'That login is taken.' });
    const res = await pool.query<{ id: string }>(
      `insert into users (login, password_hash, full_name, is_admin)
       values ($1, $2, $3, $4)
       returning id`,
      [login, await hashPassword(password), fullName ?? '', isAdmin ?? false]
    );
    const row = await userById(res.rows[0].id);
    return reply.code(201).send({ data: publicUser(row as NonNullable<typeof row>) });
  });

  app.patch('/users/:id', async (req, reply) => {
    const auth = await requireAdmin(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = userPatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad patch.' });
    }
    const p = parsed.data;
    // Locking yourself out is the one mistake this screen can make that nobody in the browser can undo, so both halves of it are refused.
    if (id === auth.userId && (p.isAdmin === false || p.active === false)) {
      return reply.code(409).send({ error: 'You cannot take your own access away.' });
    }
    const res = await pool.query(
      `update users
          set full_name = coalesce($2, full_name),
              is_admin = coalesce($3, is_admin),
              active = coalesce($4, active),
              role_id = case when $5 then $6::uuid else role_id end
        where id = $1`,
      [
        id,
        p.fullName ?? null,
        p.isAdmin ?? null,
        p.active ?? null,
        p.roleId !== undefined,
        p.roleId ?? null,
      ]
    );
    if (!res.rowCount) return reply.code(404).send({ error: 'No such account.' });
    const row = await userById(id);
    // Switching an account off has to end its sessions, or the tab it is open in keeps working until the cookie expires.
    if (p.active === false) await pool.query('delete from sessions where user_id = $1', [id]);
    return reply.send({ data: publicUser(row as NonNullable<typeof row>) });
  });

  // An admin setting a password for someone else: the person changes it themselves from their profile, this is for handing out the first one and for rescues.
  app.post('/users/:id/password', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const parsed = z.object({ password: z.string().min(8).max(200) }).safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'The password must be at least 8 characters.' });
    }
    const res = await pool.query('update users set password_hash = $1 where id = $2', [
      await hashPassword(parsed.data.password),
      id,
    ]);
    if (!res.rowCount) return reply.code(404).send({ error: 'No such account.' });
    await pool.query('delete from sessions where user_id = $1', [id]);
    return reply.send({ data: { ok: true } });
  });
}
