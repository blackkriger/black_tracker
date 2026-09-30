create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  login         text not null unique,
  full_name     text not null default '',
  password_hash text not null,
  api_token     text unique,
  role          text not null default 'member' check (role in ('admin', 'member')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);

create table if not exists projects (
  id                uuid primary key default gen_random_uuid(),
  short_name        varchar(20) not null unique,
  name              text not null,
  description       text not null default '',
  next_issue_number integer not null default 1,
  default_state_id  uuid,
  archived          boolean not null default false,
  position          integer not null default 0,
  created_at        timestamptz not null default now()
);

create table if not exists states (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null,
  position    integer not null default 0,
  is_open     boolean not null default true,
  is_resolved boolean not null default false,
  color       text not null default '#71767b',
  unique (project_id, name)
);

alter table projects
  drop constraint if exists projects_default_state_fk;
alter table projects
  add constraint projects_default_state_fk
  foreign key (default_state_id) references states(id) on delete set null;

create table if not exists issues (
  id          uuid primary key default gen_random_uuid(),
  readable_id varchar(30) not null unique,
  project_id  uuid not null references projects(id) on delete cascade,
  number      integer not null,
  summary     text not null,
  description text not null default '',
  state_id    uuid not null references states(id),
  priority    text not null default 'Normal' check (priority in ('Critical', 'Major', 'Normal', 'Minor')),
  assignee_id uuid references users(id) on delete set null,
  reporter_id uuid references users(id) on delete set null,
  due_date    date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  resolved_at timestamptz,
  unique (project_id, number)
);

create index if not exists issues_board_idx on issues (project_id, state_id);
create index if not exists issues_assignee_idx on issues (assignee_id);
create index if not exists issues_updated_idx on issues (updated_at desc);

create table if not exists issue_comments (
  id         uuid primary key default gen_random_uuid(),
  issue_id   uuid not null references issues(id) on delete cascade,
  author_id  uuid not null references users(id) on delete cascade,
  text       text not null,
  created_at timestamptz not null default now(),
  edited_at  timestamptz
);

create index if not exists issue_comments_issue_idx on issue_comments (issue_id, created_at);

create table if not exists issue_attachments (
  id           uuid primary key default gen_random_uuid(),
  issue_id     uuid not null references issues(id) on delete cascade,
  comment_id   uuid references issue_comments(id) on delete cascade,
  filename     text not null,
  mime         text not null,
  size         bigint not null,
  storage_path text not null,
  uploaded_by  uuid references users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists issue_attachments_issue_idx on issue_attachments (issue_id, created_at);

create table if not exists issue_history (
  id         uuid primary key default gen_random_uuid(),
  issue_id   uuid not null references issues(id) on delete cascade,
  user_id    uuid references users(id) on delete set null,
  field      text not null,
  old_value  text,
  new_value  text,
  created_at timestamptz not null default now()
);

create index if not exists issue_history_issue_idx on issue_history (issue_id, created_at desc);

create table if not exists tags (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  name       text not null,
  color      text not null default '#71767b'
);

create unique index if not exists tags_project_name_idx
  on tags (project_id, lower(name)) where project_id is not null;
create unique index if not exists tags_global_name_idx
  on tags (lower(name)) where project_id is null;

create table if not exists issue_tags (
  issue_id uuid not null references issues(id) on delete cascade,
  tag_id   uuid not null references tags(id) on delete cascade,
  primary key (issue_id, tag_id)
);

create table if not exists boards (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null,
  filter_json jsonb not null default '{}'::jsonb,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists board_denials (
  board_id uuid not null references boards(id) on delete cascade,
  user_id  uuid not null references users(id) on delete cascade,
  primary key (board_id, user_id)
);

create table if not exists sessions (
  token      text primary key,
  user_id    uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_idx on sessions (user_id);
