// One screenful of numbers about the work itself: what stands on each board, what is late,
// who carries what, how long a finished issue took, and what nobody has touched in a
// fortnight. Everything is read behind the same denials the boards themselves are read
// behind, so a role that cannot open a board never counts its issues either.

import type { FastifyInstance } from 'fastify';
import { pool } from './db.js';
import { requireAuth, type Auth } from './auth.js';
import { DENIES_NOTHING, deniedFor } from './board-service.js';

const ZONE = 'Europe/Moscow';
/** Untouched this long and an open issue is worth naming. */
const STALE_DAYS = 14;
/** A deadline further off than this is not news yet. */
const SOON_DAYS = 7;

async function shutOut(auth: Auth): Promise<{ all: boolean; projects: string[]; boards: string[] }> {
  const denied = auth.isAdmin ? DENIES_NOTHING : await deniedFor(auth.roleId);
  return { all: denied.everything, projects: [...denied.projects], boards: [...denied.boards] };
}

interface Cell {
  board_id: string;
  board_name: string;
  slug: string;
  short_name: string;
  state_name: string;
  color: string;
  is_resolved: boolean;
  n: string;
}

interface DueRow {
  readable_id: string;
  summary: string;
  due_date: string;
  short_name: string;
  slug: string;
  color: string;
  assignee: string | null;
  late: boolean;
}

interface PersonRow {
  login: string;
  role_color: string | null;
  open: string;
  late: string;
  closed: string;
}

interface HeldRow {
  login: string;
  id: string;
  readable_id: string;
  summary: string;
  priority: string;
  due_date: string | null;
  created_at: Date;
  short_name: string;
  slug: string;
  state_name: string;
  color: string;
}

interface HandRow {
  issue_id: string;
  old_value: string | null;
  new_value: string | null;
  created_at: Date;
}

/** One stretch of an issue's life, in one person's hands — or in nobody's. */
interface Hand {
  login: string | null;
  days: number;
  current: boolean;
}

interface StaleRow {
  readable_id: string;
  summary: string;
  short_name: string;
  slug: string;
  state_name: string;
  color: string;
  days: string;
}

const day = (d: Date | string): string =>
  typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);

const DAY_MS = 86_400_000;

/**
 * Who has held an issue, and for how long. The history writes a row per change of hands,
 * so the stretches are the gaps between those rows: the first begins when the issue was
 * written, and the last is still running.
 */
function handsOf(born: Date, changes: HandRow[]): Hand[] {
  const now = Date.now();
  const spans: Hand[] = [];
  let since = born.getTime();
  let who = changes.length ? changes[0].old_value : null;
  for (const change of changes) {
    const at = change.created_at.getTime();
    spans.push({ login: who, days: (at - since) / DAY_MS, current: false });
    who = change.new_value;
    since = at;
  }
  spans.push({ login: who, days: (now - since) / DAY_MS, current: true });
  return spans;
}

function median(all: number[]): number | null {
  if (!all.length) return null;
  const sorted = [...all].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
}

export function registerAnalyticsRoutes(app: FastifyInstance): void {
  // The dashboard's own list: everything on the reader's hands, nearest deadline first and
  // the undated ones after them.
  app.get('/my-issues', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const denied = await shutOut(auth);
    if (denied.all) return reply.send({ data: [] });
    const res = await pool.query<{
      readable_id: string;
      summary: string;
      priority: string;
      due_date: string | null;
      short_name: string;
      slug: string;
      state_name: string;
      color: string;
    }>(
      `select i.readable_id, i.summary, i.priority, i.due_date, p.short_name, b.slug,
              s.name as state_name, s.color
         from issues i
         join projects p on p.id = i.project_id
         join boards b on b.id = i.board_id
         join states s on s.id = i.state_id
        where i.assignee_id = $3 and i.resolved_at is null
          and b.id <> all($1::uuid[]) and i.project_id <> all($2::uuid[])
        order by i.due_date nulls last, i.readable_id`,
      [denied.boards, denied.projects, auth.userId]
    );
    return reply.send({
      data: res.rows.map((r) => ({
        key: r.readable_id,
        summary: r.summary,
        priority: r.priority,
        due: r.due_date ? day(r.due_date) : null,
        projectShort: r.short_name,
        boardSlug: r.slug,
        stateName: r.state_name,
        color: r.color,
      })),
    });
  });

  app.get('/analytics', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const q = req.query as { project?: string; status?: string };
    const only = (q.project ?? '').trim() || null;
    const inState = (q.status ?? '').trim() || null;
    const denied = await shutOut(auth);
    if (denied.all) {
      return reply.send({
        data: {
          statuses: [],
          boards: [],
          due: { overdue: [], soon: [] },
          people: [],
          unassigned: 0,
          priorities: [],
          cycle: { median: null, closed: 0, months: [] },
          stale: [],
        },
      });
    }

    // Every query stands on the same four: what is shut out, which project is being read,
    // and which status the whole page is narrowed to.
    const seen: [string[], string[], string | null, string | null] = [
      denied.boards,
      denied.projects,
      only,
      inState,
    ];

    const [statuses, cells, dues, people, held, loose, priorities, cycle, months, stale] =
      await Promise.all([
      pool.query<{ name: string }>(
        `select s.name
           from states s
           join boards b on b.id = s.board_id
           join projects p on p.id = b.project_id
          where b.id <> all($1::uuid[]) and b.project_id <> all($2::uuid[])
            and ($3::text is null or p.short_name = $3)
          group by s.name
          order by min(s.position), s.name`,
        // The list of statuses is what the filter is chosen from, so it is never narrowed by it.
        seen.slice(0, 3)
      ),
      pool.query<Cell>(
        `select b.id as board_id, b.name as board_name, b.slug, p.short_name,
                s.name as state_name, s.color, s.is_resolved,
                count(i.id) as n
           from boards b
           join projects p on p.id = b.project_id
           join states s on s.board_id = b.id
           left join issues i on i.board_id = b.id and i.state_id = s.id
          where b.id <> all($1::uuid[]) and b.project_id <> all($2::uuid[])
            and ($3::text is null or p.short_name = $3)
            and ($4::text is null or s.name = $4)
          group by b.id, b.name, b.slug, b.position, p.short_name, p.position,
                   s.id, s.name, s.color, s.is_resolved, s.position
          order by p.position, p.short_name, b.position, s.position`,
        seen
      ),
      pool.query<DueRow>(
        `select i.readable_id, i.summary, i.due_date, p.short_name, b.slug, s.color,
                u.login as assignee,
                i.due_date < (now() at time zone '${ZONE}')::date as late
           from issues i
           join projects p on p.id = i.project_id
           join boards b on b.id = i.board_id
           join states s on s.id = i.state_id
           left join users u on u.id = i.assignee_id
          where i.resolved_at is null and i.due_date is not null
            and i.due_date <= (now() at time zone '${ZONE}')::date + ${SOON_DAYS}
            and b.id <> all($1::uuid[]) and i.project_id <> all($2::uuid[])
            and ($3::text is null or p.short_name = $3)
            and ($4::text is null or s.name = $4)
          order by i.due_date, i.readable_id`,
        seen
      ),
      pool.query<PersonRow>(
        `select u.login, r.color as role_color,
                count(i.id) filter (where i.resolved_at is null) as open,
                count(i.id) filter (
                  where i.resolved_at is null and i.due_date < (now() at time zone '${ZONE}')::date
                ) as late,
                count(i.id) filter (where i.resolved_at > now() - interval '30 days') as closed
           from users u
           left join roles r on r.id = u.role_id
           left join issues i on i.assignee_id = u.id
            and i.board_id <> all($1::uuid[]) and i.project_id <> all($2::uuid[])
            and ($3::text is null or i.project_id in (select id from projects where short_name = $3))
            and ($4::text is null or i.state_id in (select id from states where name = $4))
          where u.active
          group by u.login, r.color
          order by count(i.id) filter (where i.resolved_at is null) desc, lower(u.login)`,
        seen
      ),
      // What each of them is holding right now, one row per issue rather than per person.
      pool.query<HeldRow>(
        `select u.login, i.id, i.readable_id, i.summary, i.priority, i.due_date, i.created_at,
                p.short_name, b.slug, s.name as state_name, s.color
           from issues i
           join users u on u.id = i.assignee_id
           join projects p on p.id = i.project_id
           join boards b on b.id = i.board_id
           join states s on s.id = i.state_id
          where i.resolved_at is null
            and b.id <> all($1::uuid[]) and i.project_id <> all($2::uuid[])
            and ($3::text is null or p.short_name = $3)
            and ($4::text is null or s.name = $4)
          order by lower(u.login), i.due_date nulls last, i.readable_id`,
        seen
      ),
      pool.query<{ n: string }>(
        `select count(*) as n
           from issues i
           join projects p on p.id = i.project_id
          join states s on s.id = i.state_id
          where i.resolved_at is null and i.assignee_id is null
            and i.board_id <> all($1::uuid[]) and i.project_id <> all($2::uuid[])
            and ($3::text is null or p.short_name = $3)
            and ($4::text is null or s.name = $4)`,
        seen
      ),
      pool.query<{ priority: string; state_name: string; n: string }>(
        `select i.priority, s.name as state_name, count(*) as n
           from issues i
           join projects p on p.id = i.project_id
           join states s on s.id = i.state_id
          where i.resolved_at is null
            and i.board_id <> all($1::uuid[]) and i.project_id <> all($2::uuid[])
            and ($3::text is null or p.short_name = $3)
            and ($4::text is null or s.name = $4)
          group by i.priority, s.name`,
        seen
      ),
      pool.query<{ median: string | null; closed: string }>(
        `select percentile_cont(0.5) within group (
                  order by extract(epoch from (i.resolved_at - i.created_at)) / 86400
                ) as median,
                count(*) as closed
           from issues i
           join projects p on p.id = i.project_id
           join states s on s.id = i.state_id
          where i.resolved_at is not null
            and i.board_id <> all($1::uuid[]) and i.project_id <> all($2::uuid[])
            and ($3::text is null or p.short_name = $3)
            and ($4::text is null or s.name = $4)`,
        seen
      ),
      pool.query<{ month: string; median: string | null; closed: string }>(
        `select to_char(date_trunc('month', i.resolved_at at time zone '${ZONE}'), 'YYYY-MM') as month,
                percentile_cont(0.5) within group (
                  order by extract(epoch from (i.resolved_at - i.created_at)) / 86400
                ) as median,
                count(*) as closed
           from issues i
           join projects p on p.id = i.project_id
           join states s on s.id = i.state_id
          where i.resolved_at is not null
            and i.resolved_at > (now() at time zone '${ZONE}') - interval '6 months'
            and i.board_id <> all($1::uuid[]) and i.project_id <> all($2::uuid[])
            and ($3::text is null or p.short_name = $3)
            and ($4::text is null or s.name = $4)
          group by 1
          order by 1`,
        seen
      ),
      pool.query<StaleRow>(
        `select i.readable_id, i.summary, p.short_name, b.slug, s.name as state_name, s.color,
                floor(extract(epoch from (now() - i.updated_at)) / 86400) as days
           from issues i
           join projects p on p.id = i.project_id
           join boards b on b.id = i.board_id
           join states s on s.id = i.state_id
          where i.resolved_at is null
            and i.updated_at < now() - interval '${STALE_DAYS} days'
            and b.id <> all($1::uuid[]) and i.project_id <> all($2::uuid[])
            and ($3::text is null or p.short_name = $3)
            and ($4::text is null or s.name = $4)
          order by i.updated_at
          limit 20`,
        seen
      ),
    ]);

    // Every change of hands for the issues just listed, read in one go rather than per issue.
    const handRows = held.rows.length
      ? await pool.query<HandRow>(
          `select issue_id, old_value, new_value, created_at
             from issue_history
            where issue_id = any($1::uuid[]) and field = 'assignee'
            order by issue_id, created_at`,
          [held.rows.map((r) => r.id)]
        )
      : { rows: [] as HandRow[] };
    const changes = new Map<string, HandRow[]>();
    for (const row of handRows.rows) {
      const list = changes.get(row.issue_id);
      if (list) list.push(row);
      else changes.set(row.issue_id, [row]);
    }

    // The cells come back one per column; the board they belong to is put back together here.
    const boards: {
      id: string;
      name: string;
      projectShort: string;
      slug: string;
      total: number;
      open: number;
      states: { name: string; color: string; count: number }[];
    }[] = [];
    for (const c of cells.rows) {
      let board = boards.find((b) => b.id === c.board_id);
      if (!board) {
        board = {
          id: c.board_id,
          name: c.board_name,
          projectShort: c.short_name,
          slug: c.slug,
          total: 0,
          open: 0,
          states: [],
        };
        boards.push(board);
      }
      const n = Number(c.n);
      board.total += n;
      if (!c.is_resolved) board.open += n;
      board.states.push({ name: c.state_name, color: c.color, count: n });
    }

    // What each person is holding, with how long each issue has been in their hands.
    const holding = new Map<
      string,
      { key: string; summary: string; projectShort: string; boardSlug: string; color: string;
        stateName: string; priority: string; due: string | null; days: number; hands: Hand[] }[]
    >();
    for (const r of held.rows) {
      const hands = handsOf(r.created_at, changes.get(r.id) ?? []);
      const mine = hands[hands.length - 1];
      const list = holding.get(r.login) ?? [];
      list.push({
        key: r.readable_id,
        summary: r.summary,
        projectShort: r.short_name,
        boardSlug: r.slug,
        color: r.color,
        stateName: r.state_name,
        priority: r.priority,
        due: r.due_date ? day(r.due_date) : null,
        days: Math.round(mine.days * 10) / 10,
        hands: hands.map((h) => ({
          login: h.login,
          days: Math.round(h.days * 10) / 10,
          current: h.current,
        })),
      });
      holding.set(r.login, list);
    }

    const where = (r: DueRow | StaleRow) => ({
      key: r.readable_id,
      summary: r.summary,
      projectShort: r.short_name,
      boardSlug: r.slug,
      color: r.color,
    });

    return reply.send({
      data: {
        boards,
        due: {
          overdue: dues.rows
            .filter((r) => r.late)
            .map((r) => ({ ...where(r), day: day(r.due_date), assignee: r.assignee })),
          soon: dues.rows
            .filter((r) => !r.late)
            .map((r) => ({ ...where(r), day: day(r.due_date), assignee: r.assignee })),
        },
        statuses: statuses.rows.map((r) => r.name),
        people: people.rows.map((r) => {
          const issues = holding.get(r.login) ?? [];
          return {
            login: r.login,
            color: r.role_color,
            open: Number(r.open),
            late: Number(r.late),
            closed: Number(r.closed),
            held: median(issues.map((i) => i.days)),
            issues,
          };
        }),
        unassigned: Number(loose.rows[0]?.n ?? 0),
        priorities: [...new Set(priorities.rows.map((r) => r.priority))].map((name) => {
          const mine = priorities.rows.filter((r) => r.priority === name);
          return {
            name,
            count: mine.reduce((all, r) => all + Number(r.n), 0),
            byState: Object.fromEntries(mine.map((r) => [r.state_name, Number(r.n)])),
          };
        }),
        cycle: {
          median: cycle.rows[0]?.median === null ? null : Number(cycle.rows[0]?.median),
          closed: Number(cycle.rows[0]?.closed ?? 0),
          months: months.rows.map((r) => ({
            month: r.month,
            median: r.median === null ? null : Number(r.median),
            closed: Number(r.closed),
          })),
        },
        stale: stale.rows.map((r) => ({
          ...where(r),
          stateName: r.state_name,
          days: Number(r.days),
        })),
      },
    });
  });
}
