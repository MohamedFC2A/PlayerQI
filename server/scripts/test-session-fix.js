/**
 * Test script to verify session cleanup fix
 * This script simulates the game flow and checks if sessions are properly cleaned up
 */

const { createSupabaseClient } = require('./supabaseClient');

async function testSessionCleanup() {
  const supabase = createSupabaseClient();
  
  if (!supabase) {
    console.log('❌ Supabase not configured');
    return;
  }

  console.log('🔍 Testing session cleanup fix...\n');

  try {
    // Test 1: Check current active sessions
    const { data: activeSessionsBefore } = await supabase
      .from('active_sessions_v2')
      .select('session_id');

    console.log(`📊 Active sessions before test: ${activeSessionsBefore?.length || 0}`);

    // Test 2: Create a test session
    const { data: testSession, error: sessionError } = await supabase
      .from('game_sessions')
      .insert({
        history: [],
        rejected_guess_names: [],
        status: 'in_progress'
      })
      .select('id')
      .single();

    if (sessionError) {
      console.log('❌ Failed to create test session:', sessionError.message);
      return;
    }

    const sessionId = testSession.id;
    console.log(`✅ Created test session: ${sessionId}`);

    // Test 3: Create active session v2 record
    const { error: activeError } = await supabase
      .from('active_sessions_v2')
      .insert({
        session_id: sessionId,
        eliminated_players: [],
        confirmed_attributes: [],
        rejected_guesses: [] // This should be empty for fresh start
      });

    if (activeError) {
      console.log('❌ Failed to create active session:', activeError.message);
      return;
    }

    console.log('✅ Active session v2 created');

    // Test 4: Simulate game completion (win scenario)
    console.log('\n🎮 Simulating game completion...');
    
    const { error: winError } = await supabase
      .from('game_sessions')
      .update({ 
        status: 'won',
        guessed_name: 'Test Player',
        correct: true 
      })
      .eq('id', sessionId);

    if (winError) {
      console.log('❌ Failed to update game session:', winError.message);
      return;
    }

    console.log('✅ Game session marked as won');

    // Test 5: Verify cleanup happened
    setTimeout(async () => {
      const { data: activeSessionsAfter } = await supabase
        .from('active_sessions_v2')
        .select('session_id')
        .eq('session_id', sessionId);

      console.log(`📊 Active sessions after game completion: ${activeSessionsAfter?.length || 0}`);

      if (activeSessionsAfter?.length === 0) {
        console.log('✅ SUCCESS: Session properly cleaned up!');
        console.log('✅ Fix verified: No persistence of guessed players across games');
      } else {
        console.log('❌ FAILURE: Session cleanup not working properly');
        console.log('❌ Issue persists: Guessed players may appear in new games');
      }

      // Clean up test data
      await supabase
        .from('game_sessions')
        .delete()
        .eq('id', sessionId);

      console.log('\n🧹 Test data cleaned up');
    }, 1000);

  } catch (error) {
    console.log('❌ Test failed with error:', error.message);
  }
}

// Run the test
if (require.main === module) {
  testSessionCleanup();
}

module.exports = { testSessionCleanup };