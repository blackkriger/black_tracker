import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import { requireAuth, requireDeleter, type Auth } from './auth.js';
import { deniedFor, mayOpenBoard } from './board-service.js';
import { pickColor } from './colors.js';

interface TagRow {
  id: string;
  name: string;
  color: string;
  used: number;
}

const publicTag = (r: TagRow) => ({
  id: r.id,
  name: r.name,
  color: r.color,
  used: r.used,
});

const tagCreate = z.object({
  name: z.string().trim().min(1).max(40),
  boardId: z.string().uuid().optional(),
});

const tagPatch = z.object({
  name: z.string().trim().min(1).max(40),
});

const TAG_COLUMNS = `id, name, color,
  (select count(*)::int from issue_tags it where it.tag_id = tags.id) as used`;

async function reachesTags(auth: Auth): Promise<boolean> {
  return auth.isAdmin || !(await deniedFor(auth.roleId)).everything;
}

async function boardFor(auth: Auth, boardId: string): Promise<boolean> {
  const res = await pool.query<{ project_id: string }>('select project_id from boards where id = $1', [
    boardId,
  ]);
  return !!res.rowCount && (await mayOpenBoard(auth, boardId, res.rows[0].project_id));
}

export function registerTagRoutes(app: FastifyInstance): void {
  app.get('/tags', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    if (!(await reachesTags(auth))) return reply.send({ data: [] });
    const res = await pool.query<TagRow>(`select ${TAG_COLUMNS} from tags order by lower(name)`);
    return reply.send({ data: res.rows.map(publicTag) });
  });

  app.post('/tags', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const parsed = tagCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad tag.' });
    }
    const { name, boardId } = parsed.data;
    if (!(await reachesTags(auth))) {
      return reply.code(403).send({ error: 'Making a tag is not open to your role.' });
    }
    if (boardId && !(await boardFor(auth, boardId))) {
      return reply.code(404).send({ error: 'No such board.' });
    }

    const twin = await pool.query<TagRow>(
      `select ${TAG_COLUMNS} from tags where lower(name) = lower($1)`,
      [name]
    );
    let tag = twin.rows[0];
    if (tag && !boardId) {
      return reply.code(409).send({ error: 'A tag with that name already exists.' });
    }
    if (!tag) {
      const taken = await pool.query<{ color: string }>('select color from tags');
      const made = await pool.query<TagRow>(
        `insert into tags (name, color) values ($1, $2) returning id, name, color, 0 as used`,
        [name, pickColor(taken.rows.map((r) => r.color))]
      );
      tag = made.rows[0];
    }
    if (boardId) {
      await pool.query(
        'insert into board_tags (board_id, tag_id) values ($1, $2) on conflict do nothing',
        [boardId, tag.id]
      );
    }
    return reply.code(twin.rowCount ? 200 : 201).send({ data: publicTag(tag) });
  });

  app.patch('/tags/:id', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = tagPatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad patch.' });
    }
    if (!(await reachesTags(auth))) return reply.code(404).send({ error: 'No such tag.' });
    const twin = await pool.query('select 1 from tags where lower(name) = lower($1) and id <> $2', [
      parsed.data.name,
      id,
    ]);
    if (twin.rowCount) return reply.code(409).send({ error: 'A tag with that name already exists.' });
    const res = await pool.query<TagRow>(
      `update tags set name = $2 where id = $1 returning ${TAG_COLUMNS}`,
      [id, parsed.data.name]
    );
    if (!res.rowCount) return reply.code(404).send({ error: 'No such tag.' });
    return reply.send({ data: publicTag(res.rows[0]) });
  });

  app.delete('/tags/:id', async (req, reply) => {
    const auth = await requireDeleter(req, reply);
    if (!auth) return;
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
