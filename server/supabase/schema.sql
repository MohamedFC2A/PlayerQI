create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists public.question_nodes (
  id uuid primary key default gen_random_uuid(),
  text text not null unique,
  normalized_text text,
  created_at timestamptz not null default now()
);

alter table public.question_nodes
add column if not exists normalized_text text;

update public.question_nodes
set normalized_text = text
where normalized_text is null or normalized_text = '';

create unique index if not exists question_nodes_normalized_unique
on public.question_nodes(normalized_text);

alter table public.question_nodes
alter column normalized_text set not null;

create index if not exists question_nodes_normalized_trgm
on public.question_nodes using gin (normalized_text gin_trgm_ops);

create table if not exists public.question_transitions (
  id uuid primary key default gen_random_uuid(),
  from_question_id uuid references public.question_nodes(id) on delete set null,
  answer_text text not null,
  next_type text not null check (next_type in ('question','guess')),
  next_question_id uuid references public.question_nodes(id) on delete set null,
  next_content_text text,
  player_id uuid,
  seen_count integer not null default 0,
  success_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint next_content_or_question check (
    (next_type = 'question' and next_question_id is not null) or
    (next_type = 'guess' and next_content_text is not null)
  )
);

alter table public.question_transitions
add column if not exists player_id uuid;

create unique index if not exists question_transitions_unique
on public.question_transitions(from_question_id, answer_text, next_type, next_question_id, next_content_text);

create index if not exists question_transitions_lookup
on public.question_transitions(from_question_id, answer_text, success_count desc, seen_count desc, updated_at desc);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  normalized_name text,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.players
add column if not exists normalized_name text;

update public.players
set normalized_name = name
where normalized_name is null or normalized_name = '';

create unique index if not exists players_normalized_unique
on public.players(normalized_name);

alter table public.players
alter column normalized_name set not null;

create index if not exists players_normalized_trgm
on public.players using gin (normalized_name gin_trgm_ops);

create table if not exists public.player_paths (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  history jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.guess_feedback (
  id uuid primary key default gen_random_uuid(),
  guess_name text not null,
  normalized_guess_name text not null,
  correct boolean not null,
  history jsonb not null,
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_question_transitions_touch on public.question_transitions;
create trigger trg_question_transitions_touch
before update on public.question_transitions
for each row execute function public.touch_updated_at();

drop trigger if exists trg_players_touch on public.players;
create trigger trg_players_touch
before update on public.players
for each row execute function public.touch_updated_at();

create or replace function public.match_question_node(query_text text, similarity_threshold real)
returns table (
  id uuid,
  text text,
  normalized_text text,
  score real
)
language sql
stable
as $$
  select
    q.id,
    q.text,
    q.normalized_text,
    similarity(q.normalized_text, query_text) as score
  from public.question_nodes q
  where similarity(q.normalized_text, query_text) >= similarity_threshold
  order by score desc
  limit 1;
$$;

create or replace function public.match_player(query_text text, similarity_threshold real)
returns table (
  id uuid,
  name text,
  normalized_name text,
  image_url text,
  score real
)
language sql
stable
as $$
  select
    p.id,
    p.name,
    p.normalized_name,
    p.image_url,
    similarity(p.normalized_name, query_text) as score
  from public.players p
  where similarity(p.normalized_name, query_text) >= similarity_threshold
  order by score desc
  limit 1;
$$;
