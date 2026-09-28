// What a person is told about: being named in a comment, and someone reacting to one they
// wrote. `@login` in the text is the whole of the first mechanism — the names are read out
// of what was written, matched against real accounts and roles, and kept until the person
// they belong to has looked at them.

import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool } from './db.js';
import { requireAuth, requireSession } from './auth.js';
import { DENIES_NOTHING, deniedFor } from './board-service.js';

/** The same shape a login may take, so `@PROJ-1` and an e-mail do not become mentions. */
const NAME = /(?:^|\s)@([a-zA-Z0-9_.-]{2,32})/g;

const plain = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Brings a comment's mentions in line with what it now says. Names that are still there
 * keep whatever they had, including having been read; names that are gone go with it.
 * A name is either a login or a role — naming a role names everyone wearing it.
 */
export async function syncMentions(
  client: PoolClient,
  commentId: string,
  text: string,
  authorId: string
): Promise<void> {
  const said = plain(text);
  const ids = new Set<string>();

  const logins = [...new Set([...said.matchAll(NAME)].map((m) => m[1].toLowerCase()))];
  if (logins.length) {
    const found = await client.query<{ id: string }>(
      'select id from users where lower(login) = any($1::text[]) and active and id <> $2',
      [logins, authorId]
    );
    for (const row of found.rows) ids.add(row.id);
  }

  // A role's name may hold spaces, so it is looked for whole rather than tokenised.
  const roles = await client.query<{ id: string; name: string }>('select id, name from roles');
  const named = roles.rows.filter((r) =>
    new RegExp(`(^|\\s)@${escape(r.name)}(?![a-zA-Z0-9_.-])`, 'i').test(said)
  );
  if (named.length) {
    const wearers = await client.query<{ id: string }>(
      'select id from users where role_id = any($1::uuid[]) and active and id <> $2',
      [named.map((r) => r.id), authorId]
    );
    for (const row of wearers.rows) ids.add(row.id);
  }

  const all = [...ids];
  await client.query(
    `delete from notices
      where kind = 'mention' and comment_id = $1 and user_id <> all($2::uuid[])`,
    [commentId, all]
  );
  if (all.length) {
    await client.query(
      `insert into notices (user_id, kind, comment_id, by_id)
       select u, 'mention', $1, $2 from unnest($3::uuid[]) as u
       on conflict do nothing`,
      [commentId, authorId, all]
    );
  }
}

interface NoticeRow {
  id: string;
  kind: string;
  detail: string | null;
  comment_id: string | null;
  text: string | null;
  summary: string | null;
  created_at: Date;
  read_at: Date | null;
  by_login: string | null;
  readable_id: string | null;
  short_name: string | null;
  slug: string | null;
  state_color: string | null;
}

export function registerNoticeRoutes(app: FastifyInstance): void {
  // What is waiting for me, newest first: the unread ones matter, the read ones are context.
  app.get('/notices', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const denied = auth.isAdmin ? DENIES_NOTHING : await deniedFor(auth.roleId);
    if (denied.everything) return reply.send({ data: [] });

    const res = await pool.query<NoticeRow>(
      `select n.id, n.kind, n.detail, n.comment_id, c.text, i.summary, n.created_at, n.read_at,
              u.login as by_login, i.readable_id, p.short_name, b.slug, st.color as state_color
         from notices n
         left join issue_comments c on c.id = n.comment_id
         left join users u on u.id = n.by_id
         join issues i on i.id = coalesce(c.issue_id, n.issue_id)
         join projects p on p.id = i.project_id
         join boards b on b.id = i.board_id
         join states st on st.id = i.state_id
        where n.user_id = $1
          and i.project_id <> all($2::uuid[])
          and i.board_id <> all($3::uuid[])
        order by n.read_at is not null, n.created_at desc
        limit 40`,
      [auth.userId, [...denied.projects], [...denied.boards]]
    );

    return reply.send({ data: res.rows.map((r) => publicNotice(r, auth.login)) });
  });

  // Seen: one of them, or all of them at once.
  app.post('/notices/read', async (req, reply) => {
    const session = await requireSession(req, reply);
    if (!session) return;
    const parsed = z.object({ id: z.string().uuid().optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Bad notice.' });
    await pool.query(
      `update notices set read_at = now()
        where user_id = $1 and read_at is null and ($2::uuid is null or id = $2)`,
      [session.userId, parsed.data.id ?? null]
    );
    return reply.send({ data: { ok: true } });
  });
}

function publicNotice(r: NoticeRow, mine: string) {
  // A notice about the issue itself has no words of its own, so it carries its title.
  if (!r.comment_id) {
    return {
      id: r.id,
      kind: r.kind,
      commentId: null,
      emoji: r.detail,
      said: (r.summary ?? '').slice(0, 140),
      by: r.by_login,
      key: r.readable_id,
      color: r.state_color,
      projectShort: r.short_name,
      boardSlug: r.slug,
      at: r.created_at.toISOString(),
      read: r.read_at !== null,
    };
  }
  // The name that is being answered is the reader's own, so it says nothing they do not know.
  const said = plain(r.text ?? '')
    .replace(new RegExp(`(^|\\s)@${escape(mine)}(?![a-zA-Z0-9_.-])`, 'gi'), '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    id: r.id,
    kind: r.kind,
    commentId: r.comment_id,
    emoji: r.detail,
    said: said.slice(0, 140),
    by: r.by_login,
    key: r.readable_id,
    color: r.state_color,
    projectShort: r.short_name,
    boardSlug: r.slug,
    at: r.created_at.toISOString(),
    read: r.read_at !== null,
  };
}
