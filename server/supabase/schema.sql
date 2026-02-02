-- =====================================================
-- PlayerQI "Neural-Database" Schema (Feature Matrix)
-- =====================================================
-- Database stores state + precomputed stats.
-- Node.js runs the 50/50 inference loop.
-- =====================================================

begin;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists vector;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'answer_kind'
  ) then
    create type public.answer_kind as enum ('yes','no','unknown','maybe');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'project_changelog_update_type'
  ) then
    create type public.project_changelog_update_type as enum ('MAJOR_VERSION','FEATURE_UPDATE','HOTFIX');
  end if;
end $$;

-- -----------------------------------------------------
-- Wipe legacy objects (safe for database resets)
-- -----------------------------------------------------

drop view if exists public.view_game_stats cascade;
drop view if exists public.view_player_attribute_editor cascade;
drop view if exists public.view_attribute_best_question cascade;

drop materialized view if exists public.mv_player_attribute_matrix cascade;
drop materialized view if exists public.mv_attribute_global_stats cascade;

-- Drop RPCs first (avoids parameter-name/signature issues across iterations)
drop function if exists public.get_candidate_summary(uuid[], uuid[], text[]);
drop function if exists public.get_attribute_stats(uuid[], uuid[], uuid[], text[]);
drop function if exists public.refresh_player_matrix_mvs();
drop function if exists public.bump_question_seen(uuid);
drop function if exists public.bump_question_success(uuid);
drop function if exists public.match_player(text, real);
drop function if exists public.match_question(text, real);
drop function if exists public.enforce_question_uniqueness() cascade;
drop function if exists public.questions_set_normalized_text() cascade;
drop function if exists public.attributes_set_normalized_fields() cascade;
drop function if exists public.players_set_normalized_name() cascade;
drop function if exists public.touch_updated_at() cascade;
drop function if exists public.normalize_simple_text(text);

drop table if exists public.question_transitions cascade;
drop table if exists public.question_nodes cascade;
drop table if exists public.player_paths cascade;

drop table if exists public.learning_queue cascade;
drop table if exists public.active_sessions cascade;

drop table if exists public.game_moves cascade;
drop table if exists public.game_sessions cascade;

drop table if exists public.project_changelogs cascade;

drop table if exists public.player_matrix cascade;
drop table if exists public.questions cascade;
drop table if exists public.attributes cascade;
drop table if exists public.players cascade;

-- Legacy schema (for safety if reset is run before migrating)
drop table if exists public.player_features cascade;
drop table if exists public.questions_metadata cascade;
drop table if exists public.features cascade;
drop table if exists public.candidates cascade;

-- -----------------------------------------------------
-- Core entities
-- -----------------------------------------------------

create table public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  image_url text,
  prior_weight numeric not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint players_prior_weight_positive check (prior_weight > 0),
  constraint players_normalized_unique unique(normalized_name)
);

create index if not exists players_normalized_trgm
on public.players using gin (normalized_name gin_trgm_ops);

create table public.attributes (
  id uuid primary key default gen_random_uuid(),
  attribute_key text not null,
  attribute_value text not null,
  label_ar text not null,
  category text not null,
  attribute_group text not null default '',
  is_exclusive boolean not null default false,
  normalized_key text not null,
  normalized_value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attributes_normalized_unique unique(normalized_key, normalized_value)
);

create index if not exists attributes_normalized_lookup
on public.attributes(normalized_key, normalized_value);

create index if not exists attributes_category_lookup
on public.attributes(category, normalized_key, normalized_value);

create index if not exists attributes_group_lookup
on public.attributes(attribute_group, normalized_key, normalized_value);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  attribute_id uuid not null references public.attributes(id) on delete cascade,
  question_text text not null,
  normalized_text text not null,
  embedding vector(1536),
  manual_weight numeric not null default 0,
  seen_count integer not null default 0,
  success_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint questions_attribute_norm_unique unique(attribute_id, normalized_text)
);

create index if not exists questions_normalized_trgm
on public.questions using gin (normalized_text gin_trgm_ops);

create index if not exists questions_attribute_lookup
on public.questions(attribute_id, manual_weight desc, success_count desc, seen_count desc, updated_at desc);

create index if not exists questions_embedding_ivfflat
on public.questions using ivfflat (embedding vector_cosine_ops)
with (lists = 100)
where embedding is not null;

create table public.player_matrix (
  player_id uuid not null references public.players(id) on delete cascade,
  attribute_id uuid not null references public.attributes(id) on delete cascade,
  value boolean not null,
  confidence_score numeric not null default 1,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (player_id, attribute_id),
  constraint player_matrix_confidence_range check (confidence_score >= 0 and confidence_score <= 1)
);

create index if not exists player_matrix_attribute_player
on public.player_matrix(attribute_id, player_id);

create index if not exists player_matrix_attribute_value_player
on public.player_matrix(attribute_id, value, player_id);

create index if not exists player_matrix_player_attribute
on public.player_matrix(player_id, attribute_id);

create table public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  history jsonb not null default '[]'::jsonb,
  rejected_guess_names text[] not null default '{}'::text[],
  status text not null default 'in_progress' check (status in ('in_progress','won','lost','abandoned')),
  guessed_player_id uuid references public.players(id) on delete set null,
  guessed_name text,
  correct boolean,
  question_count integer,
  duration_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.game_moves (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  move_index integer not null,
  question_id uuid references public.questions(id) on delete set null,
  attribute_id uuid references public.attributes(id) on delete set null,
  answer_kind public.answer_kind,
  candidate_count_before integer,
  candidate_count_after integer,
  info_gain numeric,
  created_at timestamptz not null default now(),
  constraint game_moves_session_move_unique unique(session_id, move_index)
);

create index if not exists game_moves_session_lookup
on public.game_moves(session_id, move_index);

create table public.active_sessions (
  session_id uuid primary key references public.game_sessions(id) on delete cascade,
  state_vector jsonb not null default '{}'::jsonb,
  constraints jsonb not null default '{}'::jsonb,
  asked_attribute_ids uuid[] not null default '{}'::uuid[],
  asked_question_norms text[] not null default '{}'::text[],
  rejected_guess_names text[] not null default '{}'::text[],
  candidate_count integer,
  top_candidate_id uuid references public.players(id) on delete set null,
  top_candidate_prob numeric,
  last_move jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists active_sessions_top_candidate
on public.active_sessions(top_candidate_prob desc);

create table public.learning_queue (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.game_sessions(id) on delete set null,
  guess_name text,
  normalized_guess text,
  reason text not null,
  payload jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists learning_queue_processed
on public.learning_queue(processed_at, created_at desc);

-- -----------------------------------------------------
-- Automated changelog pipeline
-- -----------------------------------------------------
create table public.project_changelogs (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  update_type public.project_changelog_update_type not null,
  release_date timestamptz not null default now(),
  summary text,
  features jsonb not null default '[]'::jsonb,
  fixes jsonb not null default '[]'::jsonb,
  is_published boolean not null default true
);

create index if not exists project_changelogs_published_date
on public.project_changelogs(is_published, release_date desc);

-- -----------------------------------------------------
-- "Table Editor" friendly view (single base table => updatable)
-- -----------------------------------------------------
create or replace view public.view_player_attribute_editor as
select
  pm.player_id,
  (select p.name from public.players p where p.id = pm.player_id) as player_name,
  pm.attribute_id,
  (select a.attribute_key from public.attributes a where a.id = pm.attribute_id) as attribute_key,
  (select a.attribute_value from public.attributes a where a.id = pm.attribute_id) as attribute_value,
  (select a.label_ar from public.attributes a where a.id = pm.attribute_id) as attribute_label_ar,
  (select a.category from public.attributes a where a.id = pm.attribute_id) as attribute_category,
  pm.value,
  pm.confidence_score,
  pm.source,
  pm.created_at,
  pm.updated_at
from public.player_matrix pm;

create or replace view public.view_attribute_best_question as
select distinct on (q.attribute_id)
  q.attribute_id,
  q.id as question_id,
  q.question_text,
  q.normalized_text
from public.questions q
order by q.attribute_id, q.manual_weight desc, q.success_count desc, q.seen_count desc, q.updated_at desc;

-- -----------------------------------------------------
-- Materialized views for fast inference
-- -----------------------------------------------------
create materialized view public.mv_player_attribute_matrix as
select
  pm.player_id,
  jsonb_object_agg(pm.attribute_id::text, pm.value) as attributes,
  max(pm.updated_at) as updated_at
from public.player_matrix pm
group by pm.player_id;

create index if not exists mv_player_attribute_matrix_player
on public.mv_player_attribute_matrix(player_id);

create index if not exists mv_player_attribute_matrix_attrs_gin
on public.mv_player_attribute_matrix using gin (attributes jsonb_path_ops);

create materialized view public.mv_attribute_global_stats as
select
  pm.attribute_id,
  count(*) filter (where pm.value is true) as true_count,
  count(*) as known_count,
  max(pm.updated_at) as updated_at
from public.player_matrix pm
group by pm.attribute_id;

create index if not exists mv_attribute_global_stats_attribute
on public.mv_attribute_global_stats(attribute_id);

-- -----------------------------------------------------
-- Normalization & timestamps
-- -----------------------------------------------------

create or replace function public.normalize_simple_text(p_text text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'));
$$;

create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace function public.players_set_normalized_name()
returns trigger as $$
begin
  new.normalized_name := public.normalize_simple_text(new.name);
  return new;
end;
$$ language plpgsql;

create or replace function public.attributes_set_normalized_fields()
returns trigger as $$
begin
  new.normalized_key := public.normalize_simple_text(new.attribute_key);
  new.normalized_value := public.normalize_simple_text(new.attribute_value);
  if new.category is null or new.category = '' then
    new.category := new.attribute_key;
  end if;
  if new.label_ar is null or new.label_ar = '' then
    new.label_ar := new.attribute_value;
  end if;
  if new.attribute_group is null or new.attribute_group = '' then
    new.attribute_group := new.attribute_key;
  end if;
  return new;
end;
$$ language plpgsql;

create or replace function public.questions_set_normalized_text()
returns trigger as $$
begin
  new.normalized_text := public.normalize_simple_text(new.question_text);
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_players_norm on public.players;
create trigger trg_players_norm
before insert or update on public.players
for each row execute function public.players_set_normalized_name();

drop trigger if exists trg_attributes_norm on public.attributes;
create trigger trg_attributes_norm
before insert or update on public.attributes
for each row execute function public.attributes_set_normalized_fields();

drop trigger if exists trg_questions_norm on public.questions;
create trigger trg_questions_norm
before insert or update on public.questions
for each row execute function public.questions_set_normalized_text();

drop trigger if exists trg_players_touch on public.players;
create trigger trg_players_touch
before update on public.players
for each row execute function public.touch_updated_at();

drop trigger if exists trg_attributes_touch on public.attributes;
create trigger trg_attributes_touch
before update on public.attributes
for each row execute function public.touch_updated_at();

drop trigger if exists trg_questions_touch on public.questions;
create trigger trg_questions_touch
before update on public.questions
for each row execute function public.touch_updated_at();

drop trigger if exists trg_player_matrix_touch on public.player_matrix;
create trigger trg_player_matrix_touch
before update on public.player_matrix
for each row execute function public.touch_updated_at();

drop trigger if exists trg_game_sessions_touch on public.game_sessions;
create trigger trg_game_sessions_touch
before update on public.game_sessions
for each row execute function public.touch_updated_at();

drop trigger if exists trg_active_sessions_touch on public.active_sessions;
create trigger trg_active_sessions_touch
before update on public.active_sessions
for each row execute function public.touch_updated_at();

-- -----------------------------------------------------
-- Duplicate question prevention (semantic + trigram)
-- -----------------------------------------------------
create or replace function public.enforce_question_uniqueness()
returns trigger as $$
begin
  if new.embedding is not null then
    if exists (
      select 1
      from public.questions q
      where q.id <> new.id
        and q.embedding is not null
        and (1 - (q.embedding <=> new.embedding)) >= 0.92
    ) then
      raise exception 'duplicate_question_embedding';
    end if;
  else
    if exists (
      select 1
      from public.questions q
      where q.id <> new.id
        and similarity(q.normalized_text, new.normalized_text) >= 0.92
    ) then
      raise exception 'duplicate_question_trgm';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_questions_dedupe on public.questions;
create trigger trg_questions_dedupe
before insert or update on public.questions
for each row execute function public.enforce_question_uniqueness();

-- -----------------------------------------------------
-- Matching helpers (trigram)
-- -----------------------------------------------------
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

create or replace function public.match_question(query_text text, similarity_threshold real)
returns table (
  id uuid,
  attribute_id uuid,
  question_text text,
  normalized_text text,
  score real
)
language sql
stable
as $$
  select
    q.id,
    q.attribute_id,
    q.question_text,
    q.normalized_text,
    similarity(q.normalized_text, query_text) as score
  from public.questions q
  where similarity(q.normalized_text, query_text) >= similarity_threshold
  order by score desc
  limit 1;
$$;

-- -----------------------------------------------------
-- Materialized view refresh helper
-- -----------------------------------------------------
create or replace function public.refresh_player_matrix_mvs()
returns void
language plpgsql
volatile
as $$
begin
  refresh materialized view public.mv_player_attribute_matrix;
  refresh materialized view public.mv_attribute_global_stats;
end;
$$;

-- -----------------------------------------------------
-- Attribute split helpers (50/50 targeting)
-- -----------------------------------------------------
create or replace function public.get_candidate_summary(
  p_yes_attribute_ids uuid[] default '{}'::uuid[],
  p_no_attribute_ids uuid[] default '{}'::uuid[],
  p_rejected_names text[] default '{}'::text[]
)
returns table (
  candidate_count integer,
  top_player_id uuid,
  top_player_name text,
  total_weight numeric,
  top_weight numeric
)
language sql
stable
as $$
  with
    yes_ids as (select unnest(coalesce(p_yes_attribute_ids, '{}'::uuid[])) as attribute_id),
    no_ids as (select unnest(coalesce(p_no_attribute_ids, '{}'::uuid[])) as attribute_id),
    base as (
      select p.id, p.name, p.normalized_name, p.prior_weight
      from public.players p
      where (p_rejected_names is null or p.normalized_name <> all(p_rejected_names))
    ),
    filtered as (
      select b.*
      from base b
      where not exists (
        select 1
        from yes_ids y
        left join public.player_matrix pm
          on pm.player_id = b.id
          and pm.attribute_id = y.attribute_id
          and pm.value is true
        where pm.player_id is null
      )
      and not exists (
        select 1
        from no_ids n
        join public.player_matrix pm
          on pm.player_id = b.id
          and pm.attribute_id = n.attribute_id
          and pm.value is true
      )
    )
  select
    count(*)::integer as candidate_count,
    (select id from filtered order by prior_weight desc, random() limit 1) as top_player_id,
    (select name from filtered order by prior_weight desc, random() limit 1) as top_player_name,
    coalesce(sum(prior_weight), 0)::numeric as total_weight,
    coalesce((select prior_weight from filtered order by prior_weight desc, random() limit 1), 0)::numeric as top_weight
  from filtered;
$$;

create or replace function public.get_attribute_stats(
  p_yes_attribute_ids uuid[] default '{}'::uuid[],
  p_no_attribute_ids uuid[] default '{}'::uuid[],
  p_asked_attribute_ids uuid[] default '{}'::uuid[],
  p_rejected_names text[] default '{}'::text[]
)
returns table (
  attribute_id uuid,
  true_count integer,
  known_count integer,
  total_count integer
)
language plpgsql
stable
as $$
declare
  use_globals boolean;
  total_players integer;
begin
  use_globals := coalesce(array_length(p_yes_attribute_ids, 1), 0) = 0
    and coalesce(array_length(p_no_attribute_ids, 1), 0) = 0
    and coalesce(array_length(p_rejected_names, 1), 0) = 0;

  if use_globals then
    select count(*) into total_players from public.players;
    return query
      select
        s.attribute_id,
        s.true_count::integer,
        s.known_count::integer,
        total_players::integer as total_count
      from public.mv_attribute_global_stats s
      where p_asked_attribute_ids is null or not (s.attribute_id = any(p_asked_attribute_ids));
    return;
  end if;

  return query
    with
      yes_ids as (select unnest(coalesce(p_yes_attribute_ids, '{}'::uuid[])) as attribute_id),
      no_ids as (select unnest(coalesce(p_no_attribute_ids, '{}'::uuid[])) as attribute_id),
      base as (
        select p.id, p.normalized_name
        from public.players p
        where (p_rejected_names is null or p.normalized_name <> all(p_rejected_names))
      ),
      candidates as (
        select b.id
        from base b
        where not exists (
          select 1
          from yes_ids y
          left join public.player_matrix pm
            on pm.player_id = b.id
            and pm.attribute_id = y.attribute_id
            and pm.value is true
          where pm.player_id is null
        )
        and not exists (
          select 1
          from no_ids n
          join public.player_matrix pm
            on pm.player_id = b.id
            and pm.attribute_id = n.attribute_id
            and pm.value is true
        )
      ),
      total as (select count(*)::integer as total_count from candidates)
    select
      pm.attribute_id,
      count(*) filter (where pm.value is true)::integer as true_count,
      count(*)::integer as known_count,
      t.total_count
    from candidates c
    join public.player_matrix pm on pm.player_id = c.id
    cross join total t
    where p_asked_attribute_ids is null or not (pm.attribute_id = any(p_asked_attribute_ids))
    group by pm.attribute_id, t.total_count;
end;
$$;

-- -----------------------------------------------------
-- Question performance helpers
-- -----------------------------------------------------
create or replace function public.bump_question_seen(p_question_id uuid)
returns void
language sql
volatile
as $$
  update public.questions
  set seen_count = seen_count + 1
  where id = p_question_id;
$$;

create or replace function public.bump_question_success(p_question_id uuid)
returns void
language sql
volatile
as $$
  update public.questions
  set success_count = success_count + 1
  where id = p_question_id;
$$;

create or replace view public.view_game_stats as
with
  avg_q as (
    select coalesce(avg(question_count), 0) as avg_questions
    from public.game_sessions
    where status in ('won','lost') and question_count is not null
  ),
  top_questions as (
    select
      gm.question_id,
      q.question_text,
      count(*) as times_asked,
      avg(coalesce(gm.info_gain, 0)) as avg_info_gain
    from public.game_moves gm
    join public.questions q on q.id = gm.question_id
    group by gm.question_id, q.question_text
    order by avg(coalesce(gm.info_gain, 0)) desc, count(*) desc
    limit 25
  ),
  top_guesses as (
    select
      gs.guessed_player_id,
      coalesce(p.name, gs.guessed_name) as name,
      count(*) as guess_count,
      count(*) filter (where gs.correct = true) as correct_count
    from public.game_sessions gs
    left join public.players p on p.id = gs.guessed_player_id
    where gs.status in ('won','lost')
    group by gs.guessed_player_id, coalesce(p.name, gs.guessed_name)
    order by count(*) desc
    limit 25
  )
select
  (select avg_questions from avg_q) as average_questions_needed,
  (select coalesce(jsonb_agg(jsonb_build_object(
    'question_id', question_id,
    'question_text', question_text,
    'times_asked', times_asked,
    'avg_info_gain', avg_info_gain
  )), '[]'::jsonb) from top_questions) as most_determining_questions,
  (select coalesce(jsonb_agg(jsonb_build_object(
    'player_id', guessed_player_id,
    'name', name,
    'guess_count', guess_count,
    'correct_count', correct_count
  )), '[]'::jsonb) from top_guesses) as commonly_guessed_players;

commit;

-- Force PostgREST schema cache refresh (important after wipe & rebuild)
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
end $$;

