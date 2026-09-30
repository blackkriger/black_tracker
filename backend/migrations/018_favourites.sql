create table if not exists issue_favourites (
  issue_id   uuid not null references issues (id) on delete cascade,
  user_id    uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (issue_id, user_id)
);

create index if not exists issue_favourites_user_idx on issue_favourites (user_id);
