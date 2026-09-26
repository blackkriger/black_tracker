-- Boards were addressed by their uuid, so a board's address was thirty-six characters of noise. They get a slug instead, unique inside the project, the way the project itself has a short key.

alter table boards add column if not exists slug text;

update boards
   set slug = coalesce(
     nullif(trim(both '-' from lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))), ''),
     'board'
   )
 where slug is null;

-- A name that slugs to something another board in the project already took gets a counter, in the order the boards sit.
with numbered as (
  select id, row_number() over (partition by project_id, slug order by position, id) as n
    from boards
)
update boards b
   set slug = b.slug || '-' || numbered.n::text
  from numbered
 where numbered.id = b.id and numbered.n > 1;

alter table boards alter column slug set not null;
create unique index if not exists boards_project_slug_idx on boards (project_id, lower(slug));
