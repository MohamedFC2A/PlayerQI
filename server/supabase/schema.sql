create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists vector;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'answer_kind'
  ) then
    create type public.answer_kind as enum ('yes','no','unknown','maybe');
  end if;
end $$;

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
  answer public.answer_kind not null default 'yes',
  source text,
  confidence numeric,
  created_at timestamptz not null default now(),
  primary key (player_id, feature_id)
);

alter table public.player_features
add column if not exists answer public.answer_kind;

alter table public.player_features
alter column answer set default 'yes'::public.answer_kind;

update public.player_features
set answer = 'yes'::public.answer_kind
where answer is null;

alter table public.player_features
alter column answer set not null;

create index if not exists player_features_feature_id
on public.player_features(feature_id, player_id);

create index if not exists player_features_feature_answer
on public.player_features(feature_id, answer, player_id);

create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  history jsonb not null default '[]'::jsonb,
  rejected_guess_names text[] not null default '{}'::text[],
  status text not null default 'in_progress' check (status in ('in_progress','won','lost','abandoned')),
  guessed_candidate_id uuid references public.candidates(id) on delete set null,
  guessed_name text,
  correct boolean,
  question_count integer,
  duration_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.game_sessions
add column if not exists rejected_guess_names text[];

alter table public.game_sessions
alter column rejected_guess_names set default '{}'::text[];

update public.game_sessions
set rejected_guess_names = '{}'::text[]
where rejected_guess_names is null;

alter table public.game_sessions
alter column rejected_guess_names set not null;

create table if not exists public.game_moves (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  move_index integer not null,
  question_id uuid references public.questions_metadata(id) on delete set null,
  feature_id uuid references public.features(id) on delete set null,
  answer boolean,
  answer_kind public.answer_kind,
  candidate_count_before integer,
  candidate_count_after integer,
  info_gain numeric,
  created_at timestamptz not null default now(),
  constraint game_moves_session_move_unique unique(session_id, move_index)
);

alter table public.game_moves
add column if not exists answer_kind public.answer_kind;

update public.game_moves
set answer_kind = case
  when answer is true then 'yes'::public.answer_kind
  when answer is false then 'no'::public.answer_kind
  else null
end
where answer_kind is null and answer is not null;

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
  total_w double precision;
  total_w_ln_w double precision;
  top_candidate_id uuid;
  top_candidate_name text;
  top_candidate_w double precision;
  top_prob double precision;
  entropy_before double precision;
  best_feature_id uuid;
  best_question_id uuid;
  best_question_text text;
  best_info_gain double precision;
  best_score double precision;
  best_missing_n integer;
  best_missing_players jsonb;
begin
  with
    h_raw as (
      select
        nullif(x->>'feature_id', '')::uuid as feature_id,
        nullif(x->>'normalized_question', '') as normalized_question,
        case
          when x ? 'answer_kind' then lower(trim(x->>'answer_kind'))
          when x ? 'answer' then lower(trim(x->>'answer'))
          else null
        end as answer_text
      from jsonb_array_elements(coalesce(current_history, '[]'::jsonb)) as x
    ),
    h_kind as (
      select
        hr.feature_id,
        hr.normalized_question,
        case
          when hr.answer_text in ('yes','y','true','نعم') then 'yes'::public.answer_kind
          when hr.answer_text in ('no','n','false','لا') then 'no'::public.answer_kind
          when hr.answer_text in ('maybe','ربما','جزئيا','جزئياً') then 'maybe'::public.answer_kind
          when hr.answer_text in ('unknown','idk','لا اعرف','لا أعرف') then 'unknown'::public.answer_kind
          else null
        end as answer_kind
      from h_raw hr
    ),
    h_resolved as (
      select
        coalesce(hk.feature_id, mq.feature_id) as feature_id,
        hk.answer_kind as answer_kind,
        hk.normalized_question as normalized_question
      from h_kind hk
      left join lateral (
        select m.feature_id
        from public.match_question_metadata(hk.normalized_question, 0.88) m
        limit 1
      ) mq on hk.feature_id is null and hk.normalized_question is not null
      where coalesce(hk.feature_id, mq.feature_id) is not null and hk.answer_kind is not null
    ),
    h_all as (
      select distinct feature_id
      from h_resolved
    ),
    asked_keys as (
      select distinct f.normalized_key
      from public.features f
      where f.id = any((select array_agg(feature_id) from h_all))
    ),
    asked_q_norms as (
      select distinct normalized_question
      from h_resolved
      where normalized_question is not null and normalized_question <> ''
    ),
    h_for_weighting as (
      select distinct feature_id, answer_kind
      from h_resolved
      where answer_kind <> 'unknown'
    ),
    base as (
      select
        c.id,
        c.name,
        c.normalized_name,
        c.image_url,
        c.prior_weight::double precision as prior_w
      from public.candidates c
      where (rejected_guess_names is null or c.normalized_name <> all(rejected_guess_names))
    ),
    remaining as (
      select
        b.id,
        b.name,
        b.normalized_name,
        b.image_url,
        (b.prior_w * exp(coalesce(sum(ln(greatest(
          case h.answer_kind
            when 'yes' then case pf.answer when 'yes' then 1::double precision when 'no' then 1e-6::double precision else 0.5::double precision end
            when 'no' then case pf.answer when 'yes' then 1e-6::double precision when 'no' then 1::double precision else 0.5::double precision end
            when 'maybe' then case pf.answer when 'yes' then 0.8::double precision when 'no' then 0.2::double precision else 0.6::double precision end
            else 1::double precision
          end
        , 1e-9::double precision))), 0))) as w
      from base b
      left join h_for_weighting h on true
      left join public.player_features pf
        on pf.player_id = b.id and pf.feature_id = h.feature_id
      group by b.id, b.name, b.normalized_name, b.image_url, b.prior_w
    ),
    remaining2 as (
      select
        r.*,
        (r.w * ln(greatest(r.w, 1e-12))) as w_ln_w
      from remaining r
      where r.w > 0
    )
  select
    (select array_agg(feature_id) from h_all),
    (select array_agg(normalized_key) from asked_keys),
    (select array_agg(normalized_question) from asked_q_norms),
    (select count(*) from remaining2),
    (select coalesce(sum(w), 0) from remaining2),
    (select coalesce(sum(w_ln_w), 0) from remaining2),
    (select id from remaining2 order by w desc, name asc limit 1),
    (select name from remaining2 order by w desc, name asc limit 1),
    (select w from remaining2 order by w desc, name asc limit 1)
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
    return jsonb_build_object('type', 'gap', 'reason', 'no_candidates');
  end if;

  if total_w <= 0 then
    top_prob := 0;
  else
    top_prob := coalesce(top_candidate_w, 0) / total_w;
  end if;

  entropy_before := public.entropy_from_sums(total_w::numeric, total_w_ln_w::numeric);

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
          when x ? 'answer_kind' then lower(trim(x->>'answer_kind'))
          when x ? 'answer' then lower(trim(x->>'answer'))
          else null
        end as answer_text
      from jsonb_array_elements(coalesce(current_history, '[]'::jsonb)) as x
    ),
    h_kind as (
      select
        hr.feature_id,
        hr.normalized_question,
        case
          when hr.answer_text in ('yes','y','true','نعم') then 'yes'::public.answer_kind
          when hr.answer_text in ('no','n','false','لا') then 'no'::public.answer_kind
          when hr.answer_text in ('maybe','ربما','جزئيا','جزئياً') then 'maybe'::public.answer_kind
          when hr.answer_text in ('unknown','idk','لا اعرف','لا أعرف') then 'unknown'::public.answer_kind
          else null
        end as answer_kind
      from h_raw hr
    ),
    h_resolved as (
      select
        coalesce(hk.feature_id, mq.feature_id) as feature_id,
        hk.answer_kind as answer_kind,
        hk.normalized_question as normalized_question
      from h_kind hk
      left join lateral (
        select m.feature_id
        from public.match_question_metadata(hk.normalized_question, 0.88) m
        limit 1
      ) mq on hk.feature_id is null and hk.normalized_question is not null
      where coalesce(hk.feature_id, mq.feature_id) is not null and hk.answer_kind is not null
    ),
    h_for_weighting as (
      select distinct feature_id, answer_kind
      from h_resolved
      where answer_kind <> 'unknown'
    ),
    base as (
      select
        c.id,
        c.name,
        c.normalized_name,
        c.image_url,
        c.prior_weight::double precision as prior_w
      from public.candidates c
      where (rejected_guess_names is null or c.normalized_name <> all(rejected_guess_names))
    ),
    remaining as (
      select
        b.id,
        b.name,
        b.normalized_name,
        b.image_url,
        (b.prior_w * exp(coalesce(sum(ln(greatest(
          case h.answer_kind
            when 'yes' then case pf.answer when 'yes' then 1::double precision when 'no' then 1e-6::double precision else 0.5::double precision end
            when 'no' then case pf.answer when 'yes' then 1e-6::double precision when 'no' then 1::double precision else 0.5::double precision end
            when 'maybe' then case pf.answer when 'yes' then 0.8::double precision when 'no' then 0.2::double precision else 0.6::double precision end
            else 1::double precision
          end
        , 1e-9::double precision))), 0))) as w
      from base b
      left join h_for_weighting h on true
      left join public.player_features pf
        on pf.player_id = b.id and pf.feature_id = h.feature_id
      group by b.id, b.name, b.normalized_name, b.image_url, b.prior_w
    ),
    remaining2 as (
      select
        r.*,
        (r.w * ln(greatest(r.w, 1e-12))) as w_ln_w
      from remaining r
      where r.w > 0
    ),
    feature_stats as (
      select
        pf.feature_id,
        f.normalized_key,
        count(*) filter (where pf.answer = 'yes') as yes_n,
        coalesce(sum(r.w) filter (where pf.answer = 'yes'), 0) as yes_w_known,
        coalesce(sum(r.w_ln_w) filter (where pf.answer = 'yes'), 0) as yes_w_ln_w_known,
        count(*) filter (where pf.answer = 'no') as no_n,
        coalesce(sum(r.w) filter (where pf.answer = 'no'), 0) as no_w_known,
        coalesce(sum(r.w_ln_w) filter (where pf.answer = 'no'), 0) as no_w_ln_w_known
      from remaining2 r
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
        fs.no_n,
        (n - fs.yes_n - fs.no_n) as unknown_n,
        (fs.yes_w_known + ((total_w - fs.yes_w_known - fs.no_w_known) / 2)) as yes_w,
        (fs.no_w_known + ((total_w - fs.yes_w_known - fs.no_w_known) / 2)) as no_w,
        (fs.yes_w_ln_w_known
          + ((total_w_ln_w - fs.yes_w_ln_w_known - fs.no_w_ln_w_known) / 2)
          - ((ln(2)::double precision / 2) * (total_w - fs.yes_w_known - fs.no_w_known))
        ) as yes_w_ln_w,
        (fs.no_w_ln_w_known
          + ((total_w_ln_w - fs.yes_w_ln_w_known - fs.no_w_ln_w_known) / 2)
          - ((ln(2)::double precision / 2) * (total_w - fs.yes_w_known - fs.no_w_known))
        ) as no_w_ln_w,
        entropy_before as entropy_before,
        ((fs.yes_w_known + ((total_w - fs.yes_w_known - fs.no_w_known) / 2)) / total_w)
          * public.entropy_from_sums(
              (fs.yes_w_known + ((total_w - fs.yes_w_known - fs.no_w_known) / 2))::numeric,
              (fs.yes_w_ln_w_known
                + ((total_w_ln_w - fs.yes_w_ln_w_known - fs.no_w_ln_w_known) / 2)
                - ((ln(2)::double precision / 2) * (total_w - fs.yes_w_known - fs.no_w_known))
              )::numeric
            )
          + ((fs.no_w_known + ((total_w - fs.yes_w_known - fs.no_w_known) / 2)) / total_w)
          * public.entropy_from_sums(
              (fs.no_w_known + ((total_w - fs.yes_w_known - fs.no_w_known) / 2))::numeric,
              (fs.no_w_ln_w_known
                + ((total_w_ln_w - fs.yes_w_ln_w_known - fs.no_w_ln_w_known) / 2)
                - ((ln(2)::double precision / 2) * (total_w - fs.yes_w_known - fs.no_w_known))
              )::numeric
            ) as expected_entropy
      from feature_stats fs
      where total_w > 0
        and (fs.yes_w_known + ((total_w - fs.yes_w_known - fs.no_w_known) / 2)) > 0
        and (fs.no_w_known + ((total_w - fs.yes_w_known - fs.no_w_known) / 2)) > 0
        and (
          n < 20
          or (
            (fs.yes_w_known + ((total_w - fs.yes_w_known - fs.no_w_known) / 2)) >= (total_w * 0.08)
            and (fs.yes_w_known + ((total_w - fs.yes_w_known - fs.no_w_known) / 2)) <= (total_w * 0.92)
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
        (1 - (abs((s.yes_w) - (s.no_w)) / total_w)) as balance,
        (
          select count(*)
          from remaining2 r
          left join public.player_features pf_any
            on pf_any.player_id = r.id and pf_any.feature_id = s.feature_id
          where pf_any.player_id is null
        ) as missing_n,
        (
          select coalesce(jsonb_agg(jsonb_build_object('candidate_id', m.id, 'name', m.name)), '[]'::jsonb)
          from (
            select r.id, r.name
            from remaining2 r
            left join public.player_features pf_any
              on pf_any.player_id = r.id and pf_any.feature_id = s.feature_id
            where pf_any.player_id is null
            order by r.w desc, r.name asc
            limit 20
          ) m
        ) as missing_players,
        case
          when s.normalized_key = 'league' and asked_feature_keys is not null and ('league' = any(asked_feature_keys)) then 0.12
          when asked_feature_keys is not null and (s.normalized_key = any(asked_feature_keys)) then 0.5
          else 1
        end as key_penalty,
        (s.entropy_before - s.expected_entropy)
          * (1 - (abs((s.yes_w) - (s.no_w)) / total_w))
          * (case
              when s.normalized_key = 'league' and asked_feature_keys is not null and ('league' = any(asked_feature_keys)) then 0.12
              when asked_feature_keys is not null and (s.normalized_key = any(asked_feature_keys)) then 0.5
              else 1
            end)
          * (1 + greatest(-0.95, qpick.manual_weight))
          * (1 - least(0.95, coalesce(s.unknown_n::double precision / greatest(n, 1), 0))) as score
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
      where (s.entropy_before - s.expected_entropy) >= 0.0003
      order by score desc, info_gain desc
      limit 1
    )
  select
    b.feature_id,
    b.question_id,
    b.question_text,
    b.info_gain,
    b.score,
    b.missing_n,
    b.missing_players
  into
    best_feature_id,
    best_question_id,
    best_question_text,
    best_info_gain,
    best_score,
    best_missing_n,
    best_missing_players
  from best b;

  if best_feature_id is null or best_question_id is null or best_question_text is null then
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
          'p', (r.w / nullif(total_w, 0))
        )), '[]'::jsonb)
        from (
          with
            h_raw as (
              select
                nullif(x->>'feature_id', '')::uuid as feature_id,
                nullif(x->>'normalized_question', '') as normalized_question,
                case
                  when x ? 'answer_kind' then lower(trim(x->>'answer_kind'))
                  when x ? 'answer' then lower(trim(x->>'answer'))
                  else null
                end as answer_text
              from jsonb_array_elements(coalesce(current_history, '[]'::jsonb)) as x
            ),
            h_kind as (
              select
                hr.feature_id,
                hr.normalized_question,
                case
                  when hr.answer_text in ('yes','y','true','نعم') then 'yes'::public.answer_kind
                  when hr.answer_text in ('no','n','false','لا') then 'no'::public.answer_kind
                  when hr.answer_text in ('maybe','ربما','جزئيا','جزئياً') then 'maybe'::public.answer_kind
                  when hr.answer_text in ('unknown','idk','لا اعرف','لا أعرف') then 'unknown'::public.answer_kind
                  else null
                end as answer_kind
              from h_raw hr
            ),
            h_resolved as (
              select
                coalesce(hk.feature_id, mq.feature_id) as feature_id,
                hk.answer_kind as answer_kind,
                hk.normalized_question as normalized_question
              from h_kind hk
              left join lateral (
                select m.feature_id
                from public.match_question_metadata(hk.normalized_question, 0.88) m
                limit 1
              ) mq on hk.feature_id is null and hk.normalized_question is not null
              where coalesce(hk.feature_id, mq.feature_id) is not null and hk.answer_kind is not null
            ),
            h_for_weighting as (
              select distinct feature_id, answer_kind
              from h_resolved
              where answer_kind <> 'unknown'
            ),
            base as (
              select
                c.id,
                c.name,
                c.normalized_name,
                c.prior_weight::double precision as prior_w
              from public.candidates c
              where (rejected_guess_names is null or c.normalized_name <> all(rejected_guess_names))
            ),
            remaining as (
              select
                b.id,
                b.name,
                (b.prior_w * exp(coalesce(sum(ln(greatest(
                  case h.answer_kind
                    when 'yes' then case pf.answer when 'yes' then 1::double precision when 'no' then 1e-6::double precision else 0.5::double precision end
                    when 'no' then case pf.answer when 'yes' then 1e-6::double precision when 'no' then 1::double precision else 0.5::double precision end
                    when 'maybe' then case pf.answer when 'yes' then 0.8::double precision when 'no' then 0.2::double precision else 0.6::double precision end
                    else 1::double precision
                  end
                , 1e-9::double precision))), 0))) as w
              from base b
              left join h_for_weighting h on true
              left join public.player_features pf
                on pf.player_id = b.id and pf.feature_id = h.feature_id
              group by b.id, b.name, b.prior_w
            )
          select r.id, r.name, r.w
          from remaining r
          where r.w > 0
          order by r.w desc, r.name asc
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
      'score', best_score,
      'missing_n', coalesce(best_missing_n, 0),
      'missing_players', coalesce(best_missing_players, '[]'::jsonb)
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

create or replace function public.get_next_best_move(p_session_id uuid)
returns jsonb
language plpgsql
volatile
as $$
declare
  current_history jsonb;
  rejected_names text[];
  move jsonb;
begin
  select gs.rejected_guess_names
  into rejected_names
  from public.game_sessions gs
  where gs.id = p_session_id;

  if rejected_names is null then
    rejected_names := '{}'::text[];
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'feature_id', gm.feature_id,
    'answer_kind', gm.answer_kind
  ) order by gm.move_index), '[]'::jsonb)
  into current_history
  from public.game_moves gm
  where gm.session_id = p_session_id and gm.feature_id is not null;

  move := public.get_next_best_move(current_history, rejected_names);

  if move->>'type' = 'question' and (move ? 'question_id') then
    perform public.bump_question_seen(nullif(move->>'question_id', '')::uuid);
  end if;

  return move;
end;
$$;

create or replace function public.game_start()
returns jsonb
language plpgsql
volatile
as $$
declare
  sid uuid;
  move jsonb;
begin
  insert into public.game_sessions default values
  returning id into sid;

  move := public.get_next_best_move(sid);
  return jsonb_build_object('session_id', sid) || move;
end;
$$;

create or replace function public.game_step(
  p_session_id uuid,
  p_question_id uuid,
  p_feature_id uuid,
  p_answer public.answer_kind,
  p_rejected_guess_names text[] default null
)
returns jsonb
language plpgsql
volatile
as $$
declare
  next_index integer;
  move jsonb;
begin
  select coalesce(max(move_index), 0) + 1
  into next_index
  from public.game_moves
  where session_id = p_session_id;

  insert into public.game_moves (session_id, move_index, question_id, feature_id, answer_kind)
  values (p_session_id, next_index, p_question_id, p_feature_id, p_answer);

  update public.game_sessions
  set history = coalesce(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'move_index', next_index,
    'question_id', p_question_id,
    'feature_id', p_feature_id,
    'answer_kind', p_answer
  )),
  rejected_guess_names = coalesce(p_rejected_guess_names, rejected_guess_names),
  question_count = next_index
  where id = p_session_id;

  move := public.get_next_best_move(p_session_id);
  return jsonb_build_object('session_id', p_session_id) || move;
end;
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

create or replace function public.migrate_legacy_player_paths_to_sessions(p_max_rows integer default null)
returns jsonb
language plpgsql
volatile
as $$
declare
  r record;
  inserted_sessions integer := 0;
  q text;
begin
  if not exists (
    select 1
    from pg_tables
    where schemaname = 'public' and tablename = 'player_paths'
  ) then
    return jsonb_build_object('ok', true, 'inserted_sessions', 0);
  end if;

  q := 'select player_id, history, created_at from public.player_paths order by created_at asc';
  if p_max_rows is not null and p_max_rows > 0 then
    q := q || format(' limit %s', p_max_rows);
  end if;

  for r in execute q loop
    insert into public.game_sessions (
      history,
      status,
      guessed_candidate_id,
      guessed_name,
      correct,
      question_count,
      created_at,
      updated_at
    )
    values (
      coalesce(r.history, '[]'::jsonb),
      'won',
      r.player_id,
      null,
      true,
      case
        when jsonb_typeof(r.history) = 'array' then jsonb_array_length(r.history)
        else null
      end,
      coalesce(r.created_at, now()),
      coalesce(r.created_at, now())
    );

    inserted_sessions := inserted_sessions + 1;
  end loop;

  return jsonb_build_object('ok', true, 'inserted_sessions', inserted_sessions);
exception
  when undefined_column then
    return jsonb_build_object('ok', false, 'error', 'player_paths schema mismatch');
  when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;
