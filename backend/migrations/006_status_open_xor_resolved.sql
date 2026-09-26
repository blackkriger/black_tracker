-- A status is either still in play or the place issues end up in, never both. The interface ticks one box and the other clears; this keeps the rule true whatever writes the row.
update states set is_open = false where is_open and is_resolved;
alter table states drop constraint if exists states_open_xor_resolved;
alter table states add constraint states_open_xor_resolved check (not (is_open and is_resolved));
