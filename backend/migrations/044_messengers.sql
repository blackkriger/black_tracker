create table if not exists messenger_links (
  user_id uuid not null references users (id) on delete cascade,
  channel text not null check (channel in ('telegram', 'vk')),
  peer_id bigint not null,
  name    text,
  primary key (user_id, channel),
  unique (channel, peer_id)
);

insert into messenger_links (user_id, channel, peer_id, name)
select id, 'telegram', telegram_chat_id, telegram_name
  from users
 where telegram_chat_id is not null
on conflict do nothing;

create table if not exists messenger_codes (
  code_hash  text primary key,
  user_id    uuid not null references users (id) on delete cascade,
  channel    text not null,
  expires_at timestamptz not null
);

create table if not exists messenger_sends (
  notice_id  uuid not null references notices (id) on delete cascade,
  channel    text not null,
  peer_id    bigint,
  message_id bigint,
  pending    boolean not null default true,
  due_at     timestamptz not null default now(),
  attempts   int not null default 0,
  version    int not null default 0,
  last_error text,
  primary key (notice_id, channel)
);

create index if not exists messenger_sends_due_idx on messenger_sends (due_at) where pending;

insert into messenger_sends (notice_id, channel, peer_id, message_id, pending, due_at, attempts, version, last_error)
select notice_id, 'telegram', chat_id, message_id, pending, due_at, attempts, version, last_error
  from telegram_sends
on conflict do nothing;

alter table telegram_drafts rename to messenger_drafts;
alter table messenger_drafts add column if not exists channel text not null default 'telegram';

create or replace function queue_messenger_send() returns trigger
language plpgsql as $$
begin
  insert into messenger_sends (notice_id, channel)
  select new.id, l.channel from messenger_links l where l.user_id = new.user_id
  on conflict (notice_id, channel) do update
    set pending = true, due_at = now(), attempts = 0, last_error = null,
        version = messenger_sends.version + 1;
  return new;
end;
$$;

drop trigger if exists notices_telegram on notices;
drop trigger if exists notices_messengers on notices;
create trigger notices_messengers after insert or update of detail on notices
  for each row execute function queue_messenger_send();

drop function if exists queue_telegram_send();
drop table if exists telegram_sends;
drop table if exists telegram_link_codes;
alter table users drop column if exists telegram_chat_id;
alter table users drop column if exists telegram_name;
