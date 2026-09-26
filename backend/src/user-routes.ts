// Accounts, from the admin's side: there is no sign-up, so this is where people come from. Nobody is ever deleted — an account carries authorship of issues, comments and history — it is switched off instead.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { inTransaction, pool } from './db.js';
import { hashPassword, publicUser, requireAdmin } from './auth.js';

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
});

export function registerUserRoutes(app: FastifyInstance): void {
  // Everyone signed in can read the list: assignee pickers and mentions need names. It carries no secrets — no email, no token, no hash.
  app.get('/users', async (req, reply) => {
    const auth = await requireAdmin(req, reply);
    if (!auth) return;
    const res = await pool.query(
      `select * from users order by active desc, lower(coalesce(nullif(full_name, ''), login))`
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
    const res = await pool.query(
      `insert into users (login, password_hash, full_name, is_admin)
       values ($1, $2, $3, $4)
       returning *`,
      [login, await hashPassword(password), fullName ?? '', isAdmin ?? false]
    );
    return reply.code(201).send({ data: publicUser(res.rows[0]) });
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
              active = coalesce($4, active)
        where id = $1
        returning *`,
      [id, p.fullName ?? null, p.isAdmin ?? null, p.active ?? null]
    );
    if (!res.rowCount) return reply.code(404).send({ error: 'No such account.' });
    // Switching an account off has to end its sessions, or the tab it is open in keeps working until the cookie expires.
    if (p.active === false) await pool.query('delete from sessions where user_id = $1', [id]);
    return reply.send({ data: publicUser(res.rows[0]) });
  });

  // Which boards this person cannot open. Access is a denial list, so an empty answer means every board is theirs.
  app.get('/users/:id/access', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const res = await pool.query<{ board_id: string }>(
      'select board_id from board_denials where user_id = $1',
      [id]
    );
    return reply.send({ data: { deniedBoards: res.rows.map((r) => r.board_id) } });
  });

  app.put('/users/:id/access', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const parsed = z
      .object({ deniedBoards: z.array(z.string().uuid()).max(500) })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Send the list of board ids.' });
    if (!(await pool.query('select 1 from users where id = $1', [id])).rowCount) {
      return reply.code(404).send({ error: 'No such account.' });
    }
    await inTransaction(async (client) => {
      await client.query('delete from board_denials where user_id = $1', [id]);
      if (parsed.data.deniedBoards.length) {
        await client.query(
          `insert into board_denials (board_id, user_id)
           select b, $1 from unnest($2::uuid[]) as b
           on conflict do nothing`,
          [id, parsed.data.deniedBoards]
        );
      }
    });
    return reply.send({ data: { deniedBoards: parsed.data.deniedBoards } });
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
