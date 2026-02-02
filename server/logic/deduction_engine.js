/**
 * Deduction Engine - Translates user answers into database filters
 * Implements logical reasoning and state management for the hyper-speed engine
 */

class DeductionEngine {
  constructor(supabaseClient) {
    this.supabase = supabaseClient;
    this.attributeCache = new Map(); // Cache for attribute lookups
  }

  /**
   * Process user answer and update game state
   * @param {string} sessionId - Game session ID
   * @param {string|Object} question - Question text or object with attribute info
   * @param {string} answer - User's answer ('yes', 'no', 'maybe', 'unknown')
   * @param {number} responseTime - Response time in milliseconds
   * @returns {Promise<Object>} Processing result
   */
  async processAnswer(sessionId, question, answer, responseTime = null) {
    try {
      // 1. Resolve question to attribute
      const attribute = await this.resolveQuestionToAttribute(question);
      if (!attribute) {
        throw new Error('Could not resolve question to attribute');
      }

      // 2. Convert answer to standardized format
      const answerValue = this.standardizeAnswer(answer);
      
      // 3. Call database RPC function
      const { data, error } = await this.supabase.rpc('process_answer_v2', {
        p_session_id: sessionId,
        p_attribute_id: attribute.id,
        p_answer_value: answerValue,
        p_response_time: responseTime
      });

      if (error) {
        throw new Error(`Database error: ${error.message}`);
      }

      // 4. Apply deductive logic for related eliminations
      if (answerValue === -1) { // NO answer
        await this.applyLogicalEliminations(sessionId, attribute);
      }

      return {
        success: true,
        attributeId: attribute.id,
        answerValue: answerValue,
        behavioralProfile: data.behavioral_profile,
        message: 'Answer processed successfully'
      };

    } catch (error) {
      console.error('Deduction engine error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get the next optimal move from the database engine
   * @param {string} sessionId - Game session ID
   * @returns {Promise<Object>} Next move recommendation
   */
  async getNextMove(sessionId) {
    try {
      const { data, error } = await this.supabase.rpc('get_next_move_v2', {
        p_session_id: sessionId
      });

      if (error) {
        throw new Error(`Database error: ${error.message}`);
      }

      return {
        success: true,
        move: data
      };

    } catch (error) {
      console.error('Get next move error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Resolve question text to attribute ID
   * @param {string|Object} question - Question text or object
   * @returns {Promise<Object|null>} Attribute object or null
   */
  async resolveQuestionToAttribute(question) {
    const questionText = typeof question === 'string' ? question : question.content;
    const normalizedQuestion = this.normalizeText(questionText);

    // Check cache first
    if (this.attributeCache.has(normalizedQuestion)) {
      return this.attributeCache.get(normalizedQuestion);
    }

    try {
      // Search for exact match
      const { data: exactMatch } = await this.supabase
        .from('attributes')
        .select('id, label_ar, category')
        .eq('label_ar', questionText)
        .maybeSingle();

      if (exactMatch) {
        this.attributeCache.set(normalizedQuestion, exactMatch);
        return exactMatch;
      }

      // Fuzzy search for similar attributes
      const { data: fuzzyMatches } = await this.supabase
        .from('attributes')
        .select('id, label_ar, category')
        .ilike('label_ar', `%${questionText}%`)
        .limit(5);

      if (fuzzyMatches && fuzzyMatches.length > 0) {
        // Return best match (could implement better similarity logic)
        const bestMatch = fuzzyMatches[0];
        this.attributeCache.set(normalizedQuestion, bestMatch);
        return bestMatch;
      }

      return null;

    } catch (error) {
      console.error('Attribute resolution error:', error);
      return null;
    }
  }

  /**
   * Standardize answer to numeric format
   * @param {string} answer - User's answer
   * @returns {number} -1 (no), 0 (maybe/unknown), 1 (yes)
   */
  standardizeAnswer(answer) {
    const normalized = answer.toLowerCase().trim();
    
    if (['yes', 'y', 'نعم', 'true'].includes(normalized)) {
      return 1;
    } else if (['no', 'n', 'لا', 'false'].includes(normalized)) {
      return -1;
    } else {
      return 0; // maybe, unknown, etc.
    }
  }

  /**
   * Apply logical eliminations based on answer semantics
   * @param {string} sessionId - Session ID
   * @param {Object} attribute - Attribute object
   */
  async applyLogicalEliminations(sessionId, attribute) {
    // This would contain logic for eliminating related attributes
    // For example: if "Is he a striker?" = NO, eliminate all forward positions
    
    const eliminationRules = {
      // Position-based eliminations
      'مهاجم': ['wing_forward', 'center_forward', 'second_striker'],
      'مدافع': ['center_back', 'full_back', 'wing_back'],
      'لاعب وسط': ['defensive_midfielder', 'central_midfielder', 'attacking_midfielder'],
      'حارس مرمى': ['goalkeeper'],
      
      // League-based eliminations  
      'يلعب في الدوري الإنجليزي': ['premier_league', 'championship'],
      'يلعب في Ла ليجا': ['la_liga'],
      
      // Regional eliminations
      'من أوروبا': ['european_nationality'],
      'من أمريكا الجنوبية': ['south_american_nationality']
    };

    const attributeKey = attribute.label_ar;
    const relatedAttributes = eliminationRules[attributeKey];
    
    if (relatedAttributes && relatedAttributes.length > 0) {
      // In a full implementation, this would update the session's eliminated attributes
      console.log(`Eliminating related attributes for ${attributeKey}:`, relatedAttributes);
    }
  }

  /**
   * Update user behavioral profile based on response patterns
   * @param {string} sessionId - Session ID
   * @param {Array} history - Response history
   * @returns {string} Behavioral profile classification
   */
  updateUserProfile(sessionId, history) {
    if (!Array.isArray(history) || history.length === 0) {
      return 'normal';
    }

    const responseTimes = history
      .map(h => h.response_time)
      .filter(t => typeof t === 'number');

    if (responseTimes.length === 0) {
      return 'normal';
    }

    const avgTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    
    // Simple heuristic classification
    if (avgTime < 1500) {
      return 'impulsive'; // Quick responses
    } else if (avgTime > 8000) {
      return 'analytical'; // Slow, thoughtful responses
    } else {
      return 'normal'; // Moderate response time
    }
  }

  /**
   * Calculate consistency score from answer history
   * @param {Array} history - Response history
   * @returns {number} Consistency score (0-1)
   */
  calculateConsistency(history) {
    if (!Array.isArray(history) || history.length < 2) {
      return 1.0; // Perfect consistency for insufficient data
    }

    let contradictions = 0;
    let totalPairs = 0;

    // Check for logical contradictions
    for (let i = 0; i < history.length - 1; i++) {
      for (let j = i + 1; j < history.length; j++) {
        const h1 = history[i];
        const h2 = history[j];

        // Simple contradiction: same attribute with opposite answers
        if (h1.attribute_id === h2.attribute_id && 
            h1.answer_value !== 0 && 
            h2.answer_value !== 0 &&
            h1.answer_value !== h2.answer_value) {
          contradictions++;
        }
        totalPairs++;
      }
    }

    return totalPairs > 0 ? 1.0 - (contradictions / totalPairs) : 1.0;
  }

  /**
   * Normalize text for comparison
   * @param {string} text - Input text
   * @returns {string} Normalized text
   */
  normalizeText(text) {
    return text
      .toLowerCase()
      .replace(/[\u064B-\u0652\u0670]/g, '') // Remove Arabic diacritics
      .replace(/[أإآ]/g, 'ا') // Normalize alef variants
      .replace(/ة/g, 'ه') // Normalize ta marbuta
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Get session analytics and insights
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>} Analytics data
   */
  async getSessionAnalytics(sessionId) {
    try {
      const { data, error } = await this.supabase.rpc('get_session_analytics', {
        p_session_id: sessionId
      });

      if (error) {
        throw new Error(`Analytics error: ${error.message}`);
      }

      return {
        success: true,
        analytics: data
      };

    } catch (error) {
      console.error('Analytics error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = DeductionEngine;