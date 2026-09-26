// One channel for the whole tracker. Every write that other people would want to know about is announced here, and every open tab is listening: a board redraws the moment someone else moves a card, and an issue someone is reading updates under them with the changed field lit up.
//
// Server-sent events rather than websockets: the traffic is one-way, it rides the same HTTPS the API does, and the browser reconnects on its own. A comment line every 25 seconds keeps the proxy from deciding an idle stream is a dead one.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth, type Auth } from './auth.js';
import { pool } from './db.js';
import { DENIES_NOTHING, deniedFor, type Denials } from './board-service.js';

export interface LiveEvent {
  /** 'issue.created', 'issue.moved', 'comment.added' — the noun and what happened to it. */
  type: string;
  /** Who may hear it: a listener whose role cannot open this board is simply not told. */
  boardId?: string | null;
  projectId?: string | null;
  issueId?: string;
  issueKey?: string;
  commentId?: string;
  /** Which fields changed, so the reader can light them up rather than guess. */
  fields?: string[];
  /** The login behind the change, for the history line and for who to blame. */
  by?: string;
  /** The tab that caused it: that one tab already shows the change and is told to ignore the echo. */
  origin?: string;
}

/** Which tab a request came from, when it said. */
export const tabOf = (req: { headers: Record<string, unknown> }): string =>
  typeof req.headers['x-tab-id'] === 'string' ? (req.headers['x-tab-id'] as string) : '';

interface Client {
  reply: FastifyReply;
  auth: Auth;
  denied: Denials;
  deniedAt: number;
}

/** Null when the account is gone or switched off, which ends the stream. */
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
const HEARTBEAT_MS = 25_000;

const clients = new Map<number, Client>();
let nextId = 1;

// The connection outlives any single request, so what the listener is allowed to hear is re-read on a timer: a role swapped or an account switched off has to take effect without waiting for them to reload.
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
  const line = `data: ${JSON.stringify({ ...event, at: new Date().toISOString() })}\n\n`;
  for (const [id, client] of clients) {
    // A socket can die without the close handler running — a write to it would be swallowed and the client would sit in the map for good.
    if (client.reply.raw.destroyed || client.reply.raw.writableEnded) {
      clients.delete(id);
      continue;
    }
    let denied: Denials | null;
    try {
      denied = await denialsFresh(client);
    } catch {
      // A blip reading the denials is not a reason to forget a listener: it keeps its stream and misses this one event.
      continue;
    }
    if (!denied) {
      // The account is off. Ending the stream is what tells the browser to stop asking.
      client.reply.raw.end();
      clients.delete(id);
      continue;
    }
    if (!mayHear(denied, event)) continue;
    client.reply.raw.write(line);
  }
}

// Everything that is not an issue — a project renamed, a status added, a tag merged, an account switched off — is announced by one hook rather than by twenty handlers that would drift apart. The screens hear the noun and read their own data again; the issue routes say more about themselves because a card needs to know which field to light up.
const TOPICS: [RegExp, string][] = [
  [/^\/projects/, 'project'],
  [/^\/boards\/[^/]+\/states/, 'state'],
  [/^\/states/, 'state'],
  [/^\/boards/, 'board'],
  [/^\/tags/, 'tag'],
  [/^\/roles/, 'role'],
  [/^\/users/, 'user'],
  [/^\/invites/, 'invite'],
];

// These say enough about themselves already.
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
      // nginx honours this and stops buffering, which is what turns a stream into a stream.
      'X-Accel-Buffering': 'no',
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
