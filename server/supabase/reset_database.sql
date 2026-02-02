-- =====================================================
-- 🔄 PlayerQI Database RESET Script (Feature Matrix)
-- =====================================================
-- Clears game data + knowledge base tables.
-- Use with care: this deletes players, attributes, questions, and matrix values.
-- =====================================================

begin;

do $$
begin
  -- New Feature-Matrix schema
  if to_regclass('public.game_moves') is not null then
    execute 'truncate table public.game_moves restart identity cascade';
  end if;
  if to_regclass('public.game_sessions') is not null then
    execute 'truncate table public.game_sessions restart identity cascade';
  end if;
  if to_regclass('public.questions') is not null then
    execute 'truncate table public.questions restart identity cascade';
  end if;
  if to_regclass('public.player_attributes') is not null then
    execute 'truncate table public.player_attributes restart identity cascade';
  end if;
  if to_regclass('public.attributes') is not null then
    execute 'truncate table public.attributes restart identity cascade';
  end if;
  if to_regclass('public.players') is not null then
    execute 'truncate table public.players restart identity cascade';
  end if;

  -- Legacy schema (for safety if reset is run before migrating)
  if to_regclass('public.questions_metadata') is not null then
    execute 'truncate table public.questions_metadata restart identity cascade';
  end if;
  if to_regclass('public.player_features') is not null then
    execute 'truncate table public.player_features restart identity cascade';
  end if;
  if to_regclass('public.features') is not null then
    execute 'truncate table public.features restart identity cascade';
  end if;
  if to_regclass('public.candidates') is not null then
    execute 'truncate table public.candidates restart identity cascade';
  end if;
end $$;

commit;

select '✅ RESET COMPLETE!' as status;

select jsonb_build_object(
  'players_exists', (to_regclass('public.players') is not null),
  'attributes_exists', (to_regclass('public.attributes') is not null),
  'questions_exists', (to_regclass('public.questions') is not null),
  'player_attributes_exists', (to_regclass('public.player_attributes') is not null),
  'game_sessions_exists', (to_regclass('public.game_sessions') is not null),
  'legacy_candidates_exists', (to_regclass('public.candidates') is not null),
  'legacy_features_exists', (to_regclass('public.features') is not null),
  'legacy_questions_metadata_exists', (to_regclass('public.questions_metadata') is not null)
) as schema_flags;
