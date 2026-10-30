import { createReadStream } from 'node:fs';
import { rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { inTransaction, pool } from './db.js';
import { env } from './env.js';
import { requireAuth, type Auth } from './auth.js';
import { denialsOf, mayOpenProject } from './board-service.js';
import { publish, tabOf } from './events.js';
import { disposition, fileHeaders, onDisk, storeIn } from './issue-routes.js';
import { projectByShort } from './project-routes.js';
import { BUILD_MAX_BYTES, PLATFORMS } from '../../shared/rules.js';

const PLATFORM = z.enum(PLATFORMS);
type Platform = z.infer<typeof PLATFORM>;
const PAGE_LIMIT = 5 * 1024 * 1024;
const CLOSED = { error: 'Open the file to anyone with the link.' };
const TOO_LARGE = { error: '1 GB max for a build.' };
const NOT_DRIVE = { error: 'That is not a Google Drive link.' };

interface BuildRow {
  id: string;
  project: string;
  name: string;
  platform: Platform;
  size: string | null;
  url: string | null;
  by: string | null;
  created_at: Date;
}

const SELECT = `
  select b.id, p.short_name as project, b.name, b.platform, b.size, b.url, u.login as by, b.created_at
    from project_builds b
    join projects p on p.id = b.project_id
    left join users u on u.id = b.uploaded_by`;

const publicBuild = (r: BuildRow) => ({
  id: r.id,
  project: r.project,
  name: r.name,
  platform: r.platform,
  size: r.size === null ? null : Number(r.size),
  url: r.url,
  by: r.by,
  at: r.created_at.toISOString(),
});

const buildFolder = (projectId: string): string => path.join('builds', projectId.toLowerCase());

export async function sweepBuilds(projectId: string): Promise<void> {
  await rm(onDisk(buildFolder(projectId)), { recursive: true, force: true }).catch(() => {});
}

async function openProject(auth: Auth, short: string): Promise<{ id: string; short_name: string } | null> {
  const project = await projectByShort(short);
  if (!project || project.archived || !(await mayOpenProject(auth, project.id))) return null;
  return project;
}

async function keep(
  auth: Auth,
  projectId: string,
  platform: Platform,
  build: { name: string; storagePath: string | null; size: number | null; url: string | null }
): Promise<BuildRow> {
  const { id, gone } = await inTransaction(async (client) => {
    await client.query('select 1 from projects where id = $1 for update', [projectId]);
    const old = await client.query<{ storage_path: string | null }>(
      'delete from project_builds where project_id = $1 and platform = $2 returning storage_path',
      [projectId, platform]
    );
    const made = await client.query<{ id: string }>(
      `insert into project_builds (project_id, platform, name, storage_path, size, url, uploaded_by)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [projectId, platform, build.name, build.storagePath, build.size, build.url, auth.userId]
    );
    return { id: made.rows[0].id, gone: old.rows.map((r) => r.storage_path).filter((p): p is string => !!p) };
  });
  await Promise.all(gone.map((p) => unlink(onDisk(p)).catch(() => {})));
  const res = await pool.query<BuildRow>(`${SELECT} where b.id = $1`, [id]);
  return res.rows[0];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? whole;
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
  });
}

function driveTarget(raw: string): string | null {
  let link: URL;
  try {
    link = new URL(raw);
  } catch {
    return null;
  }
  if (link.protocol !== 'https:' || link.hostname !== 'drive.google.com') return null;
  const key = link.searchParams.get('resourcekey');
  const withKey = (target: string): string => (key ? `${target}?resourcekey=${encodeURIComponent(key)}` : target);
  const file = /\/file\/(?:u\/\d+\/)?d\/([\w-]{10,})/.exec(link.pathname)?.[1];
  if (file) return withKey(`https://drive.google.com/file/d/${file}/view`);
  const folder = /\/folders\/([\w-]{10,})/.exec(link.pathname)?.[1];
  if (folder) return withKey(`https://drive.google.com/drive/folders/${folder}`);
  const id = link.searchParams.get('id');
  if (id && /^[\w-]{10,}$/.test(id)) return withKey(`https://drive.google.com/file/d/${id}/view`);
  return null;
}

function driveName(html: string): string {
  const og = /<meta property="og:title" content="([^"]*)"/.exec(html)?.[1];
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1]?.replace(/\s+[-–—]\s+Google\s+\S+\s*$/u, '');
  return decodeEntities(og ?? title ?? '').trim().slice(0, 200);
}

async function readDrive(raw: string): Promise<{ name: string } | { code: number; body: { error: string } }> {
  const target = driveTarget(raw);
  if (!target) return { code: 400, body: NOT_DRIVE };
  let res: Response;
  try {
    res = await fetch(target, { signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': 'Mozilla/5.0' } });
  } catch {
    return { code: 502, body: { error: 'Google did not answer.' } };
  }
  const page =
    res.ok &&
    new URL(res.url).hostname === 'drive.google.com' &&
    (res.headers.get('content-type') ?? '').startsWith('text/html') &&
    Number(res.headers.get('content-length') ?? 0) <= PAGE_LIMIT;
  const name = page ? driveName((await res.text()).slice(0, PAGE_LIMIT)) : '';
  if (!name || /^Google\s+\S+$/u.test(name)) return { code: 422, body: CLOSED };
  return { name };
}

interface DemoRow {
  platform: Platform;
  name: string;
  size: string | null;
  url: string | null;
  storage_path: string | null;
  created_at: Date;
}

async function demoBuilds(): Promise<Partial<Record<Platform, DemoRow>>> {
  const res = await pool.query<DemoRow>(
    `select b.platform, b.name, b.size, b.url, b.storage_path, b.created_at
       from project_builds b join projects p on p.id = b.project_id
      where lower(p.short_name) = lower($1) and not p.archived`,
    [env.demoProject]
  );
  return Object.fromEntries(res.rows.map((r) => [r.platform, r]));
}

const publicDemo = (platform: Platform, r: DemoRow | undefined) =>
  r
    ? {
        name: r.name,
        size: r.size === null ? null : Number(r.size),
        at: r.created_at.toISOString(),
        href: r.url ?? `/demo/${platform}`,
      }
    : null;

export function registerBuildRoutes(app: FastifyInstance): void {
  app.get('/public/demo', async (_req, reply) => {
    const builds = await demoBuilds();
    reply.header('Cache-Control', 'no-store');
    return reply.send({ data: { windows: publicDemo('windows', builds.windows), macos: publicDemo('macos', builds.macos) } });
  });

  app.get('/public/demo/entry', async (_req, reply) => {
    const builds = await demoBuilds();
    reply.header('Cache-Control', 'no-store');
    if (builds.windows?.url && !builds.macos) return reply.redirect(builds.windows.url, 302);
    reply.header('Content-Type', 'text/html; charset=utf-8');
    reply.header('X-Accel-Redirect', '/demo/index.html');
    return reply.send('');
  });

  app.get('/public/demo/:platform', async (req, reply) => {
    const platform = PLATFORM.safeParse((req.params as { platform: string }).platform);
    const build = platform.success ? (await demoBuilds())[platform.data] : undefined;
    if (!build) return reply.code(404).send({ error: 'No such build.' });
    reply.header('Cache-Control', 'no-store');
    if (build.url) return reply.redirect(build.url, 302);
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', disposition('attachment', build.name));
    reply.header('X-Accel-Redirect', `/demo-files/${build.storage_path}`);
    return reply.send('');
  });

  app.get('/builds', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const denied = [...(await denialsOf(auth)).projects];
    const res = await pool.query<BuildRow>(
      `${SELECT} where not p.archived and not (p.id = any($1::uuid[]))
        order by p.short_name, b.platform = 'macos', b.created_at desc`,
      [denied]
    );
    return reply.send({ data: res.rows.map(publicBuild) });
  });

  app.post('/builds/:short', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { short } = req.params as { short: string };
    const project = await openProject(auth, short);
    if (!project) return reply.code(404).send({ error: 'No such project.' });
    const platform = PLATFORM.safeParse((req.query as { platform?: string }).platform);
    if (!platform.success) return reply.code(400).send({ error: 'Which platform?' });
    const file = await req.file({ limits: { fileSize: BUILD_MAX_BYTES, files: 1 } });
    if (!file) return reply.code(400).send({ error: 'Send a file.' });

    let stored: string;
    try {
      stored = await storeIn(buildFolder(project.id), file.file, file.filename);
    } catch (err) {
      if (file.file.truncated) return reply.code(413).send(TOO_LARGE);
      throw err;
    }
    if (file.file.truncated) {
      await unlink(onDisk(stored)).catch(() => {});
      return reply.code(413).send(TOO_LARGE);
    }
    let saved: BuildRow;
    try {
      saved = await keep(auth, project.id, platform.data, {
        name: path.basename(file.filename).trim().slice(0, 200) || 'build',
        storagePath: stored,
        size: (await stat(onDisk(stored))).size,
        url: null,
      });
    } catch (err) {
      await unlink(onDisk(stored)).catch(() => {});
      throw err;
    }
    void publish({ type: 'build.changed', projectId: project.id, by: auth.login, origin: tabOf(req) });
    return reply.code(201).send({ data: publicBuild(saved) });
  });

  app.post('/builds/:short/drive', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { short } = req.params as { short: string };
    const project = await openProject(auth, short);
    if (!project) return reply.code(404).send({ error: 'No such project.' });
    const parsed = z.object({ url: z.string().trim().max(2000), platform: PLATFORM }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(NOT_DRIVE);
    const drive = await readDrive(parsed.data.url);
    if ('code' in drive) return reply.code(drive.code).send(drive.body);
    const saved = await keep(auth, project.id, parsed.data.platform, {
      name: drive.name,
      storagePath: null,
      size: null,
      url: parsed.data.url,
    });
    void publish({ type: 'build.changed', projectId: project.id, by: auth.login, origin: tabOf(req) });
    return reply.code(201).send({ data: publicBuild(saved) });
  });

  app.post('/builds/:short/drive/name', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { short } = req.params as { short: string };
    if (!(await openProject(auth, short))) return reply.code(404).send({ error: 'No such project.' });
    const parsed = z.object({ url: z.string().trim().max(2000) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(NOT_DRIVE);
    const drive = await readDrive(parsed.data.url);
    if ('code' in drive) return reply.code(drive.code).send(drive.body);
    return reply.send({ data: { name: drive.name } });
  });

  app.get('/builds/:id/file', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(404).send({ error: 'No such build.' });
    const res = await pool.query<{ name: string; storage_path: string; size: string; project_id: string }>(
      `select b.name, b.storage_path, b.size, b.project_id
         from project_builds b join projects p on p.id = b.project_id
        where b.id = $1 and b.storage_path is not null and not p.archived`,
      [id.data]
    );
    const row = res.rows[0];
    if (!row || !(await mayOpenProject(auth, row.project_id))) {
      return reply.code(404).send({ error: 'No such build.' });
    }
    fileHeaders(reply, 'application/octet-stream', 'attachment', row.name);
    reply.header('Content-Length', row.size);
    return reply.send(createReadStream(onDisk(row.storage_path)));
  });
}
