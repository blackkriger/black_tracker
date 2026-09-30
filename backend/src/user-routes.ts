import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { inTransaction, pool } from './db.js';
import {
  USER_SELECT,
  hashPassword,
  hashToken,
  mayManageRoles,
  newRawToken,
  publicUser,
  requireAdmin,
  requireAuth,
  requireRoleManager,
  startSession,
  userById,
} from './auth.js';

const RESET_HOURS = 24;

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
  roleId: z.string().uuid().nullable().optional(),
});

export function registerUserRoutes(app: FastifyInstance): void {
  app.get('/users', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const res = await pool.query(
      `${USER_SELECT} order by u.active desc, lower(coalesce(nullif(u.full_name, ''), u.login))`
    );
    return reply.send({
      data: res.rows.map((row) => {
        const person = publicUser(row);
        if (auth.isAdmin || row.id === auth.userId) return person;
        const { token, isAdmin, ...rest } = person;
        return rest;
      }),
    });
  });

  app.get('/people', async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const res = await pool.query<{
      id: string;
      login: string;
      full_name: string;
      role_color: string | null;
    }>(
      `select u.id, u.login, u.full_name, r.color as role_color
         from users u
         left join roles r on r.id = u.role_id
        where u.active
        order by lower(coalesce(nullif(u.full_name, ''), u.login))`
    );
    return reply.send({
      data: res.rows.map((r) => ({
        id: r.id,
        login: r.login,
        fullName: r.full_name,
        roleColor: r.role_color,
      })),
    });
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
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = userPatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad patch.' });
    }
    const p = parsed.data;
    const touchesAccount =
      p.fullName !== undefined || p.isAdmin !== undefined || p.active !== undefined;
    if (touchesAccount && !auth.isAdmin) {
      return reply.code(403).send({ error: 'Admins only.' });
    }
    if (!touchesAccount && !(await mayManageRoles(auth))) {
      return reply.code(403).send({ error: 'Handing out roles is not open to your role.' });
    }
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
    if (p.active === false) await pool.query('delete from sessions where user_id = $1', [id]);
    return reply.send({ data: publicUser(row as NonNullable<typeof row>) });
  });

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

  app.post('/users/:id/reset-link', async (req, reply) => {
    const auth = await requireRoleManager(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const target = await pool.query<{ is_admin: boolean; active: boolean }>(
      'select is_admin, active from users where id = $1',
      [id]
    );
    if (!target.rowCount) return reply.code(404).send({ error: 'No such account.' });
    if (target.rows[0].is_admin && !auth.isAdmin) {
      return reply.code(403).send({ error: "Only an admin can reset an admin's password." });
    }
    if (!target.rows[0].active) return reply.code(409).send({ error: 'This account is switched off.' });
    const raw = newRawToken();
    const expiresAt = await inTransaction(async (client) => {
      await client.query('delete from password_resets where user_id = $1 and used_at is null', [id]);
      const made = await client.query<{ expires_at: Date }>(
        `insert into password_resets (user_id, token_hash, created_by, expires_at)
         values ($1, $2, $3, now() + make_interval(hours => $4::int))
         returning expires_at`,
        [id, hashToken(raw), auth.userId, RESET_HOURS]
      );
      return made.rows[0].expires_at;
    });
    return reply.code(201).send({ data: { token: raw, expiresAt: expiresAt.toISOString() } });
  });

  app.get('/password-resets/:token/check', async (req, reply) => {
    const { token } = req.params as { token: string };
    const res = await pool.query<{ login: string; full_name: string }>(
      `select u.login, u.full_name
         from password_resets r
         join users u on u.id = r.user_id and u.active
        where r.token_hash = $1 and r.used_at is null and r.expires_at > now()`,
      [hashToken(token)]
    );
    if (!res.rowCount) return reply.code(404).send({ error: 'This link is no longer valid.' });
    return reply.send({ data: { login: res.rows[0].login, fullName: res.rows[0].full_name } });
  });

  app.post('/password-resets/:token/accept', async (req, reply) => {
    const { token } = req.params as { token: string };
    const parsed = z.object({ password: z.string().min(8).max(200) }).safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'The password must be at least 8 characters.' });
    }
    const hash = await hashPassword(parsed.data.password);
    const userId = await inTransaction(async (client) => {
      const link = await client.query<{ id: string; user_id: string }>(
        `select r.id, r.user_id
           from password_resets r
           join users u on u.id = r.user_id and u.active
          where r.token_hash = $1 and r.used_at is null and r.expires_at > now()
          for update of r`,
        [hashToken(token)]
      );
      if (!link.rowCount) return null;
      const { id, user_id: owner } = link.rows[0];
      await client.query('update users set password_hash = $1 where id = $2', [hash, owner]);
      await client.query('update password_resets set used_at = now() where id = $1', [id]);
      await client.query('delete from sessions where user_id = $1', [owner]);
      return owner;
    });
    if (!userId) return reply.code(404).send({ error: 'This link is no longer valid.' });
    const row = await userById(userId);
    await startSession(reply, userId);
    return reply.send({ data: publicUser(row as NonNullable<typeof row>) });
  });
}
