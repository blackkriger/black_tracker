alter table issues add column if not exists via_bot boolean not null default false;

create table if not exists telegram_drafts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  chat_id     bigint not null,
  message_id  bigint,
  summary     text not null,
  description text not null default '',
  files       jsonb not null default '[]',
  boards      uuid[] not null,
  created_at  timestamptz not null default now()
);
