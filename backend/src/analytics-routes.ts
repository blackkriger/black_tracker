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

export function registerAnalyticsRoutes(app: FastifyInstance): void {
  app.get('/analytics', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const only = ((req.query as { project?: string }).project ?? '').trim() || null;
    const denied = await shutOut(auth);
    if (denied.all) {
      return reply.send({
        data: {
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

    // Every query stands on the same three: what is shut out, and which project is being read.
    const seen: [string[], string[], string | null] = [denied.boards, denied.projects, only];

    const [cells, dues, people, loose, priorities, cycle, months, stale] = await Promise.all([
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
          where u.active
          group by u.login, r.color
          order by count(i.id) filter (where i.resolved_at is null) desc, lower(u.login)`,
        seen
      ),
      pool.query<{ n: string }>(
        `select count(*) as n
           from issues i
           join projects p on p.id = i.project_id
          where i.resolved_at is null and i.assignee_id is null
            and i.board_id <> all($1::uuid[]) and i.project_id <> all($2::uuid[])
            and ($3::text is null or p.short_name = $3)`,
        seen
      ),
      pool.query<{ priority: string; n: string }>(
        `select i.priority, count(*) as n
           from issues i
           join projects p on p.id = i.project_id
          where i.resolved_at is null
            and i.board_id <> all($1::uuid[]) and i.project_id <> all($2::uuid[])
            and ($3::text is null or p.short_name = $3)
          group by i.priority`,
        seen
      ),
      pool.query<{ median: string | null; closed: string }>(
        `select percentile_cont(0.5) within group (
                  order by extract(epoch from (i.resolved_at - i.created_at)) / 86400
                ) as median,
                count(*) as closed
           from issues i
           join projects p on p.id = i.project_id
          where i.resolved_at is not null
            and i.board_id <> all($1::uuid[]) and i.project_id <> all($2::uuid[])
            and ($3::text is null or p.short_name = $3)`,
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
          where i.resolved_at is not null
            and i.resolved_at > (now() at time zone '${ZONE}') - interval '6 months'
            and i.board_id <> all($1::uuid[]) and i.project_id <> all($2::uuid[])
            and ($3::text is null or p.short_name = $3)
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
          order by i.updated_at
          limit 20`,
        seen
      ),
    ]);

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
        people: people.rows.map((r) => ({
          login: r.login,
          color: r.role_color,
          open: Number(r.open),
          late: Number(r.late),
          closed: Number(r.closed),
        })),
        unassigned: Number(loose.rows[0]?.n ?? 0),
        priorities: priorities.rows.map((r) => ({ name: r.priority, count: Number(r.n) })),
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
