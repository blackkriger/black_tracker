import { mkdir } from 'node:fs/promises';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { env } from './env.js';
import { pruneSessions, registerAuthRoutes, registerRoleWall } from './auth.js';
import { registerProjectRoutes } from './project-routes.js';
import { registerBoardRoutes } from './board-routes.js';
import { registerTagRoutes } from './tag-routes.js';
import { registerUserRoutes } from './user-routes.js';
import { registerInviteRoutes } from './invite-routes.js';
import { registerRoleRoutes } from './role-routes.js';
import { registerIssueRoutes } from './issue-routes.js';
import { registerCalendarRoutes } from './calendar-routes.js';
import { registerMentionRoutes } from './mention-routes.js';
import { registerChangeFeed, registerEventRoutes } from './events.js';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  // Screenshots and gifs are the point of attachments; nginx carries the same ceiling.
  bodyLimit: 30 * 1024 * 1024,
});

await app.register(cookie);
await app.register(cors, { origin: env.corsOrigins, credentials: true });
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 10 } });

app.get('/health', async () => ({ data: { ok: true } }));

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
registerMentionRoutes(app);
registerEventRoutes(app);
// After the routes, so it sees the pattern each one matched.
registerChangeFeed(app);

// Every route answers the same two shapes: `{ data }` when it worked, `{ error }` when it did not.
app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Not found.' }));
app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  app.log.error(err);
  const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  reply.code(status).send({ error: status === 500 ? 'Something went wrong.' : err.message });
});

await mkdir(env.uploadDir, { recursive: true });
await pruneSessions();
setInterval(pruneSessions, 24 * 60 * 60 * 1000).unref();

await app.listen({ port: env.port, host: '127.0.0.1' });
