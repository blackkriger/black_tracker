import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import { sweepBuilds } from './build-routes.js';
import { filesOfIssues, sweepFiles } from './issue-routes.js';
import { requireAuth, requireDeleter } from './auth.js';
import {
  DENIES_NOTHING,
  deniedFor,
  mayOpenProject,
  publicBoard,
  tagIdsByBoard,
  type BoardRow,
  type StateRow,
} from './board-service.js';

interface ProjectRow {
  id: string;
  short_name: string;
  name: string;
  description: string;
  next_issue_number: number;
  archived: boolean;
  position: number;
  repo: string | null;
}

const publicProject = (r: ProjectRow) => ({
  id: r.id,
  shortName: r.short_name,
  name: r.name,
  description: r.description,
  archived: r.archived,
  position: r.position,
  repo: r.repo,
  nextKey: `${r.short_name}-${r.next_issue_number}`,
});

const projectCreate = z.object({
  // Must match the router's [A-Z][A-Z0-9]* key pattern; lower-case would collide with pages.
  shortName: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Z][A-Z0-9]*$/, 'Use upper-case letters and digits, e.g. PROJ'),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(4000).optional(),
});

const projectPatch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
  archived: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  repo: z
    .string()
    .trim()
    .max(200)
    .regex(/^(?:[\w.-]+\/[\w.-]+)?$/, 'Write it as owner/name.')
    .optional(),
});

export async function projectByShort(shortName: string): Promise<ProjectRow | null> {
  const res = await pool.query<ProjectRow>(
    'select * from projects where lower(short_name) = lower($1)',
    [shortName]
  );
  return res.rows[0] ?? null;
}

export async function boardsOfProject(projectId: string) {
  const [boards, states] = await Promise.all([
    pool.query<BoardRow>(
      `select id, project_id, name, slug, default_state_id, default_assignee_id, position
         from boards where project_id = $1 order by position, name`,
      [projectId]
    ),
    pool.query<StateRow>(
      `select s.* from states s
         join boards b on b.id = s.board_id
        where b.project_id = $1
        order by s.position, s.name`,
      [projectId]
    ),
  ]);
  const byBoard = new Map<string, StateRow[]>();
  for (const s of states.rows) {
    const list = byBoard.get(s.board_id) ?? [];
    list.push(s);
    byBoard.set(s.board_id, list);
  }
  const tagsByBoard = await tagIdsByBoard(boards.rows.map((b) => b.id));
  return { rows: boards.rows, statesByBoard: byBoard, tagsByBoard };
}

export function registerProjectRoutes(app: FastifyInstance): void {
  app.get('/projects', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const [projects, boards] = await Promise.all([
      pool.query<ProjectRow>('select * from projects order by position, short_name'),
      pool.query<BoardRow>(
        'select id, project_id, name, slug, default_state_id, position from boards order by position, name'
      ),
    ]);
    const denied = auth.isAdmin ? DENIES_NOTHING : await deniedFor(auth.roleId);
    if (denied.everything) return reply.send({ data: [] });
    const byProject = new Map<string, { id: string; name: string; slug: string }[]>();
    for (const b of boards.rows) {
      if (denied.boards.has(b.id)) continue;
      const list = byProject.get(b.project_id) ?? [];
      list.push({ id: b.id, name: b.name, slug: b.slug });
      byProject.set(b.project_id, list);
    }
    return reply.send({
      data: projects.rows
        .filter((r) => !denied.projects.has(r.id))
        .map((r) => ({ ...publicProject(r), boards: byProject.get(r.id) ?? [] })),
    });
  });

  app.get('/projects/:short', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { short } = req.params as { short: string };
    const project = await projectByShort(short);
    if (!project) return reply.code(404).send({ error: 'No such project.' });
    const denied = auth.isAdmin ? DENIES_NOTHING : await deniedFor(auth.roleId);
    if (denied.everything || denied.projects.has(project.id)) {
      return reply.code(404).send({ error: 'No such project.' });
    }
    const { rows, statesByBoard, tagsByBoard } = await boardsOfProject(project.id);
    return reply.send({
      data: {
        ...publicProject(project),
        boards: rows
          .filter((b) => !denied.boards.has(b.id))
          .map((b) => publicBoard(b, statesByBoard.get(b.id) ?? [], [], tagsByBoard.get(b.id) ?? [])),
      },
    });
  });

  app.post('/projects', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    if (!auth.isAdmin && (await deniedFor(auth.roleId)).everything) {
      return reply.code(403).send({ error: 'Making a project is not open to your role.' });
    }
    const parsed = projectCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad project.' });
    }
    const { shortName, name, description } = parsed.data;
    if (await projectByShort(shortName)) {
      return reply.code(409).send({ error: `Project ${shortName} already exists.` });
    }
    const created = await pool.query<ProjectRow>(
      `insert into projects (short_name, name, description, position)
       values ($1, $2, $3, (select coalesce(max(position), -1) + 1 from projects))
       returning *`,
      [shortName, name, description ?? '']
    );
    return reply.code(201).send({ data: publicProject(created.rows[0]) });
  });

  app.delete('/projects/:short', async (req, reply) => {
    const auth = await requireDeleter(req, reply);
    if (!auth) return;
    const { short } = req.params as { short: string };
    const parsed = z.object({ confirm: z.string().trim() }).safeParse(req.body);
    const project = await projectByShort(short);
    if (!project) return reply.code(404).send({ error: 'No such project.' });
    if (!auth.isAdmin) {
      const denied = await deniedFor(auth.roleId);
      if (denied.everything || denied.projects.has(project.id)) {
        return reply.code(404).send({ error: 'No such project.' });
      }
    }
    if (
      !parsed.success ||
      parsed.data.confirm.toLowerCase() !== project.name.trim().toLowerCase()
    ) {
      return reply.code(400).send({ error: 'Type name of the project to confirm.' });
    }
    const doomed = await pool.query<{ id: string }>('select id from issues where project_id = $1', [
      project.id,
    ]);
    const ids = doomed.rows.map((r) => r.id);
    const paths = await filesOfIssues(ids);
    await pool.query('delete from projects where id = $1', [project.id]);
    await sweepFiles(ids, paths);
    await sweepBuilds(project.id);
    return reply.send({ data: { ok: true, issues: doomed.rowCount ?? 0 } });
  });

  app.patch('/projects/:short', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { short } = req.params as { short: string };
    const parsed = projectPatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad patch.' });
    }
    const project = await projectByShort(short);
    if (!project || !(await mayOpenProject(auth, project.id))) {
      return reply.code(404).send({ error: 'No such project.' });
    }
    const p = parsed.data;
    const res = await pool.query<ProjectRow>(
      `update projects
          set name = coalesce($2, name),
              description = coalesce($3, description),
              archived = coalesce($4, archived),
              position = coalesce($5, position),
              repo = case when $6 then nullif($7, '') else repo end
        where id = $1
        returning *`,
      [
        project.id,
        p.name ?? null,
        p.description ?? null,
        p.archived ?? null,
        p.position ?? null,
        p.repo !== undefined,
        p.repo ?? null,
      ]
    );
    return reply.send({ data: publicProject(res.rows[0]) });
  });
}
