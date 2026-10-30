import type { FastifyInstance } from 'fastify';
import { DAY_RE, listOf, onDays, pool, ZONE } from './db.js';
import { requireAuth } from './auth.js';
import { shutOut } from './board-service.js';
import { stretchesOf, workOf, type HandRow } from './work.js';

const ISSUE_PICKS = `
            and ($7::uuid[] is null or (
                  select count(*) from issue_tags it where it.issue_id = i.id and it.tag_id = any($7)
                ) = cardinality($7))
            and ($8::text[] is null or i.assignee_id in (select id from users where login = any($8))
                 or ('-' = any($8) and i.assignee_id is null))
            and ($9::text[] is null or i.author_id in (select id from users where login = any($9)))
            and ($10::text[] is null or i.watcher_id in (select id from users where login = any($10)))`;

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
  board_id: string;
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

interface Hand {
  login: string | null;
  days: number;
  current: boolean;
  states: { name: string; color: string | null; days: number }[];
}

const day = (d: Date | string): string =>
  typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

function handsOf(
  born: Date,
  holder: string,
  state: string,
  changes: HandRow[],
  colorOf: (name: string) => string | null
): Hand[] {
  const start = born.getTime();
  const hands = stretchesOf(start, holder, changes.filter((c) => c.field === 'assignee'));
  const states = stretchesOf(start, state, changes.filter((c) => c.field === 'status'));
  return hands.map((h, i) => {
    const split = new Map<string, number>();
    for (const st of states) {
      const overlap = Math.min(h.to, st.to) - Math.max(h.from, st.from);
      if (overlap > 0 && st.name) split.set(st.name, (split.get(st.name) ?? 0) + overlap);
    }
    return {
      login: h.name,
      days: (h.to - h.from) / DAY_MS,
      current: i === hands.length - 1,
      states: [...split].map(([name, ms]) => ({ name, color: colorOf(name), days: ms / DAY_MS })),
    };
  });
}

function median(all: number[]): number | null {
  if (!all.length) return null;
  const sorted = [...all].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
}

export function registerAnalyticsRoutes(app: FastifyInstance): void {
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
      board_name: string;
      state_name: string;
      color: string;
    }>(
      `select i.readable_id, i.summary, i.priority, i.due_date, p.short_name, b.slug,
              b.name as board_name, s.name as state_name, s.color
         from issues i
         join projects p on p.id = i.project_id
         join boards b on b.id = i.board_id
         join states s on s.id = i.state_id
        where (i.assignee_id = $3 or i.watcher_id = $3) and not s.is_resolved
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
        boardName: r.board_name,
        stateName: r.state_name,
        color: r.color,
      })),
    });
  });

  app.get('/my-favourites', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const denied = await shutOut(auth);
    if (denied.all) return reply.send({ data: [] });
    const res = await pool.query<{
      readable_id: string;
      summary: string;
      short_name: string;
      slug: string;
      state_name: string;
      color: string;
    }>(
      `select i.readable_id, i.summary, p.short_name, b.slug, s.name as state_name, s.color
         from issue_favourites f
         join issues i on i.id = f.issue_id
         join projects p on p.id = i.project_id
         join boards b on b.id = i.board_id
         join states s on s.id = i.state_id
        where f.user_id = $3
          and b.id <> all($1::uuid[]) and i.project_id <> all($2::uuid[])
        order by f.created_at desc`,
      [denied.boards, denied.projects, auth.userId]
    );
    return reply.send({
      data: res.rows.map((r) => ({
        key: r.readable_id,
        summary: r.summary,
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
    const q = req.query as Record<string, string | undefined>;
    const only = listOf(q.projects);
    const inState = listOf(q.states);
    const tagged = listOf(q.tags)?.filter((t) => /^[0-9a-f-]{36}$/i.test(t)) ?? null;
    const holders = listOf(q.assignees);
    const writers = listOf(q.authors);
    const watchers = listOf(q.watchers);
    const from = (q.from ?? '').trim() || null;
    const to = (q.to ?? '').trim() || null;
    if ((from && !DAY_RE.test(from)) || (to && !DAY_RE.test(to))) {
      return reply.code(400).send({ error: 'Dates go as YYYY-MM-DD.' });
    }
    const denied = await shutOut(auth);
    if (denied.all) {
      return reply.send({
        data: {
          statuses: [],
          boards: [],
          due: { overdue: [], soon: [] },
          people: [],
          worked: [],
          unassigned: 0,
          priorities: [],
          cycle: { median: null, closed: 0, months: [] },
        },
      });
    }

    const seen: [string[], string[], string[] | null] = [denied.boards, denied.projects, only];
    const within = [...seen, inState, from, to, tagged, holders, writers, watchers];
    const people_ = holders?.filter((login) => login !== '-') ?? null;

    const [statuses, cells, dues, people, held, loose, priorities, cycle, months, worked, bounds] =
      await Promise.all([
      pool.query<{ name: string; color: string }>(
        `select s.name, (array_agg(s.color order by p.position, p.short_name, b.position))[1] as color
           from states s
           join boards b on b.id = s.board_id
           join projects p on p.id = b.project_id
          where b.id <> all($1::uuid[]) and b.project_id <> all($2::uuid[])
            and ($3::text[] is null or p.short_name = any($3))
          group by s.name
          order by min(s.position), s.name`,
        seen
      ),
      pool.query<Cell>(
        `select b.id as board_id, b.name as board_name, b.slug, p.short_name,
                s.name as state_name, s.color, s.is_resolved,
                count(i.id) as n
           from boards b
           join projects p on p.id = b.project_id
           join states s on s.board_id = b.id
           left join issues i on i.board_id = b.id and i.state_id = s.id
            and ${onDays('i.created_at', '$5', '$6')}
${ISSUE_PICKS}
          where b.id <> all($1::uuid[]) and b.project_id <> all($2::uuid[])
            and ($3::text[] is null or p.short_name = any($3))
            and ($4::text[] is null or s.name = any($4))
          group by b.id, b.name, b.slug, b.position, p.short_name, p.position,
                   s.id, s.name, s.color, s.is_resolved, s.position
          order by p.position, p.short_name, b.position, s.position`,
        within
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
            and i.due_date between coalesce($5::date, '-infinity') and coalesce($6::date, 'infinity')
            and b.id <> all($1::uuid[]) and i.project_id <> all($2::uuid[])
            and ($3::text[] is null or p.short_name = any($3))
            and ($4::text[] is null or s.name = any($4))
${ISSUE_PICKS}
          order by i.due_date, i.readable_id`,
        within
      ),
      pool.query<PersonRow>(
        `select u.login, r.color as role_color,
                count(i.id) filter (
                  where i.resolved_at is null and ${onDays('i.created_at', '$5', '$6')}
                ) as open,
                count(i.id) filter (
                  where i.resolved_at is null and i.due_date < (now() at time zone '${ZONE}')::date
                    and ${onDays('i.created_at', '$5', '$6')}
                ) as late,
                count(i.id) filter (where ${onDays('i.resolved_at', '$5', '$6')}) as closed
           from users u
           left join roles r on r.id = u.role_id
           left join issues i on i.assignee_id = u.id
            and i.board_id <> all($1::uuid[]) and i.project_id <> all($2::uuid[])
            and ($3::text[] is null or i.project_id in (select id from projects where short_name = any($3)))
            and ($4::text[] is null or i.state_id in (select id from states where name = any($4)))
${ISSUE_PICKS}
          where u.active
            and ($8::text[] is null or u.login = any($8))
          group by u.login, r.color
          order by count(i.id) filter (
                     where i.resolved_at is null and ${onDays('i.created_at', '$5', '$6')}
                   ) desc, lower(u.login)`,
        within
      ),
      pool.query<HeldRow>(
        `select u.login, i.id, i.readable_id, i.summary, i.priority, i.due_date, i.created_at,
                i.board_id, p.short_name, b.slug, s.name as state_name, s.color
           from issues i
           join users u on u.id = i.assignee_id
           join projects p on p.id = i.project_id
           join boards b on b.id = i.board_id
           join states s on s.id = i.state_id
          where i.resolved_at is null and ${onDays('i.created_at', '$5', '$6')}
            and b.id <> all($1::uuid[]) and i.project_id <> all($2::uuid[])
            and ($3::text[] is null or p.short_name = any($3))
            and ($4::text[] is null or s.name = any($4))
${ISSUE_PICKS}
          order by lower(u.login), i.due_date nulls last, i.readable_id`,
        within
      ),
      pool.query<{ n: string }>(
        `select count(*) as n
           from issues i
           join projects p on p.id = i.project_id
          join states s on s.id = i.state_id
          where i.resolved_at is null and i.assignee_id is null and ${onDays('i.created_at', '$5', '$6')}
            and i.board_id <> all($1::uuid[]) and i.project_id <> all($2::uuid[])
            and ($3::text[] is null or p.short_name = any($3))
            and ($4::text[] is null or s.name = any($4))
${ISSUE_PICKS}`,
        within
      ),
      pool.query<{ priority: string; state_name: string; n: string }>(
        `select i.priority, s.name as state_name, count(*) as n
           from issues i
           join projects p on p.id = i.project_id
           join states s on s.id = i.state_id
          where i.resolved_at is null and ${onDays('i.created_at', '$5', '$6')}
            and i.board_id <> all($1::uuid[]) and i.project_id <> all($2::uuid[])
            and ($3::text[] is null or p.short_name = any($3))
            and ($4::text[] is null or s.name = any($4))
${ISSUE_PICKS}
          group by i.priority, s.name`,
        within
      ),
      pool.query<{ median: string | null; closed: string }>(
        `select percentile_cont(0.5) within group (
                  order by extract(epoch from (i.resolved_at - i.created_at)) / 86400
                ) as median,
                count(*) as closed
           from issues i
           join projects p on p.id = i.project_id
           join states s on s.id = i.state_id
          where i.resolved_at is not null and ${onDays('i.resolved_at', '$5', '$6')}
            and i.board_id <> all($1::uuid[]) and i.project_id <> all($2::uuid[])
            and ($3::text[] is null or p.short_name = any($3))
            and ($4::text[] is null or s.name = any($4))
${ISSUE_PICKS}`,
        within
      ),
      pool.query<{ month: string; median: string | null; closed: string; buckets: string[] }>(
        `select to_char(date_trunc('month', i.resolved_at at time zone '${ZONE}'), 'YYYY-MM') as month,
                percentile_cont(0.5) within group (order by t.secs / 86400) as median,
                count(*) as closed,
                array[
                  count(*) filter (where t.secs < 3600),
                  count(*) filter (where t.secs >= 3600 and t.secs < 86400),
                  count(*) filter (where t.secs >= 86400 and t.secs < 259200),
                  count(*) filter (where t.secs >= 259200 and t.secs < 604800),
                  count(*) filter (where t.secs >= 604800 and t.secs < 2592000),
                  count(*) filter (where t.secs >= 2592000)
                ] as buckets
           from issues i
           join projects p on p.id = i.project_id
           join states s on s.id = i.state_id
          cross join lateral (select extract(epoch from (i.resolved_at - i.created_at)) as secs) t
          where i.resolved_at is not null and ${onDays('i.resolved_at', '$5', '$6')}
            and i.board_id <> all($1::uuid[]) and i.project_id <> all($2::uuid[])
            and ($3::text[] is null or p.short_name = any($3))
            and ($4::text[] is null or s.name = any($4))
${ISSUE_PICKS}
          group by 1
          order by 1`,
        within
      ),
      workOf({
        boards: denied.boards,
        projects: denied.projects,
        projectNames: only,
        states: inState,
        tags: tagged,
        authors: writers,
        watchers,
        from,
        to,
      }),
      pool.query<{ start: Date | null; stop: Date | null }>(
        `select $1::date::timestamp at time zone '${ZONE}' as start,
                ($2::date + 1)::timestamp at time zone '${ZONE}' as stop`,
        [from, to]
      ),
    ]);

    const traced = held.rows.map((r) => r.id);
    const [handRows, palette] = await Promise.all([
      traced.length
        ? pool.query<HandRow>(
            `select issue_id, field, old_value, new_value, created_at
               from issue_history
              where issue_id = any($1::uuid[]) and field in ('assignee', 'status')
              order by issue_id, created_at`,
            [traced]
          )
        : { rows: [] as HandRow[] },
      held.rows.length
        ? pool.query<{ board_id: string; name: string; color: string }>(
            'select board_id, name, color from states where board_id = any($1::uuid[])',
            [[...new Set(held.rows.map((r) => r.board_id))]]
          )
        : { rows: [] as { board_id: string; name: string; color: string }[] },
    ]);
    const colors = new Map(palette.rows.map((r) => [`${r.board_id}:${r.name}`, r.color]));
    const changes = new Map<string, HandRow[]>();
    for (const row of handRows.rows) {
      const list = changes.get(row.issue_id);
      if (list) list.push(row);
      else changes.set(row.issue_id, [row]);
    }

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

    const holding = new Map<
      string,
      { key: string; summary: string; projectShort: string; boardSlug: string; color: string;
        stateName: string; priority: string; due: string | null; days: number; hands: Hand[] }[]
    >();
    for (const r of held.rows) {
      const hands = handsOf(
        r.created_at,
        r.login,
        r.state_name,
        changes.get(r.id) ?? [],
        (name) => colors.get(`${r.board_id}:${name}`) ?? null
      );
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
        days: mine.days,
        hands,
      });
      holding.set(r.login, list);
    }

    const start = bounds.rows[0]?.start?.getTime() ?? -Infinity;
    const stop = Math.min(bounds.rows[0]?.stop?.getTime() ?? Infinity, Date.now());
    const work = new Map<
      string,
      { key: string; summary: string; projectShort: string; boardSlug: string; color: string;
        states: { name: string; color: string | null; days: number }[]; days: number }[]
    >();
    for (const { issue: r, spans, colorOf } of worked) {
      const spent = new Map<string, { ms: number; states: Map<string, number> }>();
      for (const sp of spans) {
        const ms = Math.min(sp.to, stop) - Math.max(sp.from, start);
        if (ms <= 0) continue;
        const mine = spent.get(sp.login) ?? { ms: 0, states: new Map<string, number>() };
        mine.ms += ms;
        mine.states.set(sp.state, (mine.states.get(sp.state) ?? 0) + ms);
        spent.set(sp.login, mine);
      }
      for (const [login, { ms, states: inState }] of spent) {
        const lasting = [...inState].filter(([, held]) => held >= MINUTE_MS);
        const shown = lasting.length ? lasting : [...inState].sort((a, b) => b[1] - a[1]).slice(0, 1);
        const list = work.get(login) ?? [];
        list.push({
          key: r.readable_id,
          summary: r.summary,
          projectShort: r.short_name,
          boardSlug: r.slug,
          color: r.color,
          states: shown.map(([name, held]) => ({ name, color: colorOf(name), days: held / DAY_MS })),
          days: ms / DAY_MS,
        });
        work.set(login, list);
      }
    }
    const roleColors = new Map(people.rows.map((r) => [r.login, r.role_color]));

    const where = (r: DueRow) => ({
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
        statuses: statuses.rows.map((r) => ({ name: r.name, color: r.color })),
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
        worked: [...work]
          .filter(([login]) => !people_ || people_.includes(login))
          .map(([login, issues]) => ({
            login,
            color: roleColors.get(login) ?? null,
            days: issues.reduce((all, i) => all + i.days, 0),
            issues: issues.sort((a, b) => b.days - a.days),
          }))
          .sort((a, b) => b.days - a.days || a.login.localeCompare(b.login)),
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
            buckets: r.buckets.map(Number),
          })),
        },
      },
    });
  });
}
