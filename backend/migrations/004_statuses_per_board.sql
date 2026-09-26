-- Statuses move from the project to the board. A board is no longer a saved filter over shared columns: it owns its columns, the way Kaiten and Trello do, so one project can run a dev board with four statuses beside an art board with seven. An issue therefore lives on one board, and its status is that board's.

alter table boards add column if not exists default_state_id uuid;
alter table states add column if not exists board_id uuid references boards(id) on delete cascade;

-- Every project that had statuses but no board gets one to hold them.
insert into boards (project_id, name, position)
select p.id, 'Board', 0
  from projects p
 where not exists (select 1 from boards b where b.project_id = p.id);

-- Existing statuses land on the project's first board, in the order they already had.
update states s
   set board_id = (
     select b.id from boards b
      where b.project_id = s.project_id
      order by b.position, b.name
      limit 1
   )
 where s.board_id is null;

delete from states where board_id is null;

-- The board inherits the default the project used to carry, or its first status.
update boards b
   set default_state_id = coalesce(
     (select p.default_state_id from projects p
       where p.id = b.project_id
         and exists (select 1 from states s where s.id = p.default_state_id and s.board_id = b.id)),
     (select s.id from states s where s.board_id = b.id order by s.position limit 1)
   );

alter table states alter column board_id set not null;
alter table states drop constraint if exists states_project_id_name_key;
alter table states drop column if exists project_id;
create unique index if not exists states_board_name_idx on states (board_id, lower(name));

alter table projects drop constraint if exists projects_default_state_fk;
alter table projects drop column if exists default_state_id;

alter table boards
  add constraint boards_default_state_fk
  foreign key (default_state_id) references states(id) on delete set null;

-- A board is a container now, not a stored query.
alter table boards drop column if exists filter_json;

-- Which board an issue sits on. There are no issues yet, so the column lands filled-in-advance rather than backfilled.
alter table issues add column if not exists board_id uuid references boards(id) on delete cascade;
create index if not exists issues_board_idx on issues (board_id, state_id);
