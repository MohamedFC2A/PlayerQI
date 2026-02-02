-- =====================================================
-- PlayerQI v2.0: Hyper-Speed Cognitive Engine Schema
-- In-Database Logic for Real-Time Entropy Calculation
-- =====================================================

begin;

-- Enable required extensions
create extension if not exists vector;

-- -----------------------------------------------------
-- Core Feature Matrix Schema (The "Brain")
-- -----------------------------------------------------

-- Attributes table (replaces text-based questions)
create table if not exists public.attributes (
  id uuid primary key default gen_random_uuid(),
  category text not null, -- e.g., 'Position', 'League', 'Physical', 'Achievement'
  label_ar text not null, -- Arabic label: 'يلعب بقدمه اليسرى'
  label_en text, -- English label
  semantic_vector vector(1536), -- For semantic deduplication
  is_exclusive boolean default false, -- For mutually exclusive groups
  attribute_group text default '', -- Group related attributes
  created_at timestamptz not null default now()
);

-- Unique constraint on Arabic labels
create unique index if not exists attributes_label_ar_unique on public.attributes(label_ar);

-- Index for semantic similarity search
create index if not exists attributes_semantic_idx on public.attributes 
using ivfflat (semantic_vector vector_cosine_ops);

-- Player Features Matrix (The Core Intelligence)
create table if not exists public.player_features (
  player_id uuid not null references public.players(id) on delete cascade,
  attribute_id uuid not null references public.attributes(id) on delete cascade,
  value integer not null check (value in (-1, 0, 1)), -- -1=No, 0=Maybe, 1=Yes
  confidence numeric(3,2) not null default 1.0 check (confidence >= 0.0 and confidence <= 1.0),
  source text, -- 'manual', 'ai', 'user_feedback'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (player_id, attribute_id)
);

-- Fast lookup indexes
create index if not exists idx_player_features_attribute_value 
on public.player_features(attribute_id, value);

create index if not exists idx_player_features_player 
on public.player_features(player_id, attribute_id);

-- -----------------------------------------------------
-- Enhanced Session Management (Short-term Memory)
-- -----------------------------------------------------

-- Active game sessions with state tracking
create table if not exists public.active_sessions_v2 (
  session_id uuid primary key references public.game_sessions(id) on delete cascade,
  eliminated_players uuid[] default '{}'::uuid[], -- Players ruled out
  confirmed_attributes uuid[] default '{}'::uuid[], -- Confirmed player characteristics
  rejected_guesses uuid[] default '{}'::uuid[], -- Wrong guesses to avoid
  risk_profile text default 'normal' check (risk_profile in ('cautious', 'normal', 'reckless')),
  current_entropy numeric(5,3), -- Current information entropy
  remaining_candidates integer, -- Number of possible players
  question_history jsonb default '[]'::jsonb, -- Track question sequence
  last_move jsonb, -- Most recent move details
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for fast session lookups
create index if not exists active_sessions_v2_entropy_idx 
on public.active_sessions_v2(current_entropy desc);

create index if not exists active_sessions_v2_remaining_idx 
on public.active_sessions_v2(remaining_candidates);

-- -----------------------------------------------------
-- Behavioral Profiling (Lightweight, Heuristic-Based)
-- -----------------------------------------------------

-- Simplified player profiles (no ML required)
create table if not exists public.player_behavior_profiles (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  response_pattern text check (response_pattern in ('impulsive', 'analytical', 'normal', 'hesitant')),
  average_response_time integer, -- milliseconds
  consistency_score numeric(3,2) check (consistency_score >= 0.0 and consistency_score <= 1.0),
  difficulty_preference text check (difficulty_preference in ('easy', 'medium', 'hard')),
  cultural_affinity jsonb default '{}'::jsonb, -- Regional preferences
  created_at timestamptz not null default now()
);

create index if not exists player_behavior_profiles_session_idx 
on public.player_behavior_profiles(session_id);

-- -----------------------------------------------------
-- RPC Functions for In-Database Intelligence
-- -----------------------------------------------------

-- Main decision engine: calculates next optimal move
create or replace function public.get_next_move_v2(p_session_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  session_record record;
  candidate_count integer;
  top_candidate record;
  best_attribute record;
  entropy_score numeric;
  remaining_players uuid[];
begin
  -- Get current session state
  select * into session_record 
  from public.active_sessions_v2 
  where session_id = p_session_id;
  
  if not found then
    -- Initialize new session
    insert into public.active_sessions_v2 (session_id) 
    values (p_session_id);
    select * into session_record 
    from public.active_sessions_v2 
    where session_id = p_session_id;
  end if;
  
  -- Calculate remaining candidates based on session history
  select array_agg(p.id) into remaining_players
  from public.players p
  where p.id != all(session_record.eliminated_players)
    and p.id != all(session_record.rejected_guesses)
    and not exists (
      select 1 from public.player_features pf
      join unnest(session_record.confirmed_attributes) as attr_id on pf.attribute_id = attr_id
      where pf.player_id = p.id and pf.value = -1 -- Confirmed negative
    );
  
  candidate_count := array_length(remaining_players, 1);
  
  -- Early Exit: Kill Shot Logic
  if candidate_count <= 3 then
    select p.id, p.name, p.prior_weight into top_candidate
    from public.players p
    where p.id = any(remaining_players)
    order by p.prior_weight desc
    limit 1;
    
    if top_candidate.prior_weight >= 0.85 or candidate_count = 1 then
      return jsonb_build_object(
        'type', 'guess',
        'content', top_candidate.name,
        'player_id', top_candidate.id,
        'confidence', top_candidate.prior_weight,
        'remaining_candidates', candidate_count
      );
    end if;
  end if;
  
  -- Calculate Optimal Question (Entropy Maximization)
  select 
    a.id as attribute_id,
    a.label_ar as question_text,
    abs(0.5 - (count(*) filter (where pf.value = 1)::float / candidate_count)) as split_distance,
    count(*) filter (where pf.value = 1) as positive_count,
    candidate_count as total_count
  into best_attribute
  from public.attributes a
  join public.player_features pf on pf.attribute_id = a.id
  where pf.player_id = any(remaining_players)
    and a.id != all(session_record.confirmed_attributes)
    and pf.confidence > 0.7 -- Only use high-confidence features
  group by a.id, a.label_ar, candidate_count
  order by abs(0.5 - (count(*) filter (where pf.value = 1)::float / candidate_count)) asc
  limit 1;
  
  if not found then
    -- Fallback to basic entropy if no good attributes found
    return jsonb_build_object(
      'type', 'question',
      'content', 'هل يلعب في أوروبا؟',
      'fallback', true,
      'remaining_candidates', candidate_count
    );
  end if;
  
  -- Update session with new entropy calculation
  entropy_score := 1.0 - best_attribute.split_distance; -- Convert distance to score
  
  update public.active_sessions_v2 
  set 
    current_entropy = entropy_score,
    remaining_candidates = candidate_count,
    updated_at = now()
  where session_id = p_session_id;
  
  return jsonb_build_object(
    'type', 'question',
    'content', best_attribute.question_text,
    'attribute_id', best_attribute.attribute_id,
    'entropy_score', entropy_score,
    'split_ratio', round(best_attribute.positive_count::numeric / best_attribute.total_count, 2),
    'remaining_candidates', candidate_count
  );
  
exception when others then
  return jsonb_build_object(
    'type', 'error',
    'message', 'Failed to calculate next move',
    'error', sqlerrm
  );
end;
$$;

-- Deductive logic handler for answer processing
create or replace function public.process_answer_v2(
  p_session_id uuid,
  p_attribute_id uuid,
  p_answer_value integer, -- -1, 0, or 1
  p_response_time integer default null
)
returns jsonb
language plpgsql
as $$
declare
  session_record record;
  related_attributes uuid[];
  behavioral_profile text;
begin
  -- Get current session
  select * into session_record 
  from public.active_sessions_v2 
  where session_id = p_session_id;
  
  if not found then
    return jsonb_build_object('error', 'Session not found');
  end if;
  
  -- Update session based on answer
  if p_answer_value = 1 then -- YES
    -- Add to confirmed attributes
    update public.active_sessions_v2 
    set confirmed_attributes = array_append(confirmed_attributes, p_attribute_id)
    where session_id = p_session_id;
    
  elsif p_answer_value = -1 then -- NO
    -- Eliminate players with this attribute
    -- This would typically involve more complex logic to find related exclusions
    
  elsif p_answer_value = 0 then -- MAYBE/UNKNOWN
    -- Handle uncertain responses - could adjust confidence or skip attribute
  end if;
  
  -- Simple behavioral profiling based on response time
  if p_response_time is not null then
    if p_response_time < 1500 then
      behavioral_profile := 'impulsive';
    elsif p_response_time > 8000 then
      behavioral_profile := 'analytical';
    else
      behavioral_profile := 'normal';
    end if;
    
    -- Update or create behavioral profile
    insert into public.player_behavior_profiles (
      session_id, response_pattern, average_response_time
    ) values (
      p_session_id, behavioral_profile, p_response_time
    ) on conflict (session_id) do update set
      response_pattern = excluded.response_pattern,
      average_response_time = excluded.average_response_time;
  end if;
  
  return jsonb_build_object(
    'status', 'processed',
    'session_updated', true,
    'behavioral_profile', behavioral_profile
  );
  
exception when others then
  return jsonb_build_object(
    'error', 'Failed to process answer',
    'message', sqlerrm
  );
end;
$$;

-- Function to identify matrix gaps for AI filling
create or replace function public.get_matrix_gaps(limit_count integer default 50)
returns table(
  player_id uuid,
  player_name text,
  attribute_id uuid,
  attribute_label text,
  missing_count bigint
)
language sql
stable
as $$
  select 
    p.id as player_id,
    p.name as player_name,
    a.id as attribute_id,
    a.label_ar as attribute_label,
    count(*) as missing_count
  from public.players p
  cross join public.attributes a
  where not exists (
    select 1 from public.player_features pf
    where pf.player_id = p.id and pf.attribute_id = a.id
  )
  and p.prior_weight > 0.1 -- Focus on popular players
  group by p.id, p.name, a.id, a.label_ar
  order by p.prior_weight desc, count(*) desc
  limit limit_count;
$$;

-- Function to get session analytics
create or replace function public.get_session_analytics(p_session_id uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'session_id', p_session_id,
    'question_count', gs.question_count,
    'duration_ms', gs.duration_ms,
    'correct', gs.correct,
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

-- Update timestamp trigger
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Apply triggers
drop trigger if exists update_player_features_updated_at on public.player_features;
create trigger update_player_features_updated_at
  before update on public.player_features
  for each row execute function public.update_updated_at_column();

drop trigger if exists update_active_sessions_v2_updated_at on public.active_sessions_v2;
create trigger update_active_sessions_v2_updated_at
  before update on public.active_sessions_v2
  for each row execute function public.update_updated_at_column();

commit;

-- Notify PostgREST to refresh schema
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
end $$;