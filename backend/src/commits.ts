import { pool } from './db.js';

export interface CommitEvent {
  repo: string;
  sha: string;
  kind: 'commit' | 'merge';
  message: string;
  branch: string | null;
  mergedFrom: string | null;
  authorName: string | null;
  authorLogin: string | null;
  at: string;
  keys: string[];
}

export interface Linked {
  issueId: string;
  issueKey: string;
  boardId: string;
  projectId: string;
}

const NOREPLY = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i;

export function loginOf(email: string | null | undefined, username?: string | null): string | null {
  if (username) return username;
  const hit = email ? NOREPLY.exec(email) : null;
  return hit ? hit[1] : null;
}

export async function projectKeys(): Promise<string[]> {
  const res = await pool.query<{ short_name: string }>('select short_name from projects');
  return res.rows.map((r) => r.short_name);
}

export function keysIn(text: string, keys: string[]): string[] {
  if (!keys.length || !text) return [];
  const pattern = new RegExp(`(?<![A-Za-z0-9])(${keys.join('|')})[-\\s]?(\\d+)(?![0-9])`, 'gi');
  const found = new Set<string>();
  for (const m of text.matchAll(pattern)) found.add(`${m[1].toUpperCase()}-${Number(m[2])}`);
  return [...found];
}

const MERGED = /^Merge (?:branch|remote-tracking branch) '([^']+)'(?: of \S+)?(?: into (\S+))?|^Merge pull request #\d+ from [^/\s]+\/(\S+)/;

export function mergeOf(message: string): { from: string; into: string | null } | null {
  const hit = MERGED.exec(message.split('\n')[0] ?? '');
  if (!hit) return null;
  return { from: (hit[1] ?? hit[3]).replace(/^origin\//, ''), into: hit[2] ?? null };
}

export async function recordCommits(events: CommitEvent[]): Promise<Linked[]> {
  if (!events.length) return [];
  const wanted = [...new Set(events.flatMap((e) => e.keys))];
  const issues = wanted.length
    ? await pool.query<{ id: string; readable_id: string; board_id: string; project_id: string }>(
        'select id, readable_id, board_id, project_id from issues where readable_id = any($1::text[])',
        [wanted]
      )
    : { rows: [] };
  const byKey = new Map(issues.rows.map((r) => [r.readable_id, r]));
  const linked = new Map<string, Linked>();
  for (const e of events) {
    const stored = await pool.query<{ id: string }>(
      `insert into repo_commits (repo, sha, kind, message, branch, merged_from, author_name, author_login, at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (repo, sha) do update set repo = excluded.repo
       returning id`,
      [e.repo, e.sha, e.kind, e.message.slice(0, 4000), e.branch, e.mergedFrom, e.authorName, e.authorLogin, e.at]
    );
    const commitId = stored.rows[0].id;
    for (const key of new Set(e.keys)) {
      const issue = byKey.get(key);
      if (!issue) continue;
      const res = await pool.query(
        `insert into issue_commits (issue_id, commit_id)
         select $1, $2
          where not exists (select 1 from commit_unlinks where issue_id = $1 and commit_id = $2)
         on conflict (issue_id, commit_id) do nothing`,
        [issue.id, commitId]
      );
      if (res.rowCount) {
        linked.set(issue.id, {
          issueId: issue.id,
          issueKey: issue.readable_id,
          boardId: issue.board_id,
          projectId: issue.project_id,
        });
      }
    }
  }
  return [...linked.values()];
}
