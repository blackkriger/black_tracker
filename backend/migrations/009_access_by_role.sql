delete from board_denials;

alter table board_denials drop constraint if exists board_denials_pkey;
alter table board_denials drop column if exists user_id;
alter table board_denials add column if not exists role_id uuid not null references roles (id) on delete cascade;
alter table board_denials add constraint board_denials_pkey primary key (board_id, role_id);
