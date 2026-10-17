import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DAY_RE, inTransaction, pool, ZONE } from './db.js';
import { requireAuth, type Auth } from './auth.js';
import { deniedFor, mayOpenBoard } from './board-service.js';
import { writeHistory } from './issue-routes.js';

const PAGE = 100;

const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  authors: z.string().max(2000).optional(),
  branches: z.string().max(4000).optional(),
  projects: z.string().max(400).optional(),
  tags: z.string().max(4000).optional(),
  linked: z.enum(['yes', 'no']).optional(),
  from: z.string().regex(DAY_RE).optional(),
  to: z.string().regex(DAY_RE).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

interface ListedRow {
  id: string;
  repo: string;
  sha: string;
  kind: 'commit' | 'merge';
  message: string;
  branch: string | null;
  merged_from: string | null;
  author: string;
  author_name: string | null;
  by_login: string | null;
  at: Date;
  project: string | null;
  issues: { id: string; key: string; summary: string; stateName: string; stateColor: string; projectShort: string; boardSlug: string }[];
  total: number;
}

const listOf = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

async function hiddenFor(auth: Auth): Promise<{ projects: string[]; boards: string[] }> {
  if (auth.isAdmin) return { projects: [], boards: [] };
  const denied = await deniedFor(auth.roleId);
  return { projects: [...denied.projects], boards: [...denied.boards] };
}

const VISIBLE = `
  from repo_commits c
  left join projects rp on rp.repo = c.repo
  left join users u on u.github_login is not null
   and lower(u.github_login) = lower(coalesce(c.author_login, c.author_name))
 where (rp.id is null or not (rp.id = any($1::uuid[])))`;

const AUTHOR = 'coalesce(u.login, c.author_login, c.author_name)';

async function visibleCommit(auth: Auth, id: string): Promise<{ id: string; sha: string } | null> {
  const hidden = await hiddenFor(auth);
  const res = await pool.query<{ id: string; sha: string }>(`select c.id, c.sha ${VISIBLE} and c.id = $2`, [
    hidden.projects,
    id,
  ]);
  return res.rows[0] ?? null;
}

export function registerCommitRoutes(app: FastifyInstance): void {
  app.get('/commits', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Bad filter.' });
    const p = parsed.data;
    const hidden = await hiddenFor(auth);
    const authors = listOf(p.authors);
    const branches = listOf(p.branches);
    const projects = listOf(p.projects);
    const tags = listOf(p.tags).filter((v) => /^[0-9a-f-]{36}$/i.test(v));
    const res = await pool.query<ListedRow>(
      `select c.id, c.repo, c.sha, c.kind, c.message, c.branch, c.merged_from, ${AUTHOR} as author,
              c.author_name, u.login as by_login, c.at, rp.short_name as project,
              coalesce((
                select json_agg(json_build_object(
                         'id', i.id, 'key', i.readable_id, 'summary', i.summary, 'stateName', s.name,
                         'stateColor', s.color, 'projectShort', ip.short_name, 'boardSlug', b.slug
                       ) order by i.number)
                  from issue_commits l
                  join issues i on i.id = l.issue_id
                  join boards b on b.id = i.board_id
                  join projects ip on ip.id = i.project_id
                  join states s on s.id = i.state_id
                 where l.commit_id = c.id
                   and not (b.id = any($2::uuid[]) or ip.id = any($1::uuid[]))
              ), '[]') as issues,
              count(*) over ()::int as total
        ${VISIBLE}
          and ($3::text is null or c.sha ilike $3 || '%' or c.message ilike '%' || $3 || '%')
          and (cardinality($4::text[]) = 0 or ${AUTHOR} = any($4::text[]))
          and (cardinality($5::text[]) = 0 or c.branch = any($5::text[]))
          and (cardinality($6::text[]) = 0 or rp.short_name = any($6::text[]) or exists (
                select 1 from issue_commits l join issues i on i.id = l.issue_id join projects ip on ip.id = i.project_id
                 where l.commit_id = c.id and ip.short_name = any($6::text[])))
          and ($7::text is null
               or ($7 = 'yes') = exists (select 1 from issue_commits l where l.commit_id = c.id))
          and ($8::date is null or (c.at at time zone '${ZONE}')::date >= $8)
          and ($9::date is null or (c.at at time zone '${ZONE}')::date <= $9)
          and (cardinality($11::uuid[]) = 0 or exists (
                select 1 from issue_commits l join issue_tags it on it.issue_id = l.issue_id
                 where l.commit_id = c.id and it.tag_id = any($11::uuid[])))
        order by c.at desc, c.id desc
        limit ${PAGE} offset $10`,
      [
        hidden.projects,
        hidden.boards,
        p.q || null,
        authors,
        branches,
        projects,
        p.linked ?? null,
        p.from ?? null,
        p.to ?? null,
        p.offset ?? 0,
        tags,
      ]
    );
    return reply.send({
      data: {
        total: res.rows[0]?.total ?? 0,
        commits: res.rows.map((r) => ({
          id: r.id,
          sha: r.sha,
          kind: r.kind,
          message: r.message.split('\n')[0],
          branch: r.branch,
          mergedFrom: r.merged_from,
          author: r.author,
          by: r.by_login,
          at: r.at.toISOString(),
          url: `https://github.com/${r.repo}/commit/${r.sha}`,
          project: r.project,
          issues: r.issues,
        })),
      },
    });
  });

  app.get('/commits/facets', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const hidden = await hiddenFor(auth);
    const [authors, branches] = await Promise.all([
      pool.query<{ value: string; login: string | null; n: number }>(
        `select ${AUTHOR} as value, max(u.login) as login, count(*)::int as n ${VISIBLE}
          group by 1 order by 3 desc`,
        [hidden.projects]
      ),
      pool.query<{ value: string; n: number }>(
        `select c.branch as value, count(*)::int as n ${VISIBLE} and c.branch is not null
          group by 1 order by 2 desc`,
        [hidden.projects]
      ),
    ]);
    return reply.send({
      data: {
        authors: authors.rows.filter((r) => r.value).map((r) => ({ value: r.value, login: r.login })),
        branches: branches.rows.map((r) => r.value),
      },
    });
  });

  app.post('/commits/:id/link', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = z.object({ key: z.string().trim().min(3).max(30) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Which issue? Give its key.' });
    const commit = await visibleCommit(auth, id);
    if (!commit) return reply.code(404).send({ error: 'No such commit.' });
    const found = await pool.query<{ id: string; board_id: string; project_id: string }>(
      'select id, board_id, project_id from issues where lower(readable_id) = lower($1)',
      [parsed.data.key]
    );
    const issue = found.rows[0];
    if (!issue) return reply.code(404).send({ error: 'No issue with that key.' });
    if (!(await mayOpenBoard(auth, issue.board_id, issue.project_id))) {
      return reply.code(403).send({ error: 'That issue is not open to you.' });
    }
    await inTransaction(async (client) => {
      const made = await client.query(
        'insert into issue_commits (issue_id, commit_id) values ($1, $2) on conflict do nothing',
        [issue.id, commit.id]
      );
      await client.query('delete from commit_unlinks where issue_id = $1 and commit_id = $2', [issue.id, commit.id]);
      if (made.rowCount) await writeHistory(client, issue.id, auth, 'commits linked', null, commit.sha.slice(0, 7));
    });
    return reply.send({ data: { ok: true } });
  });

  app.post('/commits/:id/unlink', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = z.object({ issueId: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'From which issue?' });
    const commit = await visibleCommit(auth, id);
    if (!commit) return reply.code(404).send({ error: 'No such commit.' });
    const found = await pool.query<{ board_id: string; project_id: string }>(
      'select board_id, project_id from issues where id = $1',
      [parsed.data.issueId]
    );
    const issue = found.rows[0];
    if (!issue || !(await mayOpenBoard(auth, issue.board_id, issue.project_id))) {
      return reply.code(404).send({ error: 'No such issue.' });
    }
    await inTransaction(async (client) => {
      const gone = await client.query('delete from issue_commits where issue_id = $1 and commit_id = $2', [
        parsed.data.issueId,
        commit.id,
      ]);
      if (!gone.rowCount) return;
      await client.query(
        'insert into commit_unlinks (issue_id, commit_id) values ($1, $2) on conflict do nothing',
        [parsed.data.issueId, commit.id]
      );
      await writeHistory(client, parsed.data.issueId, auth, 'commits unlinked', null, commit.sha.slice(0, 7));
    });
    return reply.send({ data: { ok: true } });
  });
}
