// Projects. Their boards own the statuses, so the only thing a project says about columns is which boards it has.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { inTransaction, pool } from './db.js';
import { requireAdmin, requireAuth } from './auth.js';
import {
  createBoardWithDefaults,
  publicBoard,
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
}

const publicProject = (r: ProjectRow) => ({
  id: r.id,
  shortName: r.short_name,
  name: r.name,
  description: r.description,
  archived: r.archived,
  position: r.position,
});

const projectCreate = z.object({
  // The short name rides in every issue key, so it is upper-case, short and free of anything that would need escaping in a URL.
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
});

export async function projectByShort(shortName: string): Promise<ProjectRow | null> {
  const res = await pool.query<ProjectRow>(
    'select * from projects where lower(short_name) = lower($1)',
    [shortName]
  );
  return res.rows[0] ?? null;
}

// One project's boards with their columns, in two queries rather than one per board.
export async function boardsOfProject(projectId: string) {
  const [boards, states] = await Promise.all([
    pool.query<BoardRow>(
      `select id, project_id, name, default_state_id, position
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
  return { rows: boards.rows, statesByBoard: byBoard };
}

export function registerProjectRoutes(app: FastifyInstance): void {
  app.get('/projects', async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const res = await pool.query<ProjectRow>('select * from projects order by position, short_name');
    return reply.send({ data: res.rows.map(publicProject) });
  });

  app.get('/projects/:short', async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const { short } = req.params as { short: string };
    const project = await projectByShort(short);
    if (!project) return reply.code(404).send({ error: 'No such project.' });
    const { rows, statesByBoard } = await boardsOfProject(project.id);
    return reply.send({
      data: {
        ...publicProject(project),
        boards: rows.map((b) => publicBoard(b, statesByBoard.get(b.id) ?? [])),
      },
    });
  });

  app.post('/projects', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const parsed = projectCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad project.' });
    }
    const { shortName, name, description } = parsed.data;
    if (await projectByShort(shortName)) {
      return reply.code(409).send({ error: `Project ${shortName} already exists.` });
    }
    // The project and its first board land together: a project with no board has nowhere to put an issue.
    const project = await inTransaction(async (client) => {
      const created = await client.query<ProjectRow>(
        `insert into projects (short_name, name, description, position)
         values ($1, $2, $3, (select coalesce(max(position), -1) + 1 from projects))
         returning *`,
        [shortName, name, description ?? '']
      );
      const row = created.rows[0];
      await createBoardWithDefaults(client, row.id, 'Board');
      return row;
    });
    return reply.code(201).send({ data: publicProject(project) });
  });

  // Deleting a project takes its boards, statuses, issues and its own tags with it — the database cascades — so the caller types the project's full name to prove it meant this one.
  app.delete('/projects/:short', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { short } = req.params as { short: string };
    const parsed = z.object({ confirm: z.string().trim() }).safeParse(req.body);
    const project = await projectByShort(short);
    if (!project) return reply.code(404).send({ error: 'No such project.' });
    if (
      !parsed.success ||
      parsed.data.confirm.toLowerCase() !== project.name.trim().toLowerCase()
    ) {
      return reply.code(400).send({ error: `Type ${project.name} to confirm.` });
    }
    const counts = await pool.query<{ issues: number }>(
      'select count(*)::int as issues from issues where project_id = $1',
      [project.id]
    );
    await pool.query('delete from projects where id = $1', [project.id]);
    return reply.send({ data: { ok: true, issues: counts.rows[0].issues } });
  });

  app.patch('/projects/:short', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { short } = req.params as { short: string };
    const parsed = projectPatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad patch.' });
    }
    const project = await projectByShort(short);
    if (!project) return reply.code(404).send({ error: 'No such project.' });
    const p = parsed.data;
    const res = await pool.query<ProjectRow>(
      `update projects
          set name = coalesce($2, name),
              description = coalesce($3, description),
              archived = coalesce($4, archived),
              position = coalesce($5, position)
        where id = $1
        returning *`,
      [project.id, p.name ?? null, p.description ?? null, p.archived ?? null, p.position ?? null]
    );
    return reply.send({ data: publicProject(res.rows[0]) });
  });
}
