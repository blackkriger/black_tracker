create table if not exists feedback_responses (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lang       text not null check (lang in ('ru', 'en')),
  answers    jsonb not null,
  name       text,
  email      text
);

create index if not exists feedback_responses_created_idx on feedback_responses (created_at desc);

create table if not exists feedback_visits (
  day   date not null,
  lang  text not null check (lang in ('ru', 'en')),
  count int not null default 0,
  primary key (day, lang)
);
