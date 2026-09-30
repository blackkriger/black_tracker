import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth, type Auth } from './auth.js';
import { pool } from './db.js';
import { DENIES_NOTHING, deniedFor, type Denials } from './board-service.js';

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
}

export const tabOf = (req: { headers: Record<string, unknown> }): string =>
  typeof req.headers['x-tab-id'] === 'string' ? (req.headers['x-tab-id'] as string) : '';

interface Client {
  reply: FastifyReply;
  auth: Auth;
  denied: Denials;
  deniedAt: number;
}

async function stillAllowed(client: Client): Promise<Denials | null> {
  const res = await pool.query<{ is_admin: boolean; role_id: string | null; active: boolean }>(
    'select is_admin, role_id, active from users where id = $1',
    [client.auth.userId]
  );
  const row = res.rows[0];
  if (!row || !row.active) return null;
  client.auth = { ...client.auth, isAdmin: row.is_admin, roleId: row.role_id };
  return row.is_admin ? DENIES_NOTHING : await deniedFor(row.role_id);
}

const DENIALS_TTL = 30_000;
// Keep under nginx's proxy_read_timeout, or it closes streams that go quiet.
const HEARTBEAT_MS = 25_000;

const clients = new Map<number, Client>();
let nextId = 1;

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

export async function publish(event: LiveEvent): Promise<void> {
  if (!clients.size) return;
  const { only, ...told } = event;
  const line = `data: ${JSON.stringify({ ...told, at: new Date().toISOString() })}\n\n`;
  const perRole = new Map<string, Denials | null>();
  for (const [id, client] of clients) {
    if (client.reply.raw.destroyed || client.reply.raw.writableEnded) {
      clients.delete(id);
      continue;
    }
    if (only && client.auth.userId !== only) continue;
    let denied: Denials | null;
    const roleKey = `${client.auth.userId}`;
    try {
      if (!perRole.has(roleKey)) perRole.set(roleKey, await denialsFresh(client));
      denied = perRole.get(roleKey) ?? null;
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
    clients.set(id, {
      reply,
      auth,
      denied: auth.isAdmin ? DENIES_NOTHING : await deniedFor(auth.roleId),
      deniedAt: Date.now(),
    });

    const beat = setInterval(() => {
      if (reply.raw.destroyed || reply.raw.writableEnded) {
        clearInterval(beat);
        clients.delete(id);
        return;
      }
      try {
        reply.raw.write(': ping\n\n');
      } catch {
        clearInterval(beat);
        clients.delete(id);
      }
    }, HEARTBEAT_MS);

    req.raw.on('close', () => {
      clearInterval(beat);
      clients.delete(id);
    });
  });
}
