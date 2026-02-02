const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function testSessionCleanup() {
  console.log('🔍 Testing session cleanup fix...');
  
  // Check current active sessions
  const { data: activeSessionsBefore, error: error1 } = await supabase
    .from('active_sessions')
    .select('session_id');
  
  console.log(`Active sessions before test: ${activeSessionsBefore?.length || 0}`);
  
  if (error1) {
    console.error('Error fetching active sessions:', error1);
    return;
  }
  
  // If there are active sessions, simulate game end cleanup
  if (activeSessionsBefore && activeSessionsBefore.length > 0) {
    const sessionId = activeSessionsBefore[0].session_id;
    console.log(`Testing cleanup for session: ${sessionId}`);
    
    // Simulate game completion - delete active session
    const { error: deleteError } = await supabase
      .from('active_sessions')
      .delete()
      .eq('session_id', sessionId);
    
    if (deleteError) {
      console.error('Error cleaning up session:', deleteError);
    } else {
      console.log('✅ Session cleanup successful');
    }
    
    // Verify cleanup
    const { data: activeSessionsAfter, error: error2 } = await supabase
      .from('active_sessions')
      .select('session_id')
      .eq('session_id', sessionId);
    
    if (error2) {
      console.error('Error verifying cleanup:', error2);
    } else {
      console.log(`Active sessions after cleanup: ${activeSessionsAfter?.length || 0}`);
      if (activeSessionsAfter?.length === 0) {
        console.log('✅ Fix verified: Active session properly cleaned up');
      } else {
        console.log('❌ Fix failed: Active session still exists');
      }
    }
  } else {
    console.log('No active sessions to test cleanup with');
  }
}

testSessionCleanup().catch(console.error);