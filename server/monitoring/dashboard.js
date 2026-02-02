/**
 * PlayerQI v2.0 Monitoring Dashboard
 * Real-time performance and analytics monitoring
 */

const express = require('express');
const { createSupabaseClient } = require('./supabaseClient');

const app = express();
const supabase = createSupabaseClient();

app.use(express.json());
app.use(express.static('public')); // Serve static dashboard files

// CORS for dashboard access
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

/**
 * System Health Endpoint
 */
app.get('/api/monitoring/health', async (req, res) => {
  try {
    // Database connectivity check
    const dbHealth = await checkDatabaseHealth();
    
    // System metrics
    const metrics = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: getCPUUsage(),
      timestamp: new Date().toISOString()
    };

    res.json({
      status: 'healthy',
      database: dbHealth,
      system: metrics,
      engine: 'hyper-speed-v2'
    });

  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

/**
 * Performance Metrics Endpoint
 */
app.get('/api/monitoring/performance', async (req, res) => {
  try {
    const timeframe = req.query.timeframe || '24h';
    
    const metrics = await getPerformanceMetrics(timeframe);
    res.json(metrics);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Game Analytics Endpoint
 */
app.get('/api/monitoring/analytics', async (req, res) => {
  try {
    const analytics = await getGameAnalytics();
    res.json(analytics);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Knowledge Base Status
 */
app.get('/api/monitoring/knowledge', async (req, res) => {
  try {
    const knowledgeStatus = await getKnowledgeBaseStatus();
    res.json(knowledgeStatus);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper functions
async function checkDatabaseHealth() {
  if (!supabase) return { status: 'disconnected' };

  try {
    const { data, error } = await supabase
      .from('players')
      .select('count()', { count: 'exact' })
      .limit(1);

    return {
      status: error ? 'degraded' : 'healthy',
      playerCount: data ? data[0]?.count || 0 : 0,
      error: error?.message || null
    };
  } catch (error) {
    return { status: 'error', error: error.message };
  }
}

function getCPUUsage() {
  // Simple CPU usage estimation
  const startUsage = process.cpuUsage();
  const startTime = Date.now();
  
  // Busy wait for a short time to measure CPU
  const now = Date.now();
  while (Date.now() - now < 10) {
    // Busy wait
  }
  
  const endUsage = process.cpuUsage(startUsage);
  const endTime = Date.now();
  
  const cpuPercent = (endUsage.user + endUsage.system) / 1000 / (endTime - startTime);
  return Math.round(cpuPercent * 100) / 100;
}

async function getPerformanceMetrics(timeframe) {
  if (!supabase) return { error: 'Database not configured' };

  try {
    // Get recent game sessions for performance analysis
    const { data: sessions } = await supabase
      .from('game_sessions')
      .select('created_at, duration_ms, question_count, correct')
      .gte('created_at', getTimeframeStart(timeframe))
      .order('created_at', { ascending: false })
      .limit(1000);

    if (!sessions || sessions.length === 0) {
      return { message: 'No data available' };
    }

    // Calculate metrics
    const totalSessions = sessions.length;
    const avgDuration = sessions.reduce((sum, s) => sum + (s.duration_ms || 0), 0) / totalSessions;
    const avgQuestions = sessions.reduce((sum, s) => sum + (s.question_count || 0), 0) / totalSessions;
    const successRate = sessions.filter(s => s.correct).length / totalSessions;

    // Response time distribution
    const responseTimes = sessions
      .map(s => s.duration_ms)
      .filter(t => t > 0)
      .sort((a, b) => a - b);

    const percentiles = {
      p50: responseTimes[Math.floor(responseTimes.length * 0.5)] || 0,
      p90: responseTimes[Math.floor(responseTimes.length * 0.9)] || 0,
      p95: responseTimes[Math.floor(responseTimes.length * 0.95)] || 0,
      p99: responseTimes[Math.floor(responseTimes.length * 0.99)] || 0
    };

    return {
      period: timeframe,
      totalSessions,
      averageDuration: Math.round(avgDuration),
      averageQuestions: Math.round(avgQuestions),
      successRate: Math.round(successRate * 100) / 100,
      responseTimePercentiles: percentiles,
      sampleSize: responseTimes.length
    };

  } catch (error) {
    return { error: error.message };
  }
}

async function getGameAnalytics() {
  if (!supabase) return { error: 'Database not configured' };

  try {
    // Get behavioral profile statistics
    const { data: behaviorStats } = await supabase
      .from('player_behavior_profiles')
      .select('response_pattern, consistency_score, difficulty_preference')
      .limit(1000);

    // Get question effectiveness data
    const { data: questionStats } = await supabase
      .rpc('get_matrix_gaps', { limit_count: 50 });

    // Analyze behavioral patterns
    const behaviorAnalysis = analyzeBehaviorPatterns(behaviorStats || []);

    return {
      behavioralInsights: behaviorAnalysis,
      knowledgeGaps: questionStats ? questionStats.length : 0,
      matrixCompleteness: calculateMatrixCompleteness()
    };

  } catch (error) {
    return { error: error.message };
  }
}

async function getKnowledgeBaseStatus() {
  if (!supabase) return { error: 'Database not configured' };

  try {
    // Count total players and attributes
    const { data: playerCount } = await supabase
      .from('players')
      .select('count()', { count: 'exact' });

    const { data: attributeCount } = await supabase
      .from('attributes')
      .select('count()', { count: 'exact' });

    // Count filled matrix entries
    const { data: featureCount } = await supabase
      .from('player_features')
      .select('count()', { count: 'exact' });

    const totalPossible = (playerCount?.[0]?.count || 0) * (attributeCount?.[0]?.count || 0);
    const filledPercentage = totalPossible > 0 
      ? Math.round((featureCount?.[0]?.count || 0) / totalPossible * 10000) / 100
      : 0;

    return {
      players: playerCount?.[0]?.count || 0,
      attributes: attributeCount?.[0]?.count || 0,
      filledEntries: featureCount?.[0]?.count || 0,
      completeness: filledPercentage,
      gaps: totalPossible - (featureCount?.[0]?.count || 0)
    };

  } catch (error) {
    return { error: error.message };
  }
}

function analyzeBehaviorPatterns(behaviors) {
  if (behaviors.length === 0) return {};

  const patterns = {};
  let totalConsistency = 0;

  behaviors.forEach(b => {
    const pattern = b.response_pattern || 'unknown';
    patterns[pattern] = (patterns[pattern] || 0) + 1;
    totalConsistency += b.consistency_score || 0;
  });

  return {
    distribution: patterns,
    averageConsistency: Math.round((totalConsistency / behaviors.length) * 100) / 100,
    totalProfiles: behaviors.length
  };
}

function calculateMatrixCompleteness() {
  // Placeholder for more sophisticated completeness calculation
  return 'calculating...';
}

function getTimeframeStart(timeframe) {
  const now = new Date();
  switch (timeframe) {
    case '1h': now.setHours(now.getHours() - 1); break;
    case '6h': now.setHours(now.getHours() - 6); break;
    case '12h': now.setHours(now.getHours() - 12); break;
    case '24h': now.setDate(now.getDate() - 1); break;
    case '7d': now.setDate(now.getDate() - 7); break;
    default: now.setDate(now.getDate() - 1);
  }
  return now.toISOString();
}

// Start monitoring server
const PORT = process.env.MONITORING_PORT || 3001;
app.listen(PORT, () => {
  console.log(`📊 PlayerQI Monitoring Dashboard running on port ${PORT}`);
});

module.exports = app;