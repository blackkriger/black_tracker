import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import pg from 'pg';
import { z } from 'zod';
import { credentialOf, requireAuth, requireSession, type Auth } from './auth.js';
import { pool } from './db.js';
import { env } from './env.js';
import { DENIES_NOTHING, deniedFor, type Denials } from './board-service.js';

export interface BoardPresence {
  board: string[];
  issues: Record<string, string[]>;
}

export interface LiveEvent {
  type: string;
  boardId?: string | null;
  projectId?: string | null;
  issueId?: string;
  issueKey?: string;
  commentId?: string;
  fields?: string[];
  by?: string;
  origin?: string;
  only?: string;
  presence?: BoardPresence;
}

export const tabOf = (req: { headers: Record<string, unknown> }): string =>
  typeof req.headers['x-tab-id'] === 'string' ? (req.headers['x-tab-id'] as string) : '';

interface Client {
  reply: FastifyReply;
  auth: Auth;
  credential: string;
  tab: string;
  denied: Denials;
  deniedAt: number;
}

interface Seat {
  login: string;
  boardId: string | null;
  issueId: string | null;
  issueBoardId: string | null;
  since: number;
}

async function stillAllowed(client: Client): Promise<Denials | null> {
  const res = await pool.query<{ is_admin: boolean; role_id: string | null }>(
    `select u.is_admin, u.role_id
       from users u
      where u.id = $1 and u.active
        and case when $2 = 'token' then u.api_token_hash = $3
                 else exists (
                   select 1 from sessions s
                    where s.user_id = u.id and s.token = $3 and s.expires_at > now()
                 )
            end`,
    [client.auth.userId, client.auth.kind, client.credential]
  );
  const row = res.rows[0];
  if (!row) return null;
  client.auth = { ...client.auth, isAdmin: row.is_admin, roleId: row.role_id };
  return row.is_admin ? DENIES_NOTHING : await deniedFor(row.role_id);
}

const DENIALS_TTL = 30_000;
// Keep under nginx's proxy_read_timeout, or it closes streams that go quiet.
const HEARTBEAT_MS = 25_000;

const clients = new Map<number, Client>();
let nextId = 1;

const seats = new Map<string, Seat>();
const projectOfBoard = new Map<string, string>();
const seatOf = (userId: string, tab: string): string => `${userId}:${tab}`;

async function projectOf(boardId: string): Promise<string | null> {
  const known = projectOfBoard.get(boardId);
  if (known) return known;
  const res = await pool.query<{ project_id: string }>('select project_id from boards where id = $1', [boardId]);
  const id = res.rows[0]?.project_id ?? null;
  if (id) projectOfBoard.set(boardId, id);
  return id;
}

function presenceOf(boardId: string): BoardPresence {
  const board = new Set<string>();
  const issues = new Map<string, Set<string>>();
  for (const seat of seats.values()) {
    if (seat.boardId === boardId) board.add(seat.login);
    if (seat.issueId && seat.issueBoardId === boardId) {
      issues.set(seat.issueId, (issues.get(seat.issueId) ?? new Set()).add(seat.login));
    }
  }
  return { board: [...board], issues: Object.fromEntries([...issues].map(([id, who]) => [id, [...who]])) };
}

async function tellPresence(boardIds: (string | null | undefined)[]): Promise<void> {
  for (const boardId of new Set(boardIds.filter((id): id is string => !!id))) {
    void publish({ type: 'presence.changed', boardId, projectId: await projectOf(boardId), presence: presenceOf(boardId) });
  }
}

function leave(key: string): void {
  const seat = seats.get(key);
  if (!seat) return;
  seats.delete(key);
  void tellPresence([seat.boardId, seat.issueBoardId]);
}

function leaveIfGone(userId: string, tab: string): void {
  const open = [...clients.values()].some((c) => c.auth.userId === userId && c.tab === tab);
  if (!open) leave(seatOf(userId, tab));
}

const SEAT_GRACE_MS = 60_000;
setInterval(() => {
  for (const [key, seat] of seats) {
    const [userId, tab] = key.split(':');
    const open = [...clients.values()].some((c) => c.auth.userId === userId && c.tab === tab);
    if (!open && Date.now() - seat.since > SEAT_GRACE_MS) leave(key);
  }
}, SEAT_GRACE_MS).unref();

async function denialsFresh(client: Client): Promise<Denials | null> {
  if (Date.now() - client.deniedAt <= DENIALS_TTL) return client.denied;
  const denied = await stillAllowed(client);
  if (!denied) return null;
  client.denied = denied;
  client.deniedAt = Date.now();
  return denied;
}

function mayHear(denied: Denials, event: LiveEvent): boolean {
  if (denied.everything) return false;
  if (event.boardId && denied.boards.has(event.boardId)) return false;
  if (event.projectId && denied.projects.has(event.projectId)) return false;
  return true;
}

const historyOf = new Map<string, string | null>();
let historyFlush: ReturnType<typeof setTimeout> | null = null;

async function announceHistory(): Promise<void> {
  historyFlush = null;
  const changed = [...historyOf];
  historyOf.clear();
  const res = await pool.query<{ id: string; readable_id: string; board_id: string; project_id: string }>(
    'select id, readable_id, board_id, project_id from issues where id = any($1::uuid[])',
    [changed.map(([id]) => id)]
  );
  const people = await pool.query<{ id: string; login: string }>('select id, login from users where id = any($1::uuid[])', [
    changed.map(([, by]) => by).filter((by): by is string => !!by),
  ]);
  const loginOf = new Map(people.rows.map((u) => [u.id, u.login]));
  const actorOf = new Map(changed);
  for (const row of res.rows) {
    const by = actorOf.get(row.id);
    void publish({
      type: 'history.added',
      issueId: row.id,
      issueKey: row.readable_id,
      boardId: row.board_id,
      projectId: row.project_id,
      by: by ? loginOf.get(by) : undefined,
    });
  }
}

export async function listenForHistory(): Promise<void> {
  const client = new pg.Client({ connectionString: env.databaseUrl });
  const again = (err?: Error): void => {
    if (err) console.error('[events] history listener lost', err.message);
    client.removeAllListeners();
    void client.end().catch(() => {});
    setTimeout(() => void listenForHistory(), 5000).unref();
  };
  client.on('notification', (msg) => {
    try {
      const { issue, by } = JSON.parse(msg.payload ?? '{}') as { issue?: string; by?: string | null };
      if (issue) historyOf.set(issue, by ?? null);
    } catch {
      return;
    }
    historyFlush ??= setTimeout(() => {
      void announceHistory().catch((err) => console.error('[events] history announce failed', (err as Error).message));
    }, 50);
  });
  client.on('error', again);
  try {
    await client.connect();
    await client.query('listen issue_history');
  } catch (err) {
    again(err as Error);
  }
}

export async function publish(event: LiveEvent): Promise<void> {
  if (!clients.size) return;
  const { only, ...told } = event;
  const line = `data: ${JSON.stringify({ ...told, at: new Date().toISOString() })}\n\n`;
  for (const [id, client] of clients) {
    if (client.reply.raw.destroyed || client.reply.raw.writableEnded) {
      clients.delete(id);
      continue;
    }
    if (only && client.auth.userId !== only) continue;
    let denied: Denials | null;
    try {
      denied = await denialsFresh(client);
    } catch {
      continue;
    }
    if (!denied) {
      client.reply.raw.end();
      clients.delete(id);
      continue;
    }
    if (!mayHear(denied, event)) continue;
    client.reply.raw.write(line);
  }
}

const TOPICS: [RegExp, string][] = [
  // First match wins, so a nested path must come before its parent.
  [/^\/projects\/[^/]+\/boards/, 'board'],
  [/^\/projects/, 'project'],
  [/^\/boards\/[^/]+\/states/, 'state'],
  [/^\/states/, 'state'],
  [/^\/boards/, 'board'],
  [/^\/tags/, 'tag'],
  [/^\/roles/, 'role'],
  [/^\/users/, 'user'],
  [/^\/me$/, 'user'],
  [/^\/invites/, 'invite'],
  [/^\/key-dates/, 'key-date'],
  [/^\/notices/, 'notice'],
];

const SPOKEN_FOR = /^\/(issues|comments|attachments)|\/issues/;

export function registerChangeFeed(app: FastifyInstance): void {
  app.addHook('onResponse', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    if (reply.statusCode >= 300) return;
    const route = req.routeOptions?.url ?? req.url;
    if (SPOKEN_FOR.test(route)) return;
    const topic = TOPICS.find(([pattern]) => pattern.test(route))?.[1];
    if (!topic) return;
    void publish({ type: `${topic}.changed`, by: req.auth?.login, origin: tabOf(req) });
  });
}

export function registerEventRoutes(app: FastifyInstance): void {
  app.get('/events', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const credential = credentialOf(req);
    if (!credential) return reply.code(401).send({ error: 'Sign in first.' });

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Stops nginx buffering the event stream.
      'X-Accel-Buffering': 'no',
    });
    // Without an 'error' listener, a socket dying mid-write crashes the process.
    reply.raw.on('error', () => {
      clients.delete(id);
    });
    reply.raw.write(': open\n\n');

    const id = nextId++;
    const tab = String((req.query as { tab?: string }).tab ?? '').slice(0, 64);
    clients.set(id, {
      reply,
      auth,
      credential,
      tab,
      denied: auth.isAdmin ? DENIES_NOTHING : await deniedFor(auth.roleId),
      deniedAt: Date.now(),
    });

    const gone = (): void => {
      clearInterval(beat);
      clients.delete(id);
      if (tab) leaveIfGone(auth.userId, tab);
    };
    const beat = setInterval(() => {
      if (reply.raw.destroyed || reply.raw.writableEnded) {
        gone();
        return;
      }
      try {
        reply.raw.write(': ping\n\n');
      } catch {
        gone();
      }
    }, HEARTBEAT_MS);

    req.raw.on('close', gone);
  });

  app.post('/presence', async (req, reply) => {
    const auth = await requireSession(req, reply);
    if (!auth) return;
    const tab = tabOf(req).slice(0, 64);
    const parsed = z
      .object({ boardId: z.string().uuid().nullable(), issueId: z.string().uuid().nullable() })
      .safeParse(req.body);
    if (!tab || !parsed.success) return reply.code(400).send({ error: 'Bad presence.' });
    const denied = auth.isAdmin ? DENIES_NOTHING : await deniedFor(auth.roleId);
    const open = (boardId: string, projectId: string | null): boolean =>
      !!projectId && !denied.everything && !denied.boards.has(boardId) && !denied.projects.has(projectId);

    let boardId = parsed.data.boardId;
    if (boardId && !open(boardId, await projectOf(boardId))) boardId = null;
    let issueId = parsed.data.issueId;
    let issueBoardId: string | null = null;
    if (issueId) {
      const res = await pool.query<{ board_id: string; project_id: string }>(
        'select board_id, project_id from issues where id = $1',
        [issueId]
      );
      const row = res.rows[0];
      if (row && open(row.board_id, row.project_id)) issueBoardId = row.board_id;
      else issueId = null;
    }

    const key = seatOf(auth.userId, tab);
    const before = seats.get(key);
    if (boardId || issueId) {
      seats.set(key, { login: auth.login, boardId, issueId, issueBoardId, since: Date.now() });
    } else {
      seats.delete(key);
    }
    void tellPresence([before?.boardId, before?.issueBoardId, boardId, issueBoardId]);
    const shown = [...new Set([boardId, issueBoardId].filter((id): id is string => !!id))];
    return reply.send({ data: Object.fromEntries(shown.map((id) => [id, presenceOf(id)])) });
  });
}
