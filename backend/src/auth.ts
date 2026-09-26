// Two ways in, one place that sets `req.auth`: a session cookie for the browser and a personal API token for agents and scripts. The token is deliberately weaker — it can move issues around, but it cannot speak as a person, so comment routes demand a session.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import { env } from './env.js';

export const SESSION_COOKIE = 'tracker_session';
const SESSION_DAYS = 30;
// A session stamped this recently does not need its last-seen written again.
const LAST_SEEN_THROTTLE_MS = 15 * 60 * 1000;

export interface Auth {
  userId: string;
  login: string;
  /** The creator's own key: may change how the tracker is set up, and is kept out of every board denial. Held in the database, never handed out by a screen. */
  isAdmin: boolean;
  /** What they are on the team. Board access is denied to roles, so this is what a denial is checked against. */
  roleId: string | null;
  /** How the caller proved who they are. Comment routes accept 'session' only. */
  kind: 'session' | 'token';
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: Auth;
  }
}

// What lands in the sessions table is a hash, so a database dump is not a pile of working cookies. Salted with SESSION_SECRET so the hashes are useless against another instance too.
export function hashToken(raw: string): string {
  return createHash('sha256').update(`${env.sessionSecret}:${raw}`).digest('hex');
}

export const newRawToken = () => randomBytes(32).toString('base64url');

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const checkPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

// Signing someone in: one place, so /login and an accepted invite hand out the same cookie.
export async function startSession(reply: FastifyReply, userId: string): Promise<void> {
  const raw = await createSession(userId);
  reply.setCookie(SESSION_COOKIE, raw, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.secureCookies,
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

async function createSession(userId: string): Promise<string> {
  const raw = newRawToken();
  await pool.query(
    `insert into sessions (token, user_id, expires_at)
     values ($1, $2, now() + make_interval(days => $3::int))`,
    [hashToken(raw), userId, SESSION_DAYS]
  );
  return raw;
}

interface UserRow {
  id: string;
  login: string;
  full_name: string;
  is_admin: boolean;
  active: boolean;
  role_id: string | null;
  role_name: string | null;
  role_color: string | null;
  role_can_delete: boolean | null;
  api_token_hash: string | null;
  api_token_hint: string | null;
  api_token_created_at: Date | null;
  api_token_last_used_at: Date | null;
  created_at: Date;
  last_seen_at: Date | null;
}

// Every route that hands back a person reads them through this, so the role always travels with them.
export const USER_SELECT = `
  select u.*, r.name as role_name, r.color as role_color, r.can_delete as role_can_delete
    from users u
    left join roles r on r.id = u.role_id`;

export async function userById(id: string): Promise<UserRow | null> {
  const res = await pool.query<UserRow>(`${USER_SELECT} where u.id = $1`, [id]);
  return res.rows[0] ?? null;
}

export function publicUser(row: UserRow) {
  return {
    id: row.id,
    login: row.login,
    fullName: row.full_name,
    isAdmin: row.is_admin,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    lastSeenAt: row.last_seen_at?.toISOString() ?? null,
    /** Whether the delete buttons do anything for them: the creator always, everyone else through their role. */
    canDelete: row.is_admin || row.role_can_delete === true,
    // What they are called on the team, and what it lets them do.
    role:
      row.role_id && row.role_name
        ? { id: row.role_id, name: row.role_name, color: row.role_color ?? '' }
        : null,
    // The raw token is gone the moment it is handed over, so the profile shows the tail and the dates instead.
    token: row.api_token_hash
      ? {
          hint: row.api_token_hint,
          createdAt: row.api_token_created_at?.toISOString() ?? null,
          lastUsedAt: row.api_token_last_used_at?.toISOString() ?? null,
        }
      : null,
  };
}

const lastSeenWrites = new Map<string, number>();
function touchLastSeen(userId: string): void {
  const now = Date.now();
  if (now - (lastSeenWrites.get(userId) ?? 0) < LAST_SEEN_THROTTLE_MS) return;
  lastSeenWrites.set(userId, now);
  pool
    .query('update users set last_seen_at = now() where id = $1', [userId])
    .catch((err) => console.error('[auth] last-seen write failed', err));
}

// Same throttle as the visit stamp: an agent can fire a burst of calls, and one write a quarter hour is enough to answer "is this token still in use".
const tokenUseWrites = new Map<string, number>();
function touchTokenUse(userId: string): void {
  const now = Date.now();
  if (now - (tokenUseWrites.get(userId) ?? 0) < LAST_SEEN_THROTTLE_MS) return;
  tokenUseWrites.set(userId, now);
  pool
    .query('update users set api_token_last_used_at = now() where id = $1', [userId])
    .catch((err) => console.error('[auth] token-use write failed', err));
}

// Resolves whoever is calling, or null. Never sends a reply — the requireX helpers below do that, so one place decides the status code.
async function resolveAuth(req: FastifyRequest): Promise<Auth | null> {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const raw = header.slice(7).trim();
    if (!raw) return null;
    const res = await pool.query<{
      id: string;
      login: string;
      is_admin: boolean;
      role_id: string | null;
    }>(`select id, login, is_admin, role_id from users where api_token_hash = $1 and active`, [
      hashToken(raw),
    ]);
    const row = res.rows[0];
    if (!row) return null;
    touchLastSeen(row.id);
    touchTokenUse(row.id);
    return {
      userId: row.id,
      login: row.login,
      isAdmin: row.is_admin,
      roleId: row.role_id,
      kind: 'token',
    };
  }

  const cookie = req.cookies?.[SESSION_COOKIE];
  if (!cookie) return null;
  const res = await pool.query<{
    id: string;
    login: string;
    is_admin: boolean;
    role_id: string | null;
  }>(
    `select u.id, u.login, u.is_admin, u.role_id
       from sessions s
       join users u on u.id = s.user_id and u.active
      where s.token = $1 and s.expires_at > now()`,
    [hashToken(cookie)]
  );
  const row = res.rows[0];
  if (!row) return null;
  touchLastSeen(row.id);
  return {
    userId: row.id,
    login: row.login,
    isAdmin: row.is_admin,
    roleId: row.role_id,
    kind: 'session',
  };
}

export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<Auth | null> {
  const auth = req.auth ?? (await resolveAuth(req));
  if (!auth) {
    reply.code(401).send({ error: 'Sign in first.' });
    return null;
  }
  req.auth = auth;
  return auth;
}

// Anything that speaks as a person — comments, and the account's own settings. An agent's token is for moving work along, not for writing in someone's name.
export async function requireSession(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<Auth | null> {
  const auth = await requireAuth(req, reply);
  if (!auth) return null;
  if (auth.kind !== 'session') {
    reply.code(403).send({ error: 'An API token cannot do this — sign in instead.' });
    return null;
  }
  return auth;
}

// Deleting is a right a role can be given: it takes away work someone else has done, so it is not simply part of being able to reach the thing. The creator holds it by virtue of is_admin; everyone else holds it only through their role. The access system itself — roles, invites, accounts — stays admin-only, or a role could be granted the power to dismantle the rules it lives under.
export async function requireDeleter(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<Auth | null> {
  const auth = await requireAuth(req, reply);
  if (!auth) return null;
  if (auth.isAdmin) return auth;
  if (auth.roleId) {
    const res = await pool.query('select 1 from roles where id = $1 and can_delete', [auth.roleId]);
    if (res.rowCount) return auth;
  }
  reply.code(403).send({ error: 'Deleting is not open to your role.' });
  return null;
}

export async function requireAdmin(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<Auth | null> {
  const auth = await requireAuth(req, reply);
  if (!auth) return null;
  if (!auth.isAdmin) {
    reply.code(403).send({ error: 'Admins only.' });
    return null;
  }
  return auth;
}

const loginSchema = z.object({
  login: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Login and password required.' });

    const res = await pool.query<UserRow & { password_hash: string }>(
      `${USER_SELECT} where lower(u.login) = lower($1)`,
      [parsed.data.login]
    );
    const row = res.rows[0];
    // The same answer whether the login is unknown or the password is wrong, and a hash is compared either way so the timing does not tell them apart.
    const hash = row?.password_hash ?? '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu';
    const ok = await checkPassword(parsed.data.password, hash);
    if (!row || !ok || !row.active) {
      return reply.code(401).send({ error: 'Wrong login or password.' });
    }

    await startSession(reply, row.id);
    return reply.send({ data: publicUser(row) });
  });

  app.post('/logout', async (req, reply) => {
    const cookie = req.cookies?.[SESSION_COOKIE];
    if (cookie) await pool.query('delete from sessions where token = $1', [hashToken(cookie)]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.send({ data: { ok: true } });
  });

  app.get('/me', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const row = await userById(auth.userId);
    if (!row) return reply.code(404).send({ error: 'User not found.' });
    return reply.send({ data: { ...publicUser(row), authKind: auth.kind } });
  });

  // The raw token is handed over exactly here and never again: the database keeps its hash, its last four characters and the dates. A lost token is replaced, not recovered.
  app.post('/me/regenerate-token', async (req, reply) => {
    const auth = await requireSession(req, reply);
    if (!auth) return;
    const token = `trk_${newRawToken()}`;
    await pool.query(
      `update users
          set api_token_hash = $1, api_token_hint = $2,
              api_token_created_at = now(), api_token_last_used_at = null
        where id = $3`,
      [hashToken(token), token.slice(-4), auth.userId]
    );
    return reply.send({ data: { token } });
  });

  app.delete('/me/token', async (req, reply) => {
    const auth = await requireSession(req, reply);
    if (!auth) return;
    await pool.query(
      `update users
          set api_token_hash = null, api_token_hint = null,
              api_token_created_at = null, api_token_last_used_at = null
        where id = $1`,
      [auth.userId]
    );
    return reply.send({ data: { ok: true } });
  });

  // The display name is the only thing a person changes about themselves; the login and the role belong to an admin.
  app.patch('/me', async (req, reply) => {
    const auth = await requireSession(req, reply);
    if (!auth) return;
    const parsed = z
      .object({ fullName: z.string().trim().max(120) })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Name is too long.' });
    await pool.query('update users set full_name = $1 where id = $2', [
      parsed.data.fullName,
      auth.userId,
    ]);
    const row = await userById(auth.userId);
    return reply.send({ data: publicUser(row as NonNullable<typeof row>) });
  });

  app.post('/me/password', async (req, reply) => {
    const auth = await requireSession(req, reply);
    if (!auth) return;
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'The new password must be at least 8 characters.' });
    }
    const res = await pool.query<{ password_hash: string }>(
      'select password_hash from users where id = $1',
      [auth.userId]
    );
    const row = res.rows[0];
    if (!row || !(await checkPassword(parsed.data.currentPassword, row.password_hash))) {
      return reply.code(403).send({ error: 'Current password is wrong.' });
    }
    const hash = await hashPassword(parsed.data.newPassword);
    // Changing the password drops every other session; this one is re-issued so the browser stays signed in.
    await pool.query('update users set password_hash = $1 where id = $2', [hash, auth.userId]);
    await pool.query('delete from sessions where user_id = $1', [auth.userId]);
    const raw = await createSession(auth.userId);
    reply.setCookie(SESSION_COOKIE, raw, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.secureCookies,
      path: '/',
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    });
    return reply.send({ data: { ok: true } });
  });
}

// Expired rows pile up otherwise; called from the boot sequence and once a day after that.
export async function pruneSessions(): Promise<void> {
  await pool
    .query('delete from sessions where expires_at < now()')
    .catch((err) => console.error('[auth] session prune failed', err));
}

// Constant-time compare for anything that needs it later (webhook secrets, invite codes).
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
