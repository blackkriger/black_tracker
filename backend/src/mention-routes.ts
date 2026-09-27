// Being named in a comment. `@login` in the text is the whole mechanism: the names are
// read out of what was written, matched against real accounts, and kept until the person
// they belong to has looked at them.

import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool } from './db.js';
import { requireAuth, requireSession } from './auth.js';
import { DENIES_NOTHING, deniedFor } from './board-service.js';

/** The same shape a login may take, so `@PROJ-1` and an e-mail do not become mentions. */
const NAME = /@([a-zA-Z0-9_.-]{2,32})/g;

const plain = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Brings a comment's mentions in line with what it now says. Names that are still there
 * keep whatever they had, including having been read; names that are gone go with it.
 */
export async function syncMentions(
  client: PoolClient,
  commentId: string,
  text: string,
  authorId: string
): Promise<void> {
  const named = [...plain(text).matchAll(NAME)].map((m) => m[1].toLowerCase());
  const unique = [...new Set(named)];
  const found = unique.length
    ? await client.query<{ id: string }>(
        'select id from users where lower(login) = any($1::text[]) and active and id <> $2',
        [unique, authorId]
      )
    : { rows: [] as { id: string }[] };
  const ids = found.rows.map((r) => r.id);

  await client.query('delete from mentions where comment_id = $1 and user_id <> all($2::uuid[])', [
    commentId,
    ids,
  ]);
  if (ids.length) {
    await client.query(
      `insert into mentions (comment_id, user_id)
       select $1, u from unnest($2::uuid[]) as u
       on conflict do nothing`,
      [commentId, ids]
    );
  }
}

export function registerMentionRoutes(app: FastifyInstance): void {
  // What is waiting for me, newest first: the unread ones matter, the read ones are context.
  app.get('/mentions', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const denied = auth.isAdmin ? DENIES_NOTHING : await deniedFor(auth.roleId);
    if (denied.everything) return reply.send({ data: [] });

    const res = await pool.query<{
      comment_id: string;
      text: string;
      created_at: Date;
      read_at: Date | null;
      by_login: string;
      readable_id: string;
      short_name: string;
      slug: string;
    }>(
      `select m.comment_id, c.text, m.created_at, m.read_at, u.login as by_login,
              i.readable_id, p.short_name, b.slug
         from mentions m
         join issue_comments c on c.id = m.comment_id
         join users u on u.id = c.author_id
         join issues i on i.id = c.issue_id
         join projects p on p.id = i.project_id
         join boards b on b.id = i.board_id
        where m.user_id = $1
          and i.project_id <> all($2::uuid[])
          and i.board_id <> all($3::uuid[])
        order by m.read_at is not null, m.created_at desc
        limit 20`,
      [auth.userId, [...denied.projects], [...denied.boards]]
    );

    return reply.send({
      data: res.rows.map((r) => ({
        commentId: r.comment_id,
        said: plain(r.text).slice(0, 140),
        by: r.by_login,
        key: r.readable_id,
        projectShort: r.short_name,
        boardSlug: r.slug,
        at: r.created_at.toISOString(),
        read: r.read_at !== null,
      })),
    });
  });

  // Seen: one of them, or all of them at once.
  app.post('/mentions/read', async (req, reply) => {
    const session = await requireSession(req, reply);
    if (!session) return;
    const parsed = z
      .object({ commentId: z.string().uuid().optional() })
      .safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Bad mention.' });
    await pool.query(
      `update mentions set read_at = now()
        where user_id = $1 and read_at is null
          and ($2::uuid is null or comment_id = $2)`,
      [session.userId, parsed.data.commentId ?? null]
    );
    return reply.send({ data: { ok: true } });
  });
}
