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
  role: 'admin' | 'member';
  /** How the caller proved who they are. Comment routes accept 'session' only. */
  kind: 'session' | 'token';
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: Auth;
  }
}

// What lands in the sessions table is a hash, so a database dump is not a pile of working cookies. Salted with SESSION_SECRET so the hashes are useless against another instance too.
function hashToken(raw: string): string {
  return createHash('sha256').update(`${env.sessionSecret}:${raw}`).digest('hex');
}

const newRawToken = () => randomBytes(32).toString('base64url');

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const checkPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

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
  role: 'admin' | 'member';
  active: boolean;
  api_token: string | null;
  created_at: Date;
  last_seen_at: Date | null;
}

export function publicUser(row: UserRow) {
  return {
    id: row.id,
    login: row.login,
    fullName: row.full_name,
    role: row.role,
    active: row.active,
    hasToken: row.api_token != null,
    createdAt: row.created_at.toISOString(),
    lastSeenAt: row.last_seen_at?.toISOString() ?? null,
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

// Resolves whoever is calling, or null. Never sends a reply — the requireX helpers below do that, so one place decides the status code.
async function resolveAuth(req: FastifyRequest): Promise<Auth | null> {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const raw = header.slice(7).trim();
    if (!raw) return null;
    const res = await pool.query<{ id: string; login: string; role: 'admin' | 'member' }>(
      `select id, login, role from users where api_token = $1 and active`,
      [raw]
    );
    const row = res.rows[0];
    if (!row) return null;
    touchLastSeen(row.id);
    return { userId: row.id, login: row.login, role: row.role, kind: 'token' };
  }

  const cookie = req.cookies?.[SESSION_COOKIE];
  if (!cookie) return null;
  const res = await pool.query<{ id: string; login: string; role: 'admin' | 'member' }>(
    `select u.id, u.login, u.role
       from sessions s
       join users u on u.id = s.user_id and u.active
      where s.token = $1 and s.expires_at > now()`,
    [hashToken(cookie)]
  );
  const row = res.rows[0];
  if (!row) return null;
  touchLastSeen(row.id);
  return { userId: row.id, login: row.login, role: row.role, kind: 'session' };
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

export async function requireAdmin(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<Auth | null> {
  const auth = await requireAuth(req, reply);
  if (!auth) return null;
  if (auth.role !== 'admin') {
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
      `select * from users where lower(login) = lower($1)`,
      [parsed.data.login]
    );
    const row = res.rows[0];
    // The same answer whether the login is unknown or the password is wrong, and a hash is compared either way so the timing does not tell them apart.
    const hash = row?.password_hash ?? '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu';
    const ok = await checkPassword(parsed.data.password, hash);
    if (!row || !ok || !row.active) {
      return reply.code(401).send({ error: 'Wrong login or password.' });
    }

    const raw = await createSession(row.id);
    reply.setCookie(SESSION_COOKIE, raw, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.secureCookies,
      path: '/',
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    });
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
    const res = await pool.query<UserRow>('select * from users where id = $1', [auth.userId]);
    const row = res.rows[0];
    if (!row) return reply.code(404).send({ error: 'User not found.' });
    return reply.send({ data: { ...publicUser(row), authKind: auth.kind } });
  });

  // The raw token is shown once, right here: only its value is stored, and the profile screen says so.
  app.post('/me/regenerate-token', async (req, reply) => {
    const auth = await requireSession(req, reply);
    if (!auth) return;
    const token = newRawToken();
    await pool.query('update users set api_token = $1 where id = $2', [token, auth.userId]);
    return reply.send({ data: { token } });
  });

  app.delete('/me/token', async (req, reply) => {
    const auth = await requireSession(req, reply);
    if (!auth) return;
    await pool.query('update users set api_token = null where id = $1', [auth.userId]);
    return reply.send({ data: { ok: true } });
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
