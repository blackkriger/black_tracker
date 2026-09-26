// Invite links. Registration stays closed — nobody can sign themselves up — but an admin no longer has to invent a password for someone else: they mint a link, and whoever opens it picks their own login and password and lands signed in. The token is kept as a hash, shown once, and good for one account.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { inTransaction, pool } from './db.js';
import {
  hashPassword,
  hashToken,
  newRawToken,
  publicUser,
  requireAdmin,
  startSession,
  userById,
} from './auth.js';
import { accountCredentials } from './user-routes.js';

const INVITE_DAYS = 7;

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
}

const publicInvite = (r: InviteRow) => ({
  id: r.id,
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
         c.login as created_by_login, u.login as used_by_login
    from invites i
    join users c on c.id = i.created_by
    left join users u on u.id = i.used_by
    left join roles r on r.id = i.role_id`;

export function registerInviteRoutes(app: FastifyInstance): void {
  app.get('/invites', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const res = await pool.query<InviteRow>(`${LIST_SQL} order by i.created_at desc`);
    return reply.send({ data: res.rows.map(publicInvite) });
  });

  app.post('/invites', async (req, reply) => {
    const auth = await requireAdmin(req, reply);
    if (!auth) return;
    const parsed = z
      .object({ isAdmin: z.boolean().optional(), roleId: z.string().uuid().nullable().optional() })
      .safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Bad invite.' });
    const raw = newRawToken();
    const created = await pool.query<{ id: string }>(
      `insert into invites (token_hash, hint, is_admin, role_id, created_by, expires_at)
       values ($1, $2, $3, $4, $5, now() + make_interval(days => $6::int))
       returning id`,
      [
        hashToken(raw),
        raw.slice(-6),
        parsed.data.isAdmin ?? false,
        parsed.data.roleId ?? null,
        auth.userId,
        INVITE_DAYS,
      ]
    );
    const res = await pool.query<InviteRow>(`${LIST_SQL} where i.id = $1`, [created.rows[0].id]);
    // The only moment the token exists anywhere readable; from here on the row carries its tail and nothing else.
    return reply.code(201).send({ data: { ...publicInvite(res.rows[0]), token: raw } });
  });

  // A link nobody walked through is just a key left on the table — it can be thrown away. One that was used is the record of how an account came to exist, and that is kept.
  app.delete('/invites/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
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

  // Open to anyone holding the link: the join screen asks before drawing its form.
  app.get('/invites/:token/check', async (req, reply) => {
    const { token } = req.params as { token: string };
    const res = await pool.query<{ is_admin: boolean }>(
      `select is_admin from invites
        where token_hash = $1 and used_at is null and expires_at > now()`,
      [hashToken(token)]
    );
    if (!res.rowCount) return reply.code(404).send({ error: 'This invite link is no longer valid.' });
    return reply.send({ data: { ok: true, isAdmin: res.rows[0].is_admin } });
  });

  app.post('/invites/:token/accept', async (req, reply) => {
    const { token } = req.params as { token: string };
    const parsed = accountCredentials.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad account.' });
    }
    const { login, password, fullName } = parsed.data;
    const hash = await hashPassword(password);

    type Outcome = { ok: false; error: string; code: number } | { ok: true; userId: string };

    const outcome = await inTransaction(async (client): Promise<Outcome> => {
      // Locked for the length of the transaction, so the same link opened in two tabs cannot make two accounts.
      const invite = await client.query<{ id: string; is_admin: boolean; role_id: string | null }>(
        `select id, is_admin, role_id from invites
          where token_hash = $1 and used_at is null and expires_at > now()
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
    await startSession(reply, outcome.userId);
    return reply.code(201).send({ data: publicUser(row as NonNullable<typeof row>) });
  });
}
