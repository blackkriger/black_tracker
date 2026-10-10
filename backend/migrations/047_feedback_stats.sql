create table if not exists feedback_forms (
  id         text primary key,
  name       text not null,
  created_at timestamptz not null default now()
);

insert into feedback_forms (id, name) values ('demo', 'Demo feedback') on conflict (id) do nothing;

alter table feedback_responses add column if not exists form_id text references feedback_forms (id);
update feedback_responses set form_id = 'demo' where form_id is null;
alter table feedback_responses alter column form_id set not null;
create index if not exists feedback_responses_form_idx on feedback_responses (form_id, created_at desc);

create table if not exists feedback_sessions (
  id           uuid primary key,
  form_id      text not null references feedback_forms (id),
  day          date not null,
  lang         text not null check (lang in ('ru', 'en')),
  theme        text check (theme in ('light', 'dark')),
  device       text not null check (device in ('desktop', 'phone', 'tablet')),
  os           text,
  browser      text,
  screen       text,
  browser_lang text,
  country      text,
  visits       int not null default 1,
  reached      int not null default 0,
  section_ms   jsonb not null default '{}',
  sent         boolean not null default false
);

create index if not exists feedback_sessions_form_idx on feedback_sessions (form_id, day);

drop table if exists feedback_visits;
