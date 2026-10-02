import { randomUUID } from 'node:crypto';
import { ZipArchive } from 'archiver';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { inTransaction, pool } from './db.js';
import { env } from './env.js';
import { requireAuth, requireDeleter, requireSession, type Auth } from './auth.js';
import { DENIES_NOTHING, deniedFor, mayOpenBoard } from './board-service.js';
import { syncMentions } from './notice-routes.js';
import { publish, tabOf } from './events.js';

const PRIORITIES = ['Critical', 'Major', 'Normal', 'Minor'] as const;

// Only these types render inline: html, svg, pdf and the like would run script on our origin.
const INLINE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'video/mp4',
  'video/webm',
]);

// html and svg are safe here: the text route returns bytes as a JSON string, never as a page.
const READABLE = new Set([
  'bat', 'c', 'cfg', 'cmd', 'conf', 'cpp', 'cs', 'css', 'csv', 'dio', 'diff', 'drawio', 'env',
  'gd', 'go',
  'godot', 'gradle', 'h', 'hpp', 'htm', 'html', 'import', 'ini', 'java', 'js', 'json',
  'jsx', 'kt', 'less', 'log', 'lua', 'md', 'patch', 'php', 'pl', 'properties', 'ps1',
  'py', 'rb', 'rs', 'scss', 'sh', 'sql', 'svg', 'swift', 'toml', 'tres', 'ts', 'tscn',
  'tsx', 'txt', 'vue', 'xml', 'yaml', 'yml',
]);
const READ_MAX = 512 * 1024;

const readable = (filename: string): boolean =>
  READABLE.has(filename.split('.').pop()?.toLowerCase() ?? '');

function disposition(kind: 'inline' | 'attachment', name: string): string {
  const plain = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  // RFC 5987 needs ' ( ) * percent-encoded; encodeURIComponent leaves them as is.
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${kind}; filename="${plain}"; filename*=UTF-8''${encoded}`;
}

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

const publicIssue = (r: IssueRow, tags: TagRow[] = [], favourite = false) => ({
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
  favourite,
  tags,
});

const ISSUE_SELECT = `
  select i.*, a.login as assignee_login, w.login as author_login
    from issues i
    left join users a on a.id = i.assignee_id
    left join users w on w.id = i.author_id`;

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

interface LinkRow {
  id: string;
  readable_id: string;
  summary: string;
  state_name: string;
  state_color: string;
  short_name: string;
  slug: string;
  board_id: string;
  project_id: string;
  kind?: LinkKind;
  resolved?: boolean;
}

type LinkKind = 'related' | 'parent' | 'child' | 'duplicateOf' | 'duplicatedBy';

async function linksOf(issueId: string, auth: Auth): Promise<LinkRow[]> {
  const res = await pool.query<LinkRow>(
    `select i.id, i.readable_id, i.summary, i.board_id, i.project_id,
            s.name as state_name, s.color as state_color, s.is_resolved as resolved,
            p.short_name, b.slug,
            case when l.kind = 'related' then 'related'
                 when l.kind = 'subtask' and l.b = $1 then 'parent'
                 when l.kind = 'subtask' then 'child'
                 when l.a = $1 then 'duplicateOf'
                 else 'duplicatedBy' end as kind
       from issue_links l
       join issues i on i.id = case when l.a = $1 then l.b else l.a end
       join states s on s.id = i.state_id
       join projects p on p.id = i.project_id
       join boards b on b.id = i.board_id
      where l.a = $1 or l.b = $1
      order by i.readable_id`,
    [issueId]
  );
  if (auth.isAdmin) return res.rows;
  const denied = await deniedFor(auth.roleId);
  if (denied.everything) return [];
  return res.rows.filter(
    (r) => !denied.boards.has(r.board_id) && !denied.projects.has(r.project_id)
  );
}

const publicLink = (r: LinkRow) => ({
  id: r.id,
  key: r.readable_id,
  summary: r.summary,
  stateName: r.state_name,
  stateColor: r.state_color,
  projectShort: r.short_name,
  boardSlug: r.slug,
  kind: r.kind ?? 'related',
  resolved: r.resolved ?? false,
});

async function starredBy(userId: string, issueIds: string[]): Promise<Set<string>> {
  if (!issueIds.length) return new Set();
  const res = await pool.query<{ issue_id: string }>(
    'select issue_id from issue_favourites where user_id = $1 and issue_id = any($2::uuid[])',
    [userId, issueIds]
  );
  return new Set(res.rows.map((r) => r.issue_id));
}

async function issueById(id: string): Promise<IssueRow | null> {
  const res = await pool.query<IssueRow>(`${ISSUE_SELECT} where i.id = $1`, [id]);
  return res.rows[0] ?? null;
}

async function parentOf(issueId: string): Promise<IssueRow | null> {
  const res = await pool.query<IssueRow>(
    `${ISSUE_SELECT} join issue_links l on l.a = i.id and l.kind = 'subtask' where l.b = $1`,
    [issueId]
  );
  return res.rows[0] ?? null;
}

function announceParent(parent: IssueRow | null, by: string, origin: string | undefined): void {
  if (!parent) return;
  void publish({
    type: 'issue.linked',
    boardId: parent.board_id,
    projectId: parent.project_id,
    issueId: parent.id,
    issueKey: parent.readable_id,
    fields: ['links'],
    by,
    origin,
  });
}

async function subtaskCounts(
  auth: Auth,
  parentIds: string[]
): Promise<Map<string, { done: number; total: number }>> {
  const out = new Map<string, { done: number; total: number }>();
  if (!parentIds.length) return out;
  const denied = auth.isAdmin ? DENIES_NOTHING : await deniedFor(auth.roleId);
  const res = await pool.query<{ parent: string; done: number; total: number }>(
    `select l.a as parent, count(*)::int as total, count(*) filter (where s.is_resolved)::int as done
       from issue_links l
       join issues c on c.id = l.b
       join states s on s.id = c.state_id
      where l.kind = 'subtask' and l.a = any($1::uuid[]) and c.board_id <> all($2::uuid[])
      group by l.a`,
    [parentIds, [...denied.boards]]
  );
  for (const row of res.rows) out.set(row.parent, { done: row.done, total: row.total });
  return out;
}

async function mayReachIssue(auth: Auth, issueId: string): Promise<boolean> {
  const host = await issueById(issueId);
  return !!host && (await mayOpenBoard(auth, host.board_id, host.project_id));
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

async function changeState(
  client: { query: typeof pool.query },
  issueId: string,
  userId: string,
  boardId: string,
  fromStateId: string,
  toStateId: string
): Promise<void> {
  const names = await client.query<{ id: string; name: string; is_resolved: boolean }>(
    'select id, name, is_resolved from states where id = any($1::uuid[])',
    [[fromStateId, toStateId]]
  );
  const byId = (sid: string) => names.rows.find((r) => r.id === sid);
  await writeHistory(
    client,
    issueId,
    userId,
    'status',
    byId(fromStateId)?.name ?? null,
    byId(toStateId)?.name ?? null
  );
  await client.query(
    `update issues set resolved_at = case when $2 then coalesce(resolved_at, now()) else null end
      where id = $1`,
    [issueId, byId(toStateId)?.is_resolved === true]
  );
  const top = await client.query<{ pos: number }>(
    'select coalesce(min(position), 0) - 1 as pos from issues where board_id = $1 and state_id = $2',
    [boardId, toStateId]
  );
  await client.query(
    'update issues set state_id = $2, position = $3, updated_at = now() where id = $1',
    [issueId, toStateId, top.rows[0].pos]
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

export const REACTIONS = [
  '\u{1F44D}',
  '\u{1F44C}',
  '\u{1F64F}',
  '\u{1F440}',
  '\u{2764}\u{FE0F}',
  '\u{1F389}',
  '\u{1F608}',
  '\u{1F921}',
  '\u{1F4A9}',
] as const;

const issuePatch = z.object({
  summary: z.string().trim().min(1).max(300).optional(),
  boardId: z.string().uuid().optional(),
  description: z.string().max(20000).optional(),
  stateId: z.string().uuid().optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  tagIds: z.array(z.string().uuid()).max(50).optional(),
});

const onDisk = (stored: string): string => path.join(env.uploadDir, stored);

// Call before deleting the issues: their attachment rows cascade away with the paths.
export async function filesOfIssues(issueIds: string[]): Promise<string[]> {
  if (!issueIds.length) return [];
  const res = await pool.query<{ storage_path: string }>(
    'select storage_path from issue_attachments where issue_id = any($1::uuid[])',
    [issueIds]
  );
  return res.rows.map((r) => onDisk(r.storage_path));
}

export async function sweepFiles(issueIds: string[], paths: string[]): Promise<void> {
  await Promise.all(paths.map((p) => unlink(p).catch(() => {})));
  await Promise.all(
    issueIds.map((id) =>
      rm(path.join(env.uploadDir, id.toLowerCase()), { recursive: true, force: true }).catch(() => {})
    )
  );
}

export function registerIssueRoutes(app: FastifyInstance): void {
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
    const [tags, stars, subtasks] = await Promise.all([
      tagsFor(res.rows.map((r) => r.id)),
      starredBy(auth.userId, res.rows.map((r) => r.id)),
      subtaskCounts(auth, res.rows.map((r) => r.id)),
    ]);
    return reply.send({
      data: res.rows.map((r) => ({
        ...publicIssue(r, tags.get(r.id) ?? [], stars.has(r.id)),
        subtasks: subtasks.get(r.id) ?? null,
      })),
    });
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
      // Bump and read in one UPDATE ... RETURNING so concurrent creates never share a number.
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
      if (p.assigneeId && p.assigneeId !== auth.userId) {
        await client.query(
          `insert into notices (user_id, kind, issue_id, by_id) values ($1, 'assigned', $2, $3)`,
          [p.assigneeId, row.rows[0].id, auth.userId]
        );
      }
      return row.rows[0].id;
    });
    if (p.assigneeId && p.assigneeId !== auth.userId) {
      void publish({ type: 'notice.changed', only: p.assigneeId });
    }

    const row = await issueById(created);
    const tags = await tagsFor([created]);
    void publish({
      type: 'issue.created',
      boardId: id,
      projectId,
      issueId: created,
      issueKey: row?.readable_id,
      by: auth.login,
      origin: tabOf(req),
    });
    return reply.code(201).send({ data: publicIssue(row as IssueRow, tags.get(created) ?? []) });
  });

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
    if (!ids.some((one) => one.toLowerCase() === issueId.toLowerCase())) {
      return reply.code(400).send({ error: 'Send the column and its order.' });
    }

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
      // Only the dragged card changes status: a stale tab's list may hold cards moved elsewhere.
      await client.query(
        `update issues i
            set position = o.pos,
                state_id = case when i.id = $4 then $2 else i.state_id end,
                updated_at = now()
           from unnest($3::uuid[]) with ordinality as o(id, pos)
          where i.id = o.id and i.board_id = $1`,
        [id, stateId, ids, issueId]
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
        await client.query(
          `update issues set resolved_at = case when $2 then coalesce(resolved_at, now()) else null end
            where id = $1`,
          [issueId, state.rows[0].is_resolved]
        );
      }
    });

    void publish({
      type: 'issue.moved',
      boardId: id,
      projectId: moved.project_id,
      issueId,
      issueKey: moved.readable_id,
      fields: moved.state_id === stateId ? [] : ['status'],
      by: auth.login,
      origin: tabOf(req),
    });
    return reply.send({ data: { ok: true } });
  });

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

    const [tags, comments, history, attachments, links, stars] = await Promise.all([
      tagsFor([issue.id]),
      pool.query(
        `select c.id, c.text, c.created_at, c.edited_at, c.author_id, c.pinned_at,
                u.login as author_login, p.login as pinned_by_login,
                coalesce(
                  (select json_agg(json_build_object('emoji', r.emoji, 'by', ru.login)
                                   order by r.created_at)
                     from comment_reactions r
                     join users ru on ru.id = r.user_id
                    where r.comment_id = c.id),
                  '[]'::json
                ) as reactions
           from issue_comments c
           join users u on u.id = c.author_id
           left join users p on p.id = c.pinned_by
          where c.issue_id = $1
          order by (c.pinned_at is null), c.created_at`,
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
      linksOf(issue.id, auth),
      starredBy(auth.userId, [issue.id]),
    ]);

    return reply.send({
      data: {
        ...publicIssue(issue, tags.get(issue.id) ?? [], stars.has(issue.id)),
        comments: comments.rows.map((c) => ({
          id: c.id,
          text: c.text,
          author: { id: c.author_id, login: c.author_login },
          createdAt: c.created_at.toISOString(),
          editedAt: c.edited_at?.toISOString() ?? null,
          pinnedAt: c.pinned_at?.toISOString() ?? null,
          pinnedBy: c.pinned_by_login,
          reactions: c.reactions as { emoji: string; by: string }[],
        })),
        history: history.rows.map((h) => ({
          id: h.id,
          field: h.field,
          from: h.old_value,
          to: h.new_value,
          by: h.user_login,
          at: h.created_at.toISOString(),
        })),
        links: links.map(publicLink),
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

    let landing: { boardId: string; stateId: string; name: string } | null = null;
    if (p.boardId && p.boardId !== issue.board_id) {
      const dest = await pool.query<{
        id: string;
        name: string;
        project_id: string;
        default_state_id: string | null;
      }>('select id, name, project_id, default_state_id from boards where id = $1', [p.boardId]);
      const to = dest.rows[0];
      if (!to || to.project_id !== issue.project_id) {
        return reply.code(400).send({ error: 'That board belongs to another project.' });
      }
      if (!(await mayOpenBoard(auth, to.id, to.project_id))) {
        return reply.code(403).send({ error: 'That board is not open to you.' });
      }
      const first = await pool.query<{ id: string }>(
        'select id from states where board_id = $1 order by position, name limit 1',
        [to.id]
      );
      const stateId = to.default_state_id ?? first.rows[0]?.id;
      if (!stateId) return reply.code(400).send({ error: 'That board has no statuses yet.' });
      landing = { boardId: to.id, stateId, name: to.name };
    }

    const home = landing?.boardId ?? issue.board_id;
    if (p.stateId) {
      const state = await pool.query('select 1 from states where id = $1 and board_id = $2', [
        p.stateId,
        home,
      ]);
      if (!state.rowCount) {
        return reply.code(400).send({ error: 'That status is on another board.' });
      }
    }
    const nextState = landing ? (p.stateId ?? landing.stateId) : p.stateId;

    await inTransaction(async (client) => {
      if (p.summary !== undefined && p.summary !== issue.summary) {
        await writeHistory(client, id, auth.userId, 'summary', issue.summary, p.summary);
      }
      if (p.description !== undefined && p.description !== issue.description) {
        await writeHistory(client, id, auth.userId, 'description edited', null, null);
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
        if (p.assigneeId && p.assigneeId !== auth.userId) {
          await client.query(
            `insert into notices (user_id, kind, issue_id, by_id) values ($1, 'assigned', $2, $3)`,
            [p.assigneeId, id, auth.userId]
          );
        }
      }
      if (landing) {
        const was = await client.query<{ name: string }>('select name from boards where id = $1', [
          issue.board_id,
        ]);
        await writeHistory(
          client,
          id,
          auth.userId,
          'board',
          was.rows[0]?.name ?? null,
          landing.name
        );
        await client.query('update issues set board_id = $2 where id = $1', [id, landing.boardId]);
      }
      if (nextState !== undefined && nextState !== issue.state_id) {
        await changeState(client, id, auth.userId, home, issue.state_id, nextState);
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
          nextState ?? null,
          p.priority ?? null,
          p.assigneeId !== undefined,
          p.assigneeId ?? null,
          p.dueDate !== undefined,
          p.dueDate ?? null,
        ]
      );

      if (p.tagIds) {
        const before = await client.query<{ tag_id: string; name: string }>(
          `select it.tag_id, t.name from issue_tags it join tags t on t.id = it.tag_id
            where it.issue_id = $1`,
          [id]
        );
        const after = await client.query<{ id: string; name: string }>(
          'select id, name from tags where id = any($1::uuid[])',
          [p.tagIds]
        );
        const had = new Set(before.rows.map((r) => r.tag_id));
        const has = new Set(p.tagIds);

        await client.query('delete from issue_tags where issue_id = $1', [id]);
        if (p.tagIds.length) {
          await client.query(
            `insert into issue_tags (issue_id, tag_id)
             select $1, t from unnest($2::uuid[]) as t on conflict do nothing`,
            [id, p.tagIds]
          );
        }
        for (const row of after.rows.filter((r) => !had.has(r.id))) {
          await writeHistory(client, id, auth.userId, 'tag added', null, row.name);
        }
        for (const row of before.rows.filter((r) => !has.has(r.tag_id))) {
          await writeHistory(client, id, auth.userId, 'tag removed', null, row.name);
        }
      }
    });

    const row = await issueById(id);
    if (p.assigneeId && p.assigneeId !== issue.assignee_id && p.assigneeId !== auth.userId) {
      void publish({ type: 'notice.changed', only: p.assigneeId });
    }
    const [tags, stars] = await Promise.all([tagsFor([id]), starredBy(auth.userId, [id])]);
    void publish({
      type: 'issue.updated',
      boardId: home,
      projectId: issue.project_id,
      issueId: id,
      issueKey: issue.readable_id,
      fields: Object.keys(p),
      by: auth.login,
      origin: tabOf(req),
    });
    if (nextState !== undefined && nextState !== issue.state_id) {
      announceParent(await parentOf(id), auth.login, tabOf(req));
    }
    if (landing) {
      void publish({
        type: 'issue.moved',
        boardId: issue.board_id,
        projectId: issue.project_id,
        issueId: id,
        issueKey: issue.readable_id,
        fields: ['board'],
        by: auth.login,
        origin: tabOf(req),
      });
    }
    return reply.send({ data: publicIssue(row as IssueRow, tags.get(id) ?? [], stars.has(id)) });
  });

  app.put('/issues/:id/favourite', async (req, reply) => {
    const { id } = req.params as { id: string };
    const found = await loadIssueFor(req, reply, id);
    if (!found) return;
    const parsed = z.object({ favourite: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Say favourite true or false.' });
    if (parsed.data.favourite) {
      await pool.query(
        'insert into issue_favourites (issue_id, user_id) values ($1, $2) on conflict do nothing',
        [id, found.auth.userId]
      );
    } else {
      await pool.query('delete from issue_favourites where issue_id = $1 and user_id = $2', [
        id,
        found.auth.userId,
      ]);
    }
    void publish({ type: 'favourite.changed', only: found.auth.userId, origin: tabOf(req) });
    return reply.send({ data: { favourite: parsed.data.favourite } });
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
    const doomed = await filesOfIssues([id]);
    const parent = await parentOf(id);
    await pool.query('delete from issues where id = $1', [id]);
    await sweepFiles([id], doomed);
    announceParent(parent, auth.login, tabOf(req));
    void publish({
      type: 'issue.deleted',
      boardId: issue.board_id,
      projectId: issue.project_id,
      issueId: id,
      issueKey: issue.readable_id,
      by: auth.login,
      origin: tabOf(req),
    });
    return reply.send({ data: { ok: true } });
  });

  app.get('/issues/search', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { q, exclude } = req.query as { q?: string; exclude?: string };
    const term = (q ?? '').trim().slice(0, 100);
    if (!term) return reply.send({ data: [] });
    const skip = exclude && /^[0-9a-fA-F-]{36}$/.test(exclude) ? exclude : null;
    const res = await pool.query<LinkRow>(
      `select i.id, i.readable_id, i.summary, i.board_id, i.project_id,
              s.name as state_name, s.color as state_color, p.short_name, b.slug
         from issues i
         join states s on s.id = i.state_id
         join projects p on p.id = i.project_id
         join boards b on b.id = i.board_id
        where ($2::uuid is null or i.id <> $2)
          and (i.readable_id ilike $1 || '%' or i.summary ilike '%' || $1 || '%')
        order by (i.readable_id ilike $1 || '%') desc, i.updated_at desc
        limit 60`,
      [term, skip]
    );
    if (auth.isAdmin) return reply.send({ data: res.rows.slice(0, 20).map(publicLink) });
    const denied = await deniedFor(auth.roleId);
    if (denied.everything) return reply.send({ data: [] });
    return reply.send({
      data: res.rows
        .filter((r) => !denied.boards.has(r.board_id) && !denied.projects.has(r.project_id))
        .slice(0, 20)
        .map(publicLink),
    });
  });

  app.post('/issues/:id/links', async (req, reply) => {
    const { id } = req.params as { id: string };
    const found = await loadIssueFor(req, reply, id);
    if (!found) return;
    const parsed = z
      .object({
        key: z.string().trim().min(3).max(30),
        kind: z
          .enum(['related', 'parentOf', 'subtaskOf', 'duplicateOf', 'duplicatedBy'])
          .default('related'),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Which issue? Give its key.' });
    const { kind } = parsed.data;

    const other = await pool.query<IssueRow>(
      `${ISSUE_SELECT} where lower(i.readable_id) = lower($1)`,
      [parsed.data.key]
    );
    const target = other.rows[0];
    if (!target) return reply.code(404).send({ error: 'No issue with that key.' });
    if (target.id === id) return reply.code(400).send({ error: 'An issue cannot link to itself.' });
    if (!(await mayOpenBoard(found.auth, target.board_id, target.project_id))) {
      return reply.code(403).send({ error: 'That issue is not open to you.' });
    }

    const self = found.issue;
    const paired = await pool.query(
      'select 1 from issue_links where (a = $1 and b = $2) or (a = $2 and b = $1)',
      [self.id, target.id]
    );
    if (paired.rowCount) return reply.code(409).send({ error: 'These two are already linked.' });

    // Lower-case before sorting so JS string order matches Postgres uuid order in the a < b check.
    const [a, b] = [self.id.toLowerCase(), target.id.toLowerCase()].sort();
    const stored =
      kind === 'related' ? 'related' : kind === 'parentOf' || kind === 'subtaskOf' ? 'subtask' : 'duplicate';
    const [from, to] =
      kind === 'related'
        ? [null, null]
        : kind === 'parentOf' || kind === 'duplicateOf'
          ? [self, target]
          : [target, self];

    if (stored === 'subtask' && from && to) {
      if (from.project_id !== to.project_id) {
        return reply.code(400).send({ error: "A subtask stays in its parent's project." });
      }
      if (await parentOf(to.id)) {
        return reply.code(409).send({ error: `${to.readable_id} already has a parent.` });
      }
      const loop = await pool.query(
        `with recursive up(id) as (
           select $1::uuid
           union
           select l.a from issue_links l join up on l.b = up.id where l.kind = 'subtask'
         )
         select 1 from up where id = $2`,
        [from.id, to.id]
      );
      if (loop.rowCount) {
        return reply.code(400).send({ error: `${to.readable_id} is already above ${from.readable_id}.` });
      }
    }
    if (stored === 'duplicate' && from) {
      const already = await pool.query(
        "select 1 from issue_links where a = $1 and kind = 'duplicate'",
        [from.id]
      );
      if (already.rowCount) {
        return reply.code(409).send({ error: `${from.readable_id} is already a duplicate.` });
      }
    }

    const duplicateState =
      stored === 'duplicate' && from
        ? (
            await pool.query<{ id: string }>(
              `select id from states where board_id = $1 and lower(name) = 'duplicate' and id <> $2
                limit 1`,
              [from.board_id, from.state_id]
            )
          ).rows[0]?.id ?? null
        : null;

    const linked = await inTransaction(async (client) => {
      const done = await client.query(
        `insert into issue_links (a, b, kind, created_by) values ($1, $2, $3, $4)
         on conflict do nothing`,
        [from?.id ?? a, to?.id ?? b, stored, found.auth.userId]
      );
      if (!done.rowCount) return false;
      if (from && duplicateState) {
        await changeState(
          client,
          from.id,
          found.auth.userId,
          from.board_id,
          from.state_id,
          duplicateState
        );
      }
      await writeHistory(client, id, found.auth.userId, 'link added', null, target.readable_id);
      await writeHistory(
        client,
        target.id,
        found.auth.userId,
        'link added',
        null,
        found.issue.readable_id
      );
      return true;
    });
    if (!linked) return reply.code(409).send({ error: 'These two are already linked.' });
    for (const side of [self, target]) {
      void publish({
        type: 'issue.linked',
        boardId: side.board_id,
        projectId: side.project_id,
        issueId: side.id,
        issueKey: side.readable_id,
        fields: duplicateState && side.id === from?.id ? ['links', 'stateId'] : ['links'],
        by: found.auth.login,
        origin: tabOf(req),
      });
    }
    const made = (await linksOf(self.id, found.auth)).find((l) => l.id === target.id);
    if (!made) return reply.code(404).send({ error: 'No issue with that key.' });
    return reply.code(201).send({ data: publicLink(made) });
  });

  app.delete('/issues/:id/links/:otherId', async (req, reply) => {
    const { id, otherId } = req.params as { id: string; otherId: string };
    const found = await loadIssueFor(req, reply, id);
    if (!found) return;
    const other = await issueById(otherId);
    if (other && !(await mayOpenBoard(found.auth, other.board_id, other.project_id))) {
      return reply.code(404).send({ error: 'They are not linked.' });
    }
    const res = await inTransaction(async (client) => {
      const gone = await client.query(
        'delete from issue_links where (a = $1 and b = $2) or (a = $2 and b = $1)',
        [found.issue.id, other?.id ?? otherId]
      );
      if (!gone.rowCount || !other) return gone;
      await writeHistory(client, id, found.auth.userId, 'link removed', null, other.readable_id);
      await writeHistory(
        client,
        other.id,
        found.auth.userId,
        'link removed',
        null,
        found.issue.readable_id
      );
      return gone;
    });
    if (!res.rowCount) return reply.code(404).send({ error: 'They are not linked.' });
    if (other) {
      for (const side of [found.issue, other]) {
        void publish({
          type: 'issue.linked',
          boardId: side.board_id,
          projectId: side.project_id,
          issueId: side.id,
          issueKey: side.readable_id,
          fields: ['links'],
          by: found.auth.login,
          origin: tabOf(req),
        });
      }
    }
    return reply.send({ data: { ok: true } });
  });

  app.post('/issues/:id/comments', async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = await requireSession(req, reply);
    if (!session) return;
    const found = await loadIssueFor(req, reply, id);
    if (!found) return;
    const parsed = z.object({ text: z.string().trim().min(1).max(20000) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'A comment needs some text.' });
    const row = await inTransaction(async (client) => {
      const res = await client.query(
        `insert into issue_comments (issue_id, author_id, text) values ($1, $2, $3)
         returning id, text, created_at, edited_at`,
        [id, session.userId, parsed.data.text]
      );
      await syncMentions(client, res.rows[0].id, parsed.data.text, session.userId);
      return res.rows[0];
    });
    await writeHistory(pool, id, session.userId, 'comment added', null, null);
    void publish({
      type: 'comment.added',
      boardId: found.issue.board_id,
      projectId: found.issue.project_id,
      issueId: id,
      issueKey: found.issue.readable_id,
      commentId: row.id,
      by: session.login,
      origin: tabOf(req),
    });
    return reply.code(201).send({
      data: {
        id: row.id,
        text: row.text,
        author: { id: session.userId, login: session.login },
        createdAt: row.created_at.toISOString(),
        editedAt: null,
        pinnedAt: null,
        pinnedBy: null,
      },
    });
  });

  app.put('/comments/:id/reactions', async (req, reply) => {
    const session = await requireSession(req, reply);
    if (!session) return;
    const { id } = req.params as { id: string };
    const parsed = z.object({ emoji: z.enum(REACTIONS) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Not one of the reactions.' });
    const owner = await pool.query<{ author_id: string; issue_id: string }>(
      'select author_id, issue_id from issue_comments where id = $1',
      [id]
    );
    if (!owner.rowCount) return reply.code(404).send({ error: 'No such comment.' });
    const { author_id: authorId, issue_id: issueId } = owner.rows[0];
    if (!(await mayReachIssue(session, issueId))) {
      return reply.code(403).send({ error: 'This issue is not open to you.' });
    }

    const emoji = parsed.data.emoji;
    const on = await inTransaction(async (client) => {
      const gone = await client.query(
        'delete from comment_reactions where comment_id = $1 and user_id = $2 and emoji = $3',
        [id, session.userId, emoji]
      );
      if (gone.rowCount) {
        await client.query(
          `delete from notices
            where kind = 'reaction' and comment_id = $1 and by_id = $2 and detail = $3`,
          [id, session.userId, emoji]
        );
        return false;
      }
      await client.query(
        'insert into comment_reactions (comment_id, user_id, emoji) values ($1, $2, $3)',
        [id, session.userId, emoji]
      );
      if (authorId !== session.userId) {
        await client.query(
          `insert into notices (user_id, kind, comment_id, by_id, detail)
           values ($1, 'reaction', $2, $3, $4)
           on conflict do nothing`,
          [authorId, id, session.userId, emoji]
        );
      }
      return true;
    });

    const host = await issueById(issueId);
    void publish({
      type: 'comment.reacted',
      boardId: host?.board_id,
      projectId: host?.project_id,
      issueId,
      issueKey: host?.readable_id,
      commentId: id,
      by: session.login,
      origin: tabOf(req),
    });
    return reply.send({ data: { on } });
  });

  app.put('/comments/:id/pin', async (req, reply) => {
    const session = await requireSession(req, reply);
    if (!session) return;
    const { id } = req.params as { id: string };
    const parsed = z.object({ pinned: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Say pinned true or false.' });
    const owner = await pool.query<{ issue_id: string }>(
      'select issue_id from issue_comments where id = $1',
      [id]
    );
    if (!owner.rowCount) return reply.code(404).send({ error: 'No such comment.' });
    const host = await issueById(owner.rows[0].issue_id);
    if (!host || !(await mayOpenBoard(session, host.board_id, host.project_id))) {
      return reply.code(403).send({ error: 'This issue is not open to you.' });
    }
    const res = await pool.query<{ pinned_at: Date | null }>(
      `update issue_comments
          set pinned_at = case when $2 then now() else null end,
              pinned_by = case when $2 then $3::uuid else null end
        where id = $1
        returning pinned_at`,
      [id, parsed.data.pinned, session.userId]
    );
    await writeHistory(
      pool,
      host.id,
      session.userId,
      parsed.data.pinned ? 'comment pinned' : 'comment unpinned',
      null,
      null
    );
    void publish({
      type: 'comment.pinned',
      boardId: host.board_id,
      projectId: host.project_id,
      issueId: host.id,
      issueKey: host.readable_id,
      commentId: id,
      by: session.login,
      origin: tabOf(req),
    });
    return reply.send({
      data: {
        id,
        pinnedAt: res.rows[0].pinned_at?.toISOString() ?? null,
        pinnedBy: parsed.data.pinned ? session.login : null,
      },
    });
  });

  app.patch('/comments/:id', async (req, reply) => {
    const session = await requireSession(req, reply);
    if (!session) return;
    const { id } = req.params as { id: string };
    const parsed = z.object({ text: z.string().trim().min(1).max(20000) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'A comment needs some text.' });
    const owner = await pool.query<{ author_id: string; issue_id: string }>(
      'select author_id, issue_id from issue_comments where id = $1',
      [id]
    );
    if (!owner.rowCount) return reply.code(404).send({ error: 'No such comment.' });
    if (!(await mayReachIssue(session, owner.rows[0].issue_id))) {
      return reply.code(403).send({ error: 'This issue is not open to you.' });
    }
    if (owner.rows[0].author_id !== session.userId) {
      return reply.code(403).send({ error: 'Only the author can edit a comment.' });
    }
    const res = await inTransaction(async (client) => {
      const updated = await client.query(
        'update issue_comments set text = $2, edited_at = now() where id = $1 returning edited_at',
        [id, parsed.data.text]
      );
      await syncMentions(client, id, parsed.data.text, session.userId);
      return updated;
    });
    const host = await issueById(owner.rows[0].issue_id);
    await writeHistory(pool, owner.rows[0].issue_id, session.userId, 'comment edited', null, null);
    void publish({
      type: 'comment.edited',
      boardId: host?.board_id,
      projectId: host?.project_id,
      issueId: owner.rows[0].issue_id,
      issueKey: host?.readable_id,
      commentId: id,
      by: session.login,
      origin: tabOf(req),
    });
    return reply.send({
      data: { id, text: parsed.data.text, editedAt: res.rows[0].edited_at.toISOString() },
    });
  });

  app.delete('/comments/:id', async (req, reply) => {
    const auth = await requireSession(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const owner = await pool.query<{ author_id: string; issue_id: string }>(
      'select author_id, issue_id from issue_comments where id = $1',
      [id]
    );
    if (!owner.rowCount) return reply.code(404).send({ error: 'No such comment.' });
    if (!(await mayReachIssue(auth, owner.rows[0].issue_id))) {
      return reply.code(403).send({ error: 'This issue is not open to you.' });
    }
    const mine = owner.rows[0].author_id === auth.userId;
    if (!mine && !(await requireDeleter(req, reply))) return;
    const files = await pool.query<{ storage_path: string }>(
      'select storage_path from issue_attachments where comment_id = $1',
      [id]
    );
    await pool.query('delete from issue_comments where id = $1', [id]);
    await Promise.all(files.rows.map((f) => unlink(onDisk(f.storage_path)).catch(() => {})));
    const host = await issueById(owner.rows[0].issue_id);
    await writeHistory(pool, owner.rows[0].issue_id, auth.userId, 'comment deleted', null, null);
    void publish({
      type: 'comment.deleted',
      boardId: host?.board_id,
      projectId: host?.project_id,
      issueId: owner.rows[0].issue_id,
      issueKey: host?.readable_id,
      commentId: id,
      by: auth.login,
      origin: tabOf(req),
    });
    return reply.send({ data: { ok: true } });
  });

  app.post('/issues/:id/attachments', async (req, reply) => {
    const { id } = req.params as { id: string };
    const found = await loadIssueFor(req, reply, id);
    if (!found) return;
    const { comment } = req.query as { comment?: string };
    if (comment) {
      const owns = await pool.query<{ author_id: string }>(
        'select author_id from issue_comments where id = $1 and issue_id = $2',
        [comment, id]
      );
      if (!owns.rowCount) return reply.code(400).send({ error: 'That comment is on another issue.' });
      if (found.auth.kind !== 'session') {
        return reply.code(403).send({ error: 'An API token cannot do this — sign in instead.' });
      }
      if (owns.rows[0].author_id !== found.auth.userId) {
        return reply.code(403).send({ error: 'Only the author can edit a comment.' });
      }
    }
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'Send a file.' });

    const folder = found.issue.id.toLowerCase();
    await mkdir(onDisk(folder), { recursive: true });
    // Stored under our own name: the uploaded one may collide or carry a path out of the folder.
    const ext = path.extname(file.filename).slice(0, 12).replace(/[^a-zA-Z0-9.]/g, '');
    const name = `${folder}/${randomUUID()}${ext}`;
    const stored = onDisk(name);
    try {
      await pipeline(file.file, createWriteStream(stored));
    } catch (err) {
      await unlink(stored).catch(() => {});
      throw err;
    }
    if (file.file.truncated) {
      await unlink(stored).catch(() => {});
      return reply.code(413).send({ error: '100mb max for file' });
    }
    const { size } = await stat(stored);
    const filename = file.filename.slice(0, 200);

    let res;
    try {
      res = await pool.query(
        `insert into issue_attachments (issue_id, comment_id, filename, mime, size, storage_path, uploaded_by)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id, created_at`,
        [id, comment ?? null, filename, file.mimetype, size, name, found.auth.userId]
      );
    } catch (err) {
      await unlink(stored).catch(() => {});
      throw err;
    }
    if (comment) {
      await pool.query('update issue_comments set edited_at = now() where id = $1', [comment]);
    }
    await writeHistory(pool, id, found.auth.userId, 'file added', null, filename);
    void publish({
      type: 'attachment.added',
      boardId: found.issue.board_id,
      projectId: found.issue.project_id,
      issueId: id,
      issueKey: found.issue.readable_id,
      by: found.auth.login,
      origin: tabOf(req),
    });
    return reply.code(201).send({
      data: {
        id: res.rows[0].id,
        filename,
        mime: file.mimetype,
        size,
        commentId: comment ?? null,
        uploadedBy: found.auth.login,
        createdAt: res.rows[0].created_at.toISOString(),
      },
    });
  });

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
    const inline = INLINE_TYPES.has(row.mime);
    reply.header('Content-Type', inline ? row.mime : 'application/octet-stream');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Disposition', disposition(inline ? 'inline' : 'attachment', row.filename));
    return reply.send(createReadStream(onDisk(row.storage_path)));
  });

  async function sendZip(
    reply: FastifyReply,
    name: string,
    files: { filename: string; storage_path: string }[]
  ): Promise<void> {
    const present: typeof files = [];
    for (const file of files) {
      if (await stat(onDisk(file.storage_path)).then(() => true, () => false)) present.push(file);
    }
    if (!present.length) return reply.code(404).send({ error: 'Nothing is attached here.' });
    reply.header('Content-Type', 'application/zip');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Disposition', disposition('attachment', name));
    const zip = new ZipArchive();
    const taken = new Set<string>();
    for (const file of present) {
      let named = file.filename;
      for (let n = 2; taken.has(named.toLowerCase()); n++) {
        const dot = file.filename.lastIndexOf('.');
        const stem = dot > 0 ? file.filename.slice(0, dot) : file.filename;
        const ext = dot > 0 ? file.filename.slice(dot) : '';
        named = `${stem} (${n})${ext}`;
      }
      taken.add(named.toLowerCase());
      zip.file(onDisk(file.storage_path), { name: named });
    }
    zip.finalize().catch(() => zip.destroy());
    return reply.send(zip);
  }

  app.get('/issues/:id/files.zip', async (req, reply) => {
    const { id } = req.params as { id: string };
    const found = await loadIssueFor(req, reply, id);
    if (!found) return;
    const res = await pool.query<{ filename: string; storage_path: string }>(
      `select filename, storage_path from issue_attachments
        where issue_id = $1 and comment_id is null order by created_at`,
      [id]
    );
    if (!res.rowCount) return reply.code(404).send({ error: 'Nothing is attached here.' });
    return sendZip(reply, `${found.issue.readable_id}.zip`, res.rows);
  });

  app.get('/comments/:id/files.zip', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const owner = await pool.query<{ issue_id: string; readable_id: string; said_at: string }>(
      // Dashes, not colons, in the time: a colon is not allowed in a Windows filename.
      `select c.issue_id, i.readable_id,
              to_char(c.created_at at time zone 'Europe/Moscow', 'YYYY-MM-DD-HH24-MI') as said_at
         from issue_comments c join issues i on i.id = c.issue_id where c.id = $1`,
      [id]
    );
    const host = owner.rows[0];
    if (!host) return reply.code(404).send({ error: 'No such comment.' });
    if (!(await mayReachIssue(auth, host.issue_id))) {
      return reply.code(403).send({ error: 'This comment is not open to you.' });
    }
    const res = await pool.query<{ filename: string; storage_path: string }>(
      `select filename, storage_path from issue_attachments
        where comment_id = $1 order by created_at`,
      [id]
    );
    if (!res.rowCount) return reply.code(404).send({ error: 'Nothing is attached here.' });
    return sendZip(reply, `${host.readable_id}-comment-${host.said_at}.zip`, res.rows);
  });

  app.get('/attachments/:id/text', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const res = await pool.query<{
      filename: string;
      size: number;
      storage_path: string;
      issue_id: string;
    }>('select filename, size, storage_path, issue_id from issue_attachments where id = $1', [id]);
    const row = res.rows[0];
    if (!row) return reply.code(404).send({ error: 'No such file.' });
    const issue = await issueById(row.issue_id);
    if (!issue || !(await mayOpenBoard(auth, issue.board_id, issue.project_id))) {
      return reply.code(403).send({ error: 'This file is not open to you.' });
    }
    if (!readable(row.filename)) {
      return reply.code(415).send({ error: 'There is nothing to read in this kind of file.' });
    }
    const chunks: Buffer[] = [];
    for await (const part of createReadStream(onDisk(row.storage_path), { end: READ_MAX })) {
      chunks.push(part as Buffer);
    }
    const read = Buffer.concat(chunks).subarray(0, READ_MAX);
    return reply.send({
      data: {
        filename: row.filename,
        text: read.toString('utf8'),
        truncated: Number(row.size) > READ_MAX,
      },
    });
  });

  app.delete('/attachments/:id', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const res = await pool.query<{
      storage_path: string;
      uploaded_by: string | null;
      issue_id: string;
      comment_id: string | null;
      filename: string;
    }>(
      'select storage_path, uploaded_by, issue_id, comment_id, filename from issue_attachments where id = $1',
      [id]
    );
    const row = res.rows[0];
    if (!row) return reply.code(404).send({ error: 'No such file.' });
    if (!(await mayReachIssue(auth, row.issue_id))) {
      return reply.code(403).send({ error: 'This file is not open to you.' });
    }
    if (row.comment_id) {
      if (auth.kind !== 'session') {
        return reply.code(403).send({ error: 'An API token cannot do this — sign in instead.' });
      }
      const owner = await pool.query<{ author_id: string }>(
        'select author_id from issue_comments where id = $1',
        [row.comment_id]
      );
      if (owner.rows[0]?.author_id !== auth.userId) {
        return reply.code(403).send({ error: 'Only the author can edit a comment.' });
      }
    } else {
      const mine = row.uploaded_by === auth.userId;
      if (!mine && !(await requireDeleter(req, reply))) return;
    }
    await pool.query('delete from issue_attachments where id = $1', [id]);
    if (row.comment_id) {
      await pool.query('update issue_comments set edited_at = now() where id = $1', [
        row.comment_id,
      ]);
    }
    await unlink(onDisk(row.storage_path)).catch(() => {});
    const host = await issueById(row.issue_id);
    await writeHistory(pool, row.issue_id, auth.userId, 'file removed', null, row.filename);
    void publish({
      type: 'attachment.deleted',
      boardId: host?.board_id,
      projectId: host?.project_id,
      issueId: row.issue_id,
      issueKey: host?.readable_id,
      by: auth.login,
      origin: tabOf(req),
    });
    return reply.send({ data: { ok: true } });
  });
}
