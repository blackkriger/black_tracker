import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import { requireAuth, requireDeleter, type Auth } from './auth.js';
import { DENIES_NOTHING, deniedFor, mayOpenBoard } from './board-service.js';
import { pickColor } from './colors.js';

interface TagRow {
  id: string;
  name: string;
  color: string;
  used: number;
}

const publicTag = (r: TagRow, boardIds: string[] = []) => ({
  id: r.id,
  name: r.name,
  color: r.color,
  used: r.used,
  boardIds,
});

const tagCreate = z.object({
  name: z.string().trim().min(1).max(40),
  boardId: z.string().uuid().optional(),
});

const tagPatch = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .transform((c) => c.toLowerCase())
    .optional(),
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

async function boardsOfTags(auth: Auth, tagIds: string[]): Promise<Map<string, string[]>> {
  const byTag = new Map<string, string[]>();
  if (!tagIds.length) return byTag;
  const denied = auth.isAdmin ? DENIES_NOTHING : await deniedFor(auth.roleId);
  const res = await pool.query<{ tag_id: string; board_id: string; project_id: string }>(
    `select bt.tag_id, bt.board_id, b.project_id
       from board_tags bt join boards b on b.id = bt.board_id
      where bt.tag_id = any($1::uuid[])`,
    [tagIds]
  );
  for (const row of res.rows) {
    if (denied.boards.has(row.board_id) || denied.projects.has(row.project_id)) continue;
    const list = byTag.get(row.tag_id) ?? [];
    list.push(row.board_id);
    byTag.set(row.tag_id, list);
  }
  return byTag;
}

async function withBoards(auth: Auth, rows: TagRow[]) {
  const byTag = await boardsOfTags(auth, rows.map((r) => r.id));
  return rows.map((r) => publicTag(r, byTag.get(r.id) ?? []));
}

export function registerTagRoutes(app: FastifyInstance): void {
  app.get('/tags', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    if (!(await reachesTags(auth))) return reply.send({ data: [] });
    const res = await pool.query<TagRow>(`select ${TAG_COLUMNS} from tags order by lower(name)`);
    return reply.send({ data: await withBoards(auth, res.rows) });
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
    const [data] = await withBoards(auth, [tag]);
    return reply.code(twin.rowCount ? 200 : 201).send({ data });
  });

  async function setOnBoard(req: FastifyRequest, reply: FastifyReply, on: boolean) {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { id, boardId } = req.params as { id: string; boardId: string };
    if (!(await reachesTags(auth))) return reply.code(404).send({ error: 'No such tag.' });
    if (!(await boardFor(auth, boardId))) return reply.code(404).send({ error: 'No such board.' });
    const res = await pool.query<TagRow>(`select ${TAG_COLUMNS} from tags where id = $1`, [id]);
    if (!res.rowCount) return reply.code(404).send({ error: 'No such tag.' });
    await pool.query(
      on
        ? 'insert into board_tags (board_id, tag_id) values ($1, $2) on conflict do nothing'
        : 'delete from board_tags where board_id = $1 and tag_id = $2',
      [boardId, id]
    );
    const [data] = await withBoards(auth, res.rows);
    return reply.send({ data });
  }

  app.put('/tags/:id/boards/:boardId', (req, reply) => setOnBoard(req, reply, true));
  app.delete('/tags/:id/boards/:boardId', (req, reply) => setOnBoard(req, reply, false));

  app.patch('/tags/:id', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = tagPatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad patch.' });
    }
    if (!(await reachesTags(auth))) return reply.code(404).send({ error: 'No such tag.' });
    if (parsed.data.name) {
      const twin = await pool.query('select 1 from tags where lower(name) = lower($1) and id <> $2', [
        parsed.data.name,
        id,
      ]);
      if (twin.rowCount) return reply.code(409).send({ error: 'A tag with that name already exists.' });
    }
    const res = await pool.query<TagRow>(
      `update tags set name = coalesce($2, name), color = coalesce($3, color) where id = $1 returning ${TAG_COLUMNS}`,
      [id, parsed.data.name ?? null, parsed.data.color ?? null]
    );
    if (!res.rowCount) return reply.code(404).send({ error: 'No such tag.' });
    const [data] = await withBoards(auth, res.rows);
    return reply.send({ data });
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
