create table if not exists repo_commits (
  id           uuid primary key default gen_random_uuid(),
  repo         text not null,
  sha          text not null,
  kind         text not null check (kind in ('commit', 'merge')),
  message      text not null,
  branch       text,
  merged_from  text,
  author_name  text,
  author_login text,
  at           timestamptz not null,
  created_at   timestamptz not null default now(),
  unique (repo, sha)
);
create index if not exists repo_commits_at_idx on repo_commits (at desc);

insert into repo_commits (repo, sha, kind, message, branch, merged_from, author_name, author_login, at, created_at)
select distinct on (repo, sha) repo, sha, kind, message, branch, merged_from, author_name, author_login, at, created_at
  from issue_commits
 order by repo, sha, created_at
on conflict (repo, sha) do nothing;

alter table issue_commits add column if not exists commit_id uuid references repo_commits (id) on delete cascade;
update issue_commits ic set commit_id = rc.id from repo_commits rc where rc.repo = ic.repo and rc.sha = ic.sha;
alter table issue_commits alter column commit_id set not null;
alter table issue_commits drop constraint if exists issue_commits_issue_id_sha_key;
drop index if exists issue_commits_issue_idx;
alter table issue_commits
  drop column kind,
  drop column repo,
  drop column sha,
  drop column message,
  drop column branch,
  drop column merged_from,
  drop column author_name,
  drop column author_login,
  drop column at;
alter table issue_commits add constraint issue_commits_issue_commit_key unique (issue_id, commit_id);
create index if not exists issue_commits_commit_idx on issue_commits (commit_id);

create table if not exists commit_unlinks (
  issue_id  uuid not null references issues (id) on delete cascade,
  commit_id uuid not null references repo_commits (id) on delete cascade,
  primary key (issue_id, commit_id)
);

alter table projects add column if not exists repo text unique;
