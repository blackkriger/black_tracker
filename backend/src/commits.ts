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
  const unique = new Map<string, CommitEvent>();
  for (const e of events) {
    const id = `${e.repo}
${e.sha}`;
    const seen = unique.get(id);
    if (seen) unique.set(id, { ...seen, keys: [...seen.keys, ...e.keys] });
    else unique.set(id, e);
  }
  const commits = [...unique.values()];
  const stored = await pool.query<{ id: string; repo: string; sha: string }>(
    `insert into repo_commits (repo, sha, kind, message, branch, merged_from, author_name, author_login, at)
     select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::timestamptz[])
     on conflict (repo, sha) do update set repo = excluded.repo
     returning id, repo, sha`,
    [
      commits.map((e) => e.repo),
      commits.map((e) => e.sha),
      commits.map((e) => e.kind),
      commits.map((e) => e.message.slice(0, 4000)),
      commits.map((e) => e.branch),
      commits.map((e) => e.mergedFrom),
      commits.map((e) => e.authorName),
      commits.map((e) => e.authorLogin),
      commits.map((e) => e.at),
    ]
  );
  const commitIds = new Map(stored.rows.map((r) => [`${r.repo}
${r.sha}`, r.id]));
  const pairs = new Map<string, { issueId: string; commitId: string }>();
  for (const e of commits) {
    const commitId = commitIds.get(`${e.repo}
${e.sha}`);
    if (!commitId) continue;
    for (const key of e.keys) {
      const issue = byKey.get(key);
      if (issue) pairs.set(`${issue.id}:${commitId}`, { issueId: issue.id, commitId });
    }
  }
  if (!pairs.size) return [];
  const made = await pool.query<{ issue_id: string }>(
    `insert into issue_commits (issue_id, commit_id)
     select v.issue_id, v.commit_id from unnest($1::uuid[], $2::uuid[]) as v(issue_id, commit_id)
      where not exists (
              select 1 from commit_unlinks u where u.issue_id = v.issue_id and u.commit_id = v.commit_id
            )
     on conflict (issue_id, commit_id) do nothing
     returning issue_id`,
    [[...pairs.values()].map((p) => p.issueId), [...pairs.values()].map((p) => p.commitId)]
  );
  const linked = new Map<string, Linked>();
  const byId = new Map(issues.rows.map((r) => [r.id, r]));
  for (const { issue_id: issueId } of made.rows) {
    const issue = byId.get(issueId);
    if (issue) {
      linked.set(issueId, {
        issueId,
        issueKey: issue.readable_id,
        boardId: issue.board_id,
        projectId: issue.project_id,
      });
    }
  }
  return [...linked.values()];
}
