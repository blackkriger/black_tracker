update states set is_open = false where is_open and is_resolved;
alter table states drop constraint if exists states_open_xor_resolved;
alter table states add constraint states_open_xor_resolved check (not (is_open and is_resolved));
