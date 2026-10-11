alter table user_notes add column if not exists width int;
update user_notes set color = 'amber' where color not in ('amber', 'blue', 'green', 'pink');
alter table user_notes drop constraint if exists user_notes_color_check;
alter table user_notes add constraint user_notes_color_check check (color in ('amber', 'blue', 'green', 'pink'));
