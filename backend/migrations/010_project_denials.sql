create table if not exists project_denials (
  project_id uuid not null references projects (id) on delete cascade,
  role_id    uuid not null references roles (id) on delete cascade,
  primary key (project_id, role_id)
);
