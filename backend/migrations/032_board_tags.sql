create temporary table tag_merge on commit drop as
select t.id, s.survivor
  from tags t
  join (
    select lower(name) as key,
           (array_agg(id order by (project_id is null) desc, id))[1] as survivor
      from tags
     group by lower(name)
  ) s on s.key = lower(t.name)
 where t.id <> s.survivor;

insert into issue_tags (issue_id, tag_id)
select it.issue_id, m.survivor
  from issue_tags it
  join tag_merge m on m.id = it.tag_id
on conflict do nothing;

delete from tags where id in (select id from tag_merge);

create table if not exists board_tags (
  board_id uuid not null references boards (id) on delete cascade,
  tag_id   uuid not null references tags (id) on delete cascade,
  primary key (board_id, tag_id)
);

insert into board_tags (board_id, tag_id)
select b.id, t.id
  from boards b
  join tags t on t.project_id is null or t.project_id = b.project_id
on conflict do nothing;

drop index if exists tags_project_name_idx;
drop index if exists tags_global_name_idx;
alter table tags drop column if exists project_id;
create unique index if not exists tags_name_idx on tags (lower(name));
