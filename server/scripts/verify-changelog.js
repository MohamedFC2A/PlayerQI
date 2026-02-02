const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

supabase.from('project_changelogs')
  .select('id,version,update_type,is_published,release_date,summary')
  .then(result => {
    console.log('Changelog entries:');
    result.data.forEach(entry => {
      console.log(`- ${entry.version} (${entry.update_type}): ${entry.summary}`);
    });
  })
  .catch(console.error);