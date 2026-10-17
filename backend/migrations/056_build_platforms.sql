alter table project_builds
  add column if not exists platform text not null default 'windows' check (platform in ('windows', 'macos'));
alter table project_builds alter column platform drop default;
drop index if exists project_builds_project_idx;
create unique index if not exists project_builds_platform_key on project_builds (project_id, platform);
