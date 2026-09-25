// Boards are saved filters over a project; their columns are the project's statuses, so there is nothing here about columns. Access is open by default and what gets stored is the exception: this person does not see this board.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { inTransaction, pool } from './db.js';
import { requireAdmin, requireAuth } from './auth.js';
import { projectByShort } from './project-routes.js';

interface BoardRow {
  id: string;
  project_id: string;
  name: string;
  filter_json: Record<string, unknown>;
  position: number;
}

const publicBoard = (r: BoardRow, deniedTo: string[] = []) => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  filter: r.filter_json,
  position: r.position,
  /** Who cannot see it. Admin screens read this; everyone else only ever gets boards they may open. */
  deniedTo,
});

// Whatever the list screen can filter by. Unknown keys are refused rather than stored, so a board cannot quietly carry a filter nothing understands.
const filterSchema = z
  .object({
    states: z.array(z.string().uuid()).max(20).optional(),
    assignees: z.array(z.string().uuid()).max(20).optional(),
    tags: z.array(z.string().uuid()).max(20).optional(),
    priorities: z.array(z.enum(['Critical', 'Major', 'Normal', 'Minor'])).max(4).optional(),
    query: z.string().trim().max(200).optional(),
  })
  .strict();

const boardCreate = z.object({
  name: z.string().trim().min(1).max(60),
  filter: filterSchema.optional(),
});

const boardPatch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  filter: filterSchema.optional(),
  position: z.number().int().min(0).optional(),
});

async function denialsFor(boardIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!boardIds.length) return out;
  const res = await pool.query<{ board_id: string; user_id: string }>(
    'select board_id, user_id from board_denials where board_id = any($1::uuid[])',
    [boardIds]
  );
  for (const row of res.rows) {
    const list = out.get(row.board_id) ?? [];
    list.push(row.user_id);
    out.set(row.board_id, list);
  }
  return out;
}

export function registerBoardRoutes(app: FastifyInstance): void {
  app.get('/projects/:short/boards', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { short } = req.params as { short: string };
    const project = await projectByShort(short);
    if (!project) return reply.code(404).send({ error: 'No such project.' });

    const res = await pool.query<BoardRow>(
      'select * from boards where project_id = $1 order by position, name',
      [project.id]
    );
    const denials = await denialsFor(res.rows.map((r) => r.id));
    // An admin manages access, so they see every board and who is shut out; anyone else is simply not handed the boards they cannot open.
    const rows = auth.isAdmin
      ? res.rows.map((r) => publicBoard(r, denials.get(r.id) ?? []))
      : res.rows
          .filter((r) => !(denials.get(r.id) ?? []).includes(auth.userId))
          .map((r) => publicBoard(r));
    return reply.send({ data: rows });
  });

  app.post('/projects/:short/boards', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { short } = req.params as { short: string };
    const parsed = boardCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad board.' });
    }
    const project = await projectByShort(short);
    if (!project) return reply.code(404).send({ error: 'No such project.' });
    const res = await pool.query<BoardRow>(
      `insert into boards (project_id, name, filter_json, position)
       values ($1, $2, $3::jsonb, (select coalesce(max(position), -1) + 1 from boards where project_id = $1))
       returning *`,
      [project.id, parsed.data.name, JSON.stringify(parsed.data.filter ?? {})]
    );
    return reply.code(201).send({ data: publicBoard(res.rows[0]) });
  });

  app.patch('/boards/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const parsed = boardPatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad patch.' });
    }
    const p = parsed.data;
    const res = await pool.query<BoardRow>(
      `update boards
          set name = coalesce($2, name),
              filter_json = coalesce($3::jsonb, filter_json),
              position = coalesce($4, position)
        where id = $1
        returning *`,
      [id, p.name ?? null, p.filter ? JSON.stringify(p.filter) : null, p.position ?? null]
    );
    if (!res.rowCount) return reply.code(404).send({ error: 'No such board.' });
    const denials = await denialsFor([id]);
    return reply.send({ data: publicBoard(res.rows[0], denials.get(id) ?? []) });
  });

  app.post('/projects/:short/boards/order', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { short } = req.params as { short: string };
    const parsed = z.object({ ids: z.array(z.string().uuid()).min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Send the ids in their new order.' });
    const project = await projectByShort(short);
    if (!project) return reply.code(404).send({ error: 'No such project.' });
    await pool.query(
      `update boards b
          set position = o.pos
         from unnest($2::uuid[]) with ordinality as o(id, pos)
        where b.id = o.id and b.project_id = $1`,
      [project.id, parsed.data.ids]
    );
    const res = await pool.query<BoardRow>(
      'select * from boards where project_id = $1 order by position, name',
      [project.id]
    );
    const denials = await denialsFor(res.rows.map((r) => r.id));
    return reply.send({ data: res.rows.map((r) => publicBoard(r, denials.get(r.id) ?? [])) });
  });

  app.delete('/boards/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const res = await pool.query('delete from boards where id = $1', [id]);
    if (!res.rowCount) return reply.code(404).send({ error: 'No such board.' });
    return reply.send({ data: { ok: true } });
  });

  // The whole denial list for one board, replaced in one call: the access screen sends who is shut out after every tick.
  app.put('/boards/:id/access', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const parsed = z
      .object({ deniedTo: z.array(z.string().uuid()).max(100) })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Send the list of user ids.' });
    const board = await pool.query('select 1 from boards where id = $1', [id]);
    if (!board.rowCount) return reply.code(404).send({ error: 'No such board.' });
    await inTransaction(async (client) => {
      await client.query('delete from board_denials where board_id = $1', [id]);
      if (parsed.data.deniedTo.length) {
        await client.query(
          `insert into board_denials (board_id, user_id)
           select $1, u from unnest($2::uuid[]) as u
           on conflict do nothing`,
          [id, parsed.data.deniedTo]
        );
      }
    });
    return reply.send({ data: { deniedTo: parsed.data.deniedTo } });
  });
}
