import { pool, ZONE } from './db.js';

export interface WorkIssue {
  id: string;
  login: string | null;
  board_id: string;
  project_id: string;
  readable_id: string;
  summary: string;
  created_at: Date;
  short_name: string;
  slug: string;
  state_name: string;
  color: string;
}

interface StateKind {
  board_id: string;
  project_id: string;
  name: string;
  color: string;
  is_resolved: boolean;
  starting: boolean;
}

export interface HandRow {
  issue_id: string;
  field: 'assignee' | 'status';
  old_value: string | null;
  new_value: string | null;
  created_at: Date;
}

export interface Stretch {
  from: number;
  to: number;
  name: string | null;
}

export interface WorkSpan {
  login: string;
  state: string;
  from: number;
  to: number;
}

export interface Worked {
  issue: WorkIssue;
  spans: WorkSpan[];
  colorOf: (state: string) => string | null;
}

export interface WorkFilter {
  boards: string[];
  projects: string[];
  projectNames?: string[] | null;
  states?: string[] | null;
  tags?: string[] | null;
  authors?: string[] | null;
  watchers?: string[] | null;
  from: string | null;
  to: string | null;
  login?: string | null;
}

export function stretchesOf(born: number, now: string | null, changes: HandRow[]): Stretch[] {
  const out: Stretch[] = [];
  let since = born;
  let what = changes.length ? changes[0].old_value : now;
  for (const change of changes) {
    const at = change.created_at.getTime();
    out.push({ from: since, to: at, name: what });
    what = change.new_value;
    since = at;
  }
  out.push({ from: since, to: Date.now(), name: what });
  return out;
}

export async function workOf(f: WorkFilter): Promise<Worked[]> {
  const issues = await pool.query<WorkIssue>(
    `select i.id, u.login, i.board_id, i.project_id, i.readable_id, i.summary, i.created_at,
            p.short_name, b.slug, s.name as state_name, s.color
       from issues i
       join projects p on p.id = i.project_id
       join boards b on b.id = i.board_id
       join states s on s.id = i.state_id
       left join users u on u.id = i.assignee_id
      where i.created_at < coalesce(($5::date + 1)::timestamp at time zone '${ZONE}', 'infinity')
        and (i.resolved_at is null
             or i.resolved_at >= coalesce($4::date::timestamp at time zone '${ZONE}', '-infinity'))
        and b.id <> all($1::uuid[]) and i.project_id <> all($2::uuid[])
        and ($3::text[] is null or p.short_name = any($3))
        and ($6::uuid[] is null or (
              select count(*) from issue_tags it where it.issue_id = i.id and it.tag_id = any($6)
            ) = cardinality($6))
        and ($7::text is null or u.login = $7 or exists (
              select 1 from issue_history ah
               where ah.issue_id = i.id and ah.field = 'assignee'
                 and (ah.old_value = $7 or ah.new_value = $7)
            ))
        and ($8::text[] is null or s.name = any($8))
        and ($9::text[] is null or i.author_id in (select id from users where login = any($9)))
        and ($10::text[] is null or i.watcher_id in (select id from users where login = any($10)))`,
    [
      f.boards,
      f.projects,
      f.projectNames ?? null,
      f.from,
      f.to,
      f.tags ?? null,
      f.login ?? null,
      f.states ?? null,
      f.authors ?? null,
      f.watchers ?? null,
    ]
  );
  if (!issues.rows.length) return [];

  const [history, kinds] = await Promise.all([
    pool.query<HandRow>(
      `select issue_id, field, old_value, new_value, created_at
         from issue_history
        where issue_id = any($1::uuid[]) and field in ('assignee', 'status')
        order by issue_id, created_at`,
      [issues.rows.map((r) => r.id)]
    ),
    pool.query<StateKind>(
      `select s.board_id, b.project_id, s.name, s.color, s.is_resolved,
              s.id = coalesce(b.default_state_id, (
                select f.id from states f where f.board_id = b.id order by f.position, f.name limit 1
              )) as starting
         from states s
         join boards b on b.id = s.board_id
        where b.project_id = any($1::uuid[])
        order by b.position, s.position`,
      [[...new Set(issues.rows.map((r) => r.project_id))]]
    ),
  ]);

  const changes = new Map<string, HandRow[]>();
  for (const row of history.rows) {
    const list = changes.get(row.issue_id);
    if (list) list.push(row);
    else changes.set(row.issue_id, [row]);
  }
  const onBoard = new Map<string, StateKind>();
  const inProject = new Map<string, StateKind>();
  for (const k of kinds.rows) {
    onBoard.set(`${k.board_id}:${k.name}`, k);
    if (!inProject.has(`${k.project_id}:${k.name}`)) inProject.set(`${k.project_id}:${k.name}`, k);
  }
  const kindOf = (r: WorkIssue, name: string | null): StateKind | undefined =>
    name ? (onBoard.get(`${r.board_id}:${name}`) ?? inProject.get(`${r.project_id}:${name}`)) : undefined;
  const working = (r: WorkIssue, name: string | null): boolean => {
    const kind = kindOf(r, name);
    return !!kind && !kind.is_resolved && !kind.starting;
  };

  return issues.rows.map((r) => {
    const trail = changes.get(r.id) ?? [];
    const born = r.created_at.getTime();
    const hands = stretchesOf(born, r.login, trail.filter((c) => c.field === 'assignee'));
    const states = stretchesOf(born, r.state_name, trail.filter((c) => c.field === 'status')).filter(
      (st) => working(r, st.name)
    );
    const spans: WorkSpan[] = [];
    for (const h of hands) {
      if (!h.name || (f.login && h.name !== f.login)) continue;
      for (const st of states) {
        const from = Math.max(h.from, st.from);
        const to = Math.min(h.to, st.to);
        if (to > from && st.name) spans.push({ login: h.name, state: st.name, from, to });
      }
    }
    return { issue: r, spans, colorOf: (state: string) => kindOf(r, state)?.color ?? null };
  });
}
