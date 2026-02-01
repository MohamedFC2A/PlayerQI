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

// Initialize OpenAI client pointing to DeepSeek API
const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY
});

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
      .from('players')
      .select('id, name, normalized_name, image_url')
      .eq('normalized_name', normalizedName)
      .maybeSingle();

    if (exact?.id) return exact;

    const { data: matched } = await supabase.rpc('match_player', {
      query_text: normalizedName,
      similarity_threshold: 0.9
    });

    return matched?.[0] ?? null;
  } catch {
    const { data: exact } = await supabase
      .from('players')
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
      .from('players')
      .select('id, name, normalized_name, image_url')
      .eq('normalized_name', normalizedName)
      .maybeSingle();
    existing = data ?? null;
  } catch {
    const { data } = await supabase
      .from('players')
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
      .from('players')
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
      .from('players')
      .insert({
        name: playerName,
        normalized_name: normalizedName,
        image_url: imageUrl ?? null
      })
      .select('id, name, normalized_name, image_url')
      .single();
    if (!error) created = data ?? null;
  } catch {
    const { data, error } = await supabase
      .from('players')
      .insert({
        name: playerName,
        image_url: imageUrl ?? null
      })
      .select('id, name, image_url')
      .single();
    if (!error) created = data ?? null;
  }

  return created ?? null;
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
    const questionNumber = history.length + 1;
    const historyNormalizedQuestions = history.map(h => normalizeArabicText(h.question)).filter(Boolean);
    const rejectedGuessSet = new Set(rejectedGuesses.map(g => normalizeArabicText(g)).filter(Boolean));

    const fromQuestionId = history.length > 0
      ? await getOrCreateQuestionId(history[history.length - 1].question)
      : await getRootQuestionId();
    const answerText = history.length > 0 ? history[history.length - 1].answer : 'START';

    if (fromQuestionId) {
      const cached = await getBestTransition(fromQuestionId, answerText, historyNormalizedQuestions, rejectedGuessSet);
      if (cached?.transition && cached?.resolved) {
        await bumpTransitionSeen(cached.transition.id);
        if (cached.resolved.type === 'guess') {
          const imageUrl = await getGuessImageUrl(cached.resolved.content);
          return res.json({
            thought: 'انتقال محفوظ من قاعدة البيانات',
            type: 'guess',
            content: cached.resolved.content,
            imageUrl
          });
        }
        return res.json({
          thought: 'انتقال محفوظ من قاعدة البيانات',
          type: 'question',
          content: cached.resolved.content
        });
      }
    }

    if (history.length > 0 && supabase) {
      const lastQuestionNormalized = historyNormalizedQuestions[historyNormalizedQuestions.length - 1];
      const fallbackQuestion = await getFallbackQuestionFromPlayerPaths(lastQuestionNormalized, answerText, historyNormalizedQuestions);
      if (fallbackQuestion) {
        if (fromQuestionId) {
          const nextQuestionId = await getOrCreateQuestionId(fallbackQuestion);
          if (nextQuestionId) {
            await storeTransition(fromQuestionId, answerText, 'question', nextQuestionId, null);
          }
        }
        return res.json({
          thought: 'سؤال مستنتج من مسارات محفوظة في قاعدة البيانات',
          type: 'question',
          content: fallbackQuestion
        });
      }
    }

    if (supabase) {
      const inferred = await inferPlayerGuessFromPaths(history, rejectedGuessSet);
      if (inferred?.type === 'guess' && inferred.content) {
        const imageUrl = inferred.imageUrl ?? await getGuessImageUrl(inferred.content);
        return res.json({
          thought: `تخمين مبكر من قاعدة البيانات (ثقة ${Math.round((inferred.confidence ?? 0) * 100)}%)`,
          type: 'guess',
          content: inferred.content,
          imageUrl
        });
      }
    }

    let searchContext = '';
    if (questionNumber >= 4) {
      const searchQuery = buildSearchQuery(history);
      console.log(`🔍 Searching: ${searchQuery}`);
      const searchResults = await searchPlayerInfo(searchQuery);
      if (searchResults) {
        searchContext = `
═══════════════════════════════════════════════════════════════
🌐 نتائج بحث حقيقية (استخدمها بذكاء لتحديد اللاعب!)
═══════════════════════════════════════════════════════════════
${searchResults}
`;
      }
    }

    const systemPrompt = `
أنت "كشاف محترف" و "محلل كروي عالمي" (Elite Football Scout).
مهمتك ليست مجرد "لعبة"، بل هي عملية "تحليل واستنتاج" دقيقة لتحديد هوية اللاعب.

الوقت الحالي (مهم جداً لتجنب معلومات قديمة): ${new Date().toISOString()}

═══════════════════════════════════════════════════════════════
🧠 عقلية المحلل المحترف (Professional Analyst Mindset)
═══════════════════════════════════════════════════════════════
1. **استخدم المصطلحات الفنية**: (بوكس تو بوكس، صانع ألعاب كلاسيكي، وهمي، ارتكاز، وينج باك، التوب 5 دوريات).
2. **الاستنتاج المنطقي**: لا تخمن عشوائياً. ابنِ سؤالك القادم بناءً على حقائق مؤكدة من الإجابات السابقة.
3. **الدقة المتناهية**: بدلاً من "هل هو مهاجم؟"، قل "هل يلعب كرأس حربة صريح (Number 9)؟".

═══════════════════════════════════════════════════════════════
🚫 قائمة الممنوعات (The Blacklist) - تجنب هذا الأسلوب الهواة!
═══════════════════════════════════════════════════════════════
❌ "هل هو مشهور؟" (سؤال غبي، كل اللاعبين في اللعبة مشهورون).
❌ "هل يلعب في فريق قوي؟" (نسبي جداً وغير احترافي).
❌ "هل هو لاعب جيد؟" (ذاتي جداً).
❌ تكرار أسئلة بنفس المعنى.

✅ البديل الاحترافي:
- "هل حقق الكرة الذهبية (Ballon d'Or)؟"
- "هل يلعب حالياً في الدوري الإنجليزي الممتاز (Premier League)؟"
- "هل شارك في نهائي كأس العالم؟"

═══════════════════════════════════════════════════════════════
🕸️ الشبكة العملاقة (The Giant Network)
═══════════════════════════════════════════════════════════════
أنت تتحرك داخل شبكة معقدة من البيانات. كل إجابة تغلق مسارات وتفتح مسارات جديدة.

نظام العقد (Nodes System):
1. 🌍 **عقدة التصنيف الأولي**: (القارة، الحقبة الزمنية، الحالة الاعتزالية).
2. 🏟️ **عقدة التخصيص**: (الدوري المحدد، النادي الحالي/السابق، ديربيات لعب فيها).
3. 🏃 **عقدة التفاصيل الفنية**: (القدم المفضلة، الطول، الدور التكتيكي، رقم القميص المميز).
4. 🌟 **عقدة الإنجازات**: (هداف الدوري، بطل أبطال أوروبا، قائد المنتخب).

⚡ **قاعدة الربط السريع (Fast Link Rule)**:
- إجابة المستخدم هي "المفتاح" الذي يفتح البوابة التالية.
- مثال: "نعم" للدوري الإسباني + "لا" لريال مدريد وبرشلونة -> فوراً انتقل لأسئلة عن أتلتيكو مدريد أو إشبيلية أو فالنسيا.

═══════════════════════════════════════════════════════════════
🚀 تسريع اللعب (Speed Mode)
═══════════════════════════════════════════════════════════════
1. **أسئلة قصيرة جداً ومباشرة** (يفضل أقل من 10 كلمات).
2. لا مقدمات، لا "بناءً على إجابتك".

═══════════════════════════════════════════════════════════════
🎯 استراتيجية الحسم (15 Rounds)
═══════════════════════════════════════════════════════════════
- الأسئلة 1-4: فلترة واسعة (قارة، حقبة، مركز).
- الأسئلة 5-10: تضييق الخناق (دوري، نادي، جنسية).
- الأسئلة 11-14: تفاصيل دقيقة جداً (رقم القميص، مدرب معين، واقعة شهيرة).
- السؤال 15 (Final Shutdown): التخمين النهائي الإجباري.
 - لو أنت واثق جداً قبل 15: اخرج "guess" فوراً بدل أسئلة زائدة.

═══════════════════════════════════════════════════════════════
📜 حالة الشبكة الحالية
═══════════════════════════════════════════════════════════════
• العقدة الحالية: ${questionNumber} / 15
• مسار الشبكة (History):
${history.length > 0
        ? history.map((h, i) => `   [Node ${i + 1}] "${h.question}" -> 🟢 "${h.answer}"`).join('\n')
        : '   (Start Node: Broad Filter)'}
${(rejectedGuesses ?? []).length > 0
        ? `\n• تخمينات مرفوضة (ممنوع تكرارها):\n${(rejectedGuesses ?? []).map((g, i) => `   ${i + 1}) ${g}`).join('\n')}`
        : ''}
${searchContext}

═══════════════════════════════════════════════════════════════
🚫 ممنوع التكرار والتشابه
═══════════════════════════════════════════════════════════════
- ممنوع إعادة أي سؤال سابق أو سؤال قريب جداً منه بالمعنى أو الصياغة.
- أسئلة ممنوعة (تم سؤالها بالفعل):
${history.length > 0 ? history.map((h, i) => `   ${i + 1}) ${h.question}`).join('\n') : '   (لا يوجد)'}

═══════════════════════════════════════════════════════════════
📝 صيغة الرد (JSON)
═══════════════════════════════════════════════════════════════
{
  "thought": "تحليل العقدة التالية بناءً على الشبكة بأسلوب المحلل المحترف",
  "type": "question" | "guess",
  "content": "نص السؤال الاحترافي والمباشر"
}
`;

    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "الكرة في ملعبك. هات سؤالك التالي أو تخمينك." }
      ],
      model: "deepseek-chat",
      temperature: 0.7,
      response_format: { type: "json_object" }
    });

    const aiResponse = JSON.parse(completion.choices[0].message.content);

    // Log the hidden thought for debugging
    console.log(`🧠 AI Thought: ${aiResponse.thought}`);
    console.log(`📤 Output: ${aiResponse.content}`);

    const aiNormalizedGuess = aiResponse?.type === 'guess' ? normalizeArabicText(aiResponse.content ?? '') : '';
    if (aiResponse?.type === 'guess' && aiNormalizedGuess && rejectedGuessSet.has(aiNormalizedGuess)) {
      const retryPrompt = `${systemPrompt}\n\nالتخمين السابق مرفوض بالفعل. لا تكرره.`;
      const retry = await openai.chat.completions.create({
        messages: [
          { role: "system", content: retryPrompt },
          { role: "user", content: "هات سؤال مختلف أو تخمين مختلف تماماً." }
        ],
        model: "deepseek-chat",
        temperature: 0.3,
        response_format: { type: "json_object" }
      });
      const retryResponse = JSON.parse(retry.choices[0].message.content);
      aiResponse.type = retryResponse.type;
      aiResponse.content = retryResponse.content;
      aiResponse.thought = retryResponse.thought ?? aiResponse.thought;
    }

    if (aiResponse.type === 'question' && isTooSimilarQuestion(aiResponse.content, historyNormalizedQuestions)) {
      const retryPrompt = `${systemPrompt}\n\nالنتيجة السابقة كانت مكررة/مشابهة. اخرج بسؤال مختلف تماماً الآن.`;
      const retry = await openai.chat.completions.create({
        messages: [
          { role: "system", content: retryPrompt },
          { role: "user", content: "هات سؤال جديد مختلف 100%." }
        ],
        model: "deepseek-chat",
        temperature: 0.3,
        response_format: { type: "json_object" }
      });

      const retryResponse = JSON.parse(retry.choices[0].message.content);
      if (retryResponse?.type === 'question' && !isTooSimilarQuestion(retryResponse.content, historyNormalizedQuestions)) {
        aiResponse.type = retryResponse.type;
        aiResponse.content = retryResponse.content;
        aiResponse.thought = retryResponse.thought ?? aiResponse.thought;
      }
    }

    if (fromQuestionId) {
      if (aiResponse.type === 'question') {
        const nextQuestionId = await getOrCreateQuestionId(aiResponse.content);
        if (nextQuestionId) {
          await storeTransition(fromQuestionId, answerText, 'question', nextQuestionId, null);
        }
      } else if (aiResponse.type === 'guess') {
        await storeTransition(fromQuestionId, answerText, 'guess', null, aiResponse.content);
      }
    }

    if (aiResponse.type === 'guess') {
      const imageUrl = await getGuessImageUrl(aiResponse.content);
      return res.json({ ...aiResponse, imageUrl });
    }

    res.json(aiResponse);

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

    const normalizedGuess = normalizeArabicText(guess);
    await supabase
      .from('guess_feedback')
      .insert({
        guess_name: guess,
        normalized_guess_name: normalizedGuess,
        correct,
        history
      });

    if (!correct) {
      return res.json({ ok: true, stored: true, correct: false });
    }

    const imageUrl = await getGuessImageUrl(guess);
    const verification = await verifyHistoryWithAiAndSerper(history, guess);

    if (verification?.ok && Array.isArray(verification.issues) && verification.issues.length === 0) {
      const stored = await storeConfirmedPlayerRun(history, guess);
      return res.json({
        ...stored,
        ok: true,
        correct: true,
        reviewRequired: false,
        verification,
        imageUrl: stored?.imageUrl ?? imageUrl ?? null
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

    const result = await storeConfirmedPlayerRun(history, guess);
    return res.json(result);
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
