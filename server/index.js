const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const { createSupabaseClient } = require('./supabaseClient');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const supabase = createSupabaseClient();

function normalizeSimpleText(input) {
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

function toAnswerKind(input) {
  const a = normalizeSimpleText(input);
  if (!a) return 'unknown';
  if (['yes', 'y', 'true', 'نعم'].includes(a)) return 'yes';
  if (['no', 'n', 'false', 'لا'].includes(a)) return 'no';
  if (['maybe', 'ربما', 'جزئيا', 'جزئياً'].includes(a)) return 'maybe';
  if (['unknown', 'idk', 'لا اعرف', 'لا أعرف'].includes(a)) return 'unknown';
  return 'unknown';
}

const FALLBACK_QUESTIONS = [
  'هل هو لاعب معتزل؟',
  'هل يلعب كمهاجم؟',
  'هل يلعب في أوروبا؟',
  'هل فاز بدوري أبطال أوروبا؟',
  'هل فاز بكأس العالم؟',
  'هل يلعب في منتخب بلاده؟',
  'هل يلعب في أحد الدوريات الخمسة الكبرى؟',
  'هل لعب لنادٍ كبير في أوروبا؟',
  'هل هو حارس مرمى؟',
  'هل يلعب كمدافع؟',
  'هل يلعب في خط الوسط؟',
];

function pickFallbackQuestion(history) {
  const asked = new Set(
    (Array.isArray(history) ? history : [])
      .map((h) => normalizeSimpleText(h?.question))
      .filter(Boolean),
  );
  const available = FALLBACK_QUESTIONS.filter((q) => !asked.has(normalizeSimpleText(q)));
  const pool = available.length > 0 ? available : FALLBACK_QUESTIONS;
  return pool[Math.floor(Math.random() * pool.length)];
}

async function upsertPlayerByGuessName(guessName) {
  if (!supabase) return null;
  const normalized = normalizeSimpleText(guessName);
  if (!normalized) return null;

  const { data: matched } = await supabase.rpc('match_player', {
    query_text: normalized,
    similarity_threshold: 0.92,
  });

  const matchRow = Array.isArray(matched) ? matched[0] : matched;
  if (matchRow?.id) return matchRow;

  const { data, error } = await supabase
    .from('players')
    .upsert(
      [{ name: guessName, normalized_name: normalized, prior_weight: 1 }],
      { onConflict: 'normalized_name' },
    )
    .select('id,name,normalized_name,image_url')
    .maybeSingle();

  if (error) return null;
  return data ?? null;
}

async function learnPlayerAttributesFromHistory(playerId, history) {
  if (!supabase || !playerId || !Array.isArray(history) || history.length === 0) return;

  const rows = [];
  for (const h of history) {
    const attributeId = h?.attribute_id ?? h?.feature_id ?? h?.featureId ?? null;
    const kind = toAnswerKind(h?.answer ?? h?.answer_kind ?? h?.answerKind ?? null);
    if (!attributeId) continue;
    if (kind !== 'yes' && kind !== 'no') continue;
    rows.push({
      player_id: playerId,
      attribute_id: attributeId,
      value: kind === 'yes',
      confidence_score: 1,
      source: 'user',
    });
  }

  if (rows.length === 0) return;

  await supabase
    .from('player_matrix')
    .upsert(rows, { onConflict: 'player_id,attribute_id' });
}

async function bumpQuestionSuccessFromHistory(history) {
  if (!supabase || !Array.isArray(history) || history.length === 0) return;
  const ids = Array.from(
    new Set(
      history
        .map((h) => h?.question_id ?? h?.questionId ?? null)
        .filter(Boolean),
    ),
  );
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    await supabase.rpc('bump_question_success', { p_question_id: id });
  }
}

// Cache the attribute catalog and top-player matrix for sub-200ms inference.
const ATTRIBUTE_CACHE_TTL_MS = 5 * 60 * 1000;
const MATRIX_CACHE_REFRESH_MS = 10 * 60 * 1000;

const attributeCatalogCache = { fetchedAt: 0, data: null };
const matrixCache = { ready: false, updatedAt: 0, players: new Map() };

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function refreshMatrixCache() {
  if (!supabase) return;

  const { data: players, error: playersError } = await supabase
    .from('players')
    .select('id,name,prior_weight')
    .order('prior_weight', { ascending: false })
    .limit(500);

  if (playersError || !Array.isArray(players) || players.length === 0) return;

  const playerIds = players.map((p) => p.id);
  const { data: matrixRows, error: matrixError } = await supabase
    .from('player_matrix')
    .select('player_id,attribute_id,value')
    .in('player_id', playerIds);

  if (matrixError) return;

  const byPlayer = new Map();
  for (const player of players) {
    byPlayer.set(player.id, {
      id: player.id,
      name: player.name,
      prior_weight: Number(player.prior_weight ?? 0),
      attributes: new Map(),
    });
  }

  for (const row of matrixRows ?? []) {
    const entry = byPlayer.get(row.player_id);
    if (!entry) continue;
    entry.attributes.set(row.attribute_id, row.value === true);
  }

  matrixCache.players = byPlayer;
  matrixCache.updatedAt = Date.now();
  matrixCache.ready = true;
}

if (supabase) {
  refreshMatrixCache().catch(() => {});
  setInterval(() => {
    refreshMatrixCache().catch(() => {});
  }, MATRIX_CACHE_REFRESH_MS);
}

async function fetchAttributeCatalog() {
  if (!supabase) return new Map();

  const now = Date.now();
  if (attributeCatalogCache.data && (now - attributeCatalogCache.fetchedAt) < ATTRIBUTE_CACHE_TTL_MS) {
    return attributeCatalogCache.data;
  }

  const [attrsRes, questionsRes] = await Promise.all([
    supabase
      .from('attributes')
      .select('id,attribute_key,attribute_group,is_exclusive,normalized_key,normalized_value'),
    supabase
      .from('view_attribute_best_question')
      .select('attribute_id,question_id,question_text,normalized_text'),
  ]);

  if (attrsRes.error || questionsRes.error) {
    return attributeCatalogCache.data ?? new Map();
  }

  const catalog = new Map();
  for (const attr of attrsRes.data ?? []) {
    catalog.set(attr.id, {
      id: attr.id,
      attribute_key: attr.attribute_key,
      attribute_group: attr.attribute_group,
      is_exclusive: Boolean(attr.is_exclusive),
      normalized_key: attr.normalized_key,
      normalized_value: attr.normalized_value,
      question: null,
    });
  }

  for (const q of questionsRes.data ?? []) {
    const entry = catalog.get(q.attribute_id);
    if (!entry) continue;
    entry.question = {
      id: q.question_id,
      text: q.question_text,
      normalized_text: q.normalized_text,
    };
  }

  attributeCatalogCache.data = catalog;
  attributeCatalogCache.fetchedAt = now;
  return catalog;
}

async function resolveHistoryAttributes(history) {
  const items = Array.isArray(history) ? history : [];
  const resolved = items.map((h) => {
    const answerInput = h?.answer ?? h?.answer_kind ?? h?.answerKind ?? null;
    return {
      attribute_id: h?.attribute_id ?? h?.feature_id ?? h?.featureId ?? null,
      question_id: h?.question_id ?? h?.questionId ?? null,
      question: typeof h?.question === 'string' ? h.question : '',
      normalized_question: normalizeSimpleText(h?.question ?? ''),
      answer_kind: toAnswerKind(answerInput),
    };
  });

  const missing = resolved
    .filter((h) => !h.attribute_id && h.normalized_question)
    .map((h) => h.normalized_question);

  if (!supabase || missing.length === 0) return resolved;

  const uniqueMissing = Array.from(new Set(missing));
  const { data, error } = await supabase
    .from('questions')
    .select('attribute_id,normalized_text')
    .in('normalized_text', uniqueMissing);

  if (error || !Array.isArray(data)) return resolved;

  const byNormalized = new Map(data.map((row) => [row.normalized_text, row.attribute_id]));
  return resolved.map((item) => (item.attribute_id
    ? item
    : { ...item, attribute_id: byNormalized.get(item.normalized_question) ?? null }));
}

function buildConstraintState(resolvedHistory) {
  const askedAttributeIds = new Set();
  const askedQuestionNorms = new Set();
  const latestAnswers = new Map();

  for (const h of resolvedHistory) {
    if (h.attribute_id) askedAttributeIds.add(h.attribute_id);
    if (h.normalized_question) askedQuestionNorms.add(h.normalized_question);
    if (h.attribute_id && (h.answer_kind === 'yes' || h.answer_kind === 'no')) {
      latestAnswers.set(h.attribute_id, h.answer_kind);
    }
  }

  const yesIds = [];
  const noIds = [];
  for (const [attributeId, kind] of latestAnswers.entries()) {
    if (kind === 'yes') yesIds.push(attributeId);
    if (kind === 'no') noIds.push(attributeId);
  }

  return {
    yesIds,
    noIds,
    askedAttributeIds,
    askedQuestionNorms,
  };
}

async function fetchCandidateSummary(yesIds, noIds, rejectedGuessNames) {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_candidate_summary', {
    p_yes_attribute_ids: yesIds,
    p_no_attribute_ids: noIds,
    p_rejected_names: rejectedGuessNames,
  });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    candidate_count: Number(row.candidate_count ?? 0),
    top_player_id: row.top_player_id ?? null,
    top_player_name: row.top_player_name ?? null,
    total_weight: Number(row.total_weight ?? 0),
    top_weight: Number(row.top_weight ?? 0),
  };
}

async function fetchAttributeStats(yesIds, noIds, askedAttributeIds, rejectedGuessNames) {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('get_attribute_stats', {
    p_yes_attribute_ids: yesIds,
    p_no_attribute_ids: noIds,
    p_asked_attribute_ids: Array.from(askedAttributeIds ?? []),
    p_rejected_names: rejectedGuessNames,
  });
  if (error || !Array.isArray(data)) return [];
  return data.map((row) => ({
    attribute_id: row.attribute_id,
    true_count: Number(row.true_count ?? 0),
    known_count: Number(row.known_count ?? 0),
    total_count: Number(row.total_count ?? 0),
  }));
}

function getAttributeStatsFromCache(yesIds, noIds, askedAttributeIds) {
  if (!matrixCache.ready) return { stats: [], totalCount: 0 };

  const yesSet = new Set(yesIds ?? []);
  const noSet = new Set(noIds ?? []);
  const askedSet = new Set(askedAttributeIds ?? []);

  const candidates = [];
  for (const player of matrixCache.players.values()) {
    let matches = true;
    for (const id of yesSet) {
      if (player.attributes.get(id) !== true) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    for (const id of noSet) {
      if (player.attributes.get(id) === true) {
        matches = false;
        break;
      }
    }
    if (matches) candidates.push(player);
  }

  const totalCount = candidates.length;
  if (totalCount === 0) return { stats: [], totalCount };

  const statsMap = new Map();
  for (const player of candidates) {
    for (const [attributeId, value] of player.attributes.entries()) {
      if (askedSet.has(attributeId)) continue;
      const stat = statsMap.get(attributeId) ?? { true_count: 0, known_count: 0 };
      stat.known_count += 1;
      if (value === true) stat.true_count += 1;
      statsMap.set(attributeId, stat);
    }
  }

  const stats = Array.from(statsMap, ([attribute_id, stat]) => ({
    attribute_id,
    true_count: stat.true_count,
    known_count: stat.known_count,
    total_count: totalCount,
  }));

  return { stats, totalCount };
}

function chooseBestAttribute(stats, candidateCount, catalog, askedQuestionNorms, askedAttributeIds, answeredYesGroups) {
  let best = null;
  for (const stat of stats) {
    if (!stat || !stat.attribute_id) continue;
    if (!candidateCount || candidateCount < 2) continue;

    const attr = catalog.get(stat.attribute_id);
    if (!attr || !attr.question) continue;
    // Context guardrails: avoid repeats or exclusive-group conflicts.
    if (askedAttributeIds.has(stat.attribute_id)) continue;
    if (attr.question.normalized_text && askedQuestionNorms.has(attr.question.normalized_text)) continue;
    if (attr.is_exclusive && answeredYesGroups.has(attr.attribute_group)) continue;
    if (stat.true_count === 0 || stat.true_count === candidateCount) continue;

    // Score by closeness to a perfect 50/50 split with a light penalty for unknown coverage.
    const ratio = stat.true_count / candidateCount;
    const coverage = candidateCount > 0 ? (stat.known_count / candidateCount) : 0;
    const score = Math.abs(0.5 - ratio);
    const adjustedScore = score + ((1 - coverage) * 0.2);

    if (!best || adjustedScore < best.adjustedScore
      || (adjustedScore === best.adjustedScore && coverage > best.coverage)) {
      best = {
        attribute_id: stat.attribute_id,
        question_id: attr.question.id ?? null,
        question_text: attr.question.text ?? null,
        question_normalized: attr.question.normalized_text ?? null,
        ratio,
        coverage,
        score,
        adjustedScore,
      };
    }
  }

  return best;
}

async function ensureSession(sessionId, history, rejectedGuessNames) {
  if (!supabase) return null;

  const payload = {
    history: Array.isArray(history) ? history : [],
    rejected_guess_names: Array.isArray(rejectedGuessNames) ? rejectedGuessNames : [],
    status: 'in_progress',
    question_count: Array.isArray(history) ? history.length : null,
  };

  const normalizedId = isUuid(sessionId) ? sessionId : null;
  if (!normalizedId) {
    const { data, error } = await supabase
      .from('game_sessions')
      .insert(payload)
      .select('id')
      .maybeSingle();
    if (error) return null;
    return data?.id ?? null;
  }

  await supabase
    .from('game_sessions')
    .upsert({ id: normalizedId, ...payload }, { onConflict: 'id' });

  return normalizedId;
}

async function persistSessionState({
  sessionId,
  history,
  constraintState,
  rejectedGuessNames,
  summary,
  topProb,
  move,
}) {
  if (!supabase || !sessionId) return;

  const constraints = {
    yes: constraintState.yesIds,
    no: constraintState.noIds,
  };

  await supabase
    .from('active_sessions')
    .upsert({
      session_id: sessionId,
      state_vector: {
        history,
        constraints,
      },
      constraints,
      asked_attribute_ids: Array.from(constraintState.askedAttributeIds ?? []),
      asked_question_norms: Array.from(constraintState.askedQuestionNorms ?? []),
      rejected_guess_names: rejectedGuessNames ?? [],
      candidate_count: summary?.candidate_count ?? null,
      top_candidate_id: summary?.top_player_id ?? null,
      top_candidate_prob: typeof topProb === 'number' ? topProb : null,
      last_move: move ?? null,
    }, { onConflict: 'session_id' });
}

async function recordLearningGap({ sessionId, guess, confidence, reason, history }) {
  if (!supabase || !guess) return;
  await supabase
    .from('learning_queue')
    .insert({
      session_id: sessionId ?? null,
      guess_name: guess,
      normalized_guess: normalizeSimpleText(guess),
      reason,
      payload: {
        history: Array.isArray(history) ? history : [],
        confidence: typeof confidence === 'number' ? confidence : null,
      },
    });
}

app.post('/api/game', async (req, res) => {
  try {
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    const rejectedGuesses = Array.isArray(req.body?.rejectedGuesses) ? req.body.rejectedGuesses : [];
    const sessionIdInput = String(req.body?.session_id ?? req.body?.sessionId ?? '').trim() || null;

    if (!supabase) {
      return res.json({ type: 'question', content: pickFallbackQuestion(history) });
    }

    const rejectedGuessNames = rejectedGuesses
      .map(normalizeSimpleText)
      .filter(Boolean);

    // Resolve history into attribute ids + normalized questions, then build constraints.
    const resolvedHistory = await resolveHistoryAttributes(history);
    const constraintState = buildConstraintState(resolvedHistory);

    // Fetch candidate summary + attribute splits in parallel for low latency.
    const [catalog, summary, stats, sessionId] = await Promise.all([
      fetchAttributeCatalog(),
      fetchCandidateSummary(constraintState.yesIds, constraintState.noIds, rejectedGuessNames),
      fetchAttributeStats(
        constraintState.yesIds,
        constraintState.noIds,
        constraintState.askedAttributeIds,
        rejectedGuessNames,
      ),
      ensureSession(sessionIdInput, resolvedHistory, rejectedGuessNames),
    ]);

    if (!summary || summary.candidate_count === 0) {
      return res.json({
        type: 'question',
        content: pickFallbackQuestion(history),
        session_id: sessionId ?? null,
      });
    }

    const topProb = summary.total_weight > 0
      ? (summary.top_weight / summary.total_weight)
      : (summary.candidate_count > 0 ? (1 / summary.candidate_count) : 0);

    const answeredYesGroups = new Set();
    for (const item of resolvedHistory) {
      if (item.answer_kind !== 'yes' || !item.attribute_id) continue;
      const attr = catalog.get(item.attribute_id);
      if (attr?.is_exclusive) answeredYesGroups.add(attr.attribute_group);
    }

    let attributeStats = stats;
    if (attributeStats.length === 0 && matrixCache.ready) {
      const cached = getAttributeStatsFromCache(
        constraintState.yesIds,
        constraintState.noIds,
        constraintState.askedAttributeIds,
      );
      attributeStats = cached.stats;
    }

    const metaBase = {
      remaining: summary.candidate_count,
      top_player: {
        player_id: summary.top_player_id ?? null,
        name: summary.top_player_name ?? null,
        confidence: topProb,
      },
    };

    // Guess if only one candidate remains or the top prior is overwhelming.
    if (summary.candidate_count === 1 || topProb >= 0.9) {
      const move = {
        type: 'guess',
        content: summary.top_player_name ?? null,
        confidence: topProb,
        meta: metaBase,
      };

      await persistSessionState({
        sessionId,
        history: resolvedHistory,
        constraintState,
        rejectedGuessNames,
        summary,
        topProb,
        move,
      });

      return res.json({
        type: 'guess',
        content: summary.top_player_name ?? null,
        confidence: topProb,
        meta: metaBase,
        session_id: sessionId ?? null,
        imageUrl: null,
      });
    }

    // Entropy-maximizing move: pick the attribute closest to a 50/50 split.
    const best = chooseBestAttribute(
      attributeStats,
      summary.candidate_count,
      catalog,
      constraintState.askedQuestionNorms,
      constraintState.askedAttributeIds,
      answeredYesGroups,
    );

    if (!best || !best.question_text) {
      const fallback = pickFallbackQuestion(history);
      const move = { type: 'question', content: fallback, meta: metaBase };

      await persistSessionState({
        sessionId,
        history: resolvedHistory,
        constraintState,
        rejectedGuessNames,
        summary,
        topProb,
        move,
      });

      return res.json({
        type: 'question',
        content: fallback,
        session_id: sessionId ?? null,
      });
    }

    if (best.question_id) {
      await supabase.rpc('bump_question_seen', { p_question_id: best.question_id });
    }

    const move = {
      type: 'question',
      question_id: best.question_id,
      attribute_id: best.attribute_id,
      content: best.question_text,
      meta: {
        ...metaBase,
        split: best.ratio,
        score: best.adjustedScore,
        coverage: best.coverage,
      },
    };

    await persistSessionState({
      sessionId,
      history: resolvedHistory,
      constraintState,
      rejectedGuessNames,
      summary,
      topProb,
      move,
    });

    return res.json({
      type: 'question',
      content: best.question_text,
      question_id: best.question_id ?? null,
      feature_id: best.attribute_id ?? null,
      session_id: sessionId ?? null,
      meta: move.meta ?? null,
    });
  } catch (err) {
    // Keep API stable for the client
    return res.status(500).json({ error: 'server_error' });
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

    let confidence = typeof req.body?.confidence === 'number' ? req.body.confidence : null;
    if (confidence === null && sessionId) {
      const { data: active } = await supabase
        .from('active_sessions')
        .select('top_candidate_prob')
        .eq('session_id', sessionId)
        .maybeSingle();
      confidence = typeof active?.top_candidate_prob === 'number' ? active.top_candidate_prob : null;
    }

    if (!correct) {
      if (sessionId) {
        await supabase
          .from('game_sessions')
          .update({ status: 'lost', guessed_name: guess, correct: false })
          .eq('id', sessionId);
      }

      await recordLearningGap({
        sessionId,
        guess,
        confidence,
        reason: typeof confidence === 'number' && confidence >= 0.85 ? 'high_confidence_reject' : 'wrong_guess',
        history,
      });

      return res.json({ ok: true, stored: false, correct: false, sessionId: sessionId ?? null });
    }

    const player = await upsertPlayerByGuessName(guess);
    const playerId = player?.id ?? null;

    if (sessionId) {
      await supabase
        .from('game_sessions')
        .update({
          status: 'won',
          guessed_player_id: playerId,
          guessed_name: guess,
          correct: true,
          question_count: Array.isArray(history) ? history.length : null,
        })
        .eq('id', sessionId);
    }

    await learnPlayerAttributesFromHistory(playerId, history);
    await bumpQuestionSuccessFromHistory(history);

    return res.json({
      ok: true,
      stored: Boolean(sessionId),
      correct: true,
      playerId,
      imageUrl: player?.image_url ?? null,
      sessionId: sessionId ?? null,
      reviewRequired: false,
    });
  } catch {
    return res.status(500).json({ error: 'server_error' });
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

    const player = await upsertPlayerByGuessName(guess);
    const playerId = player?.id ?? null;

    if (sessionId) {
      await supabase
        .from('game_sessions')
        .update({
          status: 'won',
          guessed_player_id: playerId,
          guessed_name: guess,
          correct: true,
          question_count: Array.isArray(history) ? history.length : null,
        })
        .eq('id', sessionId);
    }

    await learnPlayerAttributesFromHistory(playerId, history);
    await bumpQuestionSuccessFromHistory(history);

    return res.json({ ok: true, stored: Boolean(sessionId), playerId, imageUrl: player?.image_url ?? null, sessionId });
  } catch {
    return res.status(500).json({ error: 'server_error' });
  }
});

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
    supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    supabaseKeyRole,
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
