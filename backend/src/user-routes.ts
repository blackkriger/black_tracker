import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import {
  USER_SELECT,
  hashPassword,
  mayManageRoles,
  newPassword,
  publicUser,
  requireAdmin,
  requireAuth,
  requireSession,
  userById,
} from './auth.js';

export const accountCredentials = z.object({
  login: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Login can hold letters, digits, dot, dash and underscore'),
  password: newPassword,
  fullName: z.string().trim().max(120).optional(),
});

const userPatch = z.object({
  fullName: z.string().trim().max(120).optional(),
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
      gender: 'm' | 'f' | null;
    }>(
      `select u.id, u.login, u.full_name, r.color as role_color, u.gender
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
        gender: r.gender,
      })),
    });
  });

  app.post('/users', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const parsed = accountCredentials.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad account.' });
    }
    const { login, password, fullName } = parsed.data;
    const taken = await pool.query('select 1 from users where lower(login) = lower($1)', [login]);
    if (taken.rowCount) return reply.code(409).send({ error: 'That login is taken.' });
    const res = await pool.query<{ id: string }>(
      `insert into users (login, password_hash, full_name)
       values ($1, $2, $3)
       returning id`,
      [login, await hashPassword(password), fullName ?? '']
    );
    const row = await userById(res.rows[0].id);
    return reply.code(201).send({ data: publicUser(row as NonNullable<typeof row>) });
  });

  app.patch('/users/:id', async (req, reply) => {
    const auth = await requireSession(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = userPatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad patch.' });
    }
    const p = parsed.data;
    const touchesAccount = p.fullName !== undefined || p.active !== undefined;
    if (touchesAccount && !auth.isAdmin) {
      return reply.code(403).send({ error: 'Admins only.' });
    }
    if (!touchesAccount && !(await mayManageRoles(auth))) {
      return reply.code(403).send({ error: 'Handing out roles is not open to your role.' });
    }
    if (id === auth.userId && p.active === false) {
      return reply.code(409).send({ error: 'You cannot take your own access away.' });
    }
    const res = await pool.query(
      `update users
          set full_name = coalesce($2, full_name),
              active = coalesce($3, active),
              role_id = case when $4 then $5::uuid else role_id end
        where id = $1`,
      [
        id,
        p.fullName ?? null,
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
    const parsed = z.object({ password: newPassword }).safeParse(req.body);
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
