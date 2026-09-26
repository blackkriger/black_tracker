-- Access hangs off the role, not the person: someone is kept out of a board because of what they are on the team, and changing what they are changes what they can open. Nothing had been denied to anyone yet, so the column is simply swapped rather than carried over.

delete from board_denials;

alter table board_denials drop constraint if exists board_denials_pkey;
alter table board_denials drop column if exists user_id;
alter table board_denials add column if not exists role_id uuid not null references roles (id) on delete cascade;
alter table board_denials add constraint board_denials_pkey primary key (board_id, role_id);
