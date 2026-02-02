/* eslint-disable no-console */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function normalizeSimpleText(input) {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSupabase() {
  const url = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

const ATTRIBUTE_SETS = {
  continent: [
    { value: 'europe', label_ar: 'أوروبا', question_ar: 'هل هو من أوروبا؟' },
    { value: 'south america', label_ar: 'أمريكا الجنوبية', question_ar: 'هل هو من أمريكا الجنوبية؟' },
    { value: 'africa', label_ar: 'أفريقيا', question_ar: 'هل هو من أفريقيا؟' },
    { value: 'asia', label_ar: 'آسيا', question_ar: 'هل هو من آسيا؟' },
    { value: 'north america', label_ar: 'أمريكا الشمالية', question_ar: 'هل هو من أمريكا الشمالية؟' },
  ],
  position: [
    { value: 'forward', label_ar: 'مهاجم', question_ar: 'هل يلعب كمهاجم؟' },
    { value: 'midfielder', label_ar: 'لاعب وسط', question_ar: 'هل يلعب كلاعب وسط؟' },
    { value: 'defender', label_ar: 'مدافع', question_ar: 'هل يلعب كمدافع؟' },
    { value: 'goalkeeper', label_ar: 'حارس مرمى', question_ar: 'هل هو حارس مرمى؟' },
  ],
  league: [
    { value: 'premier league', label_ar: 'الدوري الإنجليزي', question_ar: 'هل يلعب في الدوري الإنجليزي؟' },
    { value: 'la liga', label_ar: 'الدوري الإسباني', question_ar: 'هل يلعب في الدوري الإسباني؟' },
    { value: 'serie a', label_ar: 'الدوري الإيطالي', question_ar: 'هل يلعب في الدوري الإيطالي؟' },
    { value: 'bundesliga', label_ar: 'الدوري الألماني', question_ar: 'هل يلعب في الدوري الألماني؟' },
    { value: 'ligue 1', label_ar: 'الدوري الفرنسي', question_ar: 'هل يلعب في الدوري الفرنسي؟' },
    { value: 'mls', label_ar: 'الدوري الأمريكي', question_ar: 'هل يلعب في الدوري الأمريكي؟' },
    { value: 'saudi pro league', label_ar: 'الدوري السعودي', question_ar: 'هل يلعب في الدوري السعودي؟' },
  ],
  retired: [
    { value: 'retired', label_ar: 'معتزل', question_ar: 'هل هو لاعب معتزل؟' },
  ],
};

const NATIONALITIES = [
  { value: 'argentina', label_ar: 'أرجنتيني' },
  { value: 'portugal', label_ar: 'برتغالي' },
  { value: 'egypt', label_ar: 'مصري' },
  { value: 'france', label_ar: 'فرنسي' },
  { value: 'norway', label_ar: 'نرويجي' },
  { value: 'brazil', label_ar: 'برازيلي' },
  { value: 'belgium', label_ar: 'بلجيكي' },
  { value: 'england', label_ar: 'إنجليزي' },
  { value: 'spain', label_ar: 'إسباني' },
  { value: 'poland', label_ar: 'بولندي' },
  { value: 'croatia', label_ar: 'كرواتي' },
  { value: 'netherlands', label_ar: 'هولندي' },
  { value: 'germany', label_ar: 'ألماني' },
  { value: 'italy', label_ar: 'إيطالي' },
  { value: 'uruguay', label_ar: 'أوروغواياني' },
  { value: 'nigeria', label_ar: 'نيجيري' },
  { value: 'morocco', label_ar: 'مغربي' },
  { value: 'korea', label_ar: 'كوري' },
  { value: 'scotland', label_ar: 'اسكتلندي' },
  { value: 'slovenia', label_ar: 'سلوفيني' },
  { value: 'georgia', label_ar: 'جورجي' },
];

const CLUBS = [
  { value: 'manchester city', label_ar: 'مانشستر سيتي' },
  { value: 'liverpool', label_ar: 'ليفربول' },
  { value: 'real madrid', label_ar: 'ريال مدريد' },
  { value: 'barcelona', label_ar: 'برشلونة' },
  { value: 'bayern munich', label_ar: 'بايرن ميونخ' },
  { value: 'arsenal', label_ar: 'آرسنال' },
  { value: 'manchester united', label_ar: 'مانشستر يونايتد' },
  { value: 'tottenham', label_ar: 'توتنهام' },
  { value: 'psg', label_ar: 'باريس سان جيرمان' },
  { value: 'atletico madrid', label_ar: 'أتلتيكو مدريد' },
  { value: 'inter milan', label_ar: 'إنتر ميلان' },
  { value: 'ac milan', label_ar: 'ميلان' },
  { value: 'napoli', label_ar: 'نابولي' },
  { value: 'inter miami', label_ar: 'إنتر ميامي' },
  { value: 'al nassr', label_ar: 'النصر' },
  { value: 'al hilal', label_ar: 'الهلال' },
  { value: 'al ittihad', label_ar: 'الاتحاد' },
];

const AWARDS = [
  { value: 'ballon dor', label_ar: 'الكرة الذهبية', question_ar: 'هل فاز بالكرة الذهبية؟' },
  { value: 'world cup', label_ar: 'كأس العالم', question_ar: 'هل فاز بكأس العالم؟' },
  { value: 'champions league', label_ar: 'دوري الأبطال', question_ar: 'هل فاز بدوري أبطال أوروبا؟' },
];

const PLAYERS = [
  { name: 'Lionel Messi', continent: 'south america', nationality: 'argentina', position: 'forward', league: 'mls', club: 'inter miami', retired: false, awards: ['ballon dor', 'world cup', 'champions league'] },
  { name: 'Cristiano Ronaldo', continent: 'europe', nationality: 'portugal', position: 'forward', league: 'saudi pro league', club: 'al nassr', retired: false, awards: ['ballon dor', 'champions league'] },
  { name: 'Kylian Mbappé', continent: 'europe', nationality: 'france', position: 'forward', league: 'la liga', club: 'real madrid', retired: false, awards: ['world cup'] },
  { name: 'Erling Haaland', continent: 'europe', nationality: 'norway', position: 'forward', league: 'premier league', club: 'manchester city', retired: false, awards: ['champions league'] },
  { name: 'Mohamed Salah', continent: 'africa', nationality: 'egypt', position: 'forward', league: 'premier league', club: 'liverpool', retired: false, awards: ['champions league'] },
  { name: 'Kevin De Bruyne', continent: 'europe', nationality: 'belgium', position: 'midfielder', league: 'premier league', club: 'manchester city', retired: false, awards: ['champions league'] },
  { name: 'Jude Bellingham', continent: 'europe', nationality: 'england', position: 'midfielder', league: 'la liga', club: 'real madrid', retired: false, awards: ['champions league'] },
  { name: 'Vinícius Júnior', continent: 'south america', nationality: 'brazil', position: 'forward', league: 'la liga', club: 'real madrid', retired: false, awards: ['champions league'] },
  { name: 'Harry Kane', continent: 'europe', nationality: 'england', position: 'forward', league: 'bundesliga', club: 'bayern munich', retired: false },
  { name: 'Robert Lewandowski', continent: 'europe', nationality: 'poland', position: 'forward', league: 'la liga', club: 'barcelona', retired: false, awards: ['champions league'] },
  { name: 'Neymar', continent: 'south america', nationality: 'brazil', position: 'forward', league: 'saudi pro league', club: 'al hilal', retired: false, awards: ['champions league'] },
  { name: 'Karim Benzema', continent: 'europe', nationality: 'france', position: 'forward', league: 'saudi pro league', club: 'al ittihad', retired: false, awards: ['ballon dor', 'champions league'] },
  { name: 'Luka Modrić', continent: 'europe', nationality: 'croatia', position: 'midfielder', league: 'la liga', club: 'real madrid', retired: false, awards: ['ballon dor', 'champions league'] },
  { name: 'Rodri', continent: 'europe', nationality: 'spain', position: 'midfielder', league: 'premier league', club: 'manchester city', retired: false, awards: ['champions league'] },
  { name: 'Bernardo Silva', continent: 'europe', nationality: 'portugal', position: 'midfielder', league: 'premier league', club: 'manchester city', retired: false, awards: ['champions league'] },
  { name: 'Bukayo Saka', continent: 'europe', nationality: 'england', position: 'forward', league: 'premier league', club: 'arsenal', retired: false },
  { name: 'Martin Ødegaard', continent: 'europe', nationality: 'norway', position: 'midfielder', league: 'premier league', club: 'arsenal', retired: false },
  { name: 'Virgil van Dijk', continent: 'europe', nationality: 'netherlands', position: 'defender', league: 'premier league', club: 'liverpool', retired: false, awards: ['champions league'] },
  { name: 'Rúben Dias', continent: 'europe', nationality: 'portugal', position: 'defender', league: 'premier league', club: 'manchester city', retired: false, awards: ['champions league'] },
  { name: 'Alisson Becker', continent: 'south america', nationality: 'brazil', position: 'goalkeeper', league: 'premier league', club: 'liverpool', retired: false, awards: ['champions league'] },
  { name: 'Thibaut Courtois', continent: 'europe', nationality: 'belgium', position: 'goalkeeper', league: 'la liga', club: 'real madrid', retired: false, awards: ['champions league'] },
  { name: 'Marc-André ter Stegen', continent: 'europe', nationality: 'germany', position: 'goalkeeper', league: 'la liga', club: 'barcelona', retired: false },
  { name: 'Manuel Neuer', continent: 'europe', nationality: 'germany', position: 'goalkeeper', league: 'bundesliga', club: 'bayern munich', retired: false, awards: ['champions league'] },
  { name: 'Jamal Musiala', continent: 'europe', nationality: 'germany', position: 'midfielder', league: 'bundesliga', club: 'bayern munich', retired: false },
  { name: 'Antoine Griezmann', continent: 'europe', nationality: 'france', position: 'forward', league: 'la liga', club: 'atletico madrid', retired: false, awards: ['world cup'] },
  { name: 'Pedri', continent: 'europe', nationality: 'spain', position: 'midfielder', league: 'la liga', club: 'barcelona', retired: false },
  { name: 'Gavi', continent: 'europe', nationality: 'spain', position: 'midfielder', league: 'la liga', club: 'barcelona', retired: false },
  { name: 'Lamine Yamal', continent: 'europe', nationality: 'spain', position: 'forward', league: 'la liga', club: 'barcelona', retired: false },
  { name: 'Rafael Leão', continent: 'europe', nationality: 'portugal', position: 'forward', league: 'serie a', club: 'ac milan', retired: false },
  { name: 'Lautaro Martínez', continent: 'south america', nationality: 'argentina', position: 'forward', league: 'serie a', club: 'inter milan', retired: false, awards: ['world cup'] },
  { name: 'Victor Osimhen', continent: 'africa', nationality: 'nigeria', position: 'forward', league: 'serie a', club: 'napoli', retired: false },
  { name: 'Khvicha Kvaratskhelia', continent: 'europe', nationality: 'georgia', position: 'forward', league: 'serie a', club: 'napoli', retired: false },
  { name: 'Federico Valverde', continent: 'south america', nationality: 'uruguay', position: 'midfielder', league: 'la liga', club: 'real madrid', retired: false, awards: ['world cup'] },
  { name: 'Aurélien Tchouaméni', continent: 'europe', nationality: 'france', position: 'midfielder', league: 'la liga', club: 'real madrid', retired: false },
  { name: 'Alejandro Garnacho', continent: 'south america', nationality: 'argentina', position: 'forward', league: 'premier league', club: 'manchester united', retired: false },
  { name: 'Bruno Fernandes', continent: 'europe', nationality: 'portugal', position: 'midfielder', league: 'premier league', club: 'manchester united', retired: false },
  { name: 'Marcus Rashford', continent: 'europe', nationality: 'england', position: 'forward', league: 'premier league', club: 'manchester united', retired: false },
  { name: 'Son Heung-min', continent: 'asia', nationality: 'korea', position: 'forward', league: 'premier league', club: 'tottenham', retired: false },
  { name: 'Declan Rice', continent: 'europe', nationality: 'england', position: 'midfielder', league: 'premier league', club: 'arsenal', retired: false },
  { name: 'William Saliba', continent: 'europe', nationality: 'france', position: 'defender', league: 'premier league', club: 'arsenal', retired: false },
  { name: 'Trent Alexander-Arnold', continent: 'europe', nationality: 'england', position: 'defender', league: 'premier league', club: 'liverpool', retired: false, awards: ['champions league'] },
  { name: 'Andrew Robertson', continent: 'europe', nationality: 'scotland', position: 'defender', league: 'premier league', club: 'liverpool', retired: false, awards: ['champions league'] },
  { name: 'Antonio Rüdiger', continent: 'europe', nationality: 'germany', position: 'defender', league: 'la liga', club: 'real madrid', retired: false, awards: ['champions league'] },
  { name: 'Ronald Araújo', continent: 'south america', nationality: 'uruguay', position: 'defender', league: 'la liga', club: 'barcelona', retired: false },
  { name: 'Jan Oblak', continent: 'europe', nationality: 'slovenia', position: 'goalkeeper', league: 'la liga', club: 'atletico madrid', retired: false },
  { name: 'Gianluigi Donnarumma', continent: 'europe', nationality: 'italy', position: 'goalkeeper', league: 'ligue 1', club: 'psg', retired: false },
  { name: 'Ousmane Dembélé', continent: 'europe', nationality: 'france', position: 'forward', league: 'ligue 1', club: 'psg', retired: false, awards: ['world cup'] },
  { name: 'Achraf Hakimi', continent: 'africa', nationality: 'morocco', position: 'defender', league: 'ligue 1', club: 'psg', retired: false },
  { name: 'Marquinhos', continent: 'south america', nationality: 'brazil', position: 'defender', league: 'ligue 1', club: 'psg', retired: false, awards: ['champions league'] },
];

function buildAttributes() {
  const attrs = [];
  for (const item of ATTRIBUTE_SETS.continent) {
    attrs.push({
      attribute_key: 'continent',
      attribute_value: item.value,
      label_ar: item.label_ar,
      category: 'Geography',
      attribute_group: 'continent',
      is_exclusive: true,
      normalized_key: 'continent',
      normalized_value: normalizeSimpleText(item.value),
    });
  }
  for (const item of ATTRIBUTE_SETS.position) {
    attrs.push({
      attribute_key: 'position',
      attribute_value: item.value,
      label_ar: item.label_ar,
      category: 'Position',
      attribute_group: 'position',
      is_exclusive: true,
      normalized_key: 'position',
      normalized_value: normalizeSimpleText(item.value),
    });
  }
  for (const item of ATTRIBUTE_SETS.league) {
    attrs.push({
      attribute_key: 'league',
      attribute_value: item.value,
      label_ar: item.label_ar,
      category: 'Competition',
      attribute_group: 'league',
      is_exclusive: true,
      normalized_key: 'league',
      normalized_value: normalizeSimpleText(item.value),
    });
  }
  attrs.push({
    attribute_key: 'retired',
    attribute_value: 'retired',
    label_ar: ATTRIBUTE_SETS.retired[0].label_ar,
    category: 'Career',
    attribute_group: 'retired',
    is_exclusive: true,
    normalized_key: 'retired',
    normalized_value: 'retired',
  });

  for (const n of NATIONALITIES) {
    attrs.push({
      attribute_key: 'nationality',
      attribute_value: n.value,
      label_ar: n.label_ar,
      category: 'Identity',
      attribute_group: 'nationality',
      is_exclusive: true,
      normalized_key: 'nationality',
      normalized_value: normalizeSimpleText(n.value),
    });
  }

  for (const c of CLUBS) {
    attrs.push({
      attribute_key: 'club',
      attribute_value: c.value,
      label_ar: c.label_ar,
      category: 'Club',
      attribute_group: 'club',
      is_exclusive: true,
      normalized_key: 'club',
      normalized_value: normalizeSimpleText(c.value),
    });
  }

  for (const a of AWARDS) {
    attrs.push({
      attribute_key: 'award',
      attribute_value: a.value,
      label_ar: a.label_ar,
      category: 'Achievements',
      attribute_group: 'award',
      is_exclusive: false,
      normalized_key: 'award',
      normalized_value: normalizeSimpleText(a.value),
    });
  }

  return attrs;
}

function buildQuestionsForAttribute(key, value, labelAr) {
  if (key === 'continent') {
    return ATTRIBUTE_SETS.continent.find((x) => x.value === value)?.question_ar ?? `هل هو من ${labelAr}؟`;
  }
  if (key === 'position') {
    return ATTRIBUTE_SETS.position.find((x) => x.value === value)?.question_ar ?? `هل يلعب كـ ${labelAr}؟`;
  }
  if (key === 'league') {
    return ATTRIBUTE_SETS.league.find((x) => x.value === value)?.question_ar ?? `هل يلعب في ${labelAr}؟`;
  }
  if (key === 'retired') {
    return ATTRIBUTE_SETS.retired[0].question_ar;
  }
  if (key === 'nationality') {
    return `هل هو ${labelAr}؟`;
  }
  if (key === 'club') {
    return `هل يلعب في نادي ${labelAr}؟`;
  }
  if (key === 'award') {
    return AWARDS.find((x) => x.value === value)?.question_ar ?? `هل فاز بـ ${labelAr}؟`;
  }
  return labelAr;
}

async function main() {
  const supabase = buildSupabase();
  console.log('Seeding players/attributes/questions/player_matrix...');

  const playersPayload = PLAYERS.map((p) => ({
    name: p.name,
    normalized_name: normalizeSimpleText(p.name),
    prior_weight: 1,
  }));

  const { data: players, error: playersError } = await supabase
    .from('players')
    .upsert(playersPayload, { onConflict: 'normalized_name' })
    .select('id,normalized_name,name');
  if (playersError) throw playersError;
  const playersByNorm = new Map(players.map((p) => [p.normalized_name, p]));

  const attrsPayload = buildAttributes();
  const { data: attrs, error: attrsError } = await supabase
    .from('attributes')
    .upsert(attrsPayload, { onConflict: 'normalized_key,normalized_value' })
    .select('id,normalized_key,normalized_value,label_ar,attribute_key,attribute_value');
  if (attrsError) throw attrsError;
  const attrByKeyValue = new Map(
    attrs.map((a) => [`${a.normalized_key}:${a.normalized_value}`, a]),
  );

  const questionsPayload = attrs.map((a) => ({
    attribute_id: a.id,
    question_text: buildQuestionsForAttribute(a.attribute_key, a.attribute_value, a.label_ar),
    normalized_text: normalizeSimpleText(buildQuestionsForAttribute(a.attribute_key, a.attribute_value, a.label_ar)),
    manual_weight: 0,
  }));
  const { error: qError } = await supabase
    .from('questions')
    .upsert(questionsPayload, { onConflict: 'attribute_id,normalized_text' });
  if (qError) throw qError;

  const playerMatrixPayload = [];
  const continents = ATTRIBUTE_SETS.continent.map((x) => x.value);
  const positions = ATTRIBUTE_SETS.position.map((x) => x.value);
  const leagues = ATTRIBUTE_SETS.league.map((x) => x.value);
  const nationalities = NATIONALITIES.map((x) => x.value);
  const clubs = CLUBS.map((x) => x.value);

  for (const p of PLAYERS) {
    const playerRow = playersByNorm.get(normalizeSimpleText(p.name));
    if (!playerRow?.id) continue;

    for (const v of continents) {
      const a = attrByKeyValue.get(`continent:${normalizeSimpleText(v)}`);
      if (!a?.id) continue;
      playerMatrixPayload.push({
        player_id: playerRow.id,
        attribute_id: a.id,
        value: p.continent === v,
        confidence_score: 1,
        source: 'seed',
      });
    }

    for (const v of positions) {
      const a = attrByKeyValue.get(`position:${normalizeSimpleText(v)}`);
      if (!a?.id) continue;
      playerMatrixPayload.push({
        player_id: playerRow.id,
        attribute_id: a.id,
        value: p.position === v,
        confidence_score: 1,
        source: 'seed',
      });
    }

    for (const v of leagues) {
      const a = attrByKeyValue.get(`league:${normalizeSimpleText(v)}`);
      if (!a?.id) continue;
      playerMatrixPayload.push({
        player_id: playerRow.id,
        attribute_id: a.id,
        value: p.league === v,
        confidence_score: 1,
        source: 'seed',
      });
    }

    for (const v of nationalities) {
      const a = attrByKeyValue.get(`nationality:${normalizeSimpleText(v)}`);
      if (!a?.id) continue;
      playerMatrixPayload.push({
        player_id: playerRow.id,
        attribute_id: a.id,
        value: p.nationality === v,
        confidence_score: 1,
        source: 'seed',
      });
    }

    for (const v of clubs) {
      const a = attrByKeyValue.get(`club:${normalizeSimpleText(v)}`);
      if (!a?.id) continue;
      playerMatrixPayload.push({
        player_id: playerRow.id,
        attribute_id: a.id,
        value: p.club === v,
        confidence_score: 0.9,
        source: 'seed',
      });
    }

    const retiredAttr = attrByKeyValue.get('retired:retired');
    if (retiredAttr?.id) {
      playerMatrixPayload.push({
        player_id: playerRow.id,
        attribute_id: retiredAttr.id,
        value: Boolean(p.retired),
        confidence_score: 0.95,
        source: 'seed',
      });
    }

    const awards = Array.isArray(p.awards) ? p.awards : [];
    for (const aKey of awards) {
      const a = attrByKeyValue.get(`award:${normalizeSimpleText(aKey)}`);
      if (!a?.id) continue;
      playerMatrixPayload.push({
        player_id: playerRow.id,
        attribute_id: a.id,
        value: true,
        confidence_score: 0.8,
        source: 'seed',
      });
    }
  }

  const { error: paError } = await supabase
    .from('player_matrix')
    .upsert(playerMatrixPayload, { onConflict: 'player_id,attribute_id' });
  if (paError) throw paError;

  const { error: refreshError } = await supabase.rpc('refresh_player_matrix_mvs');
  if (refreshError) {
    console.warn('Materialized view refresh failed:', refreshError.message ?? refreshError);
  }

  console.log(`Done.`);
  console.log(`Players: ${playersPayload.length}`);
  console.log(`Attributes: ${attrsPayload.length}`);
  console.log(`Questions: ${questionsPayload.length}`);
  console.log(`Player Matrix (upserted): ${playerMatrixPayload.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

