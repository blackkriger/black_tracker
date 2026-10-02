import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { inTransaction, pool } from './db.js';
import { filesOfIssues, sweepFiles } from './issue-routes.js';
import { requireAdmin, requireAuth, requireDeleter } from './auth.js';
import { boardsOfProject, projectByShort } from './project-routes.js';
import {
  DENIES_NOTHING,
  createBoardWithDefaults,
  deniedFor,
  denialsFor,
  freeSlug,
  mayOpenBoard,
  mayOpenProject,
  publicBoard,
  publicState,
  tagIdsByBoard,
  type BoardRow,
  type StateRow,
} from './board-service.js';
import { knownColor, pickColor } from './colors.js';

const boardCreate = z.object({ name: z.string().trim().min(1).max(60) });

const boardPatch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  defaultStateId: z.string().uuid().optional(),
  position: z.number().int().min(0).optional(),
});

const stateCreate = z.object({
  name: z.string().trim().min(1).max(60),
  isOpen: z.boolean().optional(),
  isResolved: z.boolean().optional(),
});

const statePatch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  isOpen: z.boolean().optional(),
  isResolved: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});

async function boardById(id: string): Promise<BoardRow | null> {
  const res = await pool.query<BoardRow>(
    'select id, project_id, name, slug, default_state_id, position from boards where id = $1',
    [id]
  );
  return res.rows[0] ?? null;
}

function settleFlags(
  next: { isOpen?: boolean; isResolved?: boolean },
  current: { is_open: boolean; is_resolved: boolean }
): { isOpen: boolean; isResolved: boolean } {
  if (next.isResolved !== undefined) {
    return next.isResolved
      ? { isOpen: false, isResolved: true }
      : { isOpen: next.isOpen ?? true, isResolved: false };
  }
  if (next.isOpen !== undefined) {
    return next.isOpen
      ? { isOpen: true, isResolved: false }
      : { isOpen: false, isResolved: current.is_resolved };
  }
  return { isOpen: current.is_open, isResolved: current.is_resolved };
}

async function statesOf(boardId: string): Promise<StateRow[]> {
  const res = await pool.query<StateRow>(
    'select * from states where board_id = $1 order by position, name',
    [boardId]
  );
  return res.rows;
}

export function registerBoardRoutes(app: FastifyInstance): void {
  app.get('/projects/:short/boards', async (req, reply) => {
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
    const denials = await denialsFor(rows.map((r) => r.id));
    const visible = auth.isAdmin ? rows : rows.filter((r) => !denied.boards.has(r.id));
    return reply.send({
      data: visible.map((r) =>
        publicBoard(
          r,
          statesByBoard.get(r.id) ?? [],
          auth.isAdmin ? denials.get(r.id) ?? [] : [],
          tagsByBoard.get(r.id) ?? []
        )
      ),
    });
  });

  app.get('/boards/:id', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const board = await boardById(id);
    if (!board) return reply.code(404).send({ error: 'No such board.' });
    const denials = await denialsFor([id]);
    if (!auth.isAdmin) {
      const denied = await deniedFor(auth.roleId);
      if (denied.everything || denied.boards.has(id) || denied.projects.has(board.project_id)) {
        return reply.code(403).send({ error: 'This board is not open to you.' });
      }
    }
    const tags = await tagIdsByBoard([id]);
    return reply.send({
      data: publicBoard(
        board,
        await statesOf(id),
        auth.isAdmin ? denials.get(id) ?? [] : [],
        tags.get(id) ?? []
      ),
    });
  });

  app.post('/projects/:short/boards', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { short } = req.params as { short: string };
    const parsed = boardCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad board.' });
    }
    const project = await projectByShort(short);
    if (!project || !(await mayOpenProject(auth, project.id))) {
      return reply.code(404).send({ error: 'No such project.' });
    }
    const board = await inTransaction((client) =>
      createBoardWithDefaults(client, project.id, parsed.data.name)
    );
    return reply.code(201).send({ data: publicBoard(board, await statesOf(board.id)) });
  });

  app.patch('/boards/:id', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = boardPatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad patch.' });
    }
    const p = parsed.data;
    const board = await boardById(id);
    if (!board || !(await mayOpenBoard(auth, id, board.project_id))) {
      return reply.code(404).send({ error: 'No such board.' });
    }
    const slug = p.name
      ? await inTransaction((client) => freeSlug(client, board.project_id, p.name as string, id))
      : null;
    if (p.defaultStateId) {
      const belongs = await pool.query('select 1 from states where id = $1 and board_id = $2', [
        p.defaultStateId,
        id,
      ]);
      if (!belongs.rowCount) {
        return reply.code(400).send({ error: 'That status belongs to another board.' });
      }
    }
    const res = await pool.query<BoardRow>(
      `update boards
          set name = coalesce($2, name),
              slug = coalesce($3, slug),
              default_state_id = coalesce($4, default_state_id),
              position = coalesce($5, position)
        where id = $1
        returning id, project_id, name, slug, default_state_id, position`,
      [id, p.name ?? null, slug, p.defaultStateId ?? null, p.position ?? null]
    );
    const tags = await tagIdsByBoard([id]);
    return reply.send({ data: publicBoard(res.rows[0], await statesOf(id), [], tags.get(id) ?? []) });
  });

  app.post('/projects/:short/boards/order', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { short } = req.params as { short: string };
    const parsed = z.object({ ids: z.array(z.string().uuid()).min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Send the ids in their new order.' });
    const project = await projectByShort(short);
    if (!project || !(await mayOpenProject(auth, project.id))) {
      return reply.code(404).send({ error: 'No such project.' });
    }
    const denied = auth.isAdmin ? DENIES_NOTHING : await deniedFor(auth.roleId);
    await pool.query(
      `update boards b
          set position = o.pos
         from unnest($2::uuid[]) with ordinality as o(id, pos)
        where b.id = o.id and b.project_id = $1 and b.id <> all($3::uuid[])`,
      [project.id, parsed.data.ids, [...denied.boards]]
    );
    const { rows, statesByBoard, tagsByBoard } = await boardsOfProject(project.id);
    return reply.send({
      data: rows
        .filter((r) => !denied.boards.has(r.id))
        .map((r) => publicBoard(r, statesByBoard.get(r.id) ?? [], [], tagsByBoard.get(r.id) ?? [])),
    });
  });

  app.delete('/boards/:id', async (req, reply) => {
    const auth = await requireDeleter(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const board = await boardById(id);
    if (!board) return reply.code(404).send({ error: 'No such board.' });
    if (!auth.isAdmin) {
      const denied = await deniedFor(auth.roleId);
      if (denied.everything || denied.boards.has(id) || denied.projects.has(board.project_id)) {
        return reply.code(403).send({ error: 'This board is not open to you.' });
      }
    }
    const doomed = await pool.query<{ id: string }>('select id from issues where board_id = $1', [
      id,
    ]);
    const ids = doomed.rows.map((r) => r.id);
    const paths = await filesOfIssues(ids);
    await pool.query('delete from boards where id = $1', [id]);
    await sweepFiles(ids, paths);
    return reply.send({ data: { ok: true, issues: doomed.rowCount ?? 0 } });
  });

  app.post('/boards/:id/states', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = stateCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad status.' });
    }
    const board = await boardById(id);
    if (!board || !(await mayOpenBoard(auth, id, board.project_id))) {
      return reply.code(404).send({ error: 'No such board.' });
    }
    const p = parsed.data;
    const flags = settleFlags(p, { is_open: true, is_resolved: false });
    try {
      const taken = await pool.query<{ color: string }>(
        'select color from states where board_id = $1',
        [id]
      );
      const res = await pool.query<StateRow>(
        `insert into states (board_id, name, position, is_open, is_resolved, color)
         values ($1, $2, (select coalesce(max(position), -1) + 1 from states where board_id = $1), $3, $4, $5)
         returning *`,
        [
          id,
          p.name,
          flags.isOpen,
          flags.isResolved,
          knownColor(p.name) ?? pickColor(taken.rows.map((r) => r.color)),
        ]
      );
      return reply.code(201).send({ data: publicState(res.rows[0]) });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'This board already has a status with that name.' });
      }
      throw err;
    }
  });

  app.patch('/states/:id', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = statePatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad patch.' });
    }
    const p = parsed.data;
    const before = await pool.query<{ is_open: boolean; is_resolved: boolean; board_id: string }>(
      'select is_open, is_resolved, board_id from states where id = $1',
      [id]
    );
    if (!before.rowCount) return reply.code(404).send({ error: 'No such status.' });
    const host = await boardById(before.rows[0].board_id);
    if (!host || !(await mayOpenBoard(auth, host.id, host.project_id))) {
      return reply.code(404).send({ error: 'No such status.' });
    }
    const flags = settleFlags(p, before.rows[0]);
    let res;
    try {
      res = await inTransaction(async (client) => {
        const updated = await client.query<StateRow>(
          `update states
              set name = coalesce($2, name),
                  is_open = $3,
                  is_resolved = $4,
                  position = coalesce($5, position)
            where id = $1
            returning *`,
          [id, p.name ?? null, flags.isOpen, flags.isResolved, p.position ?? null]
        );
        if (flags.isResolved !== before.rows[0].is_resolved) {
          await client.query(
            `update issues
                set resolved_at = case when $2 then coalesce(resolved_at, now()) else null end
              where state_id = $1`,
            [id, flags.isResolved]
          );
        }
        return updated;
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'That board already has a status with this name.' });
      }
      throw err;
    }
    if (!res.rowCount) return reply.code(404).send({ error: 'No such status.' });
    return reply.send({ data: publicState(res.rows[0]) });
  });

  app.post('/boards/:id/states/order', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = z.object({ ids: z.array(z.string().uuid()).min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Send the ids in their new order.' });
    const board = await boardById(id);
    if (!board || !(await mayOpenBoard(auth, id, board.project_id))) {
      return reply.code(404).send({ error: 'No such board.' });
    }
    await pool.query(
      `update states s
          set position = o.pos
         from unnest($2::uuid[]) with ordinality as o(sid, pos)
        where s.id = o.sid and s.board_id = $1`,
      [id, parsed.data.ids]
    );
    return reply.send({ data: (await statesOf(id)).map(publicState) });
  });

  app.delete('/states/:id', async (req, reply) => {
    const auth = await requireDeleter(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const onBoard = await pool.query<{ board_id: string; project_id: string }>(
      `select s.board_id, b.project_id from states s join boards b on b.id = s.board_id
        where s.id = $1`,
      [id]
    );
    if (!onBoard.rowCount) return reply.code(404).send({ error: 'No such status.' });
    if (!auth.isAdmin) {
      const denied = await deniedFor(auth.roleId);
      const { board_id: boardId, project_id: projectId } = onBoard.rows[0];
      if (denied.everything || denied.boards.has(boardId) || denied.projects.has(projectId)) {
        return reply.code(403).send({ error: 'This board is not open to you.' });
      }
    }
    const used = await pool.query<{ n: number }>(
      'select count(*)::int as n from issues where state_id = $1',
      [id]
    );
    if (used.rows[0].n > 0) {
      return reply.code(409).send({
        error: `Move the ${used.rows[0].n} issue(s) out of this status first.`,
      });
    }
    const res = await inTransaction(async (client) => {
      const gone = await client.query('delete from states where id = $1', [id]);
      await client.query(
        `update boards
            set default_state_id = (
              select id from states where board_id = $1 order by position limit 1
            )
          where id = $1 and default_state_id is null`,
        [onBoard.rows[0].board_id]
      );
      return gone;
    });
    if (!res.rowCount) return reply.code(404).send({ error: 'No such status.' });
    return reply.send({ data: { ok: true } });
  });

  app.put('/boards/:id/access', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const parsed = z
      .object({ deniedRoles: z.array(z.string().uuid()).max(100) })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Send the list of role ids.' });
    if (!(await boardById(id))) return reply.code(404).send({ error: 'No such board.' });
    await inTransaction(async (client) => {
      await client.query('delete from board_denials where board_id = $1', [id]);
      if (parsed.data.deniedRoles.length) {
        await client.query(
          `insert into board_denials (board_id, role_id)
           select $1, r from unnest($2::uuid[]) as r
           on conflict do nothing`,
          [id, parsed.data.deniedRoles]
        );
      }
    });
    return reply.send({ data: { deniedRoles: parsed.data.deniedRoles } });
  });
}
