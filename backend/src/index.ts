import { mkdir } from 'node:fs/promises';
import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { env } from './env.js';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pruneSessions, registerAuthRoutes, registerRoleWall } from './auth.js';
import { registerProjectRoutes } from './project-routes.js';
import { registerBoardRoutes } from './board-routes.js';
import { registerTagRoutes } from './tag-routes.js';
import { registerUserRoutes } from './user-routes.js';
import { registerInviteRoutes } from './invite-routes.js';
import { registerRoleRoutes } from './role-routes.js';
import { registerIssueRoutes } from './issue-routes.js';
import { registerCalendarRoutes } from './calendar-routes.js';
import { registerAnalyticsRoutes } from './analytics-routes.js';
import { registerNoticeRoutes } from './notice-routes.js';
import { listenForHistory, registerChangeFeed, registerEventRoutes } from './events.js';
import { registerGitRoutes } from './git-routes.js';
import { registerMessengerRoutes, startMessengers } from './messenger.js';
import { registerTelegramRoutes, startTelegram } from './telegram.js';
import { registerVkRoutes, startVk } from './vk.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    serializers: {
      req: (req: FastifyRequest) => ({
        method: req.method,
        url: req.url.replace(/^\/invites\/[^/?]+/, '/invites/…'),
        host: req.host,
        remoteAddress: req.ip,
        remotePort: req.socket?.remotePort,
      }),
    },
  },
  routerOptions: {
    querystringParser: (query: string) => Object.fromEntries(new URLSearchParams(query)),
  },
  bodyLimit: 30 * 1024 * 1024,
  trustProxy: '127.0.0.1',
});

await app.register(cookie);
await app.register(cors, { origin: env.corsOrigins, credentials: true });
await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024, files: 10 } });

app.get('/health', async () => ({ data: { ok: true } }));

const updatedAt = await new Promise<string>((resolve) => {
  execFile(
    'git',
    ['log', '-1', '--format=%cI'],
    { cwd: fileURLToPath(new URL('../..', import.meta.url)) },
    (err, out) => resolve(err ? new Date().toISOString() : out.trim())
  );
});
app.get('/version', async () => ({ data: { updatedAt } }));

registerRoleWall(app);
registerAuthRoutes(app);
registerProjectRoutes(app);
registerBoardRoutes(app);
registerTagRoutes(app);
registerUserRoutes(app);
registerInviteRoutes(app);
registerRoleRoutes(app);
registerIssueRoutes(app);
registerCalendarRoutes(app);
registerAnalyticsRoutes(app);
registerNoticeRoutes(app);
registerGitRoutes(app);
registerMessengerRoutes(app);
registerTelegramRoutes(app);
registerVkRoutes(app);
registerEventRoutes(app);
registerChangeFeed(app);

app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Not found.' }));
const PG_BAD_INPUT = new Set(['22P02', '22007', '22008', '23503']);

app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply) => {
  if (err.code && PG_BAD_INPUT.has(err.code)) {
    return reply.code(400).send({ error: 'Bad request.' });
  }
  if (err.code === '23505') return reply.code(409).send({ error: 'That already exists.' });
  app.log.error(err);
  const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  reply.code(status).send({ error: status === 500 ? 'Something went wrong.' : err.message });
});

await mkdir(env.uploadDir, { recursive: true });
await pruneSessions();
setInterval(pruneSessions, 24 * 60 * 60 * 1000).unref();
await startTelegram();
await listenForHistory();
startMessengers();

await app.listen({ port: env.port, host: '127.0.0.1' });
await startVk();
