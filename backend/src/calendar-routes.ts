// The calendar: days somebody marked, deadlines the issues already carry, and how much
// work went through each day. Nothing here is a new source of truth except the marks —
// the rest is what the tracker already knows, read a month at a time.

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import { requireAuth, requireDeleter, type Auth } from './auth.js';
import { DENIES_NOTHING, deniedFor, mayOpenProject } from './board-service.js';
import { projectByShort } from './project-routes.js';

// The team's day, not the server's: Berlin midnight would put an hour of the evening's
// work on the day before. Nothing else here is a moment in time — the rest are dates.
const ZONE = 'Europe/Moscow';

const range = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// Only http and https ever reach an href of ours: anything else is a way to run script.
const address = z
  .string()
  .trim()
  .max(500)
  .regex(/^https?:\/\//i, 'A link starts with http:// or https://')
  .nullable()
  .optional();

const markBody = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().trim().min(1).max(120),
  /** A project's key, or absent for a day that belongs to the whole workshop. */
  project: z.string().trim().max(20).nullable().optional(),
  /** The event's own page, and the picture it shows itself with. */
  url: address,
  banner: address,
});

const markPatch = markBody.partial();

interface MarkRow {
  id: string;
  day: Date | string;
  title: string;
  url: string | null;
  banner: string | null;
  short_name: string | null;
  project_name: string | null;
  by_login: string | null;
}

const publicMark = (r: MarkRow) => ({
  id: r.id,
  day: iso(r.day),
  title: r.title,
  url: r.url,
  banner: r.banner,
  project: r.short_name ? { shortName: r.short_name, name: r.project_name ?? '' } : null,
  by: r.by_login,
});

/** A date column arrives as 'YYYY-MM-DD' already; a timestamp arrives as a Date. Both are wanted as the day alone. */
function iso(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/** What this person cannot open, as two arrays the queries can test against. */
async function shutOut(auth: Auth): Promise<{ all: boolean; projects: string[]; boards: string[] }> {
  const denied = auth.isAdmin ? DENIES_NOTHING : await deniedFor(auth.roleId);
  return { all: denied.everything, projects: [...denied.projects], boards: [...denied.boards] };
}

export function registerCalendarRoutes(app: FastifyInstance): void {
  // Everything one screenful of calendar needs, in one read.
  app.get('/calendar', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const parsed = range.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Send from and to as dates.' });
    const { from, to } = parsed.data;
    const who = (req.query as { user?: string }).user ?? null;
    const denied = await shutOut(auth);

    if (denied.all) {
      return reply.send({ data: { marks: [], dues: [], activity: [], mentions: [] } });
    }

    const [marks, dues, activity, mentions] = await Promise.all([
      pool.query<MarkRow>(
        `select k.id, k.day, k.title, k.url, k.banner,
                p.short_name, p.name as project_name, u.login as by_login
           from key_dates k
           left join projects p on p.id = k.project_id
           left join users u on u.id = k.created_by
          where k.day between $1 and $2
            and (k.project_id is null or k.project_id <> all($3::uuid[]))
          order by k.day, lower(k.title)`,
        [from, to, denied.projects]
      ),
      pool.query<{
        id: string;
        readable_id: string;
        summary: string;
        due_date: Date | string;
        short_name: string;
        board_id: string;
        slug: string;
        state_color: string;
        resolved_at: Date | null;
      }>(
        `select i.id, i.readable_id, i.summary, i.due_date, p.short_name, b.id as board_id, b.slug,
                s.color as state_color, i.resolved_at
           from issues i
           join projects p on p.id = i.project_id
           join boards b on b.id = i.board_id
           join states s on s.id = i.state_id
          where i.due_date between $1 and $2
            and i.project_id <> all($3::uuid[])
            and i.board_id <> all($4::uuid[])
          order by i.due_date, i.readable_id`,
        [from, to, denied.projects, denied.boards]
      ),
      // What a day of work looks like: the issues someone touched, opened and closed.
      // The history is the only record of who did what and when, and time is not tracked
      // here — an issue somebody touched at all is an issue they worked on.
      pool.query<{
        day: Date | string;
        login: string;
        worked: number;
        created: number;
        resolved: number;
      }>(
        `select (h.created_at at time zone '${ZONE}')::date as day,
                u.login,
                count(distinct h.issue_id)::int as worked,
                count(distinct h.issue_id) filter (where h.field = 'created')::int as created,
                count(distinct h.issue_id) filter (
                  where h.field = 'status'
                    and (i.resolved_at at time zone '${ZONE}')::date
                      = (h.created_at at time zone '${ZONE}')::date
                )::int as resolved
           from issue_history h
           join issues i on i.id = h.issue_id
           join users u on u.id = h.user_id
          where (h.created_at at time zone '${ZONE}')::date between $1::date and $2::date
            and ($3::text is null or u.login = $3)
            and i.project_id <> all($4::uuid[])
            and i.board_id <> all($5::uuid[])
          group by 1, 2
          order by 1`,
        [from, to, who, denied.projects, denied.boards]
      ),
      // What was said to the reader is the reader's own business, so this one is never
      // about the person picked.
      pool.query<{ day: Date | string; said: number; unread: number }>(
        `select (n.created_at at time zone '${ZONE}')::date as day,
                count(*)::int as said,
                count(*) filter (where n.read_at is null)::int as unread
           from notices n
           join issue_comments c on c.id = n.comment_id
           join issues i on i.id = c.issue_id
          where n.user_id = $1
            and (n.created_at at time zone '${ZONE}')::date between $2::date and $3::date
            and i.project_id <> all($4::uuid[])
            and i.board_id <> all($5::uuid[])
          group by 1`,
        [auth.userId, from, to, denied.projects, denied.boards]
      ),
    ]);

    const byDay = new Map<
      string,
      {
        key: string;
        summary: string;
        projectShort: string;
        boardId: string;
        boardSlug: string;
        color: string;
        done: boolean;
      }[]
    >();
    for (const d of dues.rows) {
      const day = iso(d.due_date);
      const list = byDay.get(day) ?? [];
      list.push({
        key: d.readable_id,
        summary: d.summary,
        projectShort: d.short_name,
        boardId: d.board_id,
        boardSlug: d.slug,
        color: d.state_color,
        done: d.resolved_at !== null,
      });
      byDay.set(day, list);
    }

    return reply.send({
      data: {
        marks: marks.rows.map(publicMark),
        dues: [...byDay].map(([day, issues]) => ({ day, issues })),
        activity: activity.rows.map((a) => ({
          day: iso(a.day),
          login: a.login,
          worked: a.worked,
          created: a.created,
          resolved: a.resolved,
        })),
        mentions: mentions.rows.map((m) => ({
          day: iso(m.day),
          said: m.said,
          unread: m.unread,
        })),
      },
    });
  });

  // The next day worth knowing about, for the chip in the top bar.
  app.get('/calendar/next', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const denied = await shutOut(auth);
    if (denied.all) return reply.send({ data: null });
    const res = await pool.query<MarkRow>(
      `select k.id, k.day, k.title, k.url, k.banner,
              p.short_name, p.name as project_name, u.login as by_login
         from key_dates k
         left join projects p on p.id = k.project_id
         left join users u on u.id = k.created_by
        where k.day >= (now() at time zone '${ZONE}')::date
          and (k.project_id is null or k.project_id <> all($1::uuid[]))
        order by k.day, lower(k.title)
        limit 1`,
      [denied.projects]
    );
    return reply.send({ data: res.rowCount ? publicMark(res.rows[0]) : null });
  });

  app.post('/key-dates', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const parsed = markBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad date.' });
    }
    const projectId = await scopeOf(auth, reply, parsed.data.project);
    if (projectId === undefined) return;
    const res = await pool.query<{ id: string }>(
      `insert into key_dates (project_id, day, title, url, banner, created_by)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [
        projectId,
        parsed.data.day,
        parsed.data.title,
        parsed.data.url ?? null,
        parsed.data.banner ?? null,
        auth.userId,
      ]
    );
    return reply.code(201).send({ data: await markById(res.rows[0].id) });
  });

  app.patch('/key-dates/:id', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = markPatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad date.' });
    }
    const current = await pool.query<{ project_id: string | null }>(
      'select project_id from key_dates where id = $1',
      [id]
    );
    if (!current.rowCount) return reply.code(404).send({ error: 'No such date.' });
    if (!(await mayReachMark(auth, current.rows[0].project_id))) {
      return reply.code(404).send({ error: 'No such date.' });
    }
    let projectId: string | null | undefined = undefined;
    if (parsed.data.project !== undefined) {
      projectId = await scopeOf(auth, reply, parsed.data.project);
      if (projectId === undefined) return;
    }
    await pool.query(
      `update key_dates
          set day = coalesce($2, day),
              title = coalesce($3, title),
              project_id = case when $4 then $5::uuid else project_id end,
              url = case when $6 then $7 else url end,
              banner = case when $8 then $9 else banner end
        where id = $1`,
      [
        id,
        parsed.data.day ?? null,
        parsed.data.title ?? null,
        projectId !== undefined,
        projectId ?? null,
        parsed.data.url !== undefined,
        parsed.data.url ?? null,
        parsed.data.banner !== undefined,
        parsed.data.banner ?? null,
      ]
    );
    return reply.send({ data: await markById(id) });
  });

  app.delete('/key-dates/:id', async (req, reply) => {
    const auth = await requireDeleter(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const current = await pool.query<{ project_id: string | null }>(
      'select project_id from key_dates where id = $1',
      [id]
    );
    if (!current.rowCount) return reply.code(404).send({ error: 'No such date.' });
    if (!(await mayReachMark(auth, current.rows[0].project_id))) {
      return reply.code(404).send({ error: 'No such date.' });
    }
    await pool.query('delete from key_dates where id = $1', [id]);
    return reply.send({ data: { ok: true } });
  });
}

async function markById(id: string) {
  const res = await pool.query<MarkRow>(
    `select k.id, k.day, k.title, k.url, k.banner,
            p.short_name, p.name as project_name, u.login as by_login
       from key_dates k
       left join projects p on p.id = k.project_id
       left join users u on u.id = k.created_by
      where k.id = $1`,
    [id]
  );
  return publicMark(res.rows[0]);
}

async function mayReachMark(auth: Auth, projectId: string | null): Promise<boolean> {
  if (auth.isAdmin) return true;
  if (projectId) return mayOpenProject(auth, projectId);
  return !(await deniedFor(auth.roleId)).everything;
}

/**
 * Turns the project key a write carried into an id, answering the caller itself when the
 * scope is not theirs. `undefined` means the reply has already gone out.
 */
async function scopeOf(
  auth: Auth,
  reply: FastifyReply,
  project?: string | null
): Promise<string | null | undefined> {
  if (!project) {
    if (!auth.isAdmin && (await deniedFor(auth.roleId)).everything) {
      reply.code(403).send({ error: 'Marking a day is not open to your role.' });
      return undefined;
    }
    return null;
  }
  const row = await projectByShort(project);
  if (!row || !(await mayOpenProject(auth, row.id))) {
    reply.code(404).send({ error: 'No such project.' });
    return undefined;
  }
  return row.id;
}
