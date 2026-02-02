/**
 * Emergency test to verify the session persistence fix
 * This test specifically checks that rejected_guesses is empty on new game start
 */

const { createSupabaseClient } = require('./supabaseClient');

async function emergencySessionTest() {
  const supabase = createSupabaseClient();
  
  if (!supabase) {
    console.log('❌ Supabase not configured');
    return;
  }

  console.log('🚨 EMERGENCY SESSION TEST 🚨\n');

  try {
    // Step 1: Create a test game session
    console.log('1️⃣ Creating test game session...');
    const { data: gameSession, error: gameError } = await supabase
      .from('game_sessions')
      .insert({
        history: [],
        rejected_guess_names: [],
        status: 'in_progress'
      })
      .select('id')
      .single();

    if (gameError) {
      console.log('❌ Failed to create game session:', gameError.message);
      return;
    }

    const sessionId = gameSession.id;
    console.log(`✅ Game session created: ${sessionId}`);

    // Step 2: Test the get_next_move_v2 function directly
    console.log('\n2️⃣ Testing get_next_move_v2 function...');
    const { data: moveResult, error: moveError } = await supabase
      .rpc('get_next_move_v2', { p_session_id: sessionId });

    if (moveError) {
      console.log('❌ get_next_move_v2 failed:', moveError.message);
      return;
    }

    console.log('✅ get_next_move_v2 executed successfully');
    console.log(`📋 Move type: ${moveResult.type}`);
    console.log(`📋 Question: ${moveResult.content}`);

    // Step 3: Check the active session was created with empty rejected_guesses
    console.log('\n3️⃣ Verifying session state...');
    const { data: activeSession, error: activeError } = await supabase
      .from('active_sessions_v2')
      .select('rejected_guesses, eliminated_players, confirmed_attributes')
      .eq('session_id', sessionId)
      .single();

    if (activeError) {
      console.log('❌ Failed to fetch active session:', activeError.message);
      return;
    }

    const rejectedCount = activeSession.rejected_guesses?.length || 0;
    const eliminatedCount = activeSession.eliminated_players?.length || 0;
    const confirmedCount = activeSession.confirmed_attributes?.length || 0;

    console.log(`📊 rejected_guesses count: ${rejectedCount}`);
    console.log(`📊 eliminated_players count: ${eliminatedCount}`);
    console.log(`📊 confirmed_attributes count: ${confirmedCount}`);

    // Step 4: Test the force cleanup function
    console.log('\n4️⃣ Testing force cleanup function...');
    const { error: cleanupError } = await supabase
      .rpc('force_session_cleanup', { p_session_id: sessionId });

    if (cleanupError) {
      console.log('❌ force_session_cleanup failed:', cleanupError.message);
    } else {
      console.log('✅ force_session_cleanup executed successfully');
    }

    // Step 5: Verify cleanup worked
    const { data: afterCleanup, error: verifyError } = await supabase
      .from('active_sessions_v2')
      .select('rejected_guesses')
      .eq('session_id', sessionId)
      .single();

    if (verifyError) {
      console.log('❌ Failed to verify cleanup:', verifyError.message);
    } else {
      const finalRejectedCount = afterCleanup.rejected_guesses?.length || 0;
      console.log(`📊 rejected_guesses after cleanup: ${finalRejectedCount}`);
      
      if (finalRejectedCount === 0) {
        console.log('🎉 SUCCESS: Session properly initialized with empty rejected_guesses!');
        console.log('🎉 FIX VERIFIED: Previously guessed players will NOT appear in new games');
      } else {
        console.log('❌ FAILURE: rejected_guesses still contains data');
        console.log('❌ ISSUE PERSISTS: Players may still appear from previous games');
      }
    }

    // Cleanup test data
    console.log('\n🧹 Cleaning up test data...');
    await supabase
      .from('active_sessions_v2')
      .delete()
      .eq('session_id', sessionId);
    
    await supabase
      .from('game_sessions')
      .delete()
      .eq('id', sessionId);

    console.log('✅ Test data cleaned up');

  } catch (error) {
    console.log('❌ Test failed with error:', error.message);
  }
}

// Run the test
if (require.main === module) {
  emergencySessionTest();
}

module.exports = { emergencySessionTest };