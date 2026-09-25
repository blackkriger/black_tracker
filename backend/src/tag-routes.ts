// Tags are either global or a project's own. Reading them is open to everyone; making, renaming and deleting them is an admin's job, the same rule the statuses follow.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import { requireAdmin, requireAuth } from './auth.js';
import { projectByShort } from './project-routes.js';

interface TagRow {
  id: string;
  project_id: string | null;
  name: string;
  color: string;
  used: number;
}

const publicTag = (r: TagRow) => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  color: r.color,
  used: r.used,
});

const COLOR = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be #rrggbb');

const tagCreate = z.object({
  name: z.string().trim().min(1).max(40),
  color: COLOR.optional(),
  /** Absent means a global tag, usable on every project. */
  project: z.string().trim().max(20).optional(),
});

const tagPatch = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  color: COLOR.optional(),
});

export function registerTagRoutes(app: FastifyInstance): void {
  // `?project=PROJ` narrows to what that project can actually use: its own tags plus the global ones.
  app.get('/tags', async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const q = req.query as { project?: string };
    let projectId: string | null = null;
    if (q.project) {
      const project = await projectByShort(q.project);
      if (!project) return reply.code(404).send({ error: 'No such project.' });
      projectId = project.id;
    }
    const res = await pool.query<TagRow>(
      `select t.id, t.project_id, t.name, t.color,
              (select count(*)::int from issue_tags it where it.tag_id = t.id) as used
         from tags t
        where $1::uuid is null or t.project_id is null or t.project_id = $1
        order by t.project_id nulls first, lower(t.name)`,
      [projectId]
    );
    return reply.send({ data: res.rows.map(publicTag) });
  });

  app.post('/tags', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const parsed = tagCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad tag.' });
    }
    const { name, color, project } = parsed.data;
    let projectId: string | null = null;
    if (project) {
      const row = await projectByShort(project);
      if (!row) return reply.code(404).send({ error: 'No such project.' });
      projectId = row.id;
    }
    try {
      const res = await pool.query<TagRow>(
        `insert into tags (project_id, name, color)
         values ($1, $2, $3)
         returning id, project_id, name, color, 0 as used`,
        [projectId, name, color ?? '#71767b']
      );
      return reply.code(201).send({ data: publicTag(res.rows[0]) });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'A tag with that name already exists here.' });
      }
      throw err;
    }
  });

  app.patch('/tags/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const parsed = tagPatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad patch.' });
    }
    const res = await pool.query<TagRow>(
      `update tags
          set name = coalesce($2, name), color = coalesce($3, color)
        where id = $1
        returning id, project_id, name, color,
                  (select count(*)::int from issue_tags it where it.tag_id = tags.id) as used`,
      [id, parsed.data.name ?? null, parsed.data.color ?? null]
    );
    if (!res.rowCount) return reply.code(404).send({ error: 'No such tag.' });
    return reply.send({ data: publicTag(res.rows[0]) });
  });

  // Deleting a tag takes it off the issues that carry it — that is the point of deleting it — so the answer says how many were touched.
  app.delete('/tags/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const used = await pool.query<{ n: number }>(
      'select count(*)::int as n from issue_tags where tag_id = $1',
      [id]
    );
    const res = await pool.query('delete from tags where id = $1', [id]);
    if (!res.rowCount) return reply.code(404).send({ error: 'No such tag.' });
    return reply.send({ data: { ok: true, removedFrom: used.rows[0].n } });
  });
}
