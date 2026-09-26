-- Access is given a project at a time or a board at a time: a role can be shut out of a whole project — everything in it, including boards made later — or of single boards inside a project it does otherwise have.

create table if not exists project_denials (
  project_id uuid not null references projects (id) on delete cascade,
  role_id    uuid not null references roles (id) on delete cascade,
  primary key (project_id, role_id)
);
