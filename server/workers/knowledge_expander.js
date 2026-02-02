/**
 * Knowledge Expander Worker
 * Background process that fills gaps in the player feature matrix using AI
 */

const OpenAI = require('openai');
const { createSupabaseClient } = require('../supabaseClient');

class KnowledgeExpander {
  constructor() {
    this.supabase = createSupabaseClient();
    this.deepseek = this.createDeepSeekClient();
    this.batchSize = 10; // Process 10 gaps at a time
    this.maxRetries = 3;
  }

  createDeepSeekClient() {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      console.warn('DEEPSEEK_API_KEY not configured - knowledge expansion disabled');
      return null;
    }

    return new OpenAI({
      apiKey,
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    });
  }

  /**
   * Main worker function - runs periodically to fill knowledge gaps
   */
  async run() {
    if (!this.deepseek) {
      console.log('Knowledge expander disabled - no DeepSeek API key');
      return;
    }

    try {
      console.log('Starting knowledge expansion cycle...');
      
      // Get matrix gaps
      const gaps = await this.getIdentifyGaps();
      
      if (gaps.length === 0) {
        console.log('No knowledge gaps found');
        return;
      }

      console.log(`Found ${gaps.length} knowledge gaps to fill`);
      
      // Process gaps in batches
      for (let i = 0; i < gaps.length; i += this.batchSize) {
        const batch = gaps.slice(i, i + this.batchSize);
        await this.processBatch(batch);
        
        // Rate limiting
        await this.delay(1000);
      }

      console.log('Knowledge expansion cycle completed');

    } catch (error) {
      console.error('Knowledge expansion error:', error);
    }
  }

  /**
   * Identify gaps in the player feature matrix
   * @returns {Promise<Array>} Array of gap objects
   */
  async getIdentifyGaps() {
    try {
      const { data, error } = await this.supabase.rpc('get_matrix_gaps', {
        limit_count: 50
      });

      if (error) {
        throw new Error(`Database error: ${error.message}`);
      }

      return data || [];

    } catch (error) {
      console.error('Failed to identify gaps:', error);
      return [];
    }
  }

  /**
   * Process a batch of knowledge gaps
   * @param {Array} gaps - Array of gap objects
   */
  async processBatch(gaps) {
    const promises = gaps.map(gap => this.processGap(gap));
    const results = await Promise.allSettled(promises);
    
    const successful = results.filter(r => r.status === 'fulfilled' && r.value?.success);
    const failed = results.filter(r => r.status === 'rejected' || !r.value?.success);
    
    console.log(`Batch processed: ${successful.length} successful, ${failed.length} failed`);
  }

  /**
   * Process a single knowledge gap using AI
   * @param {Object} gap - Gap object with player and attribute info
   * @param {number} attempt - Current retry attempt
   */
  async processGap(gap, attempt = 1) {
    try {
      console.log(`Processing gap: ${gap.player_name} - ${gap.attribute_label} (attempt ${attempt})`);
      
      // Generate AI prompt
      const prompt = this.generatePrompt(gap);
      
      // Query DeepSeek
      const response = await this.queryAI(prompt);
      
      if (!response) {
        throw new Error('No response from AI');
      }

      // Parse and validate response
      const featureValue = this.parseAIResponse(response, gap.attribute_label);
      
      if (featureValue === null) {
        throw new Error('Could not parse AI response');
      }

      // Save to database
      await this.saveFeature(gap, featureValue);
      
      console.log(`Successfully filled gap: ${gap.player_name} - ${gap.attribute_label} = ${featureValue}`);
      
      return {
        success: true,
        player_id: gap.player_id,
        attribute_id: gap.attribute_id,
        value: featureValue
      };

    } catch (error) {
      console.error(`Failed to process gap (${attempt}/${this.maxRetries}):`, error.message);
      
      if (attempt < this.maxRetries) {
        // Retry with exponential backoff
        await this.delay(Math.pow(2, attempt) * 1000);
        return this.processGap(gap, attempt + 1);
      }
      
      // Mark as failed after max retries
      await this.markGapAsFailed(gap);
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate prompt for AI to determine player attribute
   * @param {Object} gap - Gap object
   * @returns {string} Formatted prompt
   */
  generatePrompt(gap) {
    return `
You are a football knowledge expert. Answer the following question about the player with a single word: YES, NO, or MAYBE.

Player: ${gap.player_name}
Question: ${gap.attribute_label}?

Respond with exactly one word: YES, NO, or MAYBE.
`.trim();
  }

  /**
   * Query AI with prompt
   * @param {string} prompt - The prompt to send
   * @returns {Promise<string|null>} AI response
   */
  async queryAI(prompt) {
    try {
      const response = await this.deepseek.chat.completions.create({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature: 0.1, // Low temperature for consistency
        max_tokens: 10
      });

      return response.choices[0]?.message?.content?.trim() || null;

    } catch (error) {
      console.error('AI query error:', error);
      return null;
    }
  }

  /**
   * Parse AI response into standardized format
   * @param {string} response - AI response text
   * @param {string} attributeLabel - Attribute label for context
   * @returns {number|null} -1 (no), 0 (maybe), 1 (yes) or null if invalid
   */
  parseAIResponse(response, attributeLabel) {
    if (!response) return null;

    const normalized = response.toLowerCase().trim();
    
    // Handle various response formats
    if (normalized.includes('yes') || normalized === 'نعم') {
      return 1;
    } else if (normalized.includes('no') || normalized === 'لا') {
      return -1;
    } else if (normalized.includes('maybe') || normalized.includes('ربما')) {
      return 0;
    }

    // Try to extract yes/no from context
    const contextClues = this.getAttributeContextClues(attributeLabel);
    if (contextClues.yes.some(clue => normalized.includes(clue))) {
      return 1;
    }
    if (contextClues.no.some(clue => normalized.includes(clue))) {
      return -1;
    }

    return null; // Could not parse
  }

  /**
   * Get context clues for attribute interpretation
   * @param {string} attributeLabel - Attribute label
   * @returns {Object} Context clues for yes/no determination
   */
  getAttributeContextClues(attributeLabel) {
    const clues = {
      // Position-related
      'مهاجم': { yes: ['forward', 'striker'], no: ['defender', 'midfielder', 'goalkeeper'] },
      'مدافع': { yes: ['defender', 'back'], no: ['forward', 'midfielder'] },
      'لاعب وسط': { yes: ['midfielder'], no: ['forward', 'defender'] },
      
      // League-related
      'الدوري الإنجليزي': { yes: ['premier', 'english'], no: ['spanish', 'german', 'italian'] },
      'لا ليجا': { yes: ['spanish', 'la liga'], no: ['premier', 'bundesliga'] },
      
      // Achievement-related
      'دوري أبطال أوروبا': { yes: ['champions', 'european'], no: ['domestic'] },
      'كأس العالم': { yes: ['world cup', 'international'], no: ['club', 'domestic'] },
      
      // Default fallback
      default: { yes: ['yes', 'true', 'correct'], no: ['no', 'false', 'incorrect'] }
    };

    // Find matching clue set
    for (const [key, value] of Object.entries(clues)) {
      if (attributeLabel.includes(key)) {
        return value;
      }
    }
    
    return clues.default;
  }

  /**
   * Save feature to database
   * @param {Object} gap - Gap object
   * @param {number} value - Feature value (-1, 0, or 1)
   */
  async saveFeature(gap, value) {
    const { error } = await this.supabase
      .from('player_features')
      .upsert({
        player_id: gap.player_id,
        attribute_id: gap.attribute_id,
        value: value,
        confidence: 0.9, // High confidence from AI
        source: 'ai_expansion'
      }, {
        onConflict: 'player_id,attribute_id'
      });

    if (error) {
      throw new Error(`Database save error: ${error.message}`);
    }
  }

  /**
   * Mark gap as failed after max retries
   * @param {Object} gap - Gap object
   */
  async markGapAsFailed(gap) {
    // Could implement a failed gaps table or marking system
    console.log(`Marking gap as failed: ${gap.player_name} - ${gap.attribute_label}`);
  }

  /**
   * Utility delay function
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Start periodic knowledge expansion
   * @param {number} intervalMinutes - Interval in minutes (default: 60)
   */
  startPeriodicExpansion(intervalMinutes = 60) {
    console.log(`Starting periodic knowledge expansion every ${intervalMinutes} minutes`);
    
    // Run immediately
    this.run();
    
    // Schedule recurring runs
    setInterval(() => {
      this.run();
    }, intervalMinutes * 60 * 1000);
  }
}

// Export singleton instance
const knowledgeExpander = new KnowledgeExpander();
module.exports = knowledgeExpander;