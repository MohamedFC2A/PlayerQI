-- =====================================================
-- 🗑️ PlayerQI Database RESET Script
-- =====================================================
-- This script clears ALL old/corrupted data and resets
-- the database to a fresh state for the new smart AI
-- =====================================================

BEGIN;

-- 1. Delete all game session data (old games with bad questions)
DELETE FROM public.game_moves;
DELETE FROM public.game_sessions;

-- 2. Delete all question metadata (old question formulations)
DELETE FROM public.questions_metadata;

-- 3. Delete all player features (old AI learnings)
DELETE FROM public.player_features;

-- 4. Delete all features (old feature definitions)
DELETE FROM public.features;

-- 5. Delete all learned player paths (old AI paths)
-- This table if exists
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'player_paths'
    ) THEN
        DELETE FROM public.player_paths;
    END IF;
END $$;

-- 6. Delete all question nodes (old question formulations)
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'question_nodes'
    ) THEN
        DELETE FROM public.question_nodes;
    END IF;
END $$;

-- 7. Delete all question transitions (old paths)
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'question_transitions'
    ) THEN
        DELETE FROM public.question_transitions;
    END IF;
END $$;

-- 8. Keep candidates but reset their learned data
-- We keep the player names but reset their stats
UPDATE public.candidates 
SET prior_weight = 1, 
    updated_at = NOW();

-- =====================================================
-- ✅ Insert Fresh Data for New AI
-- =====================================================

-- Insert proper features (NOT league!)
INSERT INTO public.features (feature_key, feature_value, normalized_key, normalized_value)
VALUES
  -- Continents
  ('continent', 'Europe', 'continent', 'europe'),
  ('continent', 'South America', 'continent', 'south america'),
  ('continent', 'Africa', 'continent', 'africa'),
  ('continent', 'Asia', 'continent', 'asia'),
  ('continent', 'North America', 'continent', 'north america'),
  
  -- Nationalities
  ('nationality', 'Argentina', 'nationality', 'argentina'),
  ('nationality', 'Portugal', 'nationality', 'portugal'),
  ('nationality', 'Egypt', 'nationality', 'egypt'),
  ('nationality', 'France', 'nationality', 'france'),
  ('nationality', 'Norway', 'nationality', 'norway'),
  ('nationality', 'Brazil', 'nationality', 'brazil'),
  ('nationality', 'Belgium', 'nationality', 'belgium'),
  ('nationality', 'England', 'nationality', 'england'),
  ('nationality', 'Germany', 'nationality', 'germany'),
  ('nationality', 'Spain', 'nationality', 'spain'),
  ('nationality', 'Poland', 'nationality', 'poland'),
  ('nationality', 'Croatia', 'nationality', 'croatia'),
  
  -- Positions
  ('position', 'Forward', 'position', 'forward'),
  ('position', 'Midfielder', 'position', 'midfielder'),
  ('position', 'Defender', 'position', 'defender'),
  ('position', 'Goalkeeper', 'position', 'goalkeeper'),
  
  -- Retired Status
  ('retired', 'Yes', 'retired', 'yes'),
  ('retired', 'No', 'retired', 'no'),
  
  -- Clubs (use actual club names, not leagues)
  ('club', 'Manchester City', 'club', 'manchester city'),
  ('club', 'Liverpool', 'club', 'liverpool'),
  ('club', 'Real Madrid', 'club', 'real madrid'),
  ('club', 'Barcelona', 'club', 'barcelona'),
  ('club', 'Inter Miami', 'club', 'inter miami'),
  ('club', 'Al Nassr', 'club', 'al nassr'),
  ('club', 'Paris Saint-Germain', 'club', 'paris saint germain'),
  ('club', 'Bayern Munich', 'club', 'bayern munich'),
  
  -- Awards
  ('award', 'World Cup', 'award', 'world cup'),
  ('award', 'Champions League', 'award', 'champions league'),
  ('award', 'Ballon d''Or', 'award', 'ballon dor')
ON CONFLICT (normalized_key, normalized_value) DO NOTHING;

-- Insert strategic questions (NO LEAGUE QUESTIONS!)
INSERT INTO public.questions_metadata (feature_id, question_text, normalized_text, manual_weight)
SELECT f.id, q.question_text, q.normalized_text, q.manual_weight
FROM (
  VALUES
    -- Continent questions (FIRST priority)
    ('continent', 'europe', 'هل يلعب في أوروبا؟', 'هل يلعب في اوروبا', 0.5),
    ('continent', 'south america', 'هل هو من أمريكا الجنوبية؟', 'هل هو من امريكا الجنوبيه', 0.4),
    ('continent', 'africa', 'هل هو من أفريقيا؟', 'هل هو من افريقيا', 0.3),
    
    -- Retired status
    ('retired', 'yes', 'هل اعتزل اللعب؟', 'هل اعتزل اللعب', 0.3),
    ('retired', 'no', 'هل ما زال يلعب؟', 'هل ما زال يلعب', 0),
    
    -- Positions
    ('position', 'forward', 'هل يلعب كمهاجم؟', 'هل يلعب كمهاجم', 0),
    ('position', 'midfielder', 'هل يلعب كلاعب وسط؟', 'هل يلعب كلاعب وسط', 0),
    ('position', 'defender', 'هل يلعب كمدافع؟', 'هل يلعب كمدافع', 0),
    ('position', 'goalkeeper', 'هل هو حارس مرمى؟', 'هل هو حارس مرمي', 0),
    
    -- Nationalities (specific)
    ('nationality', 'argentina', 'هل هو أرجنتيني؟', 'هل هو ارجنتيني', 0),
    ('nationality', 'portugal', 'هل هو برتغالي؟', 'هل هو برتغالي', 0),
    ('nationality', 'egypt', 'هل هو مصري؟', 'هل هو مصري', 0),
    ('nationality', 'france', 'هل هو فرنسي؟', 'هل هو فرنسي', 0),
    ('nationality', 'norway', 'هل هو نرويجي؟', 'هل هو نرويجي', 0),
    ('nationality', 'brazil', 'هل هو برازيلي؟', 'هل هو برازيلي', 0),
    
    -- Clubs (specific)
    ('club', 'manchester city', 'هل يلعب لمانشستر سيتي؟', 'هل يلعب لمانشستر سيتي', 0),
    ('club', 'liverpool', 'هل يلعب لليفربول؟', 'هل يلعب لليفربول', 0),
    ('club', 'real madrid', 'هل لعب لريال مدريد؟', 'هل لعب لريال مدريد', 0),
    ('club', 'barcelona', 'هل لعب لبرشلونة؟', 'هل لعب لبرشلونه', 0),
    ('club', 'inter miami', 'هل يلعب لإنتر ميامي؟', 'هل يلعب لانتر ميامي', 0),
    ('club', 'al nassr', 'هل يلعب للنصر السعودي؟', 'هل يلعب للنصر السعودي', 0),
    ('club', 'paris saint-germain', 'هل يلعب لباريس سان جيرمان؟', 'هل يلعب لباريس سان جيرمان', 0),
    
    -- Awards
    ('award', 'world cup', 'هل فاز بكأس العالم؟', 'هل فاز بكاس العالم', 0),
    ('award', 'champions league', 'هل فاز بدوري الأبطال؟', 'هل فاز بدوري الابطال', 0),
    ('award', 'ballon dor', 'هل فاز بالكرة الذهبية؟', 'هل فاز بالكره الذهبيه', 0)
) as q(feature_key, feature_value, question_text, normalized_text, manual_weight)
JOIN public.features f
  ON f.normalized_key = q.feature_key AND f.normalized_value = q.feature_value
ON CONFLICT (feature_id, normalized_text) DO NOTHING;

-- Insert player features (accurate mappings)
INSERT INTO public.player_features (player_id, feature_id, source, confidence)
SELECT c.id, f.id, 'seed', 1.0
FROM public.candidates c
JOIN public.features f ON (
  -- Lionel Messi
  (c.normalized_name = 'lionel messi' AND f.normalized_key = 'continent' AND f.normalized_value = 'south america') OR
  (c.normalized_name = 'lionel messi' AND f.normalized_key = 'nationality' AND f.normalized_value = 'argentina') OR
  (c.normalized_name = 'lionel messi' AND f.normalized_key = 'position' AND f.normalized_value = 'forward') OR
  (c.normalized_name = 'lionel messi' AND f.normalized_key = 'retired' AND f.normalized_value = 'no') OR
  (c.normalized_name = 'lionel messi' AND f.normalized_key = 'club' AND f.normalized_value = 'inter miami') OR
  (c.normalized_name = 'lionel messi' AND f.normalized_key = 'award' AND f.normalized_value = 'world cup') OR
  (c.normalized_name = 'lionel messi' AND f.normalized_key = 'award' AND f.normalized_value = 'ballon dor') OR
  (c.normalized_name = 'lionel messi' AND f.normalized_key = 'award' AND f.normalized_value = 'champions league') OR
  
  -- Cristiano Ronaldo
  (c.normalized_name = 'cristiano ronaldo' AND f.normalized_key = 'continent' AND f.normalized_value = 'europe') OR
  (c.normalized_name = 'cristiano ronaldo' AND f.normalized_key = 'nationality' AND f.normalized_value = 'portugal') OR
  (c.normalized_name = 'cristiano ronaldo' AND f.normalized_key = 'position' AND f.normalized_value = 'forward') OR
  (c.normalized_name = 'cristiano ronaldo' AND f.normalized_key = 'retired' AND f.normalized_value = 'no') OR
  (c.normalized_name = 'cristiano ronaldo' AND f.normalized_key = 'club' AND f.normalized_value = 'al nassr') OR
  (c.normalized_name = 'cristiano ronaldo' AND f.normalized_key = 'award' AND f.normalized_value = 'ballon dor') OR
  (c.normalized_name = 'cristiano ronaldo' AND f.normalized_key = 'award' AND f.normalized_value = 'champions league') OR
  
  -- Mohamed Salah
  (c.normalized_name = 'mohamed salah' AND f.normalized_key = 'continent' AND f.normalized_value = 'africa') OR
  (c.normalized_name = 'mohamed salah' AND f.normalized_key = 'nationality' AND f.normalized_value = 'egypt') OR
  (c.normalized_name = 'mohamed salah' AND f.normalized_key = 'position' AND f.normalized_value = 'forward') OR
  (c.normalized_name = 'mohamed salah' AND f.normalized_key = 'retired' AND f.normalized_value = 'no') OR
  (c.normalized_name = 'mohamed salah' AND f.normalized_key = 'club' AND f.normalized_value = 'liverpool') OR
  (c.normalized_name = 'mohamed salah' AND f.normalized_key = 'award' AND f.normalized_value = 'champions league') OR
  
  -- Erling Haaland
  (c.normalized_name = 'erling haaland' AND f.normalized_key = 'continent' AND f.normalized_value = 'europe') OR
  (c.normalized_name = 'erling haaland' AND f.normalized_key = 'nationality' AND f.normalized_value = 'norway') OR
  (c.normalized_name = 'erling haaland' AND f.normalized_key = 'position' AND f.normalized_value = 'forward') OR
  (c.normalized_name = 'erling haaland' AND f.normalized_key = 'retired' AND f.normalized_value = 'no') OR
  (c.normalized_name = 'erling haaland' AND f.normalized_key = 'club' AND f.normalized_value = 'manchester city') OR
  (c.normalized_name = 'erling haaland' AND f.normalized_key = 'award' AND f.normalized_value = 'champions league') OR
  
  -- Kylian Mbappé
  (c.normalized_name = 'kylian mbappe' AND f.normalized_key = 'continent' AND f.normalized_value = 'europe') OR
  (c.normalized_name = 'kylian mbappe' AND f.normalized_key = 'nationality' AND f.normalized_value = 'france') OR
  (c.normalized_name = 'kylian mbappe' AND f.normalized_key = 'position' AND f.normalized_value = 'forward') OR
  (c.normalized_name = 'kylian mbappe' AND f.normalized_key = 'retired' AND f.normalized_value = 'no') OR
  (c.normalized_name = 'kylian mbappe' AND f.normalized_key = 'award' AND f.normalized_value = 'world cup') OR
  
  -- Kevin De Bruyne
  (c.normalized_name = 'kevin de bruyne' AND f.normalized_key = 'continent' AND f.normalized_value = 'europe') OR
  (c.normalized_name = 'kevin de bruyne' AND f.normalized_key = 'nationality' AND f.normalized_value = 'belgium') OR
  (c.normalized_name = 'kevin de bruyne' AND f.normalized_key = 'position' AND f.normalized_value = 'midfielder') OR
  (c.normalized_name = 'kevin de bruyne' AND f.normalized_key = 'retired' AND f.normalized_value = 'no') OR
  (c.normalized_name = 'kevin de bruyne' AND f.normalized_key = 'club' AND f.normalized_value = 'manchester city') OR
  (c.normalized_name = 'kevin de bruyne' AND f.normalized_key = 'award' AND f.normalized_value = 'champions league')
)
ON CONFLICT (player_id, feature_id) DO NOTHING;

COMMIT;

-- =====================================================
-- ✅ Verification Queries
-- =====================================================
-- Run these to verify the reset worked:

-- Check feature count (should be ~40-50)
SELECT COUNT(*) as feature_count FROM public.features;

-- Check question count (should be ~25-30)
SELECT COUNT(*) as question_count FROM public.questions_metadata;

-- Check player features (should be ~30-40)
SELECT COUNT(*) as player_feature_count FROM public.player_features;

-- Verify NO league features exist
SELECT COUNT(*) as league_count FROM public.features WHERE normalized_key = 'league';
-- Should be 0!

-- Verify game sessions are empty
SELECT COUNT(*) as old_game_count FROM public.game_sessions;
-- Should be 0!
