alter table users add column if not exists star_created boolean not null default false;
alter table users add column if not exists star_assigned boolean not null default false;
alter table users add column if not exists star_commented boolean not null default false;

create index if not exists notices_starred_idx
  on notices (user_id, issue_id, by_id, created_at) where kind = 'starred' and comment_id is null;
