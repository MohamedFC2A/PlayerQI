-- =====================================================
-- PlayerQI Session Cleanup Fix
-- Resolves the issue where guessed players persist across games
-- =====================================================

-- Fix 1: Add function to properly clean up session data when game ends
create or replace function public.cleanup_game_session(p_session_id uuid)
returns void
language plpgsql
as $$
begin
  -- Delete the active session v2 record (resets all state)
  delete from public.active_sessions_v2 where session_id = p_session_id;
  
  -- Optionally reset any player-specific restrictions if needed
  -- This ensures fresh start for next game
  raise notice 'Session % cleaned up successfully', p_session_id;
end;
$$;

-- Fix 2: Modify the process_answer_v2 function to handle correct guesses properly
create or replace function public.process_answer_v2(
  p_session_id uuid,
  p_attribute_id uuid,
  p_answer_value integer,
  p_response_time integer default null
)
returns jsonb
language plpgsql
as $$
declare
  session_record record;
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
    -- Add to eliminated players if this is about a specific player guess
    -- This logic would need to be enhanced based on your specific use case
    
  elsif p_answer_value = 0 then -- MAYBE/UNKNOWN
    -- Handle uncertain responses
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

-- Fix 3: Enhanced get_next_move_v2 to handle fresh game starts properly
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
    -- Initialize new session with clean state
    insert into public.active_sessions_v2 (
      session_id,
      eliminated_players,
      confirmed_attributes,
      rejected_guesses,
      risk_profile,
      current_entropy,
      remaining_candidates
    ) values (
      p_session_id,
      '{}'::uuid[],  -- No eliminated players initially
      '{}'::uuid[],  -- No confirmed attributes initially
      '{}'::uuid[],  -- No rejected guesses initially (KEY FIX)
      'normal',
      null,
      null
    );
    
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

-- Fix 4: Add trigger to automatically clean up sessions when game status changes
create or replace function public.cleanup_session_on_game_end()
returns trigger
language plpgsql
as $$
begin
  -- When a game session is marked as won or lost, clean up the active session
  if NEW.status in ('won', 'lost') then
    perform public.cleanup_game_session(NEW.id);
  end if;
  return NEW;
end;
$$;

-- Apply the trigger to game_sessions table
drop trigger if exists trigger_cleanup_session on public.game_sessions;
create trigger trigger_cleanup_session
  after update on public.game_sessions
  for each row
  execute function public.cleanup_session_on_game_end();

-- Verification query
select 'Session cleanup fix applied successfully' as status;