const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const simpleGit = require('simple-git');
const OpenAI = require('openai');
const { createSupabaseClient } = require('../supabaseClient');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const repoRoot = path.join(__dirname, '..', '..');
const git = simpleGit({ baseDir: repoRoot });

async function runGit(args) {
  const out = await git.raw(args);
  return String(out ?? '').trim();
}

async function canResolveGitRef(ref) {
  try {
    await runGit(['rev-parse', '--verify', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function parseSemverVersion(input) {
  if (typeof input !== 'string') return null;
  const match = input.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:\b|$)/i);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function bumpVersion(base, updateType) {
  const next = { ...base };
  if (updateType === 'MAJOR_VERSION') {
    next.major += 1;
    next.minor = 0;
    next.patch = 0;
    return next;
  }
  if (updateType === 'HOTFIX') {
    next.patch += 1;
    return next;
  }
  next.minor += 1;
  next.patch = 0;
  return next;
}

function safeJsonParse(content) {
  if (typeof content !== 'string') return null;
  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(content.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeAiPayload(payload) {
  const updateType = typeof payload?.type === 'string' ? payload.type.trim().toUpperCase() : '';
  const normalizedType = ['MAJOR_VERSION', 'FEATURE_UPDATE', 'HOTFIX'].includes(updateType)
    ? updateType
    : 'FEATURE_UPDATE';

  const summary = typeof payload?.summary === 'string' ? payload.summary.trim() : '';
  const features = Array.isArray(payload?.features) ? payload.features.map(String).map((s) => s.trim()).filter(Boolean) : [];
  const fixes = Array.isArray(payload?.fixes) ? payload.fixes.map(String).map((s) => s.trim()).filter(Boolean) : [];

  return {
    updateType: normalizedType,
    summary: summary || 'تحديثات وتحسينات عامة.',
    features,
    fixes,
  };
}

async function getLastChangelogVersion(supabase) {
  const { data, error } = await supabase
    .from('project_changelogs')
    .select('version,release_date')
    .order('release_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data ?? null;
}

function getPackageJsonVersion() {
  const packagePath = path.join(__dirname, '..', '..', 'package.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return typeof parsed?.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

async function buildCommitRange({ lastChangelogVersion, lastTag }) {
  const candidates = [];
  if (lastChangelogVersion) candidates.push(lastChangelogVersion);
  if (lastTag) candidates.push(lastTag);

  for (const ref of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await canResolveGitRef(ref)) return ref;
  }

  return null;
}

async function fetchCommitSubjectsSince(baseline) {
  if (baseline?.type === 'since' && baseline.value) {
    const out = await runGit(['log', `--since=${baseline.value}`, '--no-merges', '--pretty=format:%s']);
    return String(out ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const ref = baseline?.type === 'ref' ? baseline.value : null;
  const range = ref ? `${ref}..HEAD` : 'HEAD';
  const out = await runGit(['log', range, '--no-merges', '--pretty=format:%s']);
  return String(out ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function generateWithDeepSeek({ commitSubjects }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('Missing DEEPSEEK_API_KEY in server/.env');
  }

  const client = new OpenAI({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  });

  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

  const systemPrompt = [
    'You are a Product Manager. Convert these raw technical git commits into a user-friendly changelog.',
    "Group them into 'New Features' and 'Bug Fixes'. Ignore technical debt or refactoring.",
    "Output JSON: { summary: '...', features: [], fixes: [], type: '...' }.",
    "Where type is one of: 'MAJOR_VERSION', 'FEATURE_UPDATE', 'HOTFIX'.",
  ].join(' ');

  const userContent = [
    'Raw commit messages:',
    ...commitSubjects.map((m) => `- ${m}`),
  ].join('\n');

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_object' },
  }).catch(() => null);

  const fallbackResp = resp ?? await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  });

  const content = fallbackResp?.choices?.[0]?.message?.content ?? '';
  const parsed = safeJsonParse(content);
  if (!parsed) {
    throw new Error('DeepSeek response was not valid JSON');
  }

  return normalizeAiPayload(parsed);
}

async function main() {
  const supabase = createSupabaseClient();
  if (!supabase) {
    // eslint-disable-next-line no-console
    console.error('Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env');
    process.exit(1);
  }

  let lastTag = null;
  try {
    lastTag = await runGit(['describe', '--tags', '--abbrev=0']);
  } catch {
    lastTag = null;
  }

  const lastChangelog = await getLastChangelogVersion(supabase);
  const lastChangelogVersion = lastChangelog?.version ?? null;
  const lastChangelogDate = lastChangelog?.release_date ? new Date(lastChangelog.release_date) : null;

  let baseline = null;
  if (lastChangelogDate && !Number.isNaN(lastChangelogDate.getTime())) {
    baseline = { type: 'since', value: lastChangelogDate.toISOString() };
  } else {
    const baseRef = await buildCommitRange({ lastChangelogVersion, lastTag });
    baseline = baseRef ? { type: 'ref', value: baseRef } : null;
  }

  const commitSubjects = await fetchCommitSubjectsSince(baseline);
  if (!Array.isArray(commitSubjects) || commitSubjects.length === 0) {
    // eslint-disable-next-line no-console
    console.log('No new commits since last release baseline. Nothing to publish.');
    return;
  }

  const ai = await generateWithDeepSeek({ commitSubjects });

  const baselineVersion = parseSemverVersion(lastChangelogVersion)
    || parseSemverVersion(lastTag)
    || parseSemverVersion(getPackageJsonVersion())
    || { major: 0, minor: 1, patch: 0 };

  const nextVersion = bumpVersion(baselineVersion, ai.updateType);
  let version = `v${nextVersion.major}.${nextVersion.minor}.${nextVersion.patch}`;

  const { data: existing } = await supabase
    .from('project_changelogs')
    .select('id')
    .eq('version', version)
    .limit(1);

  if (Array.isArray(existing) && existing.length > 0) {
    let shortSha = 'unknown';
    try {
      shortSha = await runGit(['rev-parse', '--short', 'HEAD']);
    } catch {
      shortSha = 'unknown';
    }
    version = `${version}-${shortSha}`;
  }

  const { data, error } = await supabase
    .from('project_changelogs')
    .insert([{
      version,
      update_type: ai.updateType,
      summary: ai.summary,
      features: ai.features,
      fixes: ai.fixes,
      is_published: true,
    }])
    .select('id,version,update_type,release_date')
    .maybeSingle();

  if (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to insert changelog:', error);
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`Published changelog ${data?.version || version} (${data?.update_type || ai.updateType})`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.message || err);
  process.exit(1);
});
