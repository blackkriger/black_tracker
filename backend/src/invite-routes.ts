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
} from './auth.js';
import { accountCredentials } from './user-routes.js';

const INVITE_DAYS = 7;

interface InviteRow {
  id: string;
  hint: string;
  is_admin: boolean;
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
  createdAt: r.created_at.toISOString(),
  createdBy: r.created_by_login,
  expiresAt: r.expires_at.toISOString(),
  usedAt: r.used_at?.toISOString() ?? null,
  usedBy: r.used_by_login,
  status: r.used_at ? 'used' : r.expires_at.getTime() < Date.now() ? 'expired' : 'pending',
});

const LIST_SQL = `
  select i.id, i.hint, i.is_admin, i.created_at, i.expires_at, i.used_at,
         c.login as created_by_login, u.login as used_by_login
    from invites i
    join users c on c.id = i.created_by
    left join users u on u.id = i.used_by`;

export function registerInviteRoutes(app: FastifyInstance): void {
  app.get('/invites', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const res = await pool.query<InviteRow>(`${LIST_SQL} order by i.created_at desc`);
    return reply.send({ data: res.rows.map(publicInvite) });
  });

  app.post('/invites', async (req, reply) => {
    const auth = await requireAdmin(req, reply);
    if (!auth) return;
    const parsed = z.object({ isAdmin: z.boolean().optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Bad invite.' });
    const raw = newRawToken();
    const created = await pool.query<{ id: string }>(
      `insert into invites (token_hash, hint, is_admin, created_by, expires_at)
       values ($1, $2, $3, $4, now() + make_interval(days => $5::int))
       returning id`,
      [hashToken(raw), raw.slice(-6), parsed.data.isAdmin ?? false, auth.userId, INVITE_DAYS]
    );
    const res = await pool.query<InviteRow>(`${LIST_SQL} where i.id = $1`, [created.rows[0].id]);
    // The only moment the token exists anywhere readable; from here on the row carries its tail and nothing else.
    return reply.code(201).send({ data: { ...publicInvite(res.rows[0]), token: raw } });
  });

  app.delete('/invites/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const res = await pool.query('delete from invites where id = $1', [id]);
    if (!res.rowCount) return reply.code(404).send({ error: 'No such invite.' });
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

    type Outcome =
      | { ok: false; error: string; code: number }
      | { ok: true; user: Parameters<typeof publicUser>[0] };

    const outcome = await inTransaction(async (client): Promise<Outcome> => {
      // Locked for the length of the transaction, so the same link opened in two tabs cannot make two accounts.
      const invite = await client.query<{ id: string; is_admin: boolean }>(
        `select id, is_admin from invites
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

      const user = await client.query(
        `insert into users (login, password_hash, full_name, is_admin)
         values ($1, $2, $3, $4)
         returning *`,
        [login, hash, fullName ?? '', invite.rows[0].is_admin]
      );
      await client.query('update invites set used_at = now(), used_by = $2 where id = $1', [
        invite.rows[0].id,
        user.rows[0].id,
      ]);
      return { ok: true, user: user.rows[0] };
    });

    if (!outcome.ok) return reply.code(outcome.code).send({ error: outcome.error });
    await startSession(reply, outcome.user.id);
    return reply.code(201).send({ data: publicUser(outcome.user) });
  });
}
