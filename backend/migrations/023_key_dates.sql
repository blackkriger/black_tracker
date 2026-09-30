create table if not exists key_dates (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid references projects (id) on delete cascade,
  day        date not null,
  title      text not null,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists key_dates_day_idx on key_dates (day);

create index if not exists issue_history_at_idx on issue_history (created_at);
