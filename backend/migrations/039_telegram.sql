alter table users add column if not exists telegram_chat_id bigint;
alter table users add column if not exists telegram_name text;
alter table users add column if not exists notices_off text[] not null default '{}';
create unique index if not exists users_telegram_chat_idx on users (telegram_chat_id);

create table if not exists telegram_link_codes (
  code_hash  text primary key,
  user_id    uuid not null references users (id) on delete cascade,
  expires_at timestamptz not null
);

create table if not exists telegram_sends (
  notice_id  uuid primary key references notices (id) on delete cascade,
  chat_id    bigint,
  message_id bigint,
  pending    boolean not null default true,
  due_at     timestamptz not null default now(),
  attempts   int not null default 0,
  version    int not null default 0,
  last_error text
);

create index if not exists telegram_sends_due_idx on telegram_sends (due_at) where pending;

create or replace function queue_telegram_send() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from users where id = new.user_id and telegram_chat_id is not null) then
    insert into telegram_sends (notice_id) values (new.id)
    on conflict (notice_id) do update
      set pending = true, due_at = now(), attempts = 0, last_error = null,
          version = telegram_sends.version + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists notices_telegram on notices;
create trigger notices_telegram after insert or update of detail on notices
  for each row execute function queue_telegram_send();
