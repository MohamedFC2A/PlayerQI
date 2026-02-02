# PlayerQI v2.0 Database Reset Instructions

## 🚨 Problem Fixed

The error `column "semantic_vector" does not exist` occurred due to conflicts between old and new schema versions.

## ✅ Solution Applied

1. **Removed conflicting semantic_vector column** from schema_v2.sql
2. **Created clean reset script** that drops all old schema elements
3. **Provided step-by-step reset instructions**

## 🛠️ How to Reset Your Database

### Option 1: Using the Simple Reset Script (RECOMMENDED - Fewer Dependencies)
```bash
# Navigate to supabase directory
cd server/supabase

# Run the simple reset script
# Replace YOUR_DATABASE_URL with your actual Supabase connection string
psql YOUR_DATABASE_URL -f simple_reset_v2.sql
```

### Option 2: Using the Full Reset Script
```bash
# Navigate to supabase directory
cd server/supabase

# Run the comprehensive reset and upgrade script
psql YOUR_DATABASE_URL -f reset_and_upgrade_v2.sql
```

### Option 3: Manual Reset Steps
If you prefer to do it manually:

1. **Connect to your Supabase database**
2. **Run this cleanup query first:**
```sql
-- Clean slate - removes all conflicting objects
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
```

3. **Then apply the simple schema:**
```bash
psql YOUR_DATABASE_URL -f simple_reset_v2.sql
```

## 🔧 What Was Fixed

- Removed `semantic_vector` column that was causing conflicts
- Created comprehensive reset script that handles all old schema cleanup
- Ensured clean separation between v1 and v2 schemas
- **Fixed critical session cleanup bug** that caused guessed players to persist across games
- Added proper error handling and verification
- Implemented automatic cleanup when games end

## 📋 Verification

After running the reset, you can verify success by checking:

```sql
-- Should return 7 tables
SELECT COUNT(*) as table_count 
FROM information_schema.tables 
WHERE table_schema = 'public';

-- Should show the new v2 tables
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public'
ORDER BY table_name;
```

Expected tables:
- active_sessions_v2
- attributes  
- game_sessions
- player_behavior_profiles
- player_features
- player_profiles
- players

## ⚠️ Important Notes

- **Backup your data** before running the reset
- The reset will **delete all existing game data**
- Only run this on development/staging environments first
- Test thoroughly before applying to production

## 🎯 Next Steps

After successful database reset:
1. Restart your Node.js server
2. Test the new v2 endpoints
3. Verify the monitoring dashboard works
4. Check that the knowledge expander runs properly
5. **Run the session cleanup test:** `node server/scripts/test-session-fix.js`
6. Test that guessed players don't persist across games

## 🐛 Known Issues Fixed

- **Session Persistence Bug**: Previously guessed players no longer appear immediately in new games
- **Database Column Conflicts**: All schema conflicts resolved
- **Table Dependency Errors**: Proper table creation order implemented

The system should now work without the semantic_vector error or session persistence issues!