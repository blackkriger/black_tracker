import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { inTransaction, pool } from './db.js';
import { env } from './env.js';

export const SESSION_COOKIE = 'tracker_session';
const SESSION_DAYS = 30;
const LAST_SEEN_THROTTLE_MS = 15 * 60 * 1000;

export interface Auth {
  userId: string;
  login: string;
  isAdmin: boolean;
  roleId: string | null;
  kind: 'session' | 'token';
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: Auth;
  }
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(`${env.sessionSecret}:${raw}`).digest('hex');
}

export const newRawToken = () => randomBytes(32).toString('base64url');

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
const DUMMY_HASH = bcrypt.hashSync('not anyone', 10);
export const checkPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

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
  role_can_manage_roles: boolean | null;
  api_token_hash: string | null;
  api_token_hint: string | null;
  api_token_created_at: Date | null;
  api_token_last_used_at: Date | null;
  created_at: Date;
  last_seen_at: Date | null;
}

export const USER_SELECT = `
  select u.*, r.name as role_name, r.color as role_color, r.can_delete as role_can_delete,
         r.can_manage_roles as role_can_manage_roles
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
    canDelete: row.is_admin || row.role_can_delete === true,
    canManageRoles: row.is_admin || row.role_can_manage_roles === true,
    role:
      row.role_id && row.role_name
        ? { id: row.role_id, name: row.role_name, color: row.role_color ?? '' }
        : null,
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

const tokenUseWrites = new Map<string, number>();
function touchTokenUse(userId: string): void {
  const now = Date.now();
  if (now - (tokenUseWrites.get(userId) ?? 0) < LAST_SEEN_THROTTLE_MS) return;
  tokenUseWrites.set(userId, now);
  pool
    .query('update users set api_token_last_used_at = now() where id = $1', [userId])
    .catch((err) => console.error('[auth] token-use write failed', err));
}

export function credentialOf(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const raw = header.slice(7).trim();
    return raw ? hashToken(raw) : null;
  }
  const cookie = req.cookies?.[SESSION_COOKIE];
  return cookie ? hashToken(cookie) : null;
}

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

export async function mayManageRoles(auth: Auth): Promise<boolean> {
  if (auth.isAdmin) return true;
  if (!auth.roleId) return false;
  const res = await pool.query('select 1 from roles where id = $1 and can_manage_roles', [
    auth.roleId,
  ]);
  return res.rowCount === 1;
}

export async function requireRoleManager(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<Auth | null> {
  const auth = await requireSession(req, reply);
  if (!auth) return null;
  if (await mayManageRoles(auth)) return auth;
  reply.code(403).send({ error: 'Handing out roles is not open to your role.' });
  return null;
}

const ROLELESS_PATHS = new Set([
  '/health',
  '/login',
  '/logout',
  '/me',
  '/me/password',
  '/me/token',
  '/me/regenerate-token',
  '/events',
]);

export function registerRoleWall(app: FastifyInstance): void {
  app.addHook('preHandler', async (req, reply) => {
    if (ROLELESS_PATHS.has(req.url.split('?')[0])) return;
    const auth = req.auth ?? (await resolveAuth(req));
    if (!auth) return;
    req.auth = auth;
    if (auth.isAdmin || auth.roleId) return;
    return reply.code(403).send({ error: 'Nothing is open to you until you are given a role.' });
  });
}

export async function requireAdmin(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<Auth | null> {
  const auth = await requireSession(req, reply);
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

const TRIES_BEFORE_LOCK = 8;
const LOCK_MS = 5 * 60 * 1000;
const tries = new Map<string, { count: number; until: number; seen: number }>();

function attemptKey(req: FastifyRequest, login: string): string {
  return `${req.ip}|${login.toLowerCase()}`;
}

function lockedFor(key: string): number {
  const row = tries.get(key);
  if (!row) return 0;
  if (row.until > Date.now()) return row.until - Date.now();
  if (row.until) tries.delete(key);
  return 0;
}

function noteFailure(key: string): void {
  const row = tries.get(key) ?? { count: 0, until: 0, seen: 0 };
  row.count += 1;
  if (row.count >= TRIES_BEFORE_LOCK) {
    row.count = 0;
    row.until = Date.now() + LOCK_MS;
  }
  row.seen = Date.now();
  tries.set(key, row);
  if (tries.size > 500) {
    const stale = Date.now() - LOCK_MS;
    for (const [k, v] of tries) if ((v.until || v.seen) < stale) tries.delete(k);
  }
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Login and password required.' });

    const key = attemptKey(req, parsed.data.login);
    const waiting = lockedFor(key);
    if (waiting) {
      return reply
        .code(429)
        .send({ error: `Too many attempts. Try again in ${Math.ceil(waiting / 60000)} minutes.` });
    }

    const res = await pool.query<UserRow & { password_hash: string }>(
      `${USER_SELECT} where lower(u.login) = lower($1)`,
      [parsed.data.login]
    );
    const row = res.rows[0];
    // Compare against a dummy hash for unknown logins so timing does not reveal which logins exist.
    const hash = row?.password_hash ?? DUMMY_HASH;
    const ok = await checkPassword(parsed.data.password, hash);
    if (!row || !ok || !row.active) {
      noteFailure(key);
      return reply.code(401).send({ error: 'Wrong login or password.' });
    }
    tries.delete(key);

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
    await inTransaction(async (client) => {
      await client.query('update users set password_hash = $1 where id = $2', [hash, auth.userId]);
      await client.query('delete from sessions where user_id = $1', [auth.userId]);
    });
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

export async function pruneSessions(): Promise<void> {
  await pool
    .query('delete from sessions where expires_at < now()')
    .catch((err) => console.error('[auth] session prune failed', err));
}
