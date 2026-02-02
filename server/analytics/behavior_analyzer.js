/**
 * Behavior Analyzer - Lightweight behavioral pattern detection
 * Simple heuristic-based analysis without complex ML
 */

class BehaviorAnalyzer {
  constructor() {
    this.patterns = new Map(); // Store session patterns
  }

  /**
   * Analyze player behavior from response history
   * @param {Array} history - Response history array
   * @param {number} avgResponseTime - Average response time
   * @returns {Object} Behavioral analysis results
   */
  analyzeBehavior(history, avgResponseTime) {
    if (!Array.isArray(history) || history.length === 0) {
      return this.getDefaultAnalysis();
    }

    const analysis = {
      responsePattern: this.determineResponsePattern(avgResponseTime),
      consistencyScore: this.calculateConsistency(history),
      answeringStyle: this.identifyAnsweringStyle(history),
      culturalIndicators: this.detectCulturalPreferences(history),
      difficultyAdaptation: this.assessDifficultyAdaptation(history),
      engagementLevel: this.measureEngagement(history)
    };

    return analysis;
  }

  /**
   * Determine response pattern based on timing
   * @param {number} avgResponseTime - Average response time in ms
   * @returns {string} Pattern classification
   */
  determineResponsePattern(avgResponseTime) {
    if (avgResponseTime < 1000) return 'impulsive';      // Very fast responses
    if (avgResponseTime < 2000) return 'quick';          // Fast responses
    if (avgResponseTime < 5000) return 'moderate';       // Normal responses
    if (avgResponseTime < 10000) return 'thoughtful';    // Slow, considered
    return 'deliberate';                                 // Very slow responses
  }

  /**
   * Calculate answer consistency score
   * @param {Array} history - Response history
   * @returns {number} Consistency score (0-1)
   */
  calculateConsistency(history) {
    if (history.length < 2) return 1.0;

    let contradictions = 0;
    let totalComparisons = 0;

    // Check adjacent responses for logical consistency
    for (let i = 0; i < history.length - 1; i++) {
      const current = history[i];
      const next = history[i + 1];

      // Skip if either response is uncertain
      if (current.answer_kind === 'unknown' || next.answer_kind === 'unknown') {
        continue;
      }

      // Check for obvious contradictions in positioning
      const positionContradictions = this.checkPositionContradictions(current, next);
      const leagueContradictions = this.checkLeagueContradictions(current, next);
      
      if (positionContradictions || leagueContradictions) {
        contradictions++;
      }
      
      totalComparisons++;
    }

    return totalComparisons > 0 ? 1.0 - (contradictions / totalComparisons) : 1.0;
  }

  /**
   * Check for position-related contradictions
   */
  checkPositionContradictions(resp1, resp2) {
    const positionKeywords = {
      forward: ['مهاجم', 'striker', 'forward', 'هجوم'],
      defender: ['مدافع', 'defender', 'دفاع'],
      midfielder: ['وسط', 'midfielder', 'وسطاء'],
      goalkeeper: ['حارس', 'goalkeeper', 'مرمى']
    };

    const q1 = resp1.question?.toLowerCase() || '';
    const q2 = resp2.question?.toLowerCase() || '';
    const a1 = resp1.answer_kind;
    const a2 = resp2.answer_kind;

    // If both questions are about position and answers contradict...
    for (const [position, keywords] of Object.entries(positionKeywords)) {
      if (keywords.some(kw => q1.includes(kw)) && keywords.some(kw => q2.includes(kw))) {
        // Same position category - check if answers contradict
        if ((a1 === 'yes' && a2 === 'no') || (a1 === 'no' && a2 === 'yes')) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check for league-related contradictions
   */
  checkLeagueContradictions(resp1, resp2) {
    const leagueGroups = {
      european: ['دوري أبطال أوروبا', 'champions league', 'europe'],
      premier: ['الدوري الإنجليزي', 'premier league', 'england'],
      spanish: ['لا ليجا', 'la liga', 'spain'],
      german: ['البوندسليجا', 'bundesliga', 'germany']
    };

    const q1 = resp1.question?.toLowerCase() || '';
    const q2 = resp2.question?.toLowerCase() || '';

    // Check if questions are about different leagues but both answered yes
    let league1 = null, league2 = null;
    
    for (const [league, keywords] of Object.entries(leagueGroups)) {
      if (keywords.some(kw => q1.includes(kw))) league1 = league;
      if (keywords.some(kw => q2.includes(kw))) league2 = league;
    }

    // Different leagues both answered "yes" could indicate inconsistency
    if (league1 && league2 && league1 !== league2) {
      return resp1.answer_kind === 'yes' && resp2.answer_kind === 'yes';
    }

    return false;
  }

  /**
   * Identify answering style patterns
   * @param {Array} history - Response history
   * @returns {Object} Answering style metrics
   */
  identifyAnsweringStyle(history) {
    const answerCounts = {
      yes: 0,
      no: 0,
      maybe: 0,
      unknown: 0
    };

    history.forEach(item => {
      const answer = item.answer_kind || 'unknown';
      if (answerCounts.hasOwnProperty(answer)) {
        answerCounts[answer]++;
      }
    });

    const total = history.length;
    return {
      yesRatio: total > 0 ? answerCounts.yes / total : 0,
      noRatio: total > 0 ? answerCounts.no / total : 0,
      uncertaintyRatio: total > 0 ? (answerCounts.maybe + answerCounts.unknown) / total : 0,
      decisiveness: 1 - (answerCounts.maybe + answerCounts.unknown) / Math.max(total, 1)
    };
  }

  /**
   * Detect cultural/regional preferences
   * @param {Array} history - Response history
   * @returns {Object} Cultural indicators
   */
  detectCulturalPreferences(history) {
    const regionalMentions = {
      egyptian: 0,
      saudi: 0,
      emirati: 0,
      qatari: 0,
      european: 0,
      south_american: 0
    };

    const regionalKeywords = {
      egyptian: ['egypt', 'مصر', 'cairo'],
      saudi: ['saudi', 'السعودية', 'riyadh'],
      emirati: ['uae', 'emirates', 'الإمارات', 'dubai'],
      qatari: ['qatar', 'قطر', 'doha'],
      european: ['europe', 'أوروبا', 'european'],
      south_american: ['south america', 'أمريكا الجنوبية', 'brazil', 'argentina']
    };

    history.forEach(item => {
      const question = (item.question || '').toLowerCase();
      
      for (const [region, keywords] of Object.entries(regionalKeywords)) {
        if (keywords.some(keyword => question.includes(keyword))) {
          regionalMentions[region]++;
        }
      }
    });

    // Find dominant region
    let dominantRegion = 'global';
    let maxMentions = 0;
    
    for (const [region, mentions] of Object.entries(regionalMentions)) {
      if (mentions > maxMentions) {
        maxMentions = mentions;
        dominantRegion = region;
      }
    }

    return {
      dominantRegion,
      regionalFocus: maxMentions / Math.max(history.length, 1),
      regionalDistribution: regionalMentions
    };
  }

  /**
   * Assess difficulty adaptation
   * @param {Array} history - Response history
   * @returns {Object} Difficulty adaptation metrics
   */
  assessDifficultyAdaptation(history) {
    if (history.length < 3) {
      return { trend: 'insufficient_data', adaptationScore: 0.5 };
    }

    // Simple trend analysis: do responses become more decisive over time?
    const earlyResponses = history.slice(0, Math.floor(history.length / 2));
    const lateResponses = history.slice(Math.floor(history.length / 2));

    const earlyUncertainty = this.calculateUncertainty(earlyResponses);
    const lateUncertainty = this.calculateUncertainty(lateResponses);

    const trend = lateUncertainty < earlyUncertainty ? 'improving' : 
                  lateUncertainty > earlyUncertainty ? 'declining' : 'stable';

    // Adaptation score based on improvement
    const adaptationScore = Math.max(0, Math.min(1, 1 - (lateUncertainty / Math.max(earlyUncertainty, 0.1))));

    return {
      trend,
      adaptationScore,
      earlyUncertainty,
      lateUncertainty
    };
  }

  /**
   * Calculate uncertainty ratio in responses
   */
  calculateUncertainty(responses) {
    const uncertain = responses.filter(r => 
      r.answer_kind === 'maybe' || r.answer_kind === 'unknown'
    ).length;
    return uncertain / Math.max(responses.length, 1);
  }

  /**
   * Measure engagement level
   * @param {Array} history - Response history
   * @returns {number} Engagement score (0-1)
   */
  measureEngagement(history) {
    if (history.length === 0) return 0.5;

    // Factors affecting engagement:
    // 1. Response completion rate
    // 2. Time investment (longer games = higher engagement)
    // 3. Consistent participation
    
    const completionRate = history.length / Math.max(15, history.length); // Target 15 questions
    const timeInvestment = Math.min(1, history.length / 10); // Cap at 10 questions
    
    // Check for dropped sessions (sudden stops)
    const hasDropouts = this.detectDropouts(history);
    const continuityBonus = hasDropouts ? 0.8 : 1.0;

    return Math.min(1, completionRate * timeInvestment * continuityBonus);
  }

  /**
   * Detect session dropouts
   */
  detectDropouts(history) {
    if (history.length < 3) return false;

    // Look for unusually long gaps between responses
    for (let i = 1; i < history.length; i++) {
      const timeDiff = (history[i].timestamp || Date.now()) - (history[i-1].timestamp || 0);
      if (timeDiff > 300000) { // 5 minute gap
        return true;
      }
    }
    return false;
  }

  /**
   * Get default analysis when insufficient data
   */
  getDefaultAnalysis() {
    return {
      responsePattern: 'moderate',
      consistencyScore: 0.8,
      answeringStyle: {
        yesRatio: 0.33,
        noRatio: 0.33,
        uncertaintyRatio: 0.34,
        decisiveness: 0.66
      },
      culturalIndicators: {
        dominantRegion: 'global',
        regionalFocus: 0,
        regionalDistribution: {}
      },
      difficultyAdaptation: {
        trend: 'insufficient_data',
        adaptationScore: 0.5
      },
      engagementLevel: 0.5
    };
  }

  /**
   * Generate behavioral profile summary
   * @param {Object} analysis - Full behavioral analysis
   * @returns {string} Human-readable profile summary
   */
  generateProfileSummary(analysis) {
    const patterns = [];
    
    // Response pattern
    const patternLabels = {
      'impulsive': 'مستجيب سريع جداً',
      'quick': 'مستجيب سريع',
      'moderate': 'متوسط السرعة',
      'thoughtful': 'متأمل',
      'deliberate': 'متردد'
    };
    patterns.push(patternLabels[analysis.responsePattern] || 'عادي');
    
    // Consistency
    if (analysis.consistencyScore > 0.8) {
      patterns.push('متسق');
    } else if (analysis.consistencyScore < 0.5) {
      patterns.push('غير متسق');
    }
    
    // Decisiveness
    if (analysis.answeringStyle.decisiveness > 0.8) {
      patterns.push('حازم');
    } else if (analysis.answeringStyle.decisiveness < 0.3) {
      patterns.push('متردّد');
    }
    
    return patterns.join(' - ');
  }
}

module.exports = BehaviorAnalyzer;