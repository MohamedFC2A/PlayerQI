const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createSupabaseClient } = require('./supabaseClient');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const supabase = createSupabaseClient();

function normalizeSimpleText(input) {
  if (!input) return '';
  return String(input)
    .toLowerCase()
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
  'هل لعب في أحد الدوريات الخمسة الكبرى؟',
  'هل هو لاعب معتزل؟',
  'هل يلعب كمهاجم؟',
  'هل يلعب في أوروبا؟',
  'هل فاز بدوري أبطال أوروبا؟',
  'هل فاز بكأس العالم؟',
  'هل يلعب في منتخب بلاده؟',
];

function pickFallbackQuestion(history) {
  const asked = new Set(
    (Array.isArray(history) ? history : [])
      .map((h) => normalizeSimpleText(h?.question))
      .filter(Boolean),
  );
  for (const q of FALLBACK_QUESTIONS) {
    if (!asked.has(normalizeSimpleText(q))) return q;
  }
  return FALLBACK_QUESTIONS[0];
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
    const kind = toAnswerKind(h?.answer);
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
    .from('player_attributes')
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

app.post('/api/game', async (req, res) => {
  try {
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    const rejectedGuesses = Array.isArray(req.body?.rejectedGuesses) ? req.body.rejectedGuesses : [];
    const sessionId = String(req.body?.session_id ?? req.body?.sessionId ?? '').trim() || null;

    if (!supabase) {
      return res.json({ type: 'question', content: pickFallbackQuestion(history) });
    }

    const rejectedGuessNames = rejectedGuesses
      .map(normalizeSimpleText)
      .filter(Boolean);

    let move = null;
    let error = null;

    if (history.length === 0) {
      const result = await supabase.rpc('game_start');
      move = result?.data ?? null;
      error = result?.error ?? null;
    } else if (sessionId) {
      const last = history[history.length - 1] ?? null;
      const result = await supabase.rpc('game_step', {
        p_session_id: sessionId,
        p_question_id: last?.question_id ?? last?.questionId ?? null,
        p_attribute_id: last?.attribute_id ?? last?.feature_id ?? last?.featureId ?? null,
        p_answer: toAnswerKind(last?.answer),
        p_rejected_guess_names: rejectedGuessNames,
      });
      move = result?.data ?? null;
      error = result?.error ?? null;
    } else {
      const currentHistory = history.map((h) => ({
        attribute_id: h?.attribute_id ?? h?.feature_id ?? h?.featureId ?? null,
        normalized_question: normalizeSimpleText(h?.question ?? ''),
        answer_kind: toAnswerKind(h?.answer),
      }));
      const result = await supabase.rpc('get_optimal_move', {
        current_history: currentHistory,
        rejected_guess_names: rejectedGuessNames,
      });
      move = result?.data ?? null;
      error = result?.error ?? null;
    }

    if (error) {
      return res.json({ type: 'question', content: pickFallbackQuestion(history) });
    }

    if (move?.type === 'guess' && move?.content) {
      return res.json({
        type: 'guess',
        content: move.content,
        confidence: move.confidence ?? null,
        meta: move.meta ?? null,
        session_id: move.session_id ?? sessionId ?? null,
        imageUrl: null,
      });
    }

    if (move?.type === 'question' && move?.content) {
      return res.json({
        type: 'question',
        content: move.content,
        question_id: move.question_id ?? null,
        feature_id: move.attribute_id ?? null, // client compatibility
        session_id: move.session_id ?? sessionId ?? null,
        meta: move.meta ?? null,
      });
    }

    return res.json({ type: 'question', content: pickFallbackQuestion(history), session_id: sessionId ?? null });
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

    if (!correct) {
      if (sessionId) {
        await supabase
          .from('game_sessions')
          .update({ status: 'lost', guessed_name: guess, correct: false })
          .eq('id', sessionId);
      }
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

