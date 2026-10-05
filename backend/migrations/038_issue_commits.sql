create table if not exists issue_commits (
  id          uuid primary key default gen_random_uuid(),
  issue_id    uuid not null references issues (id) on delete cascade,
  kind        text not null check (kind in ('commit', 'merge')),
  repo        text not null,
  sha         text not null,
  message     text not null,
  branch      text,
  merged_from text,
  author_name text,
  author_login text,
  at          timestamptz not null,
  created_at  timestamptz not null default now(),
  unique (issue_id, sha)
);

create index if not exists issue_commits_issue_idx on issue_commits (issue_id, at);
