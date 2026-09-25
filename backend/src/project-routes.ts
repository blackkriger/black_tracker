// Projects and their states. A state is a row, so the board grows a column the moment one is inserted — that is the whole reason states live here rather than in an enum.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { inTransaction, pool } from './db.js';
import { requireAdmin, requireAuth } from './auth.js';

interface ProjectRow {
  id: string;
  short_name: string;
  name: string;
  description: string;
  next_issue_number: number;
  default_state_id: string | null;
  archived: boolean;
  position: number;
}

interface StateRow {
  id: string;
  project_id: string;
  name: string;
  position: number;
  is_open: boolean;
  is_resolved: boolean;
  color: string;
}

const publicProject = (r: ProjectRow) => ({
  id: r.id,
  shortName: r.short_name,
  name: r.name,
  description: r.description,
  defaultStateId: r.default_state_id,
  archived: r.archived,
  position: r.position,
});

const publicState = (r: StateRow) => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  position: r.position,
  isOpen: r.is_open,
  isResolved: r.is_resolved,
  color: r.color,
});

const COLOR = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be #rrggbb');

const projectCreate = z.object({
  // The short name rides in every issue key, so it is upper-case, short and free of anything that would need escaping in a URL.
  shortName: z.string().trim().min(1).max(20).regex(/^[A-Z][A-Z0-9]*$/, 'Use upper-case letters and digits, e.g. PROJ'),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(4000).optional(),
});

const projectPatch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
  defaultStateId: z.string().uuid().nullable().optional(),
  archived: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});

const stateCreate = z.object({
  name: z.string().trim().min(1).max(60),
  color: COLOR.optional(),
  isOpen: z.boolean().optional(),
  isResolved: z.boolean().optional(),
});

const statePatch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: COLOR.optional(),
  isOpen: z.boolean().optional(),
  isResolved: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});

// The starting set every new project gets, so a fresh board is usable before anyone opens the admin screen.
const DEFAULT_STATES: { name: string; color: string; isOpen: boolean; isResolved: boolean }[] = [
  { name: 'Backlog', color: '#d9b95c', isOpen: true, isResolved: false },
  { name: 'In progress', color: '#6cdcff', isOpen: true, isResolved: false },
  { name: 'Review', color: '#c98eff', isOpen: true, isResolved: false },
  { name: 'Done', color: '#8effa9', isOpen: false, isResolved: true },
];

export async function projectByShort(shortName: string): Promise<ProjectRow | null> {
  const res = await pool.query<ProjectRow>(
    'select * from projects where lower(short_name) = lower($1)',
    [shortName]
  );
  return res.rows[0] ?? null;
}

export function registerProjectRoutes(app: FastifyInstance): void {
  app.get('/projects', async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const res = await pool.query<ProjectRow>(
      'select * from projects order by position, short_name'
    );
    return reply.send({ data: res.rows.map(publicProject) });
  });

  app.get('/projects/:short', async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const { short } = req.params as { short: string };
    const project = await projectByShort(short);
    if (!project) return reply.code(404).send({ error: 'No such project.' });
    const states = await pool.query<StateRow>(
      'select * from states where project_id = $1 order by position, name',
      [project.id]
    );
    return reply.send({
      data: { ...publicProject(project), states: states.rows.map(publicState) },
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
    // The project, its starting states and the pointer at the first one land together: a project without states cannot draw a board.
    const project = await inTransaction(async (client) => {
      const created = await client.query<ProjectRow>(
        `insert into projects (short_name, name, description, position)
         values ($1, $2, $3, (select coalesce(max(position), -1) + 1 from projects))
         returning *`,
        [shortName, name, description ?? '']
      );
      const row = created.rows[0];
      const states = await client.query<StateRow>(
        `insert into states (project_id, name, position, is_open, is_resolved, color)
         select $1, s.name, s.pos, s.is_open, s.is_resolved, s.color
           from unnest($2::text[], $3::int[], $4::bool[], $5::bool[], $6::text[])
                as s(name, pos, is_open, is_resolved, color)
         returning *`,
        [
          row.id,
          DEFAULT_STATES.map((s) => s.name),
          DEFAULT_STATES.map((_, i) => i),
          DEFAULT_STATES.map((s) => s.isOpen),
          DEFAULT_STATES.map((s) => s.isResolved),
          DEFAULT_STATES.map((s) => s.color),
        ]
      );
      const first = [...states.rows].sort((a, b) => a.position - b.position)[0];
      const withDefault = await client.query<ProjectRow>(
        'update projects set default_state_id = $1 where id = $2 returning *',
        [first?.id ?? null, row.id]
      );
      return withDefault.rows[0];
    });
    return reply.code(201).send({ data: publicProject(project) });
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
    if (p.defaultStateId) {
      const belongs = await pool.query(
        'select 1 from states where id = $1 and project_id = $2',
        [p.defaultStateId, project.id]
      );
      if (!belongs.rowCount) {
        return reply.code(400).send({ error: 'That status belongs to another project.' });
      }
    }
    const res = await pool.query<ProjectRow>(
      `update projects
          set name = coalesce($2, name),
              description = coalesce($3, description),
              default_state_id = case when $4::boolean then $5::uuid else default_state_id end,
              archived = coalesce($6, archived),
              position = coalesce($7, position)
        where id = $1
        returning *`,
      [
        project.id,
        p.name ?? null,
        p.description ?? null,
        'defaultStateId' in p,
        p.defaultStateId ?? null,
        p.archived ?? null,
        p.position ?? null,
      ]
    );
    return reply.send({ data: publicProject(res.rows[0]) });
  });

  app.get('/projects/:short/states', async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const { short } = req.params as { short: string };
    const project = await projectByShort(short);
    if (!project) return reply.code(404).send({ error: 'No such project.' });
    const res = await pool.query<StateRow>(
      'select * from states where project_id = $1 order by position, name',
      [project.id]
    );
    return reply.send({ data: res.rows.map(publicState) });
  });

  app.post('/projects/:short/states', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { short } = req.params as { short: string };
    const parsed = stateCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad status.' });
    }
    const project = await projectByShort(short);
    if (!project) return reply.code(404).send({ error: 'No such project.' });
    const p = parsed.data;
    try {
      const res = await pool.query<StateRow>(
        `insert into states (project_id, name, position, is_open, is_resolved, color)
         values ($1, $2, (select coalesce(max(position), -1) + 1 from states where project_id = $1), $3, $4, $5)
         returning *`,
        [project.id, p.name, p.isOpen ?? true, p.isResolved ?? false, p.color ?? '#71767b']
      );
      return reply.code(201).send({ data: publicState(res.rows[0]) });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'This project already has a status with that name.' });
      }
      throw err;
    }
  });

  app.patch('/states/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const parsed = statePatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad patch.' });
    }
    const p = parsed.data;
    const res = await pool.query<StateRow>(
      `update states
          set name = coalesce($2, name),
              color = coalesce($3, color),
              is_open = coalesce($4, is_open),
              is_resolved = coalesce($5, is_resolved),
              position = coalesce($6, position)
        where id = $1
        returning *`,
      [id, p.name ?? null, p.color ?? null, p.isOpen ?? null, p.isResolved ?? null, p.position ?? null]
    );
    if (!res.rowCount) return reply.code(404).send({ error: 'No such status.' });
    return reply.send({ data: publicState(res.rows[0]) });
  });

  // Column order, sent as the whole list: dragging one column moves the others, and one statement keeps them consistent.
  app.post('/projects/:short/states/order', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { short } = req.params as { short: string };
    const parsed = z.object({ ids: z.array(z.string().uuid()).min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Send the ids in their new order.' });
    const project = await projectByShort(short);
    if (!project) return reply.code(404).send({ error: 'No such project.' });
    await pool.query(
      `update states s
          set position = o.pos
         from unnest($2::uuid[]) with ordinality as o(id, pos)
        where s.id = o.id and s.project_id = $1`,
      [project.id, parsed.data.ids]
    );
    const res = await pool.query<StateRow>(
      'select * from states where project_id = $1 order by position, name',
      [project.id]
    );
    return reply.send({ data: res.rows.map(publicState) });
  });

  app.delete('/states/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    // Refusing while issues sit in the status is the point: silently moving them somewhere would lose where they were.
    const used = await pool.query<{ n: number }>(
      'select count(*)::int as n from issues where state_id = $1',
      [id]
    );
    if (used.rows[0].n > 0) {
      return reply.code(409).send({
        error: `Move the ${used.rows[0].n} issue(s) out of this status first.`,
      });
    }
    const res = await pool.query('delete from states where id = $1', [id]);
    if (!res.rowCount) return reply.code(404).send({ error: 'No such status.' });
    return reply.send({ data: { ok: true } });
  });
}
