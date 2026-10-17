create table if not exists project_builds (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects (id) on delete cascade,
  name         text not null,
  storage_path text,
  size         bigint,
  url          text,
  uploaded_by  uuid references users (id) on delete set null,
  created_at   timestamptz not null default now(),
  check ((storage_path is null) <> (url is null))
);
create index if not exists project_builds_project_idx on project_builds (project_id, created_at desc);
