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
const ROOT_QUESTION_TEXT = '__ROOT__';
let rootQuestionId = null;

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

async function bumpTransitionSuccess(fromQuestionId, answerText, nextType, nextQuestionId, nextContentText, playerId) {
  if (!supabase) return;

  const base = supabase
    .from('question_transitions')
    .select('id, success_count, seen_count, player_id')
    .eq('from_question_id', fromQuestionId)
    .eq('answer_text', answerText)
    .eq('next_type', nextType);

  const { data: existing, error } = await (async () => {
    if (nextType === 'question') {
      return base
        .eq('next_question_id', nextQuestionId)
        .is('next_content_text', null)
        .limit(1);
    }
    return base
      .is('next_question_id', null)
      .eq('next_content_text', nextContentText)
      .limit(1);
  })();

  if (!error && existing?.[0]?.id) {
    const row = existing[0];
    await supabase
      .from('question_transitions')
      .update({
        success_count: (row.success_count ?? 0) + 1,
        seen_count: (row.seen_count ?? 0) + 1,
        player_id: playerId ?? row.player_id ?? null
      })
      .eq('id', row.id);
    return;
  }

  await supabase
    .from('question_transitions')
    .insert({
      from_question_id: fromQuestionId,
      answer_text: answerText,
      next_type: nextType,
      next_question_id: nextQuestionId ?? null,
      next_content_text: nextContentText ?? null,
      player_id: playerId ?? null,
      seen_count: 1,
      success_count: 1
    });
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

async function storeConfirmedPlayerRun(history, guess) {
  const player = await ensurePlayerProfile(guess);
  if (!player?.id) {
    return { ok: true, stored: true, playerId: null, imageUrl: null };
  }

  await supabase
    .from('player_paths')
    .insert({
      player_id: player.id,
      history
    });

  for (let i = 0; i < history.length; i += 1) {
    const fromText = history[i]?.question;
    const answerText = history[i]?.answer;
    if (!fromText || !answerText) continue;
    const fromId = await getOrCreateQuestionId(fromText);
    if (!fromId) continue;

    if (i < history.length - 1) {
      const nextText = history[i + 1]?.question;
      if (!nextText) continue;
      const nextId = await getOrCreateQuestionId(nextText);
      if (!nextId) continue;
      await bumpTransitionSuccess(fromId, answerText, 'question', nextId, null, player.id);
    } else {
      await bumpTransitionSuccess(fromId, answerText, 'guess', null, guess, player.id);
    }
  }

  return { ok: true, stored: true, playerId: player.id, imageUrl: player.image_url ?? null };
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

async function getRootQuestionId() {
  if (!supabase) return null;
  if (rootQuestionId) return rootQuestionId;
  const id = await getOrCreateQuestionId(ROOT_QUESTION_TEXT);
  rootQuestionId = id;
  return id;
}

async function getOrCreateQuestionId(text) {
  if (!supabase) return null;
  const normalizedText = normalizeArabicText(text);
  if (!normalizedText) return null;

  try {
    const { data: exactRow } = await supabase
      .from('question_nodes')
      .select('id')
      .eq('normalized_text', normalizedText)
      .maybeSingle();

    if (exactRow?.id) return exactRow.id;

    const { data: matched } = await supabase.rpc('match_question_node', {
      query_text: normalizedText,
      similarity_threshold: 0.88
    });

    if (matched?.[0]?.id) return matched[0].id;

    const { data, error } = await supabase
      .from('question_nodes')
      .upsert({ text, normalized_text: normalizedText }, { onConflict: 'normalized_text' })
      .select('id')
      .single();

    if (error) return null;
    return data?.id ?? null;
  } catch {
    const { data, error } = await supabase
      .from('question_nodes')
      .upsert({ text }, { onConflict: 'text' })
      .select('id')
      .single();

    if (error) return null;
    return data?.id ?? null;
  }
}

function computeTransitionScore(transition) {
  const seen = transition?.seen_count ?? 0;
  const success = transition?.success_count ?? 0;
  const rate = (success + 1) / (seen + 2);
  const volume = Math.min(1, Math.log(seen + 1) / 4);
  return rate * 0.85 + volume * 0.15;
}

async function getBestTransition(fromQuestionId, answerText, historyNormalizedQuestions, rejectedGuessSet) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('question_transitions')
    .select('id, next_type, next_question_id, next_content_text, success_count, seen_count, updated_at')
    .eq('from_question_id', fromQuestionId)
    .eq('answer_text', answerText)
    .order('seen_count', { ascending: false })
    .order('success_count', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(50);

  if (error) return null;
  const transitions = (data ?? []).slice().sort((a, b) => {
    const sa = computeTransitionScore(a);
    const sb = computeTransitionScore(b);
    if (sb !== sa) return sb - sa;
    const va = (a?.seen_count ?? 0) - (b?.seen_count ?? 0);
    if (va !== 0) return -va;
    const ua = new Date(a?.updated_at ?? 0).getTime();
    const ub = new Date(b?.updated_at ?? 0).getTime();
    return ub - ua;
  });

  const questionIds = transitions
    .filter(t => t.next_type === 'question' && t.next_question_id)
    .map(t => t.next_question_id);

  const questionMap = new Map();
  if (questionIds.length > 0) {
    let questions = [];
    try {
      const { data } = await supabase
        .from('question_nodes')
        .select('id, text, normalized_text')
        .in('id', questionIds);
      questions = data ?? [];
    } catch {
      const { data } = await supabase
        .from('question_nodes')
        .select('id, text')
        .in('id', questionIds);
      questions = data ?? [];
    }

    for (const q of questions ?? []) {
      questionMap.set(q.id, q);
    }
  }

  for (const t of transitions) {
    if (t.next_type === 'guess') {
      const content = t.next_content_text;
      if (!content) continue;
      const normalized = normalizeArabicText(content);
      if (normalized && rejectedGuessSet?.has(normalized)) continue;
      return { transition: t, resolved: { type: 'guess', content: t.next_content_text } };
    }
    const q = questionMap.get(t.next_question_id);
    if (!q?.text) continue;
    if (isTooSimilarQuestion(q.text, historyNormalizedQuestions)) continue;
    return { transition: t, resolved: { type: 'question', content: q.text } };
  }

  return null;
}

async function getFallbackQuestionFromPlayerPaths(lastQuestionNormalized, answerText, historyNormalizedQuestions) {
  if (!supabase || !lastQuestionNormalized || !answerText) return null;
  const { data, error } = await supabase
    .from('player_paths')
    .select('history, created_at')
    .order('created_at', { ascending: false })
    .limit(250);

  if (error) return null;

  const counts = new Map();
  const latestAt = new Map();

  for (const row of data ?? []) {
    const path = Array.isArray(row?.history) ? row.history : [];
    for (let i = 0; i < path.length - 1; i += 1) {
      const q = normalizeArabicText(path[i]?.question ?? '');
      const a = path[i]?.answer ?? '';
      if (!q || q !== lastQuestionNormalized) continue;
      if (a !== answerText) continue;

      const nextQ = path[i + 1]?.question ?? '';
      if (!nextQ) continue;
      const nextNorm = normalizeArabicText(nextQ);
      if (!nextNorm) continue;
      if (isTooSimilarQuestion(nextQ, historyNormalizedQuestions)) continue;

      const key = nextNorm;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const t = new Date(row?.created_at ?? 0).getTime();
      if (!latestAt.has(key) || t > latestAt.get(key)) latestAt.set(key, t);
    }
  }

  let best = null;
  for (const [key, count] of counts.entries()) {
    const recency = latestAt.get(key) ?? 0;
    const score = count * 10 + recency / 1_000_000_000;
    if (!best || score > best.score) best = { key, score };
  }

  if (!best) return null;

  for (const row of data ?? []) {
    const path = Array.isArray(row?.history) ? row.history : [];
    for (let i = 0; i < path.length - 1; i += 1) {
      const nextQ = path[i + 1]?.question ?? '';
      if (!nextQ) continue;
      const nextNorm = normalizeArabicText(nextQ);
      if (nextNorm === best.key) return nextQ;
    }
  }

  return null;
}

async function inferPlayerGuessFromPaths(history, rejectedGuessSet) {
  if (!supabase) return null;
  const historyItems = Array.isArray(history) ? history : [];
  if (historyItems.length < 5) return null;

  const historyPairs = historyItems
    .map(h => ({
      q: normalizeArabicText(h?.question ?? ''),
      a: h?.answer ?? ''
    }))
    .filter(x => x.q && x.a);

  if (historyPairs.length < 5) return null;

  const { data, error } = await supabase
    .from('player_paths')
    .select('history, players(name, image_url)')
    .order('created_at', { ascending: false })
    .limit(400);

  if (error || !Array.isArray(data) || data.length === 0) return null;

  const agg = new Map();

  for (const row of data) {
    const playerName = row?.players?.name;
    if (!playerName) continue;
    const normalizedName = normalizeArabicText(playerName);
    if (normalizedName && rejectedGuessSet?.has(normalizedName)) continue;

    const path = Array.isArray(row?.history) ? row.history : [];
    if (path.length === 0) continue;

    const pathSet = new Set(
      path
        .map(it => `${normalizeArabicText(it?.question ?? '')}::${it?.answer ?? ''}`)
        .filter(Boolean)
    );

    let matched = 0;
    for (const hp of historyPairs) {
      if (pathSet.has(`${hp.q}::${hp.a}`)) matched += 1;
    }

    const ratio = matched / historyPairs.length;
    if (ratio < 0.55) continue;

    const prev = agg.get(playerName) ?? {
      name: playerName,
      imageUrl: row?.players?.image_url ?? null,
      scoreSum: 0,
      samples: 0,
      bestRatio: 0
    };

    prev.scoreSum += ratio;
    prev.samples += 1;
    if (ratio > prev.bestRatio) prev.bestRatio = ratio;
    if (!prev.imageUrl && row?.players?.image_url) prev.imageUrl = row.players.image_url;
    agg.set(playerName, prev);
  }

  const candidates = Array.from(agg.values())
    .filter(c => c.samples >= 2 || c.bestRatio >= 0.8)
    .sort((a, b) => {
      const sa = (a.scoreSum / a.samples) * 0.7 + a.bestRatio * 0.3 + Math.min(1, a.samples / 5) * 0.2;
      const sb = (b.scoreSum / b.samples) * 0.7 + b.bestRatio * 0.3 + Math.min(1, b.samples / 5) * 0.2;
      return sb - sa;
    });

  if (candidates.length === 0) return null;

  const best = candidates[0];
  const bestScore = (best.scoreSum / best.samples) * 0.7 + best.bestRatio * 0.3 + Math.min(1, best.samples / 5) * 0.2;
  const second = candidates[1];
  const secondScore = second
    ? (second.scoreSum / second.samples) * 0.7 + second.bestRatio * 0.3 + Math.min(1, second.samples / 5) * 0.2
    : 0;

  const lead = bestScore - secondScore;
  const confidence = Math.max(0, Math.min(0.99, (bestScore + lead) / 1.6));

  if (confidence < 0.78) return null;

  return {
    type: 'guess',
    content: best.name,
    imageUrl: best.imageUrl ?? null,
    confidence,
    samples: best.samples,
    bestRatio: best.bestRatio
  };
}

async function bumpTransitionSeen(transitionId) {
  if (!supabase) return;
  const { data } = await supabase
    .from('question_transitions')
    .select('seen_count')
    .eq('id', transitionId)
    .single();

  const seen = data?.seen_count ?? 0;
  await supabase
    .from('question_transitions')
    .update({ seen_count: seen + 1 })
    .eq('id', transitionId);
}

async function storeTransition(fromQuestionId, answerText, nextType, nextQuestionId, nextContentText) {
  if (!supabase) return;

  const baseQuery = supabase
    .from('question_transitions')
    .select('id, seen_count')
    .eq('from_question_id', fromQuestionId)
    .eq('answer_text', answerText)
    .eq('next_type', nextType);

  const { data: existing, error: existingError } = await (async () => {
    if (nextType === 'question') {
      return baseQuery
        .eq('next_question_id', nextQuestionId)
        .is('next_content_text', null)
        .limit(1);
    }
    return baseQuery
      .is('next_question_id', null)
      .eq('next_content_text', nextContentText)
      .limit(1);
  })();

  if (!existingError && existing?.[0]?.id) {
    const id = existing[0].id;
    const seen = existing[0].seen_count ?? 0;
    await supabase
      .from('question_transitions')
      .update({ seen_count: seen + 1 })
      .eq('id', id);
    return;
  }

  await supabase
    .from('question_transitions')
    .insert({
      from_question_id: fromQuestionId,
      answer_text: answerText,
      next_type: nextType,
      next_question_id: nextQuestionId ?? null,
      next_content_text: nextContentText ?? null,
      seen_count: 1,
    });
}

app.post('/api/game', async (req, res) => {
  try {
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    const rejectedGuesses = Array.isArray(req.body?.rejectedGuesses) ? req.body.rejectedGuesses : [];
    const historyNormalizedQuestions = history.map(h => normalizeArabicText(h?.question)).filter(Boolean);
    const rejectedGuessNames = rejectedGuesses.map(g => normalizeArabicText(g)).filter(Boolean);

    if (supabase) {
      const currentHistory = history.map(h => ({
        feature_id: h?.feature_id ?? h?.featureId ?? null,
        normalized_question: h?.normalized_question ?? normalizeArabicText(h?.question ?? ''),
        answer: h?.answer ?? null,
        answer_bool: parseYesNoToBool(h?.answer)
      }));

      const { data: move, error } = await supabase.rpc('get_next_best_move', {
        current_history: currentHistory,
        rejected_guess_names: rejectedGuessNames
      });

      if (!error && move?.type === 'guess' && move?.content) {
        const imageUrl = await getGuessImageUrl(move.content);
        return res.json({
          type: 'guess',
          content: move.content,
          confidence: move.confidence ?? null,
          meta: move.meta ?? null,
          imageUrl
        });
      }

      if (!error && move?.type === 'question' && move?.content) {
        await bumpQuestionSeen(move.question_id ?? null);
        return res.json({
          type: 'question',
          content: move.content,
          question_id: move.question_id ?? null,
          feature_id: move.feature_id ?? null,
          meta: move.meta ?? null
        });
      }

      if (!error && move?.type === 'gap') {
        const candidateSample = Array.isArray(move?.candidates_sample) ? move.candidates_sample : [];
        const candidateNames = candidateSample.map(c => c?.name).filter(Boolean);

        if (!openai) {
          return res.json({
            type: 'question',
            content: 'هل يلعب كمهاجم؟'
          });
        }

        const systemPrompt = `
🧠 أنت خبير استراتيجي في لعبة تخمين لاعبي كرة القدم - مهمتك: تخمين اللاعب في ≤10 أسئلة.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 STANDARD CONTEXT (افترض هذا دائماً بدون سؤال):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ اللاعب = لاعب كرة قدم محترف ذكر (male professional footballer)
✅ لا تسأل: "هل هو ذكر؟" أو "هل هو لاعب كرة قدم؟" - هذا مفترض مسبقاً!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⛔ BANNED QUESTIONS (ممنوع نهائياً):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ "هل هو ذكر؟" / "هل هي أنثى؟"
❌ "هل هو لاعب كرة قدم؟"
❌ "هل هو مشهور؟"
❌ "هل هو موجود في قاعدة البيانات؟"
❌ "هل اسمه يبدأ بحرف [X]؟"
❌ "هل عمره أقل/أكثر من [رقم عشوائي]؟"
❌ أي سؤال يعطي معلومات قليلة جداً (entropy منخفضة)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 STRATEGIC RULES (قواعد الإستراتيجية):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1️⃣ **Binary Search Approach**: كل سؤال يجب أن يقسم المرشحين إلى ~50/50 (أو على الأقل 30/70)
2️⃣ **High Entropy**: اسأل عن معلومات تؤدي لأكبر تضييق ممكن
3️⃣ **Strategic Order**: 
   - السؤال 1-3: اسأل عن continent/region (أفريقيا، أوروبا، أمريكا الجنوبية)
   - السؤال 4-6: اسأل عن club tier (top 5 leagues) أو retired status
   - السؤال 7-9: اسأل عن position، awards، national team
   - السؤال 10+: تفاصيل دقيقة (foot, specific clubs, specific awards)

4️⃣ **Split Ratio**: positive_players يجب أن تكون بين 15%-85% من إجمالي المرشحين
5️⃣ **No Repetition**: لا تسأل أسئلة قريبة بالمعنى من الأسئلة السابقة
6️⃣ **Smart Features**: استخدم feature.key من القائمة الرسمية فقط

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 ALLOWED FEATURE KEYS ONLY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ position (مهاجم، مدافع، حارس مرمى، وسط)
✅ nationality (الجنسية الفعلية)
✅ continent (أفريقيا، أوروبا، أمريكا الجنوبية، آسيا)
✅ retired (معتزل أو لا)
✅ foot (اليد اليمنى/اليسرى)
✅ height_bucket (طويل/قصير/متوسط)
✅ age_bucket (شاب/متوسط/كبير)
✅ club (النادي الحالي أو الأخير)
✅ national_team (المنتخب الوطني)
✅ award (جوائز كبرى: كأس العالم، دوري الأبطال، بالون دور، الحذاء الذهبي)

⛔ BANNED: league, دوري، أسماء دوريات كميزات منفصلة

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎲 INPUT DATA:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
المرشحون الباقون (${candidateNames.length} لاعب):
${JSON.stringify(candidateNames.slice(0, 50), null, 2)}
${candidateNames.length > 50 ? `... و ${candidateNames.length - 50} لاعب آخر` : ''}

الأسئلة السابقة (${history.length} سؤال):
${JSON.stringify(history.map(h => h?.question ?? ''), null, 2)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📤 OUTPUT FORMAT (JSON ONLY):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "type": "question",
  "content": "السؤال بالعربية (≤10 كلمات، نعم/لا فقط)",
  "feature": {
    "key": "position|nationality|continent|retired|foot|height_bucket|age_bucket|club|national_team|award",
    "value": "القيمة المحددة"
  },
  "positive_players": ["أسماء اللاعبين من القائمة فقط"],
  "confidence": 0.85
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ CRITICAL: اسأل سؤال استراتيجي واحد فقط، يقسم المرشحين بذكاء ويتجنب الأسئلة الممنوعة!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

        const completion = await openai.chat.completions.create({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: "أخرج سؤال واحد الآن." }
          ],
          model: "deepseek-chat",
          temperature: 0.4,
          response_format: { type: "json_object" }
        });

        const ai = JSON.parse(completion.choices[0].message.content);
        if (ai?.type === 'guess' && ai?.content) {
          const imageUrl = await getGuessImageUrl(ai.content);
          return res.json({ type: 'guess', content: ai.content, imageUrl });
        }

        const content = String(ai?.content ?? '').trim();
        const featureKey = String(ai?.feature?.key ?? '').trim();
        const featureValue = String(ai?.feature?.value ?? '').trim();
        const positivePlayers = Array.isArray(ai?.positive_players) ? ai.positive_players : [];
        const featureKeyNorm = normalizeArabicText(featureKey);
        const featureValueNorm = normalizeArabicText(featureValue);
        const contentNorm = normalizeArabicText(content);
        const isLeagueLike = featureKeyNorm === 'league' || contentNorm.includes('دوري') || featureValueNorm.includes('دوري');
        const allowedFeatureKeys = new Set([
          'position',
          'nationality',
          'continent',
          'retired',
          'foot',
          'height_bucket',
          'age_bucket',
          'club',
          'national_team',
          'award'
        ]);
        const candidateCount = candidateNames.length;
        const positiveCount = positivePlayers.length;
        const splitRatio = candidateCount > 0 ? positiveCount / candidateCount : 0;
        const isBadSplit = candidateCount >= 8 && (splitRatio < 0.15 || splitRatio > 0.85);
        const isBadKey = featureKeyNorm && !allowedFeatureKeys.has(featureKeyNorm);
        const isBanned = isBannedQuestion(content);

        if (!content || !featureKey || !featureValue || isLeagueLike || isBadKey || isBadSplit || isBanned || isTooSimilarQuestion(content, historyNormalizedQuestions)) {
          if (isBanned) {
            console.log(`⛔ BLOCKED BANNED QUESTION: "${content}"`);
          }
          if (isBadSplit) {
            console.log(`⚠️ BLOCKED BAD SPLIT: "${content}" (${positiveCount}/${candidateCount} = ${(splitRatio * 100).toFixed(1)}%)`);
          }
          return res.json({
            type: 'question',
            content: 'هل يلعب كمهاجم؟'
          });
        }

        const feature = await upsertFeature(featureKey, featureValue);
        if (!feature?.id) {
          return res.json({ type: 'question', content });
        }

        const q = await upsertQuestionMetadata(feature.id, content);
        const candidatesMap = await upsertCandidatesByNames(positivePlayers);
        const candidateIds = Array.from(candidatesMap.values()).map(r => r.id);
        await upsertPlayerFeatures(feature.id, candidateIds, 'llm', Number.isFinite(Number(ai?.confidence)) ? Number(ai.confidence) : null);
        await bumpQuestionSeen(q?.id ?? null);

        return res.json({
          type: 'question',
          content: q?.question_text ?? content,
          question_id: q?.id ?? null,
          feature_id: q?.feature_id ?? feature.id
        });
      }
    }

    if (!openai) {
      return res.json({
        type: 'question',
        content: 'هل يلعب كمهاجم؟'
      });
    }

    const fallbackPrompt = `
🧠 أنت خبير استراتيجي في لعبة تخمين لاعبي كرة القدم - مهمتك: تخمين اللاعب في ≤10 أسئلة.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 STANDARD CONTEXT (مفترض مسبقاً):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ اللاعب = لاعب كرة قدم محترف ذكر
✅ ممنوع السؤال عن: الجنس، "هل هو لاعب كرة قدم"، "هل هو مشهور"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⛔ BANNED QUESTIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ "هل هو ذكر؟"
❌ "هل هو لاعب كرة قدم؟"
❌ "هل هو مشهور؟"
❌ "هل اسمه يبدأ بحرف...؟"
❌ أسئلة عن العمر بأرقام محددة

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 STRATEGIC APPROACH:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- السؤال 1-3: continent/region
- السؤال 4-6: retired status, club tier
- السؤال 7-9: position, awards, national team
- السؤال 10+: تفاصيل دقيقة

الأسئلة السابقة:
${JSON.stringify(history.map(h => h?.question ?? ''), null, 2)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT (JSON ONLY):
{ "type": "question", "content": "السؤال بالعربية" }
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: fallbackPrompt },
        { role: "user", content: "هات سؤال واحد." }
      ],
      model: "deepseek-chat",
      temperature: 0.3, // Lower temperature for more strategic/consistent questions
      response_format: { type: "json_object" }
    });

    const aiResponse = JSON.parse(completion.choices[0].message.content);
    const fallbackContent = String(aiResponse?.content ?? 'هل يلعب كمهاجم؟');

    // Validate fallback question - if banned, use safe default
    if (isBannedQuestion(fallbackContent) || isTooSimilarQuestion(fallbackContent, historyNormalizedQuestions)) {
      return res.json({
        type: 'question',
        content: 'هل يلعب في أوروبا؟' // Safe strategic default
      });
    }

    return res.json({
      type: 'question',
      content: fallbackContent
    });

  } catch (error) {
    console.error('Error calling DeepSeek API:', error);
    res.status(500).json({ error: 'حدث خطأ في الاتصال بالذكاء الاصطناعي' });
  }
});

app.post('/api/confirm', async (req, res) => {
  try {
    const { history, guess, correct } = req.body ?? {};
    if (!Array.isArray(history) || typeof guess !== 'string' || typeof correct !== 'boolean') {
      return res.status(400).json({ error: 'bad_request' });
    }

    if (!supabase) {
      return res.json({ ok: true, stored: false });
    }

    if (!correct) {
      const sessionId = await recordGameSession({ history, guess, correct, candidateId: null });
      return res.json({ ok: true, stored: true, correct: false });
    }

    const imageUrl = await getGuessImageUrl(guess);
    const verification = await verifyHistoryWithAiAndSerper(history, guess);

    if (verification?.ok && Array.isArray(verification.issues) && verification.issues.length === 0) {
      const candidate = await ensurePlayerProfile(guess);
      const sessionId = await recordGameSession({ history, guess, correct: true, candidateId: candidate?.id ?? null });
      if (sessionId) await recordGameMoves(sessionId, history);
      if (candidate?.id) await learnCandidateFromHistory(candidate.id, history);
      const questionIds = Array.from(new Set(history.map(h => h?.question_id ?? h?.questionId ?? null).filter(Boolean)));
      for (const qid of questionIds) {
        await bumpQuestionSuccess(qid);
      }
      return res.json({
        ok: true,
        correct: true,
        stored: true,
        sessionId,
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
    if (!Array.isArray(history) || typeof guess !== 'string') {
      return res.status(400).json({ error: 'bad_request' });
    }

    if (!supabase) {
      return res.json({ ok: true, stored: false });
    }

    const candidate = await ensurePlayerProfile(guess);
    const sessionId = await recordGameSession({ history, guess, correct: true, candidateId: candidate?.id ?? null });
    if (sessionId) await recordGameMoves(sessionId, history);
    if (candidate?.id) await learnCandidateFromHistory(candidate.id, history);
    const questionIds = Array.from(new Set(history.map(h => h?.question_id ?? h?.questionId ?? null).filter(Boolean)));
    for (const qid of questionIds) {
      await bumpQuestionSuccess(qid);
    }
    return res.json({ ok: true, stored: true, playerId: candidate?.id ?? null, imageUrl: candidate?.image_url ?? null, sessionId });
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
