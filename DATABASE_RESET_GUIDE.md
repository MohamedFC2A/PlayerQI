# 🗑️ Database Reset Guide - PlayerQI

## 🔴 المشكلة
الـ database فيها بيانات قديمة من الـ AI السابق:
- ❌ أسئلة مكررة وسيئة
- ❌ Question transitions خاطئة
- ❌ Features عن "league" (ممنوعة الآن!)
- ❌ Player features خاطئة
- ❌ Game sessions من اللعب السيئ

## ✅ الحل: Reset كامل للـ Database

### Method 1: Supabase SQL Editor (موصى به)

1. افتح **Supabase Dashboard**:
   ```
   https://supabase.com/dashboard/project/YOUR_PROJECT_ID
   ```

2. اذهب إلى **SQL Editor** من القائمة اليسرى

3. افتح الملف:
   ```
   server/supabase/reset_database.sql
   ```

4. انسخ **كل المحتوى** والصقه في SQL Editor

5. اضغط **Run** أو **F5**

6. انتظر حتى يكتمل (قد يأخذ 10-30 ثانية)

7. تحقق من النتائج:
   ```sql
   -- يجب أن يكون 0
   SELECT COUNT(*) FROM game_sessions;
   SELECT COUNT(*) FROM features WHERE normalized_key = 'league';
   
   -- يجب أن يكون > 0
   SELECT COUNT(*) FROM features;
   SELECT COUNT(*) FROM questions_metadata;
   ```

### Method 2: Using psql (للمتقدمين)

```bash
# Get your connection string from Supabase
psql "postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres" \
  -f server/supabase/reset_database.sql
```

### Method 3: Node.js Script (إذا فشلت الطرق السابقة)

أنشئ ملف `reset-db.js`:

```javascript
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function resetDatabase() {
  console.log('🗑️ Deleting old data...');
  
  // Delete in correct order (respecting foreign keys)
  await supabase.from('game_moves').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('game_sessions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('questions_metadata').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('player_features').delete().neq('player_id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('features').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  
  console.log('✅ Old data deleted!');
  console.log('✨ Use SQL Editor to run the INSERT statements from reset_database.sql');
}

resetDatabase();
```

Run:
```bash
node reset-db.js
```

## 📊 ما يتم حذفه

| Table | محتوى | سبب الحذف |
|-------|-------|----------|
| `game_sessions` | جلسات اللعب القديمة | محفوظة من الـ AI الغبي |
| `game_moves` | الحركات في الألعاب | مرتبطة بأسئلة سيئة |
| `questions_metadata` | الأسئلة المخزنة | أسئلة قديمة ومكررة |
| `player_features` | صفات اللاعبين | تعلم خاطئ من AI سيئ |
| `features` | التصنيفات | فيها "league" ممنوع |
| `question_nodes` | عقد الأسئلة | Paths قديمة |
| `question_transitions` | انتقالات الأسئلة | Logic خاطئ |
| `player_paths` | مسارات اللاعبين | من AI غبي |

## ✨ ما يتم إدراجه

### 1. Features الجديدة (بدون league!)

- **Continents**: Europe, South America, Africa, Asia
- **Nationalities**: Argentina, Portugal, Egypt, France, Norway, Brazil, etc.
- **Positions**: Forward, Midfielder, Defender, Goalkeeper
- **Retired**: Yes, No
- **Clubs**: Manchester City, Liverpool, Real Madrid, Barcelona, etc.
- **Awards**: World Cup, Champions League, Ballon d'Or

### 2. Questions استراتيجية

أسئلة ذكية مثل:
- "هل يلعب في أوروبا؟" (continent)
- "هل اعتزل اللعب؟" (retired)
- "هل يلعب كمهاجم؟" (position)
- "هل لعب لريال مدريد؟" (club)
- "هل فاز بكأس العالم؟" (award)

### 3. Player Features صحيحة

مثال:
```
Messi:
- Continent: South America
- Nationality: Argentina  
- Position: Forward
- Retired: No
- Club: Inter Miami
- Awards: World Cup, Ballon d'Or, Champions League
```

## 🎯 Verification

بعد الـ reset، تأكد:

```sql
-- 1. No league features
SELECT * FROM features WHERE normalized_key = 'league';
-- Expected: 0 rows

-- 2. Fresh features exist
SELECT COUNT(*) FROM features;
-- Expected: 40-50

-- 3. Fresh questions exist
SELECT COUNT(*) FROM questions_metadata;
-- Expected: 25-35

-- 4. Player features exist
SELECT COUNT(*) FROM player_features;
-- Expected: 30-50

-- 5. No old games
SELECT COUNT(*) FROM game_sessions;
-- Expected: 0

-- 6. Check a sample player
SELECT f.feature_key, f.feature_value 
FROM player_features pf
JOIN features f ON f.id = pf.feature_id
JOIN candidates c ON c.id = pf.player_id
WHERE c.normalized_name = 'mohamed salah';
-- Should show: africa, egypt, forward, liverpool, champions league, etc.
```

## ⚠️ Important Notes

1. **Backup First**: إذا كان عندك بيانات مهمة، خذ backup أولاً
2. **Cannot Undo**: هذا العملية **لا يمكن التراجع عنها**
3. **Service Role Key**: تأكد إن عندك `SUPABASE_SERVICE_ROLE_KEY` في `.env`
4. **Test After**: جرب اللعبة بعد الـ reset للتأكد

## 🚀 After Reset

1. Restart server:
   ```bash
   cd server
   npm start
   ```

2. Test game:
   ```bash
   cd client
   npm run dev
   ```

3. الـ AI الآن يجب أن يسأل أسئلة ذكية مثل:
   ```
   Q1: "هل يلعب في أوروبا؟"
   Q2: "هل اعتزل اللعب؟"
   Q3: "هل يلعب كمهاجم؟"
   ...
   ```

## 🐛 Troubleshooting

### Error: "relation does not exist"
بعض الـ tables قد لا تكون موجودة. هذا طبيعي، الـ script يتعامل معها.

### Error: "permission denied"
تأكد إنك بتستخدم `service_role` key مش `anon` key.

### Data not clearing
جرب run الـ DELETE statements واحد واحد في SQL Editor.

### Insert fails
تأكد إن الـ DELETE خلص أولاً قبل الـ INSERT.
