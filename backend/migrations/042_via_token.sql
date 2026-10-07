alter table issue_history add column if not exists via_token boolean not null default false;
alter table issue_comments add column if not exists via_token boolean not null default false;
