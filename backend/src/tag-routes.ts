import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { inTransaction, pool } from './db.js';
import { requireAuth, requireDeleter } from './auth.js';
import { deniedFor, mayOpenProject } from './board-service.js';
import { pickColor } from './colors.js';
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

const tagCreate = z.object({
  name: z.string().trim().min(1).max(40),
  project: z.string().trim().max(20).optional(),
});

const tagPatch = z.object({
  name: z.string().trim().min(1).max(40),
});

async function mergeIntoGlobal(name: string, renameFirst?: string): Promise<TagRow> {
  return inTransaction(async (client) => {
    // Rename inside the merge's transaction, or a failed merge leaves the duplicate behind.
    if (renameFirst) {
      await client.query('update tags set name = $2 where id = $1', [renameFirst, name]);
    }
    const existing = await client.query<{ id: string; project_id: string | null }>(
      `select id, project_id from tags where lower(name) = lower($1) order by (project_id is null) desc, id`,
      [name]
    );
    const rows = existing.rows;
    const survivor = rows[0];
    const losers = rows.slice(1).map((r) => r.id);
    if (losers.length) {
      await client.query(
        `insert into issue_tags (issue_id, tag_id)
         select it.issue_id, $1 from issue_tags it where it.tag_id = any($2::uuid[])
         on conflict do nothing`,
        [survivor.id, losers]
      );
      await client.query('delete from tags where id = any($1::uuid[])', [losers]);
    }
    const promoted = await client.query<TagRow>(
      `update tags set project_id = null where id = $1
       returning id, project_id, name, color,
                 (select count(*)::int from issue_tags it where it.tag_id = tags.id) as used`,
      [survivor.id]
    );
    return promoted.rows[0];
  });
}

export function registerTagRoutes(app: FastifyInstance): void {
  app.get('/tags', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const q = req.query as { project?: string };
    const denied = auth.isAdmin ? null : await deniedFor(auth.roleId);
    let projectId: string | null = null;
    if (q.project) {
      const project = await projectByShort(q.project);
      if (!project) return reply.code(404).send({ error: 'No such project.' });
      if (denied && (denied.everything || denied.projects.has(project.id))) {
        return reply.code(404).send({ error: 'No such project.' });
      }
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
    const visible = denied
      ? res.rows.filter((r) => !r.project_id || !denied.projects.has(r.project_id))
      : res.rows;
    return reply.send({ data: (denied?.everything ? [] : visible).map(publicTag) });
  });

  app.post('/tags', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const parsed = tagCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad tag.' });
    }
    const { name, project } = parsed.data;
    let projectId: string | null = null;
    if (project) {
      const row = await projectByShort(project);
      if (!row || !(await mayOpenProject(auth, row.id))) {
        return reply.code(404).send({ error: 'No such project.' });
      }
      projectId = row.id;
    } else if (!auth.isAdmin && (await deniedFor(auth.roleId)).everything) {
      return reply.code(403).send({ error: 'Making a tag is not open to your role.' });
    }

    const twins = await pool.query<{ id: string; project_id: string | null }>(
      'select id, project_id from tags where lower(name) = lower($1)',
      [name]
    );
    if (twins.rows.some((t) => t.project_id === projectId)) {
      return reply.code(409).send({ error: 'A tag with that name already exists here.' });
    }
    if (twins.rowCount) {
      const merged = await mergeIntoGlobal(name);
      return reply.send({ data: { ...publicTag(merged), merged: true } });
    }

    try {
      const taken = await pool.query<{ color: string }>(
        'select color from tags where project_id is null or project_id is not distinct from $1',
        [projectId]
      );
      const res = await pool.query<TagRow>(
        `insert into tags (project_id, name, color)
         values ($1, $2, $3)
         returning id, project_id, name, color, 0 as used`,
        [projectId, name, pickColor(taken.rows.map((r) => r.color))]
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
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = tagPatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad patch.' });
    }
    const current = await pool.query<{ project_id: string | null }>(
      'select project_id from tags where id = $1',
      [id]
    );
    if (!current.rowCount) return reply.code(404).send({ error: 'No such tag.' });
    const home = current.rows[0].project_id;
    const reaches = home
      ? await mayOpenProject(auth, home)
      : auth.isAdmin || !(await deniedFor(auth.roleId)).everything;
    if (!reaches) return reply.code(404).send({ error: 'No such tag.' });

    const twins = await pool.query<{ id: string; project_id: string | null }>(
      'select id, project_id from tags where lower(name) = lower($1) and id <> $2',
      [parsed.data.name, id]
    );
    if (twins.rows.some((t) => t.project_id === current.rows[0].project_id)) {
      return reply.code(409).send({ error: 'A tag with that name already exists here.' });
    }
    if (twins.rowCount) {
      const merged = await mergeIntoGlobal(parsed.data.name, id);
      return reply.send({ data: { ...publicTag(merged), merged: true } });
    }
    const res = await pool.query<TagRow>(
      `update tags set name = $2
        where id = $1
        returning id, project_id, name, color,
                  (select count(*)::int from issue_tags it where it.tag_id = tags.id) as used`,
      [id, parsed.data.name]
    );
    return reply.send({ data: publicTag(res.rows[0]) });
  });

  app.delete('/tags/:id', async (req, reply) => {
    const auth = await requireDeleter(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const current = await pool.query<{ project_id: string | null }>(
      'select project_id from tags where id = $1',
      [id]
    );
    if (!current.rowCount) return reply.code(404).send({ error: 'No such tag.' });
    const home = current.rows[0].project_id;
    const reaches = home
      ? await mayOpenProject(auth, home)
      : auth.isAdmin || !(await deniedFor(auth.roleId)).everything;
    if (!reaches) return reply.code(404).send({ error: 'No such tag.' });
    const used = await pool.query<{ n: number }>(
      'select count(*)::int as n from issue_tags where tag_id = $1',
      [id]
    );
    const res = await pool.query('delete from tags where id = $1', [id]);
    if (!res.rowCount) return reply.code(404).send({ error: 'No such tag.' });
    return reply.send({ data: { ok: true, removedFrom: used.rows[0].n } });
  });
}
