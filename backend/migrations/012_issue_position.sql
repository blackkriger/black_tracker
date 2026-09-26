-- Cards are ordered by hand inside a column: a kanban board where the order is someone's judgement, not the clock. The number is the position within one board's column, renumbered whenever a card lands.

alter table issues add column if not exists position integer not null default 0;

create index if not exists issues_board_state_idx on issues (board_id, state_id, position);
