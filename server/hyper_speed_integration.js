/**
 * PlayerQI v2.0 - Hyper-Speed Cognitive Engine Integration
 * Integrates the new in-database logic with existing game flow
 */

const express = require('express');
const { createSupabaseClient } = require('./supabaseClient');
const DeductionEngine = require('./logic/deduction_engine');
const BehaviorAnalyzer = require('./analytics/behavior_analyzer');
const knowledgeExpander = require('./workers/knowledge_expander');

// Initialize components
const supabase = createSupabaseClient();
const deductionEngine = new DeductionEngine(supabase);
const behaviorAnalyzer = new BehaviorAnalyzer();

// Apply the new schema (in production, this would be done separately)
async function initializeSchema() {
  try {
    // This would typically be run manually or via migration script
    console.log('Schema initialization would be run separately');
  } catch (error) {
    console.error('Schema initialization error:', error);
  }
}

/**
 * Enhanced game endpoint using hyper-speed engine
 */
async function handleGameRequest(req, res) {
  try {
    const { history, rejectedGuesses, sessionId, responseTime } = req.body;
    
    if (!Array.isArray(history)) {
      return res.status(400).json({ error: 'Invalid history format' });
    }

    // Ensure session exists
    const validatedSessionId = await ensureSession(sessionId, history, rejectedGuesses);
    
    // Process the latest answer if provided
    if (history.length > 0) {
      const latestMove = history[history.length - 1];
      if (latestMove.question && latestMove.answer) {
        await deductionEngine.processAnswer(
          validatedSessionId,
          latestMove.question,
          latestMove.answer,
          responseTime || latestMove.responseTime
        );
      }
    }

    // Get next move from hyper-speed engine
    const nextMoveResult = await deductionEngine.getNextMove(validatedSessionId);
    
    if (!nextMoveResult.success) {
      throw new Error(nextMoveResult.error);
    }

    // Add session ID to response
    const response = {
      ...nextMoveResult.move,
      session_id: validatedSessionId
    };

    res.json(response);

  } catch (error) {
    console.error('Game request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Enhanced confirmation endpoint with behavioral analysis
 */
async function handleConfirmRequest(req, res) {
  try {
    const { history, guess, correct, sessionId, responseTimes } = req.body;
    
    if (!Array.isArray(history) || typeof guess !== 'string') {
      return res.status(400).json({ error: 'Invalid request format' });
    }

    // Calculate behavioral metrics
    const avgResponseTime = responseTimes && responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : null;

    const behavioralAnalysis = behaviorAnalyzer.analyzeBehavior(history, avgResponseTime);
    
    // Store behavioral profile
    if (sessionId) {
      await storeBehavioralProfile(sessionId, behavioralAnalysis, history.length);
    }

    // Update game session
    if (sessionId && supabase) {
      const updates = {
        status: correct ? 'won' : 'lost',
        guessed_name: guess,
        correct: Boolean(correct),
        question_count: history.length,
        average_response_time: avgResponseTime || null
      };

      await supabase
        .from('game_sessions')
        .update(updates)
        .eq('id', sessionId);
    }

    res.json({
      ok: true,
      correct: Boolean(correct),
      behavioralAnalysis,
      profileSummary: behaviorAnalyzer.generateProfileSummary(behavioralAnalysis)
    });

  } catch (error) {
    console.error('Confirmation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get session analytics endpoint
 */
async function handleAnalyticsRequest(req, res) {
  try {
    const { sessionId } = req.params;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }

    const analyticsResult = await deductionEngine.getSessionAnalytics(sessionId);
    
    if (!analyticsResult.success) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(analyticsResult.analytics);

  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Utility functions
 */

async function ensureSession(sessionId, history, rejectedGuesses) {
  if (!supabase) {
    return sessionId || 'temp-' + Date.now();
  }

  const sessionPayload = {
    history: Array.isArray(history) ? history : [],
    rejected_guess_names: Array.isArray(rejectedGuesses) ? rejectedGuesses : [],
    status: 'in_progress',
    question_count: Array.isArray(history) ? history.length : 0
  };

  if (sessionId && isValidUUID(sessionId)) {
    // Update existing session
    await supabase
      .from('game_sessions')
      .upsert({ id: sessionId, ...sessionPayload }, { onConflict: 'id' });
    return sessionId;
  } else {
    // Create new session
    const { data, error } = await supabase
      .from('game_sessions')
      .insert(sessionPayload)
      .select('id')
      .single();

    if (error) {
      console.error('Session creation error:', error);
      return 'temp-' + Date.now();
    }

    return data.id;
  }
}

async function storeBehavioralProfile(sessionId, analysis, questionCount) {
  if (!supabase) return;

  try {
    await supabase
      .from('player_behavior_profiles')
      .upsert({
        session_id: sessionId,
        response_pattern: analysis.responsePattern,
        average_response_time: analysis.answeringStyle.avgResponseTime,
        consistency_score: analysis.consistencyScore,
        difficulty_preference: determineDifficultyPreference(analysis, questionCount),
        cultural_affinity: analysis.culturalIndicators
      }, {
        onConflict: 'session_id'
      });
  } catch (error) {
    console.error('Failed to store behavioral profile:', error);
  }
}

function determineDifficultyPreference(analysis, questionCount) {
  // Simple heuristic: fewer questions with high consistency = prefers harder questions
  if (questionCount <= 8 && analysis.consistencyScore > 0.8) {
    return 'hard';
  } else if (questionCount >= 12) {
    return 'easy';
  } else {
    return 'medium';
  }
}

function isValidUUID(uuid) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuid && uuidRegex.test(uuid);
}

// Export integration functions
module.exports = {
  handleGameRequest,
  handleConfirmRequest,
  handleAnalyticsRequest,
  initializeSchema,
  // Export instances for testing
  deductionEngine,
  behaviorAnalyzer,
  knowledgeExpander
};