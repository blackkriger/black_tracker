alter table states drop constraint if exists states_id_board_key;
alter table states add constraint states_id_board_key unique (id, board_id);

alter table issues drop constraint if exists issues_state_board_fkey;
alter table issues add constraint issues_state_board_fkey
  foreign key (state_id, board_id) references states (id, board_id)
  deferrable initially deferred;
