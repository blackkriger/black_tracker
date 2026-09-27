// Boards and the statuses that are their columns. A board owns its columns, so two boards in one project can run entirely different workflows; access is open by default and what gets stored is the exception — this person does not see this board.

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

// Open and resolved are two ends of the same question, so setting one clears the other rather than leaving a status that is both.
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
    const { rows, statesByBoard } = await boardsOfProject(project.id);
    const denials = await denialsFor(rows.map((r) => r.id));
    // An admin manages access, so they see every board and which roles are shut out; anyone else is simply not handed the boards their role cannot open.
    const visible = auth.isAdmin ? rows : rows.filter((r) => !denied.boards.has(r.id));
    return reply.send({
      data: visible.map((r) =>
        publicBoard(r, statesByBoard.get(r.id) ?? [], auth.isAdmin ? denials.get(r.id) ?? [] : [])
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
    return reply.send({
      data: publicBoard(board, await statesOf(id), auth.isAdmin ? denials.get(id) ?? [] : []),
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
    // A new board arrives with the starting four columns; from there they are edited per board.
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
    // Renaming moves the address with the name, so a board is never reachable under a word it no longer wears.
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
    return reply.send({ data: publicBoard(res.rows[0], await statesOf(id)) });
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
    await pool.query(
      `update boards b
          set position = o.pos
         from unnest($2::uuid[]) with ordinality as o(id, pos)
        where b.id = o.id and b.project_id = $1`,
      [project.id, parsed.data.ids]
    );
    const { rows, statesByBoard } = await boardsOfProject(project.id);
    return reply.send({ data: rows.map((r) => publicBoard(r, statesByBoard.get(r.id) ?? [])) });
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
    // The board's statuses and issues go with it, which is what the confirmation on the screen spells out — and their files go with them.
    const doomed = await pool.query<{ id: string }>('select id from issues where board_id = $1', [
      id,
    ]);
    const ids = doomed.rows.map((r) => r.id);
    const paths = await filesOfIssues(ids);
    await pool.query('delete from boards where id = $1', [id]);
    await sweepFiles(ids, paths);
    return reply.send({ data: { ok: true, issues: doomed.rowCount ?? 0 } });
  });

  // ── the board's columns ────────────────────────────────────────
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
          // A status everyone names the same way keeps its usual colour; anything else gets one no sibling wears.
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
      res = await pool.query<StateRow>(
        `update states
            set name = coalesce($2, name),
                is_open = $3,
                is_resolved = $4,
                position = coalesce($5, position)
          where id = $1
          returning *`,
        [id, p.name ?? null, flags.isOpen, flags.isResolved, p.position ?? null]
      );
    } catch (err) {
      // The board's own unique index answers before we do; a renamed status that collides gets the same 409 a new one would.
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'That board already has a status with this name.' });
      }
      throw err;
    }
    if (!res.rowCount) return reply.code(404).send({ error: 'No such status.' });
    return reply.send({ data: publicState(res.rows[0]) });
  });

  // Column order, sent as the whole list: dragging one column moves the others, and one statement keeps them consistent.
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
    // Refusing while issues sit in the status is the point: moving them silently would lose where they were.
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

  // The whole denial list for one board, replaced in one call: the access screen sends who is shut out after every tick.
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
