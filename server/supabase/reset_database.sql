-- =====================================================
-- 🔄 PlayerQI Database RESET Script
-- =====================================================
-- Removes ALL corrupted data from old AI
-- Inserts fresh strategic data for new smart AI
-- =====================================================

BEGIN;

-- =====================================================
-- 🗑️ STEP 1: Delete ALL Old Data
-- =====================================================

-- Delete game data (old sessions from dumb AI)
DELETE FROM public.game_moves;
DELETE FROM public.game_sessions;

-- Delete all learned questions and features
DELETE FROM public.questions_metadata;
DELETE FROM public.player_features;
DELETE FROM public.features;

-- Delete player paths if exists
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'player_paths') THEN
        DELETE FROM public.player_paths;
    END IF;
END $$;

-- Delete question nodes if exists
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'question_nodes') THEN
        DELETE FROM public.question_nodes;
    END IF;
END $$;

-- Delete question transitions if exists
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'question_transitions') THEN
        DELETE FROM public.question_transitions;
    END IF;
END $$;

-- Reset candidate weights
UPDATE public.candidates SET prior_weight = 1, updated_at = NOW();

-- =====================================================
-- ✨ STEP 2: Insert Strategic Features
-- =====================================================

-- Insert continents (FIRST priority questions)
INSERT INTO public.features (feature_key, feature_value, normalized_key, normalized_value) VALUES
  ('continent', 'Europe', 'continent', 'europe'),
  ('continent', 'South America', 'continent', 'south america'),
  ('continent', 'Africa', 'continent', 'africa'),
  ('continent', 'Asia', 'continent', 'asia'),
  ('continent', 'North America', 'continent', 'north america')
ON CONFLICT (normalized_key, normalized_value) DO NOTHING;

-- Insert nationalities
INSERT INTO public.features (feature_key, feature_value, normalized_key, normalized_value) VALUES
  ('nationality', 'Argentina', 'nationality', 'argentina'),
  ('nationality', 'Portugal', 'nationality', 'portugal'),
  ('nationality', 'Egypt', 'nationality', 'egypt'),
  ('nationality', 'France', 'nationality', 'france'),
  ('nationality', 'Norway', 'nationality', 'norway'),
  ('nationality', 'Brazil', 'nationality', 'brazil'),
  ('nationality', 'Belgium', 'nationality', 'belgium'),
  ('nationality', 'England', 'nationality', 'england'),
  ('nationality', 'Spain', 'nationality', 'spain'),
  ('nationality', 'Poland', 'nationality', 'poland'),
  ('nationality', 'Croatia', 'nationality', 'croatia'),
  ('nationality', 'Netherlands', 'nationality', 'netherlands'),
  ('nationality', 'Germany', 'nationality', 'germany'),
  ('nationality', 'Italy', 'nationality', 'italy')
ON CONFLICT (normalized_key, normalized_value) DO NOTHING;

-- Insert positions
INSERT INTO public.features (feature_key, feature_value, normalized_key, normalized_value) VALUES
  ('position', 'Forward', 'position', 'forward'),
  ('position', 'Midfielder', 'position', 'midfielder'),
  ('position', 'Defender', 'position', 'defender'),
  ('position', 'Goalkeeper', 'position', 'goalkeeper')
ON CONFLICT (normalized_key, normalized_value) DO NOTHING;

-- Insert retired status
INSERT INTO public.features (feature_key, feature_value, normalized_key, normalized_value) VALUES
  ('retired', 'Yes', 'retired', 'yes'),
  ('retired', 'No', 'retired', 'no')
ON CONFLICT (normalized_key, normalized_value) DO NOTHING;

-- Insert top clubs (NO LEAGUES!)
INSERT INTO public.features (feature_key, feature_value, normalized_key, normalized_value) VALUES
  ('club', 'Manchester City', 'club', 'manchester city'),
  ('club', 'Liverpool', 'club', 'liverpool'),
  ('club', 'Real Madrid', 'club', 'real madrid'),
  ('club', 'Barcelona', 'club', 'barcelona'),
  ('club', 'Inter Miami', 'club', 'inter miami'),
  ('club', 'Al Nassr', 'club', 'al nassr'),
  ('club', 'Paris Saint-Germain', 'club', 'paris saint germain'),
  ('club', 'Bayern Munich', 'club', 'bayern munich'),
  ('club', 'Chelsea', 'club', 'chelsea'),
  ('club', 'Manchester United', 'club', 'manchester united'),
  ('club', 'Arsenal', 'club', 'arsenal'),
  ('club', 'Juventus', 'club', 'juventus'),
  ('club', 'AC Milan', 'club', 'ac milan'),
  ('club', 'Inter Milan', 'club', 'inter milan'),
  ('club', 'Atletico Madrid', 'club', 'atletico madrid')
ON CONFLICT (normalized_key, normalized_value) DO NOTHING;

-- Insert awards
INSERT INTO public.features (feature_key, feature_value, normalized_key, normalized_value) VALUES
  ('award', 'World Cup', 'award', 'world cup'),
  ('award', 'Champions League', 'award', 'champions league'),
  ('award', 'Ballon d''Or', 'award', 'ballon dor'),
  ('award', 'Golden Boot', 'award', 'golden boot')
ON CONFLICT (normalized_key, normalized_value) DO NOTHING;

-- =====================================================
-- 📝 STEP 3: Insert Strategic Questions
-- =====================================================

INSERT INTO public.questions_metadata (feature_id, question_text, normalized_text, manual_weight)
SELECT f.id, q.question_text, q.normalized_text, q.manual_weight::numeric
FROM (
  VALUES
    -- CONTINENT QUESTIONS (Highest priority - start game with these)
    ('continent', 'europe', 'هل يلعب في أوروبا؟', 'هل يلعب في اوروبا', '0.5'),
    ('continent', 'south america', 'هل هو من أمريكا الجنوبية؟', 'هل هو من امريكا الجنوبيه', '0.4'),
    ('continent', 'africa', 'هل هو من أفريقيا؟', 'هل هو من افريقيا', '0.3'),
    ('continent', 'asia', 'هل هو من آسيا؟', 'هل هو من اسيا', '0.2'),
    
    -- RETIRED STATUS
    ('retired', 'yes', 'هل اعتزل اللعب؟', 'هل اعتزل اللعب', '0.3'),
    ('retired', 'no', 'هل ما زال يلعب؟', 'هل ما زال يلعب', '0'),
    
    -- POSITIONS
    ('position', 'forward', 'هل يلعب كمهاجم؟', 'هل يلعب كمهاجم', '0'),
    ('position', 'midfielder', 'هل يلعب كلاعب وسط؟', 'هل يلعب كلاعب وسط', '0'),
    ('position', 'defender', 'هل يلعب كمدافع؟', 'هل يلعب كمدافع', '0'),
    ('position', 'goalkeeper', 'هل هو حارس مرمى؟', 'هل هو حارس مرمي', '0'),
    
    -- MAJOR NATIONALITIES
    ('nationality', 'argentina', 'هل هو أرجنتيني؟', 'هل هو ارجنتيني', '0'),
    ('nationality', 'portugal', 'هل هو برتغالي؟', 'هل هو برتغالي', '0'),
    ('nationality', 'egypt', 'هل هو مصري؟', 'هل هو مصري', '0'),
    ('nationality', 'france', 'هل هو فرنسي؟', 'هل هو فرنسي', '0'),
    ('nationality', 'brazil', 'هل هو برازيلي؟', 'هل هو برازيلي', '0'),
    ('nationality', 'norway', 'هل هو نرويجي؟', 'هل هو نرويجي', '0'),
    ('nationality', 'belgium', 'هل هو بلجيكي؟', 'هل هو بلجيكي', '0'),
    ('nationality', 'england', 'هل هو إنجليزي؟', 'هل هو انجليزي', '0'),
    ('nationality', 'spain', 'هل هو إسباني؟', 'هل هو اسباني', '0'),
    
    -- TOP CLUBS
    ('club', 'manchester city', 'هل يلعب لمانشستر سيتي؟', 'هل يلعب لمانشستر سيتي', '0'),
    ('club', 'liverpool', 'هل يلعب لليفربول؟', 'هل يلعب لليفربول', '0'),
    ('club', 'real madrid', 'هل لعب لريال مدريد؟', 'هل لعب لريال مدريد', '0'),
    ('club', 'barcelona', 'هل لعب لبرشلونة؟', 'هل لعب لبرشلونه', '0'),
    ('club', 'inter miami', 'هل يلعب لإنتر ميامي؟', 'هل يلعب لانتر ميامي', '0'),
    ('club', 'al nassr', 'هل يلعب للنصر؟', 'هل يلعب للنصر', '0'),
    ('club', 'paris saint-germain', 'هل يلعب لباريس سان جيرمان؟', 'هل يلعب لباريس سان جيرمان', '0'),
    ('club', 'bayern munich', 'هل لعب لبايرن ميونخ؟', 'هل لعب لبايرن ميونخ', '0'),
    ('club', 'manchester united', 'هل لعب لمانشستر يونايتد؟', 'هل لعب لمانشستر يونايتد', '0'),
    
    -- AWARDS
    ('award', 'world cup', 'هل فاز بكأس العالم؟', 'هل فاز بكاس العالم', '0'),
    ('award', 'champions league', 'هل فاز بدوري الأبطال؟', 'هل فاز بدوري الابطال', '0'),
    ('award', 'ballon dor', 'هل فاز بالكرة الذهبية؟', 'هل فاز بالكره الذهبيه', '0')
) as q(feature_key, feature_value, question_text, normalized_text, manual_weight)
JOIN public.features f ON f.normalized_key = q.feature_key AND f.normalized_value = q.feature_value
ON CONFLICT (feature_id, normalized_text) DO NOTHING;

-- =====================================================
-- 👥 STEP 4: Map Players to Features
-- =====================================================

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
  
  -- Kylian Mbappé
  (c.normalized_name = 'kylian mbappe' AND f.normalized_key = 'continent' AND f.normalized_value = 'europe') OR
  (c.normalized_name = 'kylian mbappe' AND f.normalized_key = 'nationality' AND f.normalized_value = 'france') OR
  (c.normalized_name = 'kylian mbappe' AND f.normalized_key = 'position' AND f.normalized_value = 'forward') OR
  (c.normalized_name = 'kylian mbappe' AND f.normalized_key = 'retired' AND f.normalized_value = 'no') OR
  (c.normalized_name = 'kylian mbappe' AND f.normalized_key = 'club' AND f.normalized_value = 'paris saint-germain') OR
  (c.normalized_name = 'kylian mbappe' AND f.normalized_key = 'award' AND f.normalized_value = 'world cup') OR
  
  -- Erling Haaland
  (c.normalized_name = 'erling haaland' AND f.normalized_key = 'continent' AND f.normalized_value = 'europe') OR
  (c.normalized_name = 'erling haaland' AND f.normalized_key = 'nationality' AND f.normalized_value = 'norway') OR
  (c.normalized_name = 'erling haaland' AND f.normalized_key = 'position' AND f.normalized_value = 'forward') OR
  (c.normalized_name = 'erling haaland' AND f.normalized_key = 'retired' AND f.normalized_value = 'no') OR
  (c.normalized_name = 'erling haaland' AND f.normalized_key = 'club' AND f.normalized_value = 'manchester city') OR
  (c.normalized_name = 'erling haaland' AND f.normalized_key = 'award' AND f.normalized_value = 'champions league') OR
  
  -- Kevin De Bruyne
  (c.normalized_name = 'kevin de bruyne' AND f.normalized_key = 'continent' AND f.normalized_value = 'europe') OR
  (c.normalized_name = 'kevin de bruyne' AND f.normalized_key = 'nationality' AND f.normalized_value = 'belgium') OR
  (c.normalized_name = 'kevin de bruyne' AND f.normalized_key = 'position' AND f.normalized_value = 'midfielder') OR
  (c.normalized_name = 'kevin de bruyne' AND f.normalized_key = 'retired' AND f.normalized_value = 'no') OR
  (c.normalized_name = 'kevin de bruyne' AND f.normalized_key = 'club' AND f.normalized_value = 'manchester city') OR
  (c.normalized_name = 'kevin de bruyne' AND f.normalized_key = 'award' AND f.normalized_value = 'champions league') OR
  
  -- Neymar
  (c.normalized_name = 'neymar' AND f.normalized_key = 'continent' AND f.normalized_value = 'south america') OR
  (c.normalized_name = 'neymar' AND f.normalized_key = 'nationality' AND f.normalized_value = 'brazil') OR
  (c.normalized_name = 'neymar' AND f.normalized_key = 'position' AND f.normalized_value = 'forward') OR
  (c.normalized_name = 'neymar' AND f.normalized_key = 'retired' AND f.normalized_value = 'no') OR
  (c.normalized_name = 'neymar' AND f.normalized_key = 'award' AND f.normalized_value = 'champions league') OR
  
  -- Karim Benzema
  (c.normalized_name = 'karim benzema' AND f.normalized_key = 'continent' AND f.normalized_value = 'europe') OR
  (c.normalized_name = 'karim benzema' AND f.normalized_key = 'nationality' AND f.normalized_value = 'france') OR
  (c.normalized_name = 'karim benzema' AND f.normalized_key = 'position' AND f.normalized_value = 'forward') OR
  (c.normalized_name = 'karim benzema' AND f.normalized_key = 'retired' AND f.normalized_value = 'no') OR
  (c.normalized_name = 'karim benzema' AND f.normalized_key = 'club' AND f.normalized_value = 'al nassr') OR
  (c.normalized_name = 'karim benzema' AND f.normalized_key = 'award' AND f.normalized_value = 'champions league') OR
  (c.normalized_name = 'karim benzema' AND f.normalized_key = 'award' AND f.normalized_value = 'ballon dor') OR
  
  -- Luka Modrić
  (c.normalized_name = 'luka modric' AND f.normalized_key = 'continent' AND f.normalized_value = 'europe') OR
  (c.normalized_name = 'luka modric' AND f.normalized_key = 'nationality' AND f.normalized_value = 'croatia') OR
  (c.normalized_name = 'luka modric' AND f.normalized_key = 'position' AND f.normalized_value = 'midfielder') OR
  (c.normalized_name = 'luka modric' AND f.normalized_key = 'retired' AND f.normalized_value = 'no') OR
  (c.normalized_name = 'luka modric' AND f.normalized_key = 'club' AND f.normalized_value = 'real madrid') OR
  (c.normalized_name = 'luka modric' AND f.normalized_key = 'award' AND f.normalized_value = 'champions league') OR
  (c.normalized_name = 'luka modric' AND f.normalized_key = 'award' AND f.normalized_value = 'ballon dor') OR
  
  -- Robert Lewandowski
  (c.normalized_name = 'robert lewandowski' AND f.normalized_key = 'continent' AND f.normalized_value = 'europe') OR
  (c.normalized_name = 'robert lewandowski' AND f.normalized_key = 'nationality' AND f.normalized_value = 'poland') OR
  (c.normalized_name = 'robert lewandowski' AND f.normalized_key = 'position' AND f.normalized_value = 'forward') OR
  (c.normalized_name = 'robert lewandowski' AND f.normalized_key = 'retired' AND f.normalized_value = 'no') OR
  (c.normalized_name = 'robert lewandowski' AND f.normalized_key = 'club' AND f.normalized_value = 'barcelona') OR
  (c.normalized_name = 'robert lewandowski' AND f.normalized_key = 'award' AND f.normalized_value = 'champions league')
)
ON CONFLICT (player_id, feature_id) DO NOTHING;

COMMIT;

-- =====================================================
-- ✅ Verification Queries
-- =====================================================

SELECT '✅ RESET COMPLETE!' as status;

SELECT 
  'Features' as table_name,
  COUNT(*) as count,
  '40-50' as expected
FROM public.features
UNION ALL
SELECT 
  'Questions',
  COUNT(*),
  '30-40'
FROM public.questions_metadata
UNION ALL
SELECT 
  'Player Features',
  COUNT(*),
  '40-60'
FROM public.player_features
UNION ALL
SELECT 
  'Game Sessions (should be 0)',
  COUNT(*),
  '0'
FROM public.game_sessions
UNION ALL
SELECT 
  'League Features (should be 0)',
  COUNT(*),
  '0'
FROM public.features WHERE normalized_key = 'league';
