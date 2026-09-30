alter table issues add column if not exists position integer not null default 0;

create index if not exists issues_board_state_idx on issues (board_id, state_id, position);
