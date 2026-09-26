// One channel for the whole tracker. Every write that other people would want to know about is announced here, and every open tab is listening: a board redraws the moment someone else moves a card, and an issue someone is reading updates under them with the changed field lit up.
//
// Server-sent events rather than websockets: the traffic is one-way, it rides the same HTTPS the API does, and the browser reconnects on its own. A comment line every 25 seconds keeps the proxy from deciding an idle stream is a dead one.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth, type Auth } from './auth.js';
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
  /** The login behind the change: a tab does not flash at its own doing. */
  by?: string;
}

interface Client {
  reply: FastifyReply;
  auth: Auth;
  denied: Denials;
  deniedAt: number;
}

const DENIALS_TTL = 30_000;
const HEARTBEAT_MS = 25_000;

const clients = new Map<number, Client>();
let nextId = 1;

async function denialsFresh(client: Client): Promise<Denials> {
  if (client.auth.isAdmin) return DENIES_NOTHING;
  if (Date.now() - client.deniedAt > DENIALS_TTL) {
    client.denied = await deniedFor(client.auth.roleId);
    client.deniedAt = Date.now();
  }
  return client.denied;
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
    try {
      if (!mayHear(await denialsFresh(client), event)) continue;
      client.reply.raw.write(line);
    } catch {
      clients.delete(id);
    }
  }
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
