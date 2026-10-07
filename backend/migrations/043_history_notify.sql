create or replace function notify_issue_history() returns trigger
language plpgsql as $$
begin
  perform pg_notify('issue_history', json_build_object('issue', new.issue_id, 'by', new.user_id)::text);
  return new;
end;
$$;

drop trigger if exists issue_history_notify on issue_history;
create trigger issue_history_notify after insert on issue_history
  for each row execute function notify_issue_history();
