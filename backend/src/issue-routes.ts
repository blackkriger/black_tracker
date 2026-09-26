// Issues, and everything hanging off one: comments, files and the record of what changed. An issue lives on exactly one board and wears that board's status. Its key — PROJ-12 — is minted from the project's own counter inside the transaction that inserts it, so two writers never land on one number.

import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { inTransaction, pool } from './db.js';
import { env } from './env.js';
import { requireAuth, requireDeleter, requireSession, type Auth } from './auth.js';
import { deniedFor } from './board-service.js';

const PRIORITIES = ['Critical', 'Major', 'Normal', 'Minor'] as const;

interface IssueRow {
  id: string;
  readable_id: string;
  project_id: string;
  board_id: string;
  number: number;
  summary: string;
  description: string;
  state_id: string;
  priority: string;
  assignee_id: string | null;
  author_id: string | null;
  due_date: string | null;
  position: number;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
  assignee_login: string | null;
  author_login: string | null;
}

interface TagRow {
  id: string;
  name: string;
  color: string;
}

const person = (id: string | null, login: string | null) =>
  id && login ? { id, login } : null;

const publicIssue = (r: IssueRow, tags: TagRow[] = []) => ({
  id: r.id,
  key: r.readable_id,
  projectId: r.project_id,
  boardId: r.board_id,
  summary: r.summary,
  description: r.description,
  stateId: r.state_id,
  priority: r.priority,
  assignee: person(r.assignee_id, r.assignee_login),
  author: person(r.author_id, r.author_login),
  dueDate: r.due_date,
  position: r.position,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
  resolvedAt: r.resolved_at?.toISOString() ?? null,
  tags,
});

const ISSUE_SELECT = `
  select i.*, a.login as assignee_login, w.login as author_login
    from issues i
    left join users a on a.id = i.assignee_id
    left join users w on w.id = i.author_id`;

// Tags for a set of issues in one query rather than one per card.
async function tagsFor(issueIds: string[]): Promise<Map<string, TagRow[]>> {
  const out = new Map<string, TagRow[]>();
  if (!issueIds.length) return out;
  const res = await pool.query<TagRow & { issue_id: string }>(
    `select it.issue_id, t.id, t.name, t.color
       from issue_tags it join tags t on t.id = it.tag_id
      where it.issue_id = any($1::uuid[])
      order by lower(t.name)`,
    [issueIds]
  );
  for (const row of res.rows) {
    const list = out.get(row.issue_id) ?? [];
    list.push({ id: row.id, name: row.name, color: row.color });
    out.set(row.issue_id, list);
  }
  return out;
}

async function issueById(id: string): Promise<IssueRow | null> {
  const res = await pool.query<IssueRow>(`${ISSUE_SELECT} where i.id = $1`, [id]);
  return res.rows[0] ?? null;
}

// The board decides who may see an issue, so every route about an issue asks the same question first.
async function mayOpenBoard(auth: Auth, boardId: string, projectId: string): Promise<boolean> {
  if (auth.isAdmin) return true;
  const denied = await deniedFor(auth.roleId);
  return !denied.everything && !denied.boards.has(boardId) && !denied.projects.has(projectId);
}

async function loadIssueFor(
  req: FastifyRequest,
  reply: FastifyReply,
  id: string
): Promise<{ auth: Auth; issue: IssueRow } | null> {
  const auth = await requireAuth(req, reply);
  if (!auth) return null;
  const issue = await issueById(id);
  if (!issue) {
    reply.code(404).send({ error: 'No such issue.' });
    return null;
  }
  if (!(await mayOpenBoard(auth, issue.board_id, issue.project_id))) {
    reply.code(403).send({ error: 'This issue is not open to you.' });
    return null;
  }
  return { auth, issue };
}

// Every change worth asking about later: who moved it, what it was, what it became.
async function writeHistory(
  client: { query: typeof pool.query },
  issueId: string,
  userId: string,
  field: string,
  oldValue: string | null,
  newValue: string | null
): Promise<void> {
  await client.query(
    'insert into issue_history (issue_id, user_id, field, old_value, new_value) values ($1, $2, $3, $4, $5)',
    [issueId, userId, field, oldValue, newValue]
  );
}

const issueCreate = z.object({
  summary: z.string().trim().min(1).max(300),
  description: z.string().max(20000).optional(),
  stateId: z.string().uuid().optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  tagIds: z.array(z.string().uuid()).max(50).optional(),
});

const issuePatch = z.object({
  summary: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(20000).optional(),
  stateId: z.string().uuid().optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  tagIds: z.array(z.string().uuid()).max(50).optional(),
});

export function registerIssueRoutes(app: FastifyInstance): void {
  // ── the board's cards ────────────────────────────────────────────
  app.get('/boards/:id/issues', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const board = await pool.query<{ project_id: string }>(
      'select project_id from boards where id = $1',
      [id]
    );
    if (!board.rowCount) return reply.code(404).send({ error: 'No such board.' });
    if (!(await mayOpenBoard(auth, id, board.rows[0].project_id))) {
      return reply.code(403).send({ error: 'This board is not open to you.' });
    }
    const res = await pool.query<IssueRow>(
      `${ISSUE_SELECT} where i.board_id = $1 order by i.position, i.created_at`,
      [id]
    );
    const tags = await tagsFor(res.rows.map((r) => r.id));
    return reply.send({ data: res.rows.map((r) => publicIssue(r, tags.get(r.id) ?? [])) });
  });

  app.post('/boards/:id/issues', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = issueCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad issue.' });
    }
    const p = parsed.data;
    const board = await pool.query<{ project_id: string; default_state_id: string | null }>(
      'select project_id, default_state_id from boards where id = $1',
      [id]
    );
    if (!board.rowCount) return reply.code(404).send({ error: 'No such board.' });
    const { project_id: projectId, default_state_id: defaultStateId } = board.rows[0];
    if (!(await mayOpenBoard(auth, id, projectId))) {
      return reply.code(403).send({ error: 'This board is not open to you.' });
    }

    const stateId = p.stateId ?? defaultStateId;
    if (!stateId) return reply.code(400).send({ error: 'This board has no statuses yet.' });
    const state = await pool.query('select 1 from states where id = $1 and board_id = $2', [
      stateId,
      id,
    ]);
    if (!state.rowCount) return reply.code(400).send({ error: 'That status is on another board.' });

    const created = await inTransaction(async (client) => {
      // The counter is bumped and read in one statement, inside the transaction that inserts the issue: two people creating at once get two numbers.
      const counter = await client.query<{ short_name: string; next_issue_number: number }>(
        `update projects set next_issue_number = next_issue_number + 1
          where id = $1
          returning short_name, next_issue_number - 1 as next_issue_number`,
        [projectId]
      );
      const { short_name: short, next_issue_number: number } = counter.rows[0];
      const top = await client.query<{ pos: number }>(
        'select coalesce(min(position), 0) - 1 as pos from issues where board_id = $1 and state_id = $2',
        [id, stateId]
      );
      const row = await client.query<{ id: string }>(
        `insert into issues
           (readable_id, project_id, board_id, number, summary, description, state_id,
            priority, assignee_id, author_id, due_date, position)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         returning id`,
        [
          `${short}-${number}`,
          projectId,
          id,
          number,
          p.summary,
          p.description ?? '',
          stateId,
          p.priority ?? 'Normal',
          p.assigneeId ?? null,
          auth.userId,
          p.dueDate ?? null,
          top.rows[0].pos,
        ]
      );
      if (p.tagIds?.length) {
        await client.query(
          `insert into issue_tags (issue_id, tag_id)
           select $1, t from unnest($2::uuid[]) as t on conflict do nothing`,
          [row.rows[0].id, p.tagIds]
        );
      }
      await writeHistory(client, row.rows[0].id, auth.userId, 'created', null, null);
      return row.rows[0].id;
    });

    const row = await issueById(created);
    const tags = await tagsFor([created]);
    return reply.code(201).send({ data: publicIssue(row as IssueRow, tags.get(created) ?? []) });
  });

  // A card landing in a column: the column is told its whole new order, and the card that moved says so itself.
  app.post('/boards/:id/issues/order', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = z
      .object({
        issueId: z.string().uuid(),
        stateId: z.string().uuid(),
        ids: z.array(z.string().uuid()).min(1).max(500),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Send the column and its order.' });
    const { issueId, stateId, ids } = parsed.data;

    const moved = await issueById(issueId);
    if (!moved || moved.board_id !== id) {
      return reply.code(404).send({ error: 'No such issue.' });
    }
    if (!(await mayOpenBoard(auth, id, moved.project_id))) {
      return reply.code(403).send({ error: 'This board is not open to you.' });
    }
    const state = await pool.query<{ is_resolved: boolean; name: string }>(
      'select is_resolved, name from states where id = $1 and board_id = $2',
      [stateId, id]
    );
    if (!state.rowCount) return reply.code(400).send({ error: 'That status is on another board.' });

    await inTransaction(async (client) => {
      await client.query(
        `update issues i
            set position = o.pos, state_id = $2, updated_at = now()
           from unnest($3::uuid[]) with ordinality as o(id, pos)
          where i.id = o.id and i.board_id = $1`,
        [id, stateId, ids]
      );
      if (moved.state_id !== stateId) {
        const was = await client.query<{ name: string }>('select name from states where id = $1', [
          moved.state_id,
        ]);
        await writeHistory(
          client,
          issueId,
          auth.userId,
          'status',
          was.rows[0]?.name ?? null,
          state.rows[0].name
        );
        // Resolved is what "closed" means, and the stamp is what the reports will count.
        await client.query(
          `update issues set resolved_at = case when $2 then coalesce(resolved_at, now()) else null end
            where id = $1`,
          [issueId, state.rows[0].is_resolved]
        );
      }
    });

    return reply.send({ data: { ok: true } });
  });

  // ── one issue ────────────────────────────────────────────────────
  app.get('/issues/:key', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { key } = req.params as { key: string };
    const res = await pool.query<IssueRow>(`${ISSUE_SELECT} where lower(i.readable_id) = lower($1)`, [
      key,
    ]);
    const issue = res.rows[0];
    if (!issue) return reply.code(404).send({ error: 'No such issue.' });
    if (!(await mayOpenBoard(auth, issue.board_id, issue.project_id))) {
      return reply.code(403).send({ error: 'This issue is not open to you.' });
    }

    const [tags, comments, history, attachments] = await Promise.all([
      tagsFor([issue.id]),
      pool.query(
        `select c.id, c.text, c.created_at, c.edited_at, c.author_id, u.login as author_login
           from issue_comments c join users u on u.id = c.author_id
          where c.issue_id = $1 order by c.created_at`,
        [issue.id]
      ),
      pool.query(
        `select h.id, h.field, h.old_value, h.new_value, h.created_at, u.login as user_login
           from issue_history h left join users u on u.id = h.user_id
          where h.issue_id = $1 order by h.created_at desc`,
        [issue.id]
      ),
      pool.query(
        `select a.id, a.filename, a.mime, a.size, a.comment_id, a.created_at, u.login as uploaded_by_login
           from issue_attachments a left join users u on u.id = a.uploaded_by
          where a.issue_id = $1 order by a.created_at`,
        [issue.id]
      ),
    ]);

    return reply.send({
      data: {
        ...publicIssue(issue, tags.get(issue.id) ?? []),
        comments: comments.rows.map((c) => ({
          id: c.id,
          text: c.text,
          author: { id: c.author_id, login: c.author_login },
          createdAt: c.created_at.toISOString(),
          editedAt: c.edited_at?.toISOString() ?? null,
        })),
        history: history.rows.map((h) => ({
          id: h.id,
          field: h.field,
          from: h.old_value,
          to: h.new_value,
          by: h.user_login,
          at: h.created_at.toISOString(),
        })),
        attachments: attachments.rows.map((a) => ({
          id: a.id,
          filename: a.filename,
          mime: a.mime,
          size: a.size,
          commentId: a.comment_id,
          uploadedBy: a.uploaded_by_login,
          createdAt: a.created_at.toISOString(),
        })),
      },
    });
  });

  app.patch('/issues/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const found = await loadIssueFor(req, reply, id);
    if (!found) return;
    const { auth, issue } = found;
    const parsed = issuePatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad patch.' });
    }
    const p = parsed.data;

    if (p.stateId) {
      const state = await pool.query('select 1 from states where id = $1 and board_id = $2', [
        p.stateId,
        issue.board_id,
      ]);
      if (!state.rowCount) {
        return reply.code(400).send({ error: 'That status is on another board.' });
      }
    }

    await inTransaction(async (client) => {
      if (p.summary !== undefined && p.summary !== issue.summary) {
        await writeHistory(client, id, auth.userId, 'summary', issue.summary, p.summary);
      }
      if (p.description !== undefined && p.description !== issue.description) {
        await writeHistory(client, id, auth.userId, 'description', null, null);
      }
      if (p.priority !== undefined && p.priority !== issue.priority) {
        await writeHistory(client, id, auth.userId, 'priority', issue.priority, p.priority);
      }
      if (p.dueDate !== undefined && (p.dueDate ?? null) !== issue.due_date) {
        await writeHistory(client, id, auth.userId, 'due date', issue.due_date, p.dueDate ?? null);
      }
      if (p.assigneeId !== undefined && (p.assigneeId ?? null) !== issue.assignee_id) {
        const names = await client.query<{ id: string; login: string }>(
          'select id, login from users where id = any($1::uuid[])',
          [[issue.assignee_id, p.assigneeId ?? null].filter(Boolean)]
        );
        const login = (uid: string | null) =>
          uid ? (names.rows.find((r) => r.id === uid)?.login ?? null) : null;
        await writeHistory(
          client,
          id,
          auth.userId,
          'assignee',
          login(issue.assignee_id),
          login(p.assigneeId ?? null)
        );
      }
      if (p.stateId !== undefined && p.stateId !== issue.state_id) {
        const names = await client.query<{ id: string; name: string; is_resolved: boolean }>(
          'select id, name, is_resolved from states where id = any($1::uuid[])',
          [[issue.state_id, p.stateId]]
        );
        const byId = (sid: string) => names.rows.find((r) => r.id === sid);
        await writeHistory(
          client,
          id,
          auth.userId,
          'status',
          byId(issue.state_id)?.name ?? null,
          byId(p.stateId)?.name ?? null
        );
        await client.query(
          `update issues set resolved_at = case when $2 then coalesce(resolved_at, now()) else null end
            where id = $1`,
          [id, byId(p.stateId)?.is_resolved === true]
        );
        // A card arriving in a column by the side door still lands at its head.
        const top = await client.query<{ pos: number }>(
          'select coalesce(min(position), 0) - 1 as pos from issues where board_id = $1 and state_id = $2',
          [issue.board_id, p.stateId]
        );
        await client.query('update issues set position = $2 where id = $1', [
          id,
          top.rows[0].pos,
        ]);
      }

      await client.query(
        `update issues
            set summary = coalesce($2, summary),
                description = coalesce($3, description),
                state_id = coalesce($4, state_id),
                priority = coalesce($5, priority),
                assignee_id = case when $6 then $7::uuid else assignee_id end,
                due_date = case when $8 then $9::date else due_date end,
                updated_at = now()
          where id = $1`,
        [
          id,
          p.summary ?? null,
          p.description ?? null,
          p.stateId ?? null,
          p.priority ?? null,
          p.assigneeId !== undefined,
          p.assigneeId ?? null,
          p.dueDate !== undefined,
          p.dueDate ?? null,
        ]
      );

      if (p.tagIds) {
        await client.query('delete from issue_tags where issue_id = $1', [id]);
        if (p.tagIds.length) {
          await client.query(
            `insert into issue_tags (issue_id, tag_id)
             select $1, t from unnest($2::uuid[]) as t on conflict do nothing`,
            [id, p.tagIds]
          );
        }
        await writeHistory(client, id, auth.userId, 'tags', null, null);
      }
    });

    const row = await issueById(id);
    const tags = await tagsFor([id]);
    return reply.send({ data: publicIssue(row as IssueRow, tags.get(id) ?? []) });
  });

  app.delete('/issues/:id', async (req, reply) => {
    const auth = await requireDeleter(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const issue = await issueById(id);
    if (!issue) return reply.code(404).send({ error: 'No such issue.' });
    if (!(await mayOpenBoard(auth, issue.board_id, issue.project_id))) {
      return reply.code(403).send({ error: 'This issue is not open to you.' });
    }
    // The rows go with the issue through the foreign keys; the files on disk are ours to sweep.
    const files = await pool.query<{ storage_path: string }>(
      'select storage_path from issue_attachments where issue_id = $1',
      [id]
    );
    await pool.query('delete from issues where id = $1', [id]);
    await Promise.all(files.rows.map((f) => unlink(f.storage_path).catch(() => {})));
    return reply.send({ data: { ok: true } });
  });

  // ── comments ─────────────────────────────────────────────────────
  // A comment speaks as a person, so a token cannot write one: an agent moves work along, it does not talk in someone's name.
  app.post('/issues/:id/comments', async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = await requireSession(req, reply);
    if (!session) return;
    const found = await loadIssueFor(req, reply, id);
    if (!found) return;
    const parsed = z.object({ text: z.string().trim().min(1).max(20000) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'A comment needs some text.' });
    const res = await pool.query(
      `insert into issue_comments (issue_id, author_id, text) values ($1, $2, $3)
       returning id, text, created_at, edited_at`,
      [id, session.userId, parsed.data.text]
    );
    const row = res.rows[0];
    return reply.code(201).send({
      data: {
        id: row.id,
        text: row.text,
        author: { id: session.userId, login: session.login },
        createdAt: row.created_at.toISOString(),
        editedAt: null,
      },
    });
  });

  app.patch('/comments/:id', async (req, reply) => {
    const session = await requireSession(req, reply);
    if (!session) return;
    const { id } = req.params as { id: string };
    const parsed = z.object({ text: z.string().trim().min(1).max(20000) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'A comment needs some text.' });
    const owner = await pool.query<{ author_id: string }>(
      'select author_id from issue_comments where id = $1',
      [id]
    );
    if (!owner.rowCount) return reply.code(404).send({ error: 'No such comment.' });
    // Editing is the author's alone: an admin can delete what should not stand, but not put words in someone's mouth.
    if (owner.rows[0].author_id !== session.userId) {
      return reply.code(403).send({ error: 'Only the author can edit a comment.' });
    }
    const res = await pool.query(
      'update issue_comments set text = $2, edited_at = now() where id = $1 returning edited_at',
      [id, parsed.data.text]
    );
    return reply.send({
      data: { id, text: parsed.data.text, editedAt: res.rows[0].edited_at.toISOString() },
    });
  });

  app.delete('/comments/:id', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const owner = await pool.query<{ author_id: string }>(
      'select author_id from issue_comments where id = $1',
      [id]
    );
    if (!owner.rowCount) return reply.code(404).send({ error: 'No such comment.' });
    const mine = owner.rows[0].author_id === auth.userId && auth.kind === 'session';
    if (!mine && !(await requireDeleter(req, reply))) return;
    const files = await pool.query<{ storage_path: string }>(
      'select storage_path from issue_attachments where comment_id = $1',
      [id]
    );
    await pool.query('delete from issue_comments where id = $1', [id]);
    await Promise.all(files.rows.map((f) => unlink(f.storage_path).catch(() => {})));
    return reply.send({ data: { ok: true } });
  });

  // ── attachments ──────────────────────────────────────────────────
  app.post('/issues/:id/attachments', async (req, reply) => {
    const { id } = req.params as { id: string };
    const found = await loadIssueFor(req, reply, id);
    if (!found) return;
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'Send a file.' });

    const dir = path.join(env.uploadDir, id);
    await mkdir(dir, { recursive: true });
    // The name on disk is ours, not the one it arrived with: two screenshots called image.png do not collide, and nothing in the name can point out of the folder.
    const ext = path.extname(file.filename).slice(0, 12).replace(/[^a-zA-Z0-9.]/g, '');
    const stored = path.join(dir, `${randomUUID()}${ext}`);
    await pipeline(file.file, createWriteStream(stored));
    if (file.file.truncated) {
      await unlink(stored).catch(() => {});
      return reply.code(413).send({ error: 'That file is too large.' });
    }
    const { size } = await stat(stored);
    const filename = file.filename.slice(0, 200);

    const res = await pool.query(
      `insert into issue_attachments (issue_id, comment_id, filename, mime, size, storage_path, uploaded_by)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, created_at`,
      [id, null, filename, file.mimetype, size, stored, found.auth.userId]
    );
    return reply.code(201).send({
      data: {
        id: res.rows[0].id,
        filename,
        mime: file.mimetype,
        size,
        commentId: null,
        uploadedBy: found.auth.login,
        createdAt: res.rows[0].created_at.toISOString(),
      },
    });
  });

  // Files are served by the API, not by nginx, because who may see them depends on the board they hang off.
  app.get('/attachments/:id', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const res = await pool.query<{
      filename: string;
      mime: string;
      storage_path: string;
      issue_id: string;
    }>('select filename, mime, storage_path, issue_id from issue_attachments where id = $1', [id]);
    const row = res.rows[0];
    if (!row) return reply.code(404).send({ error: 'No such file.' });
    const issue = await issueById(row.issue_id);
    if (!issue || !(await mayOpenBoard(auth, issue.board_id, issue.project_id))) {
      return reply.code(403).send({ error: 'This file is not open to you.' });
    }
    reply.header('Content-Type', row.mime);
    reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(row.filename)}"`);
    return reply.send(createReadStream(row.storage_path));
  });

  app.delete('/attachments/:id', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const res = await pool.query<{ storage_path: string; uploaded_by: string | null }>(
      'select storage_path, uploaded_by from issue_attachments where id = $1',
      [id]
    );
    const row = res.rows[0];
    if (!row) return reply.code(404).send({ error: 'No such file.' });
    const mine = row.uploaded_by === auth.userId;
    if (!mine && !(await requireDeleter(req, reply))) return;
    await pool.query('delete from issue_attachments where id = $1', [id]);
    await unlink(row.storage_path).catch(() => {});
    return reply.send({ data: { ok: true } });
  });
}
