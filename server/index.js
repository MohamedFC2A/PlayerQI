const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const OpenAI = require('openai');
const axios = require('axios');
const { createSupabaseClient } = require('./supabaseClient');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const supabase = createSupabaseClient();

function normalizeArabicText(input) {
  if (!input) return '';
  return String(input)
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTrigrams(text) {
  const t = normalizeArabicText(text).replace(/\s+/g, ' ');
  if (!t) return [];
  if (t.length <= 3) return [t];
  const grams = [];
  for (let i = 0; i < t.length - 2; i += 1) {
    grams.push(t.slice(i, i + 3));
  }
  return grams;
}

function diceCoefficient(a, b) {
  const aTris = buildTrigrams(a);
  const bTris = buildTrigrams(b);
  if (aTris.length === 0 && bTris.length === 0) return 1;
  if (aTris.length === 0 || bTris.length === 0) return 0;
  const aCount = new Map();
  for (const tri of aTris) aCount.set(tri, (aCount.get(tri) ?? 0) + 1);
  let matches = 0;
  for (const tri of bTris) {
    const count = aCount.get(tri) ?? 0;
    if (count > 0) {
      matches += 1;
      aCount.set(tri, count - 1);
    }
  }
  return (2 * matches) / (aTris.length + bTris.length);
}

function isTooSimilarQuestion(candidateText, historyNormalizedQuestions) {
  const candidateNorm = normalizeArabicText(candidateText);
  if (!candidateNorm) return true;
  for (const prevNorm of historyNormalizedQuestions) {
    if (!prevNorm) continue;
    if (candidateNorm === prevNorm) return true;
    if (diceCoefficient(candidateNorm, prevNorm) >= 0.86) return true;
  }
  return false;
}

function parseYesNoToBool(answer) {
  const a = String(answer ?? '').trim().toLowerCase();
  if (!a) return null;
  if (a === 'yes' || a === 'y' || a === 'نعم') return true;
  if (a === 'no' || a === 'n' || a === 'لا') return false;
  return null;
}

/**
 * Check if a question is banned or has low entropy (weak/stupid question)
 * Returns true if the question should be BLOCKED
 */
function isBannedQuestion(questionText) {
  const normalized = normalizeArabicText(questionText);
  if (!normalized) return true;

  // Banned patterns (exact matches or contains)
  const bannedPatterns = [
    // Gender questions
    'ذكر', 'انثي', 'رجل', 'امراه', 'بنت', 'ولد',
    // Obvious questions
    'لاعب كره قدم', 'يلعب كره قدم', 'كره القدم',
    'مشهور', 'موجود في قاعده البيانات', 'تعرفه',
    // Name-based questions
    'اسمه يبدا بحرف', 'اسمه ينتهي بحرف', 'اسمه يحتوي علي',
    // Weak age questions
    'عمره اقل من', 'عمره اكثر من', 'عمره يساوي',
    // League questions (banned)
    'دوري', 'league', 'الدوري الانجليزي', 'الدوري الاسباني'
  ];

  for (const pattern of bannedPatterns) {
    if (normalized.includes(normalizeArabicText(pattern))) {
      return true;
    }
  }

  return false;
}

const openai = process.env.DEEPSEEK_API_KEY
  ? new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY
  })
  : null;

// Serper API for real-time web search
const SERPER_API_KEY = process.env.SERPER_API_KEY;

// Smart fallback questions system - prevents repetition
const FALLBACK_QUESTIONS = [
  'هل يلعب في أوروبا؟',
  'هل هو لاعب معتزل؟',
  'هل يلعب كمهاجم؟',
  'هل لعب في الدوريات الخمسة الكبرى؟',
  'هل فاز بدوري الأبطال؟',
  'هل يلعب في إنجلترا؟',
  'هل يلعب في إسبانيا؟',
  'هل هو أفريقي؟',
  'هل هو من أمريكا الجنوبية؟',
  'هل فاز بكأس العالم للأندية؟',
  'هل يلعب في الدوري الإيطالي؟',
  'هل يلعب في الدوري الألماني؟',
  'هل يلعب في الدوري الفرنسي؟',
  'هل هو آسيوي؟',
  'هل يلعب كمدافع؟',
  'هل يلعب في خط الوسط؟',
  'هل هو حارس مرمى؟'
];

/**
 * Get a smart fallback question that hasn't been asked yet
 * @param {string[]} historyNormalizedQuestions - Array of normalized questions already asked
 * @returns {string} A strategic fallback question
 */
function getSmartFallbackQuestion(historyNormalizedQuestions) {
  // Filter out questions that have already been asked
  const availableQuestions = FALLBACK_QUESTIONS.filter(q => {
    return !isTooSimilarQuestion(q, historyNormalizedQuestions);
  });

  // If we still have unused questions, use the first one (highest priority)
  if (availableQuestions.length > 0) {
    return availableQuestions[0];
  }

  // If all fallback questions have been used, generate random strategic questions
  const randomStrategicQuestions = [
    'هل لعب في ريال مدريد؟',
    'هل لعب في برشلونة؟',
    'هل فاز بالكرة الذهبية؟',
    'هل لعب في مانشستر يونايتد؟',
    'هل هو أوروبي؟',
    'هل لعب في باريس سان جيرمان؟',
    'هل فاز بكأس العالم؟',
    'هل لعب في ليفربول؟',
    'هل لعب في تشيلسي؟',
    'هل لعب في يوفنتوس؟'
  ];

  // Try to find a random question that hasn't been asked
  const availableRandom = randomStrategicQuestions.filter(q => {
    return !isTooSimilarQuestion(q, historyNormalizedQuestions);
  });

  if (availableRandom.length > 0) {
    return availableRandom[Math.floor(Math.random() * availableRandom.length)];
  }

  // Last resort: return a completely random question from all options
  return randomStrategicQuestions[Math.floor(Math.random() * randomStrategicQuestions.length)];
}

const inflightFeaturePopulation = new Set();

function toAnswerKind(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return null;
  if (v === 'yes' || v === 'y' || v === 'true' || v === 'نعم') return 'yes';
  if (v === 'no' || v === 'n' || v === 'false' || v === 'لا') return 'no';
  if (v === 'maybe' || v === 'ربما' || v === 'جزئيا' || v === 'جزئياً') return 'maybe';
  if (v === 'unknown' || v === 'idk' || v === 'لا اعرف' || v === 'لا أعرف') return 'unknown';
  return null;
}

async function populateMissingPlayerFeatures(featureId, questionText, missingPlayers) {
  if (!openai || !supabase) return { ok: false, reason: 'not_configured' };
  if (!featureId || !questionText) return { ok: false, reason: 'missing_inputs' };

  const players = Array.isArray(missingPlayers) ? missingPlayers : [];
  const candidates = players
    .map(p => ({
      candidate_id: p?.candidate_id ?? p?.candidateId ?? null,
      name: String(p?.name ?? '').trim()
    }))
    .filter(p => p.candidate_id && p.name);

  const batch = [];
  for (const c of candidates) {
    const key = `${featureId}:${c.candidate_id}`;
    if (inflightFeaturePopulation.has(key)) continue;
    inflightFeaturePopulation.add(key);
    batch.push(c);
    if (batch.length >= 10) break;
  }

  if (batch.length === 0) return { ok: true, inserted: 0 };

  try {
    const systemPrompt = `
أنت مساعد بيانات لكرة القدم.
مهمتك: تحديد إجابة نعم/لا/ربما/لا أعرف عن كل لاعب بالنسبة للسؤال.

الوقت الحالي: ${new Date().toISOString()}

قواعد:
1) لا تخترع. إذا لم تكن واثقاً: answer = "unknown".
2) السؤال قد يكون بصيغة عربية. اعتبره عبارة/خاصية عن اللاعب.
3) أرجع JSON فقط.

السؤال:
${questionText}

اللاعبون:
${JSON.stringify(batch, null, 2)}

صيغة الإخراج:
{
  "items": [
    { "candidate_id": "uuid", "answer": "yes|no|maybe|unknown", "confidence": 0.0 }
  ]
}
`;

    const completion = await openai.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'أخرج JSON فقط.' }
      ],
      model: 'deepseek-chat',
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(completion.choices?.[0]?.message?.content ?? '{}');
    const items = Array.isArray(parsed?.items) ? parsed.items : [];

    const byId = new Map(items.map(it => [String(it?.candidate_id ?? it?.candidateId ?? ''), it]));
    const payload = [];

    for (const c of batch) {
      const it = byId.get(String(c.candidate_id)) ?? null;
      const answer = toAnswerKind(it?.answer);
      const confidence = Number(it?.confidence ?? 0);
      if (!answer) continue;
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) continue;
      if (answer === 'unknown') continue;
      if ((answer === 'yes' || answer === 'no') && confidence < 0.65) continue;
      if (answer === 'maybe' && confidence < 0.6) continue;

      payload.push({
        player_id: c.candidate_id,
        feature_id: featureId,
        answer,
        source: 'llm',
        confidence
      });
    }

    if (payload.length === 0) return { ok: true, inserted: 0 };

    const { error } = await supabase
      .from('player_features')
      .upsert(payload, { onConflict: 'player_id,feature_id', ignoreDuplicates: true });

    if (error) return { ok: false, reason: 'db_error' };
    return { ok: true, inserted: payload.length };
  } catch {
    return { ok: false, reason: 'llm_error' };
  } finally {
    for (const c of batch) {
      inflightFeaturePopulation.delete(`${featureId}:${c.candidate_id}`);
    }
  }
}

/**
 * Search for real-time football player information using Serper API
 */
async function searchPlayerInfo(query) {
  if (!SERPER_API_KEY || SERPER_API_KEY === 'YOUR_SERPER_API_KEY_HERE') {
    console.log('⚠️ Serper API key not configured - skipping real-time search');
    return null;
  }

  try {
    const response = await axios.post(
      'https://google.serper.dev/search',
      {
        q: query,
        gl: 'eg', // Egypt for Arabic context
        hl: 'ar', // Arabic language
        num: 5
      },
      {
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    // Extract relevant info from search results
    const results = response.data;
    let extractedInfo = '';

    if (results.knowledgeGraph) {
      const kg = results.knowledgeGraph;
      extractedInfo += `📊 معلومات سريعة: ${kg.title || ''} - ${kg.type || ''}\n`;
      if (kg.description) extractedInfo += `${kg.description}\n`;
      if (kg.attributes) {
        Object.entries(kg.attributes).forEach(([key, value]) => {
          extractedInfo += `• ${key}: ${value}\n`;
        });
      }
    }

    if (results.organic && results.organic.length > 0) {
      extractedInfo += '\n🔍 نتائج البحث:\n';
      results.organic.slice(0, 3).forEach((result, i) => {
        extractedInfo += `${i + 1}. ${result.title}: ${result.snippet || ''}\n`;
      });
    }

    return extractedInfo || null;
  } catch (error) {
    console.error('Serper search error:', error.message);
    return null;
  }
}

async function searchPlayerImage(playerName) {
  if (!SERPER_API_KEY || SERPER_API_KEY === 'YOUR_SERPER_API_KEY_HERE') {
    return null;
  }

  try {
    const response = await axios.post(
      'https://google.serper.dev/images',
      {
        q: `${playerName} لاعب كرة قدم`,
        gl: 'eg',
        hl: 'ar',
        num: 6
      },
      {
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    const images = response.data?.images ?? [];
    const first = images[0];
    return first?.imageUrl ?? first?.thumbnailUrl ?? null;
  } catch {
    return null;
  }
}

async function searchPlayerEvidence(playerName) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const query = `${playerName} لاعب كرة قدم wikipedia position club nationality ${yyyy}`;
  return await searchPlayerInfo(query);
}

async function getPlayerFromDbByName(playerName) {
  if (!supabase) return null;
  const normalizedName = normalizeArabicText(playerName);
  if (!normalizedName) return null;

  try {
    const { data: exact } = await supabase
      .from('candidates')
      .select('id, name, normalized_name, image_url')
      .eq('normalized_name', normalizedName)
      .maybeSingle();

    if (exact?.id) return exact;

    const { data: matched } = await supabase.rpc('match_candidate', {
      query_text: normalizedName,
      similarity_threshold: 0.9
    });

    return matched?.[0] ?? null;
  } catch {
    const { data: exact } = await supabase
      .from('candidates')
      .select('id, name, image_url')
      .eq('name', playerName)
      .maybeSingle();
    return exact?.id ? exact : null;
  }
}

async function getGuessImageUrl(guessName) {
  const fromDb = await getPlayerFromDbByName(guessName);
  if (fromDb?.image_url) return fromDb.image_url;
  return await searchPlayerImage(guessName);
}

async function ensurePlayerProfile(playerName) {
  if (!supabase) return null;
  const normalizedName = normalizeArabicText(playerName);
  if (!normalizedName) return null;

  let existing = null;
  try {
    const { data } = await supabase
      .from('candidates')
      .select('id, name, normalized_name, image_url')
      .eq('normalized_name', normalizedName)
      .maybeSingle();
    existing = data ?? null;
  } catch {
    const { data } = await supabase
      .from('candidates')
      .select('id, name, image_url')
      .eq('name', playerName)
      .maybeSingle();
    existing = data ?? null;
  }

  if (existing?.id) {
    if (existing.image_url) return existing;
    const imageUrl = await searchPlayerImage(existing.name || playerName);
    if (!imageUrl) return existing;
    const { data: updated } = await supabase
      .from('candidates')
      .update({ image_url: imageUrl })
      .eq('id', existing.id)
      .select('id, name, normalized_name, image_url')
      .single();
    return updated ?? existing;
  }

  const imageUrl = await searchPlayerImage(playerName);
  let created = null;
  try {
    const { data, error } = await supabase
      .from('candidates')
      .insert({
        name: playerName,
        normalized_name: normalizedName,
        image_url: imageUrl ?? null,
        prior_weight: 1
      })
      .select('id, name, normalized_name, image_url')
      .single();
    if (!error) created = data ?? null;
  } catch {
    const { data, error } = await supabase
      .from('candidates')
      .insert({
        name: playerName,
        image_url: imageUrl ?? null,
        prior_weight: 1
      })
      .select('id, name, image_url')
      .single();
    if (!error) created = data ?? null;
  }

  return created ?? null;
}

async function upsertFeature(featureKey, featureValue) {
  if (!supabase) return null;
  const normalizedKey = normalizeArabicText(featureKey);
  const normalizedValue = normalizeArabicText(featureValue);
  if (!normalizedKey || !normalizedValue) return null;

  const { data, error } = await supabase
    .from('features')
    .upsert(
      {
        feature_key: featureKey,
        feature_value: featureValue,
        normalized_key: normalizedKey,
        normalized_value: normalizedValue
      },
      { onConflict: 'normalized_key,normalized_value' }
    )
    .select('id, feature_key, feature_value, normalized_key, normalized_value')
    .single();

  if (error) return null;
  return data ?? null;
}

async function upsertQuestionMetadata(featureId, questionText) {
  if (!supabase) return null;
  const normalizedText = normalizeArabicText(questionText);
  if (!featureId || !normalizedText) return null;

  const { data: matched } = await supabase.rpc('match_question_metadata', {
    query_text: normalizedText,
    similarity_threshold: 0.92
  });

  if (matched?.[0]?.id && matched[0]?.feature_id) {
    return {
      id: matched[0].id,
      feature_id: matched[0].feature_id,
      question_text: matched[0].question_text
    };
  }

  const { data, error } = await supabase
    .from('questions_metadata')
    .upsert(
      {
        feature_id: featureId,
        question_text: questionText,
        normalized_text: normalizedText,
        manual_weight: 0
      },
      { onConflict: 'feature_id,normalized_text' }
    )
    .select('id, feature_id, question_text')
    .single();

  if (error) return null;
  return data ?? null;
}

async function upsertCandidatesByNames(names) {
  if (!supabase) return new Map();
  const rows = (Array.isArray(names) ? names : [])
    .map(n => String(n ?? '').trim())
    .filter(Boolean)
    .map(name => ({
      name,
      normalized_name: normalizeArabicText(name),
      prior_weight: 1
    }))
    .filter(r => r.normalized_name);

  const dedup = new Map();
  for (const r of rows) dedup.set(r.normalized_name, r);

  const payload = Array.from(dedup.values());
  if (payload.length === 0) return new Map();

  const { data, error } = await supabase
    .from('candidates')
    .upsert(payload, { onConflict: 'normalized_name' })
    .select('id, name, normalized_name');

  if (error || !Array.isArray(data)) return new Map();
  const map = new Map();
  for (const row of data) {
    if (row?.normalized_name && row?.id) map.set(row.normalized_name, row);
  }
  return map;
}

async function upsertPlayerFeatures(featureId, candidateIds, source = 'llm', confidence = null) {
  if (!supabase) return { ok: false };
  if (!featureId) return { ok: false };
  const ids = Array.isArray(candidateIds) ? candidateIds.filter(Boolean) : [];
  if (ids.length === 0) return { ok: true, inserted: 0 };

  const payload = ids.map(candidateId => ({
    player_id: candidateId,
    feature_id: featureId,
    source,
    confidence
  }));

  const { error } = await supabase
    .from('player_features')
    .upsert(payload, { onConflict: 'player_id,feature_id' });

  return { ok: !error, inserted: payload.length };
}

async function bumpQuestionSeen(questionId) {
  if (!supabase || !questionId) return;
  await supabase.rpc('bump_question_seen', { p_question_id: questionId });
}

async function bumpQuestionSuccess(questionId) {
  if (!supabase || !questionId) return;
  await supabase.rpc('bump_question_success', { p_question_id: questionId });
}

async function recordGameSession({ history, guess, correct, candidateId }) {
  if (!supabase) return null;
  const status = correct === true ? 'won' : correct === false ? 'lost' : 'abandoned';
  const { data, error } = await supabase
    .from('game_sessions')
    .insert({
      history: Array.isArray(history) ? history : [],
      status,
      guessed_candidate_id: candidateId ?? null,
      guessed_name: guess ?? null,
      correct: typeof correct === 'boolean' ? correct : null,
      question_count: Array.isArray(history) ? history.length : null
    })
    .select('id')
    .single();

  if (error) return null;
  return data?.id ?? null;
}

async function recordGameMoves(sessionId, history) {
  if (!supabase || !sessionId) return { ok: false };
  const items = Array.isArray(history) ? history : [];
  const payload = items
    .map((h, idx) => {
      const questionId = h?.question_id ?? h?.questionId ?? null;
      const featureId = h?.feature_id ?? h?.featureId ?? null;
      const answerBool = parseYesNoToBool(h?.answer);
      return {
        session_id: sessionId,
        move_index: idx + 1,
        question_id: questionId,
        feature_id: featureId,
        answer: answerBool
      };
    })
    .filter(m => m.question_id || m.feature_id || m.answer !== null);

  if (payload.length === 0) return { ok: true, inserted: 0 };
  const { error } = await supabase.from('game_moves').insert(payload);
  return { ok: !error, inserted: payload.length };
}

async function learnCandidateFromHistory(candidateId, history) {
  if (!supabase || !candidateId) return { ok: false };
  const items = Array.isArray(history) ? history : [];
  const yesFeatures = items
    .map(h => ({
      featureId: h?.feature_id ?? h?.featureId ?? null,
      answerBool: parseYesNoToBool(h?.answer)
    }))
    .filter(x => x.featureId && x.answerBool === true)
    .map(x => x.featureId);

  const unique = Array.from(new Set(yesFeatures));
  if (unique.length === 0) return { ok: true, inserted: 0 };
  const { error } = await supabase
    .from('player_features')
    .upsert(
      unique.map(featureId => ({
        player_id: candidateId,
        feature_id: featureId,
        source: 'confirmed',
        confidence: 1
      })),
      { onConflict: 'player_id,feature_id' }
    );

  return { ok: !error, inserted: unique.length };
}

async function verifyHistoryWithAiAndSerper(history, playerName) {
  const evidence = await searchPlayerEvidence(playerName);
  const historyPayload = (history ?? []).map((h, i) => ({
    index: i + 1,
    question: h?.question ?? '',
    answer: h?.answer ?? ''
  }));

  if (!openai) {
    return {
      ok: false,
      evidencePresent: Boolean(evidence),
      items: [],
      issues: [],
      suggestedHistory: history ?? []
    };
  }

  const systemPrompt = `
أنت "مدقق بيانات" لكرة القدم.
مهمتك: التحقق من صحة إجابات المستخدم على أسئلة نعم/لا/ربما/لا أعرف بعد معرفة اللاعب النهائي.

الوقت الحالي (لا تعتمد على معلومات قديمة): ${new Date().toISOString()}

قواعد صارمة:
1) لا تخترع حقائق. اعتمد فقط على "الأدلة" أسفل + معرفة عامة مؤكدة.
2) لو الدليل غير كافٍ: suggestedAnswer = "لا أعرف" مع confidence منخفضة.
3) لا تغيّر الإجابات إلا إذا كنت واثقاً جداً (confidence >= 0.80).
4) أرجع JSON فقط.

الأدلة (قد تكون ناقصة):
${evidence ? evidence : '(لا توجد أدلة من البحث)'}

اسم اللاعب الذي تم تأكيده: ${playerName}

المدخلات (أسئلة وإجابات المستخدم):
${JSON.stringify(historyPayload, null, 2)}

صيغة الإخراج:
{
  "items": [
    {
      "index": 1,
      "question": "string",
      "userAnswer": "نعم|لا|ربما|لا أعرف",
      "suggestedAnswer": "نعم|لا|ربما|لا أعرف",
      "confidence": 0.0,
      "reason": "string"
    }
  ]
}
`;

  try {
    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "راجع كل الإجابات وأخرج JSON." }
      ],
      model: "deepseek-chat",
      temperature: 0.2,
      response_format: { type: "json_object" }
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    const items = Array.isArray(parsed?.items) ? parsed.items : [];

    const normalized = items
      .map(it => ({
        index: Number(it.index),
        question: String(it.question ?? ''),
        userAnswer: String(it.userAnswer ?? ''),
        suggestedAnswer: String(it.suggestedAnswer ?? ''),
        confidence: Number(it.confidence ?? 0),
        reason: String(it.reason ?? '')
      }))
      .filter(it => Number.isFinite(it.index) && it.index >= 1 && it.index <= (history?.length ?? 0));

    const suggestedHistory = (history ?? []).map((h, i) => {
      const item = normalized.find(it => it.index === i + 1);
      if (!item) return h;
      if (item.confidence >= 0.8 && item.suggestedAnswer && item.suggestedAnswer !== h.answer) {
        return { ...h, answer: item.suggestedAnswer };
      }
      return h;
    });

    const issues = normalized
      .filter(it => it.confidence >= 0.8 && it.suggestedAnswer && it.suggestedAnswer !== it.userAnswer && it.suggestedAnswer !== 'لا أعرف')
      .map(it => ({
        index: it.index,
        question: it.question,
        userAnswer: it.userAnswer,
        suggestedAnswer: it.suggestedAnswer,
        confidence: it.confidence,
        reason: it.reason
      }));

    return {
      ok: true,
      evidencePresent: Boolean(evidence),
      items: normalized,
      issues,
      suggestedHistory
    };
  } catch {
    return {
      ok: false,
      evidencePresent: Boolean(evidence),
      items: [],
      issues: [],
      suggestedHistory: history ?? []
    };
  }
}

/**
 * Build a context query based on current game history
 */
function buildSearchQuery(history) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  // Extract ALL traits confirmed by "Yes"
  const positiveTraits = history
    .filter(h => h.answer === 'نعم')
    .map(h => {
      // Clean up the question to extract the core keyword (simplistic approach enabled by specific AI questions)
      // This is a heuristic. A better approach is to ask AI to summarize the state, but that's slow.
      // For now, we rely on the full history string in the system prompt for the AI, 
      // and use a broad query for Serper.
      return h.question;
    });

  // If we have at least 1 positive trait, we can start searching.
  if (positiveTraits.length > 0) {
    // Construct a natural language query
    // Example: "لاعب كرة قدم معتزل لعب في ريال مدريد"
    const traitsString = positiveTraits.join(' ');
    // Limit length to avoid search errors
    return `لاعب كرة قدم ${traitsString.substring(0, 100)} wikipedia ${yyyy}`;
  }

  return `أشهر لاعبي كرة القدم ${yyyy}`;
}

app.post('/api/game', async (req, res) => {
  try {
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    const rejectedGuesses = Array.isArray(req.body?.rejectedGuesses) ? req.body.rejectedGuesses : [];
    const historyNormalizedQuestions = history.map(h => normalizeArabicText(h?.question)).filter(Boolean);
    const rejectedGuessNames = rejectedGuesses.map(g => normalizeArabicText(g)).filter(Boolean);
    const sessionId = String(req.body?.session_id ?? req.body?.sessionId ?? '').trim() || null;

    if (supabase) {
      let move = null;
      let error = null;

      if (history.length === 0) {
        const result = await supabase.rpc('game_start');
        move = result?.data ?? null;
        error = result?.error ?? null;
      } else if (sessionId) {
        const last = history[history.length - 1] ?? null;
        const lastAnswerKind = toAnswerKind(last?.answer) ?? 'unknown';
        const result = await supabase.rpc('game_step', {
          p_session_id: sessionId,
          p_question_id: last?.question_id ?? last?.questionId ?? null,
          p_feature_id: last?.feature_id ?? last?.featureId ?? null,
          p_answer: lastAnswerKind,
          p_rejected_guess_names: rejectedGuessNames
        });
        move = result?.data ?? null;
        error = result?.error ?? null;
      } else {
        const currentHistory = history.map(h => ({
          feature_id: h?.feature_id ?? h?.featureId ?? null,
          normalized_question: h?.normalized_question ?? normalizeArabicText(h?.question ?? ''),
          answer: h?.answer ?? null,
          answer_bool: parseYesNoToBool(h?.answer)
        }));

        const result = await supabase.rpc('get_next_best_move', {
          current_history: currentHistory,
          rejected_guess_names: rejectedGuessNames
        });
        move = result?.data ?? null;
        error = result?.error ?? null;
      }

      if (!error && move?.type === 'guess' && move?.content) {
        const imageUrl = await getGuessImageUrl(move.content);
        return res.json({
          type: 'guess',
          content: move.content,
          confidence: move.confidence ?? null,
          meta: move.meta ?? null,
          imageUrl,
          session_id: move.session_id ?? sessionId ?? null
        });
      }

      if (!error && move?.type === 'question' && move?.content) {
        const featureId = move.feature_id ?? null;
        const missingPlayers = move?.meta?.missing_players ?? null;
        if (openai && featureId && Array.isArray(missingPlayers) && missingPlayers.length > 0) {
          Promise.resolve()
            .then(() => populateMissingPlayerFeatures(featureId, move.content, missingPlayers))
            .catch(() => null);
        }
        return res.json({
          type: 'question',
          content: move.content,
          question_id: move.question_id ?? null,
          feature_id: move.feature_id ?? null,
          meta: move.meta ?? null,
          session_id: move.session_id ?? sessionId ?? null
        });
      }

      if (!error && move?.type === 'gap') {
        return res.json({
          type: 'question',
          content: getSmartFallbackQuestion(historyNormalizedQuestions),
          meta: move?.meta ?? null,
          session_id: move.session_id ?? sessionId ?? null
        });
      }
    }

    return res.json({
      type: 'question',
      content: getSmartFallbackQuestion(historyNormalizedQuestions)
    });
  } catch (error) {
    console.error('Error in game endpoint:', error);
    res.status(500).json({ error: 'حدث خطأ في لعبة التخمين' });
  }
});

app.post('/api/confirm', async (req, res) => {
  try {
    const { history, guess, correct } = req.body ?? {};
    const sessionId = String(req.body?.session_id ?? req.body?.sessionId ?? '').trim() || null;
    if (!Array.isArray(history) || typeof guess !== 'string' || typeof correct !== 'boolean') {
      return res.status(400).json({ error: 'bad_request' });
    }

    if (!supabase) {
      return res.json({ ok: true, stored: false });
    }

    if (!correct) {
      return res.json({ ok: true, stored: false, correct: false, sessionId: sessionId ?? null });
    }

    const imageUrl = await getGuessImageUrl(guess);
    const verification = await verifyHistoryWithAiAndSerper(history, guess);

    if (verification?.ok && Array.isArray(verification.issues) && verification.issues.length === 0) {
      const candidate = await ensurePlayerProfile(guess);
      let storedSessionId = null;
      if (sessionId) {
        const { error } = await supabase
          .from('game_sessions')
          .update({
            status: 'won',
            guessed_candidate_id: candidate?.id ?? null,
            guessed_name: guess,
            correct: true,
            question_count: Array.isArray(history) ? history.length : null
          })
          .eq('id', sessionId);
        storedSessionId = error ? null : sessionId;
      }

      if (!storedSessionId) {
        storedSessionId = await recordGameSession({ history, guess, correct: true, candidateId: candidate?.id ?? null });
        if (storedSessionId) await recordGameMoves(storedSessionId, history);
      }
      if (candidate?.id) await learnCandidateFromHistory(candidate.id, history);
      const questionIds = Array.from(new Set(history.map(h => h?.question_id ?? h?.questionId ?? null).filter(Boolean)));
      for (const qid of questionIds) {
        await bumpQuestionSuccess(qid);
      }
      return res.json({
        ok: true,
        correct: true,
        stored: true,
        sessionId: storedSessionId,
        reviewRequired: false,
        verification,
        imageUrl: candidate?.image_url ?? imageUrl ?? null
      });
    }

    return res.json({
      ok: true,
      correct: true,
      stored: false,
      reviewRequired: true,
      verification,
      imageUrl
    });
  } catch (error) {
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/confirm-final', async (req, res) => {
  try {
    const { history, guess } = req.body ?? {};
    const sessionId = String(req.body?.session_id ?? req.body?.sessionId ?? '').trim() || null;
    if (!Array.isArray(history) || typeof guess !== 'string') {
      return res.status(400).json({ error: 'bad_request' });
    }

    if (!supabase) {
      return res.json({ ok: true, stored: false });
    }

    const candidate = await ensurePlayerProfile(guess);
    let storedSessionId = null;
    if (sessionId) {
      const { error } = await supabase
        .from('game_sessions')
        .update({
          status: 'won',
          guessed_candidate_id: candidate?.id ?? null,
          guessed_name: guess,
          correct: true,
          question_count: Array.isArray(history) ? history.length : null
        })
        .eq('id', sessionId);
      storedSessionId = error ? null : sessionId;
    }

    if (!storedSessionId) {
      storedSessionId = await recordGameSession({ history, guess, correct: true, candidateId: candidate?.id ?? null });
      if (storedSessionId) await recordGameMoves(storedSessionId, history);
    }
    if (candidate?.id) await learnCandidateFromHistory(candidate.id, history);
    const questionIds = Array.from(new Set(history.map(h => h?.question_id ?? h?.questionId ?? null).filter(Boolean)));
    for (const qid of questionIds) {
      await bumpQuestionSuccess(qid);
    }
    return res.json({ ok: true, stored: true, playerId: candidate?.id ?? null, imageUrl: candidate?.image_url ?? null, sessionId: storedSessionId });
  } catch {
    return res.status(500).json({ error: 'server_error' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const parts = typeof key === 'string' ? key.split('.') : [];
  let supabaseKeyRole = null;
  if (parts.length >= 2) {
    try {
      const payloadJson = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      const payload = JSON.parse(payloadJson);
      supabaseKeyRole = payload?.role ?? null;
    } catch {
      supabaseKeyRole = null;
    }
  }

  res.json({
    status: 'ok',
    serperConfigured: SERPER_API_KEY && SERPER_API_KEY !== 'YOUR_SERPER_API_KEY_HERE',
    supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    supabaseKeyRole
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔑 DeepSeek API: ${process.env.DEEPSEEK_API_KEY ? '✅ Configured' : '❌ Missing'}`);
    console.log(`🔍 Serper API: ${SERPER_API_KEY && SERPER_API_KEY !== 'YOUR_SERPER_API_KEY_HERE' ? '✅ Configured' : '⚠️ Not configured (optional)'}`);
  });
}

module.exports = app;
