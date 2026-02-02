const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

function createSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!url || !key) {
    console.error('❌ Missing Supabase credentials');
    console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env');
    process.exit(1);
  }
  
  return createClient(url, key, {
    auth: { persistSession: false }
  });
}

async function addChangelogEntry() {
  const supabase = createSupabaseClient();
  
  // Check if entry already exists
  const { data: existing } = await supabase
    .from('project_changelogs')
    .select('id')
    .eq('version', 'v1.0.0')
    .limit(1);
  
  if (Array.isArray(existing) && existing.length > 0) {
    console.log('✅ Changelog entry v1.0.0 already exists');
    return;
  }
  
  // Insert new changelog entry
  const { data, error } = await supabase
    .from('project_changelogs')
    .insert([{
      version: 'v1.0.0',
      update_type: 'MAJOR_VERSION',
      summary: 'إصدار أولي كامل للعبة PlayerQI - لعبة تخمين اللاعبين باستخدام الذكاء الاصطناعي',
      features: [
        'نظام أسئلة ذكي يتكيف مع إجابات اللاعب',
        'قاعدة بيانات تحتوي على 50 لاعب كرة قدم شهير',
        'واجهة مستخدم عربية سلسة وجذابة',
        'نظام تتبع التقدم والإحصائيات',
        'دعم الأجهزة المحمولة'
      ],
      fixes: [
        'تحسين أداء تحميل البيانات',
        'إصلاح مشاكل التوافق مع المتصفحات المختلفة'
      ],
      is_published: true
    }])
    .select('id,version,update_type,release_date')
    .maybeSingle();
  
  if (error) {
    console.error('❌ Failed to insert changelog:', error);
    process.exit(1);
  }
  
  console.log(`✅ Published changelog ${data?.version || 'v1.0.0'} (${data?.update_type || 'MAJOR_VERSION'})`);
  console.log(`📅 Release date: ${data?.release_date || new Date().toISOString()}`);
}

// Run the script
addChangelogEntry().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});