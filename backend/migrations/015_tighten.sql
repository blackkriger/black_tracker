update issues i
   set board_id = (select b.id from boards b where b.project_id = i.project_id order by b.position limit 1)
 where board_id is null;

delete from issues where board_id is null;

alter table issues alter column board_id set not null;

create unique index if not exists users_login_lower_idx on users (lower(login));
