-- =====================================================
-- PlayerQI v2.0 SIMPLE RESET SCRIPT
-- Safe, dependency-free database reset
-- =====================================================

-- Step 1: Clean slate (be careful - this deletes all data!)
-- Uncomment the next line ONLY if you want to completely reset:
-- DROP SCHEMA public CASCADE; CREATE SCHEMA public;

-- Step 2: Create extensions
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- Step 3: Create enum types
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'answer_kind'
  ) then create type public.answer_kind as enum ('yes','no','unknown','maybe'); end if;
  
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'project_changelog_update_type'
  ) then create type public.project_changelog_update_type as enum ('MAJOR_VERSION','FEATURE_UPDATE','HOTFIX'); end if;
end $$;

-- Step 4: Create core tables in correct dependency order

-- Players (foundation table)
create table if not exists public.players (
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

-- Player profiles (independent of game sessions initially)
create table if not exists public.player_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  anonymous_id text,
  skill_level numeric(3,2) check (skill_level >= 0.0 and skill_level <= 1.0),
  confidence_score numeric(3,2) check (confidence_score >= 0.0 and confidence_score <= 1.0),
  behavioral_cluster text check (behavioral_cluster in ('analytical', 'impulsive', 'cautious', 'inconsistent', 'expert')),
  cultural_preferences jsonb default '{}'::jsonb,
  historical_performance jsonb default '{}'::jsonb,
  bias_indicators jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_profiles_user_or_anonymous check (
    (user_id is not null and anonymous_id is null) or 
    (user_id is null and anonymous_id is not null)
  )
);

-- Attributes table
create table if not exists public.attributes (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  label_ar text not null,
  label_en text,
  is_exclusive boolean default false,
  attribute_group text default '',
  created_at timestamptz not null default now(),
  constraint attributes_label_ar_unique unique(label_ar)
);

-- Game sessions (can now reference player_profiles)
create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  history jsonb not null default '[]'::jsonb,
  rejected_guess_names text[] not null default '{}'::text[],
  status text not null default 'in_progress' check (status in ('in_progress','won','lost','abandoned')),
  guessed_player_id uuid references public.players(id) on delete set null,
  guessed_name text,
  correct boolean,
  question_count integer,
  duration_ms integer,
  player_profile_id uuid references public.player_profiles(id) on delete set null,
  average_response_time integer,
  behavioral_cluster text,
  session_difficulty numeric(3,2),
  engagement_score numeric(3,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Player features matrix
create table if not exists public.player_features (
  player_id uuid not null references public.players(id) on delete cascade,
  attribute_id uuid not null references public.attributes(id) on delete cascade,
  value integer not null check (value in (-1, 0, 1)),
  confidence numeric(3,2) not null default 1.0 check (confidence >= 0.0 and confidence <= 1.0),
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (player_id, attribute_id)
);

-- Active sessions v2
create table if not exists public.active_sessions_v2 (
  session_id uuid primary key references public.game_sessions(id) on delete cascade,
  eliminated_players uuid[] default '{}'::uuid[],
  confirmed_attributes uuid[] default '{}'::uuid[],
  rejected_guesses uuid[] default '{}'::uuid[],
  risk_profile text default 'normal' check (risk_profile in ('cautious', 'normal', 'reckless')),
  current_entropy numeric(5,3),
  remaining_candidates integer,
  question_history jsonb default '[]'::jsonb,
  last_move jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Behavioral profiles
create table if not exists public.player_behavior_profiles (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  response_pattern text check (response_pattern in ('impulsive', 'analytical', 'normal', 'hesitant')),
  average_response_time integer,
  consistency_score numeric(3,2) check (consistency_score >= 0.0 and consistency_score <= 1.0),
  difficulty_preference text check (difficulty_preference in ('easy', 'medium', 'hard')),
  cultural_affinity jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Step 5: Create indexes
create index if not exists players_normalized_trgm on public.players using gin (normalized_name gin_trgm_ops);
create index if not exists idx_player_features_attribute_value on public.player_features(attribute_id, value);
create index if not exists idx_player_features_player on public.player_features(player_id, attribute_id);
create index if not exists active_sessions_v2_entropy_idx on public.active_sessions_v2(current_entropy desc);
create index if not exists active_sessions_v2_remaining_idx on public.active_sessions_v2(remaining_candidates);
create index if not exists player_profiles_user_id_idx on public.player_profiles(user_id);
create index if not exists player_profiles_anonymous_id_idx on public.player_profiles(anonymous_id);
create index if not exists player_profiles_skill_level_idx on public.player_profiles(skill_level);
create index if not exists player_behavior_profiles_session_idx on public.player_behavior_profiles(session_id);

-- Step 6: Create utility functions

-- Timestamp trigger function
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Apply triggers
drop trigger if exists update_players_updated_at on public.players;
create trigger update_players_updated_at
  before update on public.players
  for each row execute function public.update_updated_at_column();

drop trigger if exists update_player_profiles_updated_at on public.player_profiles;
create trigger update_player_profiles_updated_at
  before update on public.player_profiles
  for each row execute function public.update_updated_at_column();

drop trigger if exists update_attributes_updated_at on public.attributes;
create trigger update_attributes_updated_at
  before update on public.attributes
  for each row execute function public.update_updated_at_column();

drop trigger if exists update_game_sessions_updated_at on public.game_sessions;
create trigger update_game_sessions_updated_at
  before update on public.game_sessions
  for each row execute function public.update_updated_at_column();

drop trigger if exists update_player_features_updated_at on public.player_features;
create trigger update_player_features_updated_at
  before update on public.player_features
  for each row execute function public.update_updated_at_column();

drop trigger if exists update_active_sessions_v2_updated_at on public.active_sessions_v2;
create trigger update_active_sessions_v2_updated_at
  before update on public.active_sessions_v2
  for each row execute function public.update_updated_at_column();

-- Main decision engine function
create or replace function public.get_next_move_v2(p_session_id uuid)
returns jsonb language plpgsql stable as $$
declare
  session_record record;
  candidate_count integer;
  top_candidate record;
  best_attribute record;
  entropy_score numeric;
  remaining_players uuid[];
begin
  select * into session_record from public.active_sessions_v2 where session_id = p_session_id;
  
  if not found then
    insert into public.active_sessions_v2 (session_id) values (p_session_id);
    select * into session_record from public.active_sessions_v2 where session_id = p_session_id;
  end if;
  
  select array_agg(p.id) into remaining_players
  from public.players p
  where p.id != all(session_record.eliminated_players)
    and p.id != all(session_record.rejected_guesses)
    and not exists (
      select 1 from public.player_features pf
      join unnest(session_record.confirmed_attributes) as attr_id on pf.attribute_id = attr_id
      where pf.player_id = p.id and pf.value = -1
    );
  
  candidate_count := array_length(remaining_players, 1);
  
  if candidate_count <= 3 then
    select p.id, p.name, p.prior_weight into top_candidate
    from public.players p where p.id = any(remaining_players)
    order by p.prior_weight desc limit 1;
    
    if top_candidate.prior_weight >= 0.85 or candidate_count = 1 then
      return jsonb_build_object(
        'type', 'guess', 'content', top_candidate.name,
        'player_id', top_candidate.id, 'confidence', top_candidate.prior_weight,
        'remaining_candidates', candidate_count
      );
    end if;
  end if;
  
  select a.id as attribute_id, a.label_ar as question_text,
    abs(0.5 - (count(*) filter (where pf.value = 1)::float / candidate_count)) as split_distance,
    count(*) filter (where pf.value = 1) as positive_count, candidate_count as total_count
  into best_attribute
  from public.attributes a join public.player_features pf on pf.attribute_id = a.id
  where pf.player_id = any(remaining_players) and a.id != all(session_record.confirmed_attributes)
    and pf.confidence > 0.7
  group by a.id, a.label_ar, candidate_count
  order by abs(0.5 - (count(*) filter (where pf.value = 1)::float / candidate_count)) asc
  limit 1;
  
  if not found then
    return jsonb_build_object('type', 'question', 'content', 'هل يلعب في أوروبا؟', 
                             'fallback', true, 'remaining_candidates', candidate_count);
  end if;
  
  entropy_score := 1.0 - best_attribute.split_distance;
  
  update public.active_sessions_v2 set current_entropy = entropy_score,
    remaining_candidates = candidate_count, updated_at = now()
  where session_id = p_session_id;
  
  return jsonb_build_object('type', 'question', 'content', best_attribute.question_text,
    'attribute_id', best_attribute.attribute_id, 'entropy_score', entropy_score,
    'split_ratio', round(best_attribute.positive_count::numeric / best_attribute.total_count, 2),
    'remaining_candidates', candidate_count);
  
exception when others then
  return jsonb_build_object('type', 'error', 'message', 'Failed to calculate next move', 'error', sqlerrm);
end; $$;

-- Process answer function
create or replace function public.process_answer_v2(
  p_session_id uuid, p_attribute_id uuid, p_answer_value integer, p_response_time integer default null
) returns jsonb language plpgsql as $$
declare
  session_record record;
  behavioral_profile text;
begin
  select * into session_record from public.active_sessions_v2 where session_id = p_session_id;
  if not found then return jsonb_build_object('error', 'Session not found'); end if;
  
  if p_answer_value = 1 then
    update public.active_sessions_v2 set confirmed_attributes = array_append(confirmed_attributes, p_attribute_id)
    where session_id = p_session_id;
  end if;
  
  if p_response_time is not null then
    if p_response_time < 1500 then behavioral_profile := 'impulsive';
    elsif p_response_time > 8000 then behavioral_profile := 'analytical';
    else behavioral_profile := 'normal'; end if;
    
    insert into public.player_behavior_profiles (session_id, response_pattern, average_response_time)
    values (p_session_id, behavioral_profile, p_response_time)
    on conflict (session_id) do update set
      response_pattern = excluded.response_pattern,
      average_response_time = excluded.average_response_time;
  end if;
  
  return jsonb_build_object('status', 'processed', 'session_updated', true, 'behavioral_profile', behavioral_profile);
  
exception when others then
  return jsonb_build_object('error', 'Failed to process answer', 'message', sqlerrm);
end; $$;

-- Matrix gaps function
create or replace function public.get_matrix_gaps(limit_count integer default 50)
returns table(player_id uuid, player_name text, attribute_id uuid, attribute_label text, missing_count bigint)
language sql stable as $$
  select p.id as player_id, p.name as player_name, a.id as attribute_id, 
         a.label_ar as attribute_label, count(*) as missing_count
  from public.players p cross join public.attributes a
  where not exists (select 1 from public.player_features pf 
                   where pf.player_id = p.id and pf.attribute_id = a.id)
    and p.prior_weight > 0.1
  group by p.id, p.name, a.id, a.label_ar
  order by p.prior_weight desc, count(*) desc limit limit_count;
$$;

-- Session analytics function
create or replace function public.get_session_analytics(p_session_id uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'session_id', p_session_id, 'question_count', gs.question_count,
    'duration_ms', gs.duration_ms, 'correct', gs.correct,
    'behavioral_profile', pbp.response_pattern,
    'average_response_time', pbp.average_response_time,
    'consistency_score', pbp.consistency_score,
    'final_entropy', av2.current_entropy,
    'remaining_candidates', av2.remaining_candidates
  )
  from public.game_sessions gs
  left join public.player_behavior_profiles pbp on pbp.session_id = gs.id
  left join public.active_sessions_v2 av2 on av2.session_id = gs.id
  where gs.id = p_session_id;
$$;

-- Finalize
commit;
do $$ begin perform pg_notify('pgrst', 'reload schema'); end $$;

-- Verification
select 'PlayerQI v2.0 schema reset complete' as status,
       count(*) as tables_created
from information_schema.tables 
where table_schema = 'public' 
and table_name in ('players', 'attributes', 'player_features', 'game_sessions', 
                   'active_sessions_v2', 'player_profiles', 'player_behavior_profiles');