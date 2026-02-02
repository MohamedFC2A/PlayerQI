-- =====================================================
-- EMERGENCY FIX: Immediate Session Cleanup
-- This fixes the issue where guessed players persist across games
-- =====================================================

-- Fix 1: Force clean initialization of active_sessions_v2
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
    -- CRITICAL FIX: Explicitly initialize with EMPTY arrays
    insert into public.active_sessions_v2 (
      session_id,
      eliminated_players,
      confirmed_attributes,
      rejected_guesses,  -- THIS MUST BE EXPLICITLY EMPTY
      risk_profile,
      current_entropy,
      remaining_candidates,
      question_history,
      last_move
    ) values (
      p_session_id,
      '{}'::uuid[],      -- Empty eliminated players
      '{}'::uuid[],      -- Empty confirmed attributes  
      '{}'::uuid[],      -- EMPTY REJECTED GUESSES (KEY FIX)
      'normal',          -- Default risk profile
      null,              -- No entropy yet
      null,              -- No candidates count yet
      '[]'::jsonb,       -- Empty question history
      null               -- No last move yet
    );
    
    -- Verify the session was created with empty rejected_guesses
    select * into session_record 
    from public.active_sessions_v2 
    where session_id = p_session_id;
    
    -- DEBUG: Log the initialization
    raise notice 'New session initialized with rejected_guesses length: %', 
                 array_length(session_record.rejected_guesses, 1);
  end if;
  
  -- CRITICAL: Double-check that rejected_guesses is actually empty
  if array_length(session_record.rejected_guesses, 1) > 0 then
    -- Force reset if there are any rejected guesses
    update public.active_sessions_v2 
    set rejected_guesses = '{}'::uuid[]
    where session_id = p_session_id;
    
    -- Reload the session record
    select * into session_record 
    from public.active_sessions_v2 
    where session_id = p_session_id;
    
    raise notice 'FORCED RESET: rejected_guesses cleared for session %', p_session_id;
  end if;
  
  -- Calculate remaining candidates based on session history
  select array_agg(p.id) into remaining_players
  from public.players p
  where p.id != all(session_record.eliminated_players)
    and p.id != all(session_record.rejected_guesses)  -- This should now be empty
    and not exists (
      select 1 from public.player_features pf
      join unnest(session_record.confirmed_attributes) as attr_id on pf.attribute_id = attr_id
      where pf.player_id = p.id and pf.value = -1 -- Confirmed negative
    );
  
  candidate_count := array_length(remaining_players, 1);
  
  -- DEBUG: Log candidate count
  raise notice 'Session % has % remaining candidates', p_session_id, candidate_count;
  
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

-- Fix 2: Add explicit cleanup procedure
create or replace function public.force_session_cleanup(p_session_id uuid)
returns void
language plpgsql
as $$
begin
  -- Completely reset the active session
  update public.active_sessions_v2 
  set 
    eliminated_players = '{}'::uuid[],
    confirmed_attributes = '{}'::uuid[],
    rejected_guesses = '{}'::uuid[],  -- CRITICAL: Clear rejected guesses
    risk_profile = 'normal',
    current_entropy = null,
    remaining_candidates = null,
    question_history = '[]'::jsonb,
    last_move = null,
    updated_at = now()
  where session_id = p_session_id;
  
  raise notice 'Force cleanup completed for session %', p_session_id;
end;
$$;

-- Verification query
select 
  'EMERGENCY SESSION FIX APPLIED' as status,
  'All new sessions will start with empty rejected_guesses' as fix_description,
  'Previously guessed players will NOT appear in new games' as expected_behavior;