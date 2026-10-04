import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { inTransaction, pool } from './db.js';
import {
  hashPassword,
  hashToken,
  newRawToken,
  publicUser,
  requireRoleManager,
  startSession,
  userById,
} from './auth.js';
import { accountCredentials } from './user-routes.js';

const INVITE_DAYS = 7;
const RESET_HOURS = 24;

interface InviteRow {
  id: string;
  hint: string;
  is_admin: boolean;
  role_id: string | null;
  role_name: string | null;
  role_color: string | null;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
  created_by_login: string | null;
  used_by_login: string | null;
  for_user: string | null;
  for_login: string | null;
}

const publicInvite = (r: InviteRow) => ({
  id: r.id,
  kind: r.for_user ? 'reset' : 'invite',
  forUser: r.for_login,
  hint: r.hint,
  isAdmin: r.is_admin,
  role:
    r.role_id && r.role_name
      ? { id: r.role_id, name: r.role_name, color: r.role_color ?? '' }
      : null,
  createdAt: r.created_at.toISOString(),
  createdBy: r.created_by_login,
  expiresAt: r.expires_at.toISOString(),
  usedAt: r.used_at?.toISOString() ?? null,
  usedBy: r.used_by_login,
  status: r.used_at ? 'used' : r.expires_at.getTime() < Date.now() ? 'expired' : 'pending',
});

const LIST_SQL = `
  select i.id, i.hint, i.is_admin, i.created_at, i.expires_at, i.used_at,
         i.role_id, r.name as role_name, r.color as role_color,
         c.login as created_by_login, u.login as used_by_login,
         i.for_user, f.login as for_login
    from invites i
    join users c on c.id = i.created_by
    left join users u on u.id = i.used_by
    left join users f on f.id = i.for_user
    left join roles r on r.id = i.role_id`;

export function registerInviteRoutes(app: FastifyInstance): void {
  app.get('/invites', async (req, reply) => {
    if (!(await requireRoleManager(req, reply))) return;
    const res = await pool.query<InviteRow>(`${LIST_SQL} order by i.created_at desc`);
    return reply.send({ data: res.rows.map(publicInvite) });
  });

  app.post('/invites', async (req, reply) => {
    const auth = await requireRoleManager(req, reply);
    if (!auth) return;
    const parsed = z
      .object({
        roleId: z.string().uuid().nullable().optional(),
        forUserId: z.string().uuid().optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Bad invite.' });
    const raw = newRawToken();
    const { forUserId } = parsed.data;
    if (forUserId) {
      const target = await pool.query<{ is_admin: boolean; active: boolean }>(
        'select is_admin, active from users where id = $1',
        [forUserId]
      );
      if (!target.rowCount) return reply.code(404).send({ error: 'No such account.' });
      if (target.rows[0].is_admin && !auth.isAdmin) {
        return reply.code(403).send({ error: "Only an admin can reset an admin's password." });
      }
      if (!target.rows[0].active) {
        return reply.code(409).send({ error: 'This account is switched off.' });
      }
      const madeId = await inTransaction(async (client) => {
        await client.query('delete from invites where for_user = $1 and used_at is null', [forUserId]);
        const made = await client.query<{ id: string }>(
          `insert into invites (token_hash, hint, created_by, for_user, expires_at)
           values ($1, $2, $3, $4, now() + make_interval(hours => $5::int))
           returning id`,
          [hashToken(raw), raw.slice(-6), auth.userId, forUserId, RESET_HOURS]
        );
        return made.rows[0].id;
      });
      const res = await pool.query<InviteRow>(`${LIST_SQL} where i.id = $1`, [madeId]);
      return reply.code(201).send({ data: { ...publicInvite(res.rows[0]), token: raw } });
    }
    const created = await pool.query<{ id: string }>(
      `insert into invites (token_hash, hint, is_admin, role_id, created_by, expires_at)
       values ($1, $2, $3, $4, $5, now() + make_interval(days => $6::int))
       returning id`,
      [
        hashToken(raw),
        raw.slice(-6),
        false,
        parsed.data.roleId ?? null,
        auth.userId,
        INVITE_DAYS,
      ]
    );
    const res = await pool.query<InviteRow>(`${LIST_SQL} where i.id = $1`, [created.rows[0].id]);
    return reply.code(201).send({ data: { ...publicInvite(res.rows[0]), token: raw } });
  });

  app.delete('/invites/:id', async (req, reply) => {
    if (!(await requireRoleManager(req, reply))) return;
    const { id } = req.params as { id: string };
    const res = await pool.query('delete from invites where id = $1 and used_at is null', [id]);
    if (!res.rowCount) {
      const exists = await pool.query('select 1 from invites where id = $1', [id]);
      return exists.rowCount
        ? reply.code(409).send({ error: 'That link was used; it stays as the record of it.' })
        : reply.code(404).send({ error: 'No such invite.' });
    }
    return reply.send({ data: { ok: true } });
  });

  app.get('/invites/:token/check', async (req, reply) => {
    const { token } = req.params as { token: string };
    const res = await pool.query<{
      is_admin: boolean;
      role_name: string | null;
      role_color: string | null;
      for_user: string | null;
      login: string | null;
      full_name: string | null;
    }>(
      `select i.is_admin, r.name as role_name, r.color as role_color,
              i.for_user, f.login, f.full_name
         from invites i
         left join roles r on r.id = i.role_id
         left join users f on f.id = i.for_user
        where i.token_hash = $1 and i.used_at is null and i.expires_at > now()
          and (i.for_user is null or f.active)
          and (not coalesce(f.is_admin, false)
               or exists (select 1 from users m where m.id = i.created_by and m.is_admin))`,
      [hashToken(token)]
    );
    if (!res.rowCount) return reply.code(404).send({ error: 'This link is no longer valid.' });
    const row = res.rows[0];
    return reply.send({
      data: {
        ok: true,
        kind: row.for_user ? 'reset' : 'invite',
        isAdmin: row.is_admin,
        role: row.role_name ? { name: row.role_name, color: row.role_color ?? '' } : null,
        login: row.login,
        fullName: row.full_name,
      },
    });
  });

  app.post('/invites/:token/accept', async (req, reply) => {
    const { token } = req.params as { token: string };
    const kind = await pool.query<{ for_user: string | null }>(
      'select for_user from invites where token_hash = $1',
      [hashToken(token)]
    );
    if (kind.rows[0]?.for_user) {
      const chosen = z.object({ password: z.string().min(8).max(200) }).safeParse(req.body);
      if (!chosen.success) {
        return reply.code(400).send({ error: 'The password must be at least 8 characters.' });
      }
      const newHash = await hashPassword(chosen.data.password);
      const owner = await inTransaction(async (client) => {
        const link = await client.query<{ id: string; for_user: string }>(
          `select i.id, i.for_user
             from invites i
             join users u on u.id = i.for_user and u.active
            where i.token_hash = $1 and i.used_at is null and i.expires_at > now()
              and (not u.is_admin or exists (select 1 from users m where m.id = i.created_by and m.is_admin))
            for update of i`,
          [hashToken(token)]
        );
        if (!link.rowCount) return null;
        const { id, for_user: userId } = link.rows[0];
        await client.query('update users set password_hash = $1 where id = $2', [newHash, userId]);
        await client.query('update invites set used_at = now(), used_by = $2 where id = $1', [id, userId]);
        await client.query('delete from sessions where user_id = $1', [userId]);
        return userId;
      });
      if (!owner) return reply.code(404).send({ error: 'This link is no longer valid.' });
      const who = await userById(owner);
      await startSession(req, reply, owner);
      return reply.send({ data: publicUser(who as NonNullable<typeof who>) });
    }
    const parsed = accountCredentials.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad account.' });
    }
    const { login, password, fullName } = parsed.data;
    const hash = await hashPassword(password);

    type Outcome = { ok: false; error: string; code: number } | { ok: true; userId: string };

    const outcome = await inTransaction(async (client): Promise<Outcome> => {
      // FOR UPDATE stops one link, accepted twice at once, from making two accounts.
      const invite = await client.query<{ id: string; is_admin: boolean; role_id: string | null }>(
        `select id, is_admin, role_id from invites
          where token_hash = $1 and used_at is null and expires_at > now() and for_user is null
          for update`,
        [hashToken(token)]
      );
      if (!invite.rowCount)
        return { ok: false, error: 'This invite link is no longer valid.', code: 404 };

      const taken = await client.query('select 1 from users where lower(login) = lower($1)', [
        login,
      ]);
      if (taken.rowCount) return { ok: false, error: 'That login is taken.', code: 409 };

      const user = await client.query<{ id: string }>(
        `insert into users (login, password_hash, full_name, is_admin, role_id)
         values ($1, $2, $3, $4, $5)
         returning id`,
        [login, hash, fullName ?? '', invite.rows[0].is_admin, invite.rows[0].role_id]
      );
      await client.query('update invites set used_at = now(), used_by = $2 where id = $1', [
        invite.rows[0].id,
        user.rows[0].id,
      ]);
      return { ok: true, userId: user.rows[0].id };
    });

    if (!outcome.ok) return reply.code(outcome.code).send({ error: outcome.error });
    const row = await userById(outcome.userId);
    await startSession(req, reply, outcome.userId);
    return reply.code(201).send({ data: publicUser(row as NonNullable<typeof row>) });
  });
}
