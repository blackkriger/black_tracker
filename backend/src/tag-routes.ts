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

// Nobody picks a tag colour by hand and no two tags share one. The hues already worn in this scope are sorted around the circle, the widest gap between them is found, and the new hue lands somewhere inside it: the first tags come out plainly random, and the fiftieth is simply as far from its neighbours as the circle still allows. Saturation and lightness are fixed so every tag reads the same weight on the dark background.
const TAG_SAT = 62;
const TAG_LIGHT = 64;

function hexToHue(hex: string): number | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return null; // grey has no hue to keep away from
  const d = max - min;
  const h =
    max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) % 360 + 360) % 360;
}

function hslToHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * v)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

async function freshColor(projectId: string | null): Promise<string> {
  const res = await pool.query<{ color: string }>(
    // Global tags share the field with every project's own, so both halves count as taken.
    'select color from tags where project_id is null or project_id is not distinct from $1',
    [projectId]
  );
  const hues = res.rows
    .map((r) => hexToHue(r.color))
    .filter((h): h is number => h != null)
    .sort((a, b) => a - b);
  if (!hues.length) {
    return hslToHex(Math.floor(Math.random() * 360), TAG_SAT, TAG_LIGHT);
  }
  // The gap that wraps past 360 counts too, or every new tag would crowd the low end of the circle.
  let start = hues[hues.length - 1];
  let size = 360 - hues[hues.length - 1] + hues[0];
  for (let i = 1; i < hues.length; i++) {
    const gap = hues[i] - hues[i - 1];
    if (gap > size) {
      start = hues[i - 1];
      size = gap;
    }
  }
  // Somewhere in the middle half of the gap: random, but never hugging a neighbour.
  const hue = (start + size * (0.25 + Math.random() * 0.5)) % 360;
  return hslToHex(Math.round(hue), TAG_SAT, TAG_LIGHT);
}

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
        [projectId, name, color ?? (await freshColor(projectId))]
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
