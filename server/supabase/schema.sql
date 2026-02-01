create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists vector;

create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  normalized_name text,
  image_url text,
  prior_weight numeric not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint candidates_prior_weight_positive check (prior_weight > 0)
);

alter table public.candidates
add column if not exists normalized_name text;

update public.candidates
set normalized_name = lower(regexp_replace(name, '\s+', ' ', 'g'))
where normalized_name is null or normalized_name = '';

create unique index if not exists candidates_normalized_unique
on public.candidates(normalized_name);

alter table public.candidates
alter column normalized_name set not null;

create index if not exists candidates_normalized_trgm
on public.candidates using gin (normalized_name gin_trgm_ops);

create table if not exists public.features (
  id uuid primary key default gen_random_uuid(),
  feature_key text not null,
  feature_value text not null,
  normalized_key text not null,
  normalized_value text not null,
  created_at timestamptz not null default now(),
  constraint features_normalized_unique unique(normalized_key, normalized_value)
);

create index if not exists features_normalized_lookup
on public.features(normalized_key, normalized_value);

create table if not exists public.questions_metadata (
  id uuid primary key default gen_random_uuid(),
  feature_id uuid not null references public.features(id) on delete cascade,
  question_text text not null,
  normalized_text text,
  embedding vector(1536),
  manual_weight numeric not null default 0,
  seen_count integer not null default 0,
  success_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint questions_metadata_feature_norm_unique unique(feature_id, normalized_text)
);

alter table public.questions_metadata
add column if not exists normalized_text text;

update public.questions_metadata
set normalized_text = lower(regexp_replace(question_text, '\s+', ' ', 'g'))
where normalized_text is null or normalized_text = '';

alter table public.questions_metadata
alter column normalized_text set not null;

create index if not exists questions_metadata_normalized_trgm
on public.questions_metadata using gin (normalized_text gin_trgm_ops);

create index if not exists questions_metadata_feature_lookup
on public.questions_metadata(feature_id, manual_weight desc, success_count desc, seen_count desc, updated_at desc);

create index if not exists questions_metadata_embedding_ivfflat
on public.questions_metadata using ivfflat (embedding vector_cosine_ops)
with (lists = 100)
where embedding is not null;

create table if not exists public.player_features (
  player_id uuid not null references public.candidates(id) on delete cascade,
  feature_id uuid not null references public.features(id) on delete cascade,
  source text,
  confidence numeric,
  created_at timestamptz not null default now(),
  primary key (player_id, feature_id)
);

create index if not exists player_features_feature_id
on public.player_features(feature_id, player_id);

create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  history jsonb not null default '[]'::jsonb,
  status text not null default 'in_progress' check (status in ('in_progress','won','lost','abandoned')),
  guessed_candidate_id uuid references public.candidates(id) on delete set null,
  guessed_name text,
  correct boolean,
  question_count integer,
  duration_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_moves (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  move_index integer not null,
  question_id uuid references public.questions_metadata(id) on delete set null,
  feature_id uuid references public.features(id) on delete set null,
  answer boolean,
  candidate_count_before integer,
  candidate_count_after integer,
  info_gain numeric,
  created_at timestamptz not null default now(),
  constraint game_moves_session_move_unique unique(session_id, move_index)
);

create index if not exists game_moves_session_lookup
on public.game_moves(session_id, move_index);

create or replace view public.view_game_stats as
with
  avg_q as (
    select coalesce(avg(question_count), 0) as avg_questions
    from public.game_sessions
    where status in ('won','lost') and question_count is not null
  ),
  top_questions as (
    select
      gm.question_id,
      qm.question_text,
      count(*) as times_asked,
      avg(coalesce(gm.info_gain, 0)) as avg_info_gain
    from public.game_moves gm
    join public.questions_metadata qm on qm.id = gm.question_id
    group by gm.question_id, qm.question_text
    order by avg(coalesce(gm.info_gain, 0)) desc, count(*) desc
    limit 25
  ),
  top_guesses as (
    select
      gs.guessed_candidate_id,
      coalesce(c.name, gs.guessed_name) as name,
      count(*) as guess_count,
      count(*) filter (where gs.correct = true) as correct_count
    from public.game_sessions gs
    left join public.candidates c on c.id = gs.guessed_candidate_id
    where gs.status in ('won','lost')
    group by gs.guessed_candidate_id, coalesce(c.name, gs.guessed_name)
    order by count(*) desc
    limit 25
  )
select
  (select avg_questions from avg_q) as average_questions_needed,
  (select coalesce(jsonb_agg(jsonb_build_object(
    'question_id', question_id,
    'question_text', question_text,
    'times_asked', times_asked,
    'avg_info_gain', avg_info_gain
  )), '[]'::jsonb) from top_questions) as most_determining_questions,
  (select coalesce(jsonb_agg(jsonb_build_object(
    'candidate_id', guessed_candidate_id,
    'name', name,
    'guess_count', guess_count,
    'correct_count', correct_count
  )), '[]'::jsonb) from top_guesses) as commonly_guessed_players;

create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_candidates_touch on public.candidates;
create trigger trg_candidates_touch
before update on public.candidates
for each row execute function public.touch_updated_at();

drop trigger if exists trg_questions_metadata_touch on public.questions_metadata;
create trigger trg_questions_metadata_touch
before update on public.questions_metadata
for each row execute function public.touch_updated_at();

drop trigger if exists trg_game_sessions_touch on public.game_sessions;
create trigger trg_game_sessions_touch
before update on public.game_sessions
for each row execute function public.touch_updated_at();

create or replace function public.match_candidate(query_text text, similarity_threshold real)
returns table (
  id uuid,
  name text,
  normalized_name text,
  image_url text,
  score real
)
language sql
stable
as $$
  select
    c.id,
    c.name,
    c.normalized_name,
    c.image_url,
    similarity(c.normalized_name, query_text) as score
  from public.candidates c
  where similarity(c.normalized_name, query_text) >= similarity_threshold
  order by score desc
  limit 1;
$$;

create or replace function public.match_question_metadata(query_text text, similarity_threshold real)
returns table (
  id uuid,
  feature_id uuid,
  question_text text,
  normalized_text text,
  score real
)
language sql
stable
as $$
  select
    q.id,
    q.feature_id,
    q.question_text,
    q.normalized_text,
    similarity(q.normalized_text, query_text) as score
  from public.questions_metadata q
  where similarity(q.normalized_text, query_text) >= similarity_threshold
  order by score desc
  limit 1;
$$;

create or replace function public.entropy_from_sums(sum_w numeric, sum_w_ln_w numeric)
returns numeric
language sql
stable
as $$
  select case when sum_w is null or sum_w <= 0 then 0 else ln(sum_w) - (sum_w_ln_w / sum_w) end;
$$;

create or replace function public.get_next_best_move(current_history jsonb, rejected_guess_names text[] default '{}'::text[])
returns jsonb
language plpgsql
stable
as $$
declare
  asked_feature_ids uuid[];
  asked_feature_keys text[];
  asked_question_norms text[];
  n integer;
  total_w numeric;
  total_w_ln_w numeric;
  top_candidate_id uuid;
  top_candidate_name text;
  top_candidate_w numeric;
  top_prob numeric;
  entropy_before numeric;
  best_feature_id uuid;
  best_question_id uuid;
  best_question_text text;
  best_info_gain numeric;
  best_score numeric;
begin
  with
    h_raw as (
      select
        nullif(x->>'feature_id', '')::uuid as feature_id,
        nullif(x->>'normalized_question', '') as normalized_question,
        case
          when (x ? 'answer_bool') then (x->>'answer_bool')::boolean
          when (x ? 'answer') and trim(x->>'answer') in ('yes','no') then (trim(x->>'answer') = 'yes')
          when (x ? 'answer') and trim(x->>'answer') in ('نعم','لا') then (trim(x->>'answer') = 'نعم')
          else null
        end as answer_bool
      from jsonb_array_elements(coalesce(current_history, '[]'::jsonb)) as x
    ),
    h_resolved as (
      select
        coalesce(hr.feature_id, mq.feature_id) as feature_id,
        hr.answer_bool as answer_bool
      from h_raw hr
      left join lateral (
        select m.feature_id
        from public.match_question_metadata(hr.normalized_question, 0.88) m
        limit 1
      ) mq on hr.feature_id is null and hr.normalized_question is not null
    ),
    h_all as (
      select distinct feature_id
      from h_resolved
      where feature_id is not null
    ),
    h as (
      select distinct feature_id, answer_bool
      from h_resolved
      where feature_id is not null and answer_bool is not null
    ),
    h_yes as (
      select feature_id from h where answer_bool = true
    ),
    h_no as (
      select feature_id from h where answer_bool = false
    ),
    yes_counts as (
      select pf.player_id, count(*) as yes_hits
      from public.player_features pf
      join h_yes hy on hy.feature_id = pf.feature_id
      group by pf.player_id
    ),
    remaining as (
      select
        c.id,
        c.name,
        c.normalized_name,
        c.image_url,
        c.prior_weight as w,
        (c.prior_weight * ln(greatest(c.prior_weight, 1e-9))) as w_ln_w
      from public.candidates c
      left join public.player_features pf_no
        on pf_no.player_id = c.id
       and pf_no.feature_id in (select feature_id from h_no)
      left join yes_counts yc on yc.player_id = c.id
      where pf_no.player_id is null
        and coalesce(yc.yes_hits, 0) = (select count(*) from h_yes)
        and (rejected_guess_names is null or c.normalized_name <> all(rejected_guess_names))
    )
  select
    (select array_agg(feature_id) from h_all),
    (select array_agg(distinct f.normalized_key) from public.features f where f.id = any((select array_agg(feature_id) from h_all))),
    (select array_agg(distinct hr.normalized_question) from h_raw hr where hr.normalized_question is not null and hr.normalized_question <> ''),
    (select count(*) from remaining),
    (select coalesce(sum(w), 0) from remaining),
    (select coalesce(sum(w_ln_w), 0) from remaining),
    (select id from remaining order by w desc, name asc limit 1),
    (select name from remaining order by w desc, name asc limit 1),
    (select w from remaining order by w desc, name asc limit 1)
  into
    asked_feature_ids,
    asked_feature_keys,
    asked_question_norms,
    n,
    total_w,
    total_w_ln_w,
    top_candidate_id,
    top_candidate_name,
    top_candidate_w;

  if n is null or n = 0 then
    return jsonb_build_object(
      'type', 'gap',
      'reason', 'no_candidates'
    );
  end if;

  if total_w <= 0 then
    top_prob := 0;
  else
    top_prob := coalesce(top_candidate_w, 0) / total_w;
  end if;

  entropy_before := public.entropy_from_sums(total_w, total_w_ln_w);

  if n <= 3 or top_prob >= 0.85 then
    return jsonb_build_object(
      'type', 'guess',
      'candidate_id', top_candidate_id,
      'content', top_candidate_name,
      'confidence', top_prob,
      'meta', jsonb_build_object(
        'remaining', n,
        'entropy', entropy_before
      )
    );
  end if;

  with
    h_raw as (
      select
        nullif(x->>'feature_id', '')::uuid as feature_id,
        nullif(x->>'normalized_question', '') as normalized_question,
        case
          when (x ? 'answer_bool') then (x->>'answer_bool')::boolean
          when (x ? 'answer') and trim(x->>'answer') in ('yes','no') then (trim(x->>'answer') = 'yes')
          when (x ? 'answer') and trim(x->>'answer') in ('نعم','لا') then (trim(x->>'answer') = 'نعم')
          else null
        end as answer_bool
      from jsonb_array_elements(coalesce(current_history, '[]'::jsonb)) as x
    ),
    h_resolved as (
      select
        coalesce(hr.feature_id, mq.feature_id) as feature_id,
        hr.answer_bool as answer_bool
      from h_raw hr
      left join lateral (
        select m.feature_id
        from public.match_question_metadata(hr.normalized_question, 0.88) m
        limit 1
      ) mq on hr.feature_id is null and hr.normalized_question is not null
      where hr.answer_bool is not null
    ),
    h as (
      select distinct feature_id, answer_bool
      from h_resolved
      where feature_id is not null
    ),
    h_yes as (
      select feature_id from h where answer_bool = true
    ),
    h_no as (
      select feature_id from h where answer_bool = false
    ),
    yes_counts as (
      select pf.player_id, count(*) as yes_hits
      from public.player_features pf
      join h_yes hy on hy.feature_id = pf.feature_id
      group by pf.player_id
    ),
    remaining as (
      select
        c.id,
        c.name,
        c.prior_weight as w,
        (c.prior_weight * ln(greatest(c.prior_weight, 1e-9))) as w_ln_w
      from public.candidates c
      left join public.player_features pf_no
        on pf_no.player_id = c.id
       and pf_no.feature_id in (select feature_id from h_no)
      left join yes_counts yc on yc.player_id = c.id
      where pf_no.player_id is null
        and coalesce(yc.yes_hits, 0) = (select count(*) from h_yes)
        and (rejected_guess_names is null or c.normalized_name <> all(rejected_guess_names))
    ),
    feature_stats as (
      select
        pf.feature_id,
        f.normalized_key,
        count(*) as yes_n,
        sum(r.w) as yes_w,
        sum(r.w_ln_w) as yes_w_ln_w
      from remaining r
      join public.player_features pf on pf.player_id = r.id
      join public.features f on f.id = pf.feature_id
      where asked_feature_ids is null or not (pf.feature_id = any(asked_feature_ids))
      group by pf.feature_id, f.normalized_key
    ),
    scored as (
      select
        fs.feature_id,
        fs.normalized_key,
        fs.yes_n,
        (n - fs.yes_n) as no_n,
        fs.yes_w,
        (total_w - fs.yes_w) as no_w,
        fs.yes_w_ln_w,
        (total_w_ln_w - fs.yes_w_ln_w) as no_w_ln_w,
        public.entropy_from_sums(total_w, total_w_ln_w) as entropy_before,
        (fs.yes_w / total_w) * public.entropy_from_sums(fs.yes_w, fs.yes_w_ln_w)
          + ((total_w - fs.yes_w) / total_w) * public.entropy_from_sums((total_w - fs.yes_w), (total_w_ln_w - fs.yes_w_ln_w)) as expected_entropy
      from feature_stats fs
      where fs.yes_n > 0 and fs.yes_n < n and fs.yes_w > 0 and fs.yes_w < total_w
        and (
          n < 20
          or (
            fs.yes_w >= (total_w * 0.08) and fs.yes_w <= (total_w * 0.92)
            and fs.yes_n >= greatest(2, floor(n * 0.08)::int)
            and fs.yes_n <= (n - greatest(2, floor(n * 0.08)::int))
          )
        )
    ),
    best as (
      select
        s.feature_id,
        (s.entropy_before - s.expected_entropy) as info_gain,
        qpick.id as question_id,
        qpick.question_text,
        qpick.manual_weight,
        (1 - (abs((s.yes_w) - (total_w - s.yes_w)) / total_w)) as balance,
        case
          when s.normalized_key = 'league' and asked_feature_keys is not null and ('league' = any(asked_feature_keys)) then 0.12
          when asked_feature_keys is not null and (s.normalized_key = any(asked_feature_keys)) then 0.5
          else 1
        end as key_penalty,
        (s.entropy_before - s.expected_entropy)
          * (1 - (abs((s.yes_w) - (total_w - s.yes_w)) / total_w))
          * (case
              when s.normalized_key = 'league' and asked_feature_keys is not null and ('league' = any(asked_feature_keys)) then 0.12
              when asked_feature_keys is not null and (s.normalized_key = any(asked_feature_keys)) then 0.5
              else 1
            end)
          * (1 + greatest(-0.95, qpick.manual_weight)) as score
      from scored s
      join lateral (
        select q.id, q.question_text, q.manual_weight
        from public.questions_metadata q
        where q.feature_id = s.feature_id
          and (
            asked_question_norms is null
            or not exists (
              select 1
              from unnest(asked_question_norms) aq
              where aq is not null and similarity(q.normalized_text, aq) >= 0.88
            )
          )
        order by q.manual_weight desc, q.success_count desc, q.seen_count desc, q.updated_at desc
        limit 1
      ) qpick on true
      order by score desc, info_gain desc
      limit 1
    )
  select
    b.feature_id,
    b.question_id,
    b.question_text,
    b.info_gain,
    b.score
  into
    best_feature_id,
    best_question_id,
    best_question_text,
    best_info_gain,
    best_score
  from best b;

  if best_feature_id is null or best_question_id is null or best_question_text is null or best_info_gain is null or best_info_gain <= 0.0005 or best_score is null or best_score <= 0.003 then
    return jsonb_build_object(
      'type', 'gap',
      'reason', 'no_good_question',
      'meta', jsonb_build_object(
        'remaining', n,
        'entropy', entropy_before,
        'top_candidate', jsonb_build_object(
          'candidate_id', top_candidate_id,
          'name', top_candidate_name,
          'confidence', top_prob
        )
      ),
      'candidates_sample', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'candidate_id', r.id,
          'name', r.name,
          'p', (r.w / total_w)
        )), '[]'::jsonb)
        from (
          with
            h_raw as (
              select
                nullif(x->>'feature_id', '')::uuid as feature_id,
                nullif(x->>'normalized_question', '') as normalized_question,
                case
                  when (x ? 'answer_bool') then (x->>'answer_bool')::boolean
                  when (x ? 'answer') and trim(x->>'answer') in ('yes','no') then (trim(x->>'answer') = 'yes')
                  when (x ? 'answer') and trim(x->>'answer') in ('نعم','لا') then (trim(x->>'answer') = 'نعم')
                  else null
                end as answer_bool
              from jsonb_array_elements(coalesce(current_history, '[]'::jsonb)) as x
            ),
            h_resolved as (
              select
                coalesce(hr.feature_id, mq.feature_id) as feature_id,
                hr.answer_bool as answer_bool
              from h_raw hr
              left join lateral (
                select m.feature_id
                from public.match_question_metadata(hr.normalized_question, 0.88) m
                limit 1
              ) mq on hr.feature_id is null and hr.normalized_question is not null
              where hr.answer_bool is not null
            ),
            h as (
              select distinct feature_id, answer_bool
              from h_resolved
              where feature_id is not null
            ),
            h_yes as (
              select feature_id from h where answer_bool = true
            ),
            h_no as (
              select feature_id from h where answer_bool = false
            ),
            yes_counts as (
              select pf.player_id, count(*) as yes_hits
              from public.player_features pf
              join h_yes hy on hy.feature_id = pf.feature_id
              group by pf.player_id
            )
          select
            c.id,
            c.name,
            c.prior_weight as w
          from public.candidates c
          left join public.player_features pf_no
            on pf_no.player_id = c.id
           and pf_no.feature_id in (select feature_id from h_no)
          left join yes_counts yc on yc.player_id = c.id
          where pf_no.player_id is null
            and coalesce(yc.yes_hits, 0) = (select count(*) from h_yes)
            and (rejected_guess_names is null or c.normalized_name <> all(rejected_guess_names))
          order by c.prior_weight desc, c.name asc
          limit 25
        ) r
      )
    );
  end if;

  return jsonb_build_object(
    'type', 'question',
    'question_id', best_question_id,
    'feature_id', best_feature_id,
    'content', best_question_text,
    'meta', jsonb_build_object(
      'remaining', n,
      'entropy', entropy_before,
      'top_candidate', jsonb_build_object(
        'candidate_id', top_candidate_id,
        'name', top_candidate_name,
        'confidence', top_prob
      ),
      'info_gain', best_info_gain,
      'score', best_score
    )
  );
end;
$$;

create or replace function public.bump_question_seen(p_question_id uuid)
returns void
language sql
volatile
as $$
  update public.questions_metadata
  set seen_count = seen_count + 1
  where id = p_question_id;
$$;

create or replace function public.bump_question_success(p_question_id uuid)
returns void
language sql
volatile
as $$
  update public.questions_metadata
  set success_count = success_count + 1
  where id = p_question_id;
$$;

insert into public.candidates (name, normalized_name, prior_weight)
values
  ('Lionel Messi', 'lionel messi', 1.6),
  ('Cristiano Ronaldo', 'cristiano ronaldo', 1.6),
  ('Mohamed Salah', 'mohamed salah', 1.4),
  ('Kylian Mbappé', 'kylian mbappe', 1.4),
  ('Erling Haaland', 'erling haaland', 1.35),
  ('Kevin De Bruyne', 'kevin de bruyne', 1.2),
  ('Neymar', 'neymar', 1.25),
  ('Karim Benzema', 'karim benzema', 1.2),
  ('Luka Modrić', 'luka modric', 1.15),
  ('Robert Lewandowski', 'robert lewandowski', 1.25)
on conflict do nothing;

insert into public.features (feature_key, feature_value, normalized_key, normalized_value)
values
  ('league', 'Premier League', 'league', 'premier league'),
  ('league', 'La Liga', 'league', 'la liga'),
  ('league', 'Ligue 1', 'league', 'ligue 1'),
  ('league', 'Bundesliga', 'league', 'bundesliga'),
  ('league', 'Saudi Pro League', 'league', 'saudi pro league'),
  ('nationality', 'Argentina', 'nationality', 'argentina'),
  ('nationality', 'Portugal', 'nationality', 'portugal'),
  ('nationality', 'Egypt', 'nationality', 'egypt'),
  ('nationality', 'France', 'nationality', 'france'),
  ('nationality', 'Norway', 'nationality', 'norway'),
  ('position', 'Forward', 'position', 'forward'),
  ('position', 'Midfielder', 'position', 'midfielder')
on conflict do nothing;

insert into public.questions_metadata (feature_id, question_text, normalized_text, manual_weight)
select f.id, q.question_text, q.normalized_text, q.manual_weight
from (
  values
    ('league', 'Premier League', 'هل يلعب في الدوري الإنجليزي؟', 'هل يلعب في الدوري الانجليزي', 0),
    ('league', 'La Liga', 'هل يلعب في الدوري الإسباني؟', 'هل يلعب في الدوري الاسباني', 0),
    ('league', 'Ligue 1', 'هل يلعب في الدوري الفرنسي؟', 'هل يلعب في الدوري الفرنسي', 0),
    ('league', 'Bundesliga', 'هل يلعب في الدوري الألماني؟', 'هل يلعب في الدوري الالماني', 0),
    ('league', 'Saudi Pro League', 'هل يلعب في الدوري السعودي؟', 'هل يلعب في الدوري السعودي', 0),
    ('nationality', 'Argentina', 'هل هو أرجنتيني؟', 'هل هو ارجنتيني', 0),
    ('nationality', 'Portugal', 'هل هو برتغالي؟', 'هل هو برتغالي', 0),
    ('nationality', 'Egypt', 'هل هو مصري؟', 'هل هو مصري', 0),
    ('nationality', 'France', 'هل هو فرنسي؟', 'هل هو فرنسي', 0),
    ('nationality', 'Norway', 'هل هو نرويجي؟', 'هل هو نرويجي', 0),
    ('position', 'Forward', 'هل يلعب كمهاجم؟', 'هل يلعب كمهاجم', 0),
    ('position', 'Midfielder', 'هل يلعب كلاعب وسط؟', 'هل يلعب كلاعب وسط', 0)
) as q(feature_key, feature_value, question_text, normalized_text, manual_weight)
join public.features f
  on f.normalized_key = q.feature_key and f.normalized_value = q.feature_value
on conflict do nothing;

insert into public.player_features (player_id, feature_id, source, confidence)
select c.id, f.id, 'seed', 1
from public.candidates c
join public.features f on (
  (c.normalized_name = 'lionel messi' and f.normalized_key = 'league' and f.normalized_value = 'la liga') or
  (c.normalized_name = 'lionel messi' and f.normalized_key = 'nationality' and f.normalized_value = 'argentina') or
  (c.normalized_name = 'lionel messi' and f.normalized_key = 'position' and f.normalized_value = 'forward') or
  (c.normalized_name = 'cristiano ronaldo' and f.normalized_key = 'league' and f.normalized_value = 'saudi pro league') or
  (c.normalized_name = 'cristiano ronaldo' and f.normalized_key = 'nationality' and f.normalized_value = 'portugal') or
  (c.normalized_name = 'cristiano ronaldo' and f.normalized_key = 'position' and f.normalized_value = 'forward') or
  (c.normalized_name = 'mohamed salah' and f.normalized_key = 'league' and f.normalized_value = 'premier league') or
  (c.normalized_name = 'mohamed salah' and f.normalized_key = 'nationality' and f.normalized_value = 'egypt') or
  (c.normalized_name = 'mohamed salah' and f.normalized_key = 'position' and f.normalized_value = 'forward') or
  (c.normalized_name = 'kylian mbappe' and f.normalized_key = 'league' and f.normalized_value = 'ligue 1') or
  (c.normalized_name = 'kylian mbappe' and f.normalized_key = 'nationality' and f.normalized_value = 'france') or
  (c.normalized_name = 'kylian mbappe' and f.normalized_key = 'position' and f.normalized_value = 'forward') or
  (c.normalized_name = 'erling haaland' and f.normalized_key = 'league' and f.normalized_value = 'premier league') or
  (c.normalized_name = 'erling haaland' and f.normalized_key = 'nationality' and f.normalized_value = 'norway') or
  (c.normalized_name = 'erling haaland' and f.normalized_key = 'position' and f.normalized_value = 'forward') or
  (c.normalized_name = 'kevin de bruyne' and f.normalized_key = 'league' and f.normalized_value = 'premier league') or
  (c.normalized_name = 'kevin de bruyne' and f.normalized_key = 'position' and f.normalized_value = 'midfielder') or
  (c.normalized_name = 'neymar' and f.normalized_key = 'position' and f.normalized_value = 'forward') or
  (c.normalized_name = 'karim benzema' and f.normalized_key = 'position' and f.normalized_value = 'forward') or
  (c.normalized_name = 'luka modric' and f.normalized_key = 'position' and f.normalized_value = 'midfielder') or
  (c.normalized_name = 'robert lewandowski' and f.normalized_key = 'position' and f.normalized_value = 'forward')
)
on conflict do nothing;
