-- =====================================================
-- 🧬 PlayerQI "Neural-Database" Schema (Feature Matrix)
-- =====================================================
-- Database does the thinking (information gain / entropy).
-- Node.js should only call RPC functions.
-- =====================================================

begin;

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

-- -----------------------------------------------------
-- Wipe legacy objects (safe for database resets)
-- -----------------------------------------------------
drop view if exists public.view_game_stats cascade;
drop view if exists public.view_player_attribute_editor cascade;

-- Drop RPCs first (avoids parameter-name/signature issues across iterations)
drop function if exists public.game_start();
drop function if exists public.game_step(uuid, uuid, uuid, public.answer_kind, text[]);
drop function if exists public.get_optimal_move(uuid);
drop function if exists public.get_optimal_move(jsonb, text[]);
drop function if exists public.bump_question_seen(uuid);
drop function if exists public.bump_question_success(uuid);
drop function if exists public.match_player(text, real);
drop function if exists public.match_question(text, real);
drop function if exists public.entropy_from_sums(numeric, numeric);
drop function if exists public.enforce_question_uniqueness() cascade;
drop function if exists public.questions_set_normalized_text() cascade;
drop function if exists public.attributes_set_normalized_fields() cascade;
drop function if exists public.players_set_normalized_name() cascade;
drop function if exists public.touch_updated_at() cascade;
drop function if exists public.normalize_simple_text(text);

drop table if exists public.question_transitions cascade;
drop table if exists public.question_nodes cascade;
drop table if exists public.player_paths cascade;

drop table if exists public.game_moves cascade;
drop table if exists public.game_sessions cascade;

drop table if exists public.player_features cascade;
drop table if exists public.questions_metadata cascade;
drop table if exists public.features cascade;
drop table if exists public.candidates cascade;

-- Drop new schema tables too (wipe & rebuild; avoids mismatched columns from Table Editor)
drop table if exists public.player_attributes cascade;
drop table if exists public.questions cascade;
drop table if exists public.attributes cascade;
drop table if exists public.players cascade;

-- -----------------------------------------------------
-- Core entities
-- -----------------------------------------------------

create table public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  image_url text,
  prior_weight numeric not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint players_prior_weight_positive check (prior_weight > 0),
  constraint players_normalized_unique unique(normalized_name)
);

create index if not exists players_normalized_trgm
on public.players using gin (normalized_name gin_trgm_ops);

create table public.attributes (
  id uuid primary key default gen_random_uuid(),
  attribute_key text not null,
  attribute_value text not null,
  label_ar text not null,
  category text not null,
  normalized_key text not null,
  normalized_value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attributes_normalized_unique unique(normalized_key, normalized_value)
);

create index if not exists attributes_normalized_lookup
on public.attributes(normalized_key, normalized_value);

create index if not exists attributes_category_lookup
on public.attributes(category, normalized_key, normalized_value);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  attribute_id uuid not null references public.attributes(id) on delete cascade,
  question_text text not null,
  normalized_text text not null,
  embedding vector(1536),
  manual_weight numeric not null default 0,
  seen_count integer not null default 0,
  success_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint questions_attribute_norm_unique unique(attribute_id, normalized_text)
);

create index if not exists questions_normalized_trgm
on public.questions using gin (normalized_text gin_trgm_ops);

create index if not exists questions_attribute_lookup
on public.questions(attribute_id, manual_weight desc, success_count desc, seen_count desc, updated_at desc);

create index if not exists questions_embedding_ivfflat
on public.questions using ivfflat (embedding vector_cosine_ops)
with (lists = 100)
where embedding is not null;

create table public.player_attributes (
  player_id uuid not null references public.players(id) on delete cascade,
  attribute_id uuid not null references public.attributes(id) on delete cascade,
  value boolean not null,
  confidence_score numeric not null default 1,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (player_id, attribute_id),
  constraint player_attributes_confidence_range check (confidence_score >= 0 and confidence_score <= 1)
);

create index if not exists player_attributes_attribute_player
on public.player_attributes(attribute_id, player_id);

create index if not exists player_attributes_attribute_value_player
on public.player_attributes(attribute_id, value, player_id);

create table public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  history jsonb not null default '[]'::jsonb,
  rejected_guess_names text[] not null default '{}'::text[],
  status text not null default 'in_progress' check (status in ('in_progress','won','lost','abandoned')),
  guessed_player_id uuid references public.players(id) on delete set null,
  guessed_name text,
  correct boolean,
  question_count integer,
  duration_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.game_moves (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  move_index integer not null,
  question_id uuid references public.questions(id) on delete set null,
  attribute_id uuid references public.attributes(id) on delete set null,
  answer_kind public.answer_kind,
  candidate_count_before integer,
  candidate_count_after integer,
  info_gain numeric,
  created_at timestamptz not null default now(),
  constraint game_moves_session_move_unique unique(session_id, move_index)
);

create index if not exists game_moves_session_lookup
on public.game_moves(session_id, move_index);

-- -----------------------------------------------------
-- "Table Editor" friendly view (single base table => updatable)
-- -----------------------------------------------------
create or replace view public.view_player_attribute_editor as
select
  pa.player_id,
  (select p.name from public.players p where p.id = pa.player_id) as player_name,
  pa.attribute_id,
  (select a.attribute_key from public.attributes a where a.id = pa.attribute_id) as attribute_key,
  (select a.attribute_value from public.attributes a where a.id = pa.attribute_id) as attribute_value,
  (select a.label_ar from public.attributes a where a.id = pa.attribute_id) as attribute_label_ar,
  (select a.category from public.attributes a where a.id = pa.attribute_id) as attribute_category,
  pa.value,
  pa.confidence_score,
  pa.source,
  pa.created_at,
  pa.updated_at
from public.player_attributes pa;

-- -----------------------------------------------------
-- Normalization & timestamps
-- -----------------------------------------------------

create or replace function public.normalize_simple_text(p_text text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'));
$$;

create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace function public.players_set_normalized_name()
returns trigger as $$
begin
  new.normalized_name := public.normalize_simple_text(new.name);
  return new;
end;
$$ language plpgsql;

create or replace function public.attributes_set_normalized_fields()
returns trigger as $$
begin
  new.normalized_key := public.normalize_simple_text(new.attribute_key);
  new.normalized_value := public.normalize_simple_text(new.attribute_value);
  if new.category is null or new.category = '' then
    new.category := new.attribute_key;
  end if;
  if new.label_ar is null or new.label_ar = '' then
    new.label_ar := new.attribute_value;
  end if;
  return new;
end;
$$ language plpgsql;

create or replace function public.questions_set_normalized_text()
returns trigger as $$
begin
  new.normalized_text := public.normalize_simple_text(new.question_text);
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_players_norm on public.players;
create trigger trg_players_norm
before insert or update on public.players
for each row execute function public.players_set_normalized_name();

drop trigger if exists trg_attributes_norm on public.attributes;
create trigger trg_attributes_norm
before insert or update on public.attributes
for each row execute function public.attributes_set_normalized_fields();

drop trigger if exists trg_questions_norm on public.questions;
create trigger trg_questions_norm
before insert or update on public.questions
for each row execute function public.questions_set_normalized_text();

drop trigger if exists trg_players_touch on public.players;
create trigger trg_players_touch
before update on public.players
for each row execute function public.touch_updated_at();

drop trigger if exists trg_attributes_touch on public.attributes;
create trigger trg_attributes_touch
before update on public.attributes
for each row execute function public.touch_updated_at();

drop trigger if exists trg_questions_touch on public.questions;
create trigger trg_questions_touch
before update on public.questions
for each row execute function public.touch_updated_at();

drop trigger if exists trg_player_attributes_touch on public.player_attributes;
create trigger trg_player_attributes_touch
before update on public.player_attributes
for each row execute function public.touch_updated_at();

drop trigger if exists trg_game_sessions_touch on public.game_sessions;
create trigger trg_game_sessions_touch
before update on public.game_sessions
for each row execute function public.touch_updated_at();

-- -----------------------------------------------------
-- Duplicate question prevention (semantic + trigram)
-- -----------------------------------------------------
create or replace function public.enforce_question_uniqueness()
returns trigger as $$
begin
  if new.embedding is not null then
    if exists (
      select 1
      from public.questions q
      where q.id <> new.id
        and q.embedding is not null
        and (1 - (q.embedding <=> new.embedding)) >= 0.92
    ) then
      raise exception 'duplicate_question_embedding';
    end if;
  else
    if exists (
      select 1
      from public.questions q
      where q.id <> new.id
        and similarity(q.normalized_text, new.normalized_text) >= 0.92
    ) then
      raise exception 'duplicate_question_trgm';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_questions_dedupe on public.questions;
create trigger trg_questions_dedupe
before insert or update on public.questions
for each row execute function public.enforce_question_uniqueness();

-- -----------------------------------------------------
-- Matching helpers (trigram)
-- -----------------------------------------------------
create or replace function public.match_player(query_text text, similarity_threshold real)
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
    p.id,
    p.name,
    p.normalized_name,
    p.image_url,
    similarity(p.normalized_name, query_text) as score
  from public.players p
  where similarity(p.normalized_name, query_text) >= similarity_threshold
  order by score desc
  limit 1;
$$;

create or replace function public.match_question(query_text text, similarity_threshold real)
returns table (
  id uuid,
  attribute_id uuid,
  question_text text,
  normalized_text text,
  score real
)
language sql
stable
as $$
  select
    q.id,
    q.attribute_id,
    q.question_text,
    q.normalized_text,
    similarity(q.normalized_text, query_text) as score
  from public.questions q
  where similarity(q.normalized_text, query_text) >= similarity_threshold
  order by score desc
  limit 1;
$$;

-- -----------------------------------------------------
-- Information Theory (Entropy / Info Gain)
-- -----------------------------------------------------
create or replace function public.entropy_from_sums(sum_w numeric, sum_w_ln_w numeric)
returns numeric
language sql
stable
as $$
  select case when sum_w is null or sum_w <= 0 then 0 else ln(sum_w) - (sum_w_ln_w / sum_w) end;
$$;

create or replace function public.get_optimal_move(current_history jsonb, rejected_guess_names text[] default '{}'::text[])
returns jsonb
language plpgsql
stable
as $$
declare
  asked_attribute_ids uuid[];
  asked_attribute_keys text[];
  asked_question_norms text[];
  n integer;
  total_w double precision;
  total_w_ln_w double precision;
  top_player_id uuid;
  top_player_name text;
  top_player_w double precision;
  top_prob double precision;
  entropy_before double precision;
  best_attribute_id uuid;
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
        nullif(x->>'attribute_id', '')::uuid as attribute_id,
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
        hr.attribute_id,
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
        coalesce(hk.attribute_id, mq.attribute_id) as attribute_id,
        hk.answer_kind as answer_kind,
        hk.normalized_question as normalized_question
      from h_kind hk
      left join lateral (
        select m.attribute_id
        from public.match_question(hk.normalized_question, 0.88) m
        limit 1
      ) mq on hk.attribute_id is null and hk.normalized_question is not null
      where coalesce(hk.attribute_id, mq.attribute_id) is not null and hk.answer_kind is not null
    ),
    h_all as (
      select distinct attribute_id
      from h_resolved
    ),
    asked_keys as (
      select distinct a.normalized_key
      from public.attributes a
      where a.id = any((select array_agg(attribute_id) from h_all))
    ),
    asked_q_norms as (
      select distinct normalized_question
      from h_resolved
      where normalized_question is not null and normalized_question <> ''
    ),
    h_for_weighting as (
      select distinct attribute_id, answer_kind
      from h_resolved
      where answer_kind <> 'unknown'
    ),
    base as (
      select
        p.id,
        p.name,
        p.normalized_name,
        p.image_url,
        p.prior_weight::double precision as prior_w
      from public.players p
      where (rejected_guess_names is null or p.normalized_name <> all(rejected_guess_names))
    ),
    remaining as (
      select
        b.id,
        b.name,
        b.normalized_name,
        b.image_url,
        (b.prior_w * exp(coalesce(sum(ln(greatest(
          case h.answer_kind
            when 'yes' then case when pa.value is true then 1::double precision when pa.value is false then 1e-6::double precision else 0.5::double precision end
            when 'no' then case when pa.value is true then 1e-6::double precision when pa.value is false then 1::double precision else 0.5::double precision end
            when 'maybe' then case when pa.value is true then 0.8::double precision when pa.value is false then 0.2::double precision else 0.6::double precision end
            else 1::double precision
          end
        , 1e-9::double precision))), 0))) as w
      from base b
      left join h_for_weighting h on true
      left join public.player_attributes pa
        on pa.player_id = b.id and pa.attribute_id = h.attribute_id
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
    (select array_agg(attribute_id) from h_all),
    (select array_agg(normalized_key) from asked_keys),
    (select array_agg(normalized_question) from asked_q_norms),
    (select count(*) from remaining2),
    (select coalesce(sum(w), 0) from remaining2),
    (select coalesce(sum(w_ln_w), 0) from remaining2),
    (select id from remaining2 order by w desc, name asc limit 1),
    (select name from remaining2 order by w desc, name asc limit 1),
    (select w from remaining2 order by w desc, name asc limit 1)
  into
    asked_attribute_ids,
    asked_attribute_keys,
    asked_question_norms,
    n,
    total_w,
    total_w_ln_w,
    top_player_id,
    top_player_name,
    top_player_w;

  if n is null or n = 0 then
    return jsonb_build_object('type', 'gap', 'reason', 'no_candidates');
  end if;

  if total_w <= 0 then
    top_prob := 0;
  else
    top_prob := coalesce(top_player_w, 0) / total_w;
  end if;

  entropy_before := public.entropy_from_sums(total_w::numeric, total_w_ln_w::numeric);

  if n <= 5 or top_prob >= 0.75 then
    return jsonb_build_object(
      'type', 'guess',
      'player_id', top_player_id,
      'content', top_player_name,
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
        nullif(x->>'attribute_id', '')::uuid as attribute_id,
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
        hr.attribute_id,
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
        coalesce(hk.attribute_id, mq.attribute_id) as attribute_id,
        hk.answer_kind as answer_kind,
        hk.normalized_question as normalized_question
      from h_kind hk
      left join lateral (
        select m.attribute_id
        from public.match_question(hk.normalized_question, 0.88) m
        limit 1
      ) mq on hk.attribute_id is null and hk.normalized_question is not null
      where coalesce(hk.attribute_id, mq.attribute_id) is not null and hk.answer_kind is not null
    ),
    h_for_weighting as (
      select distinct attribute_id, answer_kind
      from h_resolved
      where answer_kind <> 'unknown'
    ),
    base as (
      select
        p.id,
        p.name,
        p.normalized_name,
        p.image_url,
        p.prior_weight::double precision as prior_w
      from public.players p
      where (rejected_guess_names is null or p.normalized_name <> all(rejected_guess_names))
    ),
    remaining as (
      select
        b.id,
        b.name,
        b.normalized_name,
        b.image_url,
        (b.prior_w * exp(coalesce(sum(ln(greatest(
          case h.answer_kind
            when 'yes' then case when pa.value is true then 1::double precision when pa.value is false then 1e-6::double precision else 0.5::double precision end
            when 'no' then case when pa.value is true then 1e-6::double precision when pa.value is false then 1::double precision else 0.5::double precision end
            when 'maybe' then case when pa.value is true then 0.8::double precision when pa.value is false then 0.2::double precision else 0.6::double precision end
            else 1::double precision
          end
        , 1e-9::double precision))), 0))) as w
      from base b
      left join h_for_weighting h on true
      left join public.player_attributes pa
        on pa.player_id = b.id and pa.attribute_id = h.attribute_id
      group by b.id, b.name, b.normalized_name, b.image_url, b.prior_w
    ),
    remaining2 as (
      select
        r.*,
        (r.w * ln(greatest(r.w, 1e-12))) as w_ln_w
      from remaining r
      where r.w > 0
    ),
    attribute_stats as (
      select
        pa.attribute_id,
        a.normalized_key,
        count(*) filter (where pa.value is true) as yes_n,
        coalesce(sum(r.w) filter (where pa.value is true), 0) as yes_w_known,
        coalesce(sum(r.w_ln_w) filter (where pa.value is true), 0) as yes_w_ln_w_known,
        count(*) filter (where pa.value is false) as no_n,
        coalesce(sum(r.w) filter (where pa.value is false), 0) as no_w_known,
        coalesce(sum(r.w_ln_w) filter (where pa.value is false), 0) as no_w_ln_w_known
      from remaining2 r
      join public.player_attributes pa on pa.player_id = r.id
      join public.attributes a on a.id = pa.attribute_id
      where asked_attribute_ids is null or not (pa.attribute_id = any(asked_attribute_ids))
      group by pa.attribute_id, a.normalized_key
    ),
    scored as (
      select
        s.attribute_id,
        s.normalized_key,
        s.yes_n,
        s.no_n,
        (n - s.yes_n - s.no_n) as unknown_n,
        (s.yes_w_known + ((total_w - s.yes_w_known - s.no_w_known) / 2)) as yes_w,
        (s.no_w_known + ((total_w - s.yes_w_known - s.no_w_known) / 2)) as no_w,
        (s.yes_w_ln_w_known
          + ((total_w_ln_w - s.yes_w_ln_w_known - s.no_w_ln_w_known) / 2)
          - ((ln(2)::double precision / 2) * (total_w - s.yes_w_known - s.no_w_known))
        ) as yes_w_ln_w,
        (s.no_w_ln_w_known
          + ((total_w_ln_w - s.yes_w_ln_w_known - s.no_w_ln_w_known) / 2)
          - ((ln(2)::double precision / 2) * (total_w - s.yes_w_known - s.no_w_known))
        ) as no_w_ln_w,
        entropy_before as entropy_before,
        ((s.yes_w_known + ((total_w - s.yes_w_known - s.no_w_known) / 2)) / total_w)
          * public.entropy_from_sums(
              (s.yes_w_known + ((total_w - s.yes_w_known - s.no_w_known) / 2))::numeric,
              (s.yes_w_ln_w_known
                + ((total_w_ln_w - s.yes_w_ln_w_known - s.no_w_ln_w_known) / 2)
                - ((ln(2)::double precision / 2) * (total_w - s.yes_w_known - s.no_w_known))
              )::numeric
            )
          + ((s.no_w_known + ((total_w - s.yes_w_known - s.no_w_known) / 2)) / total_w)
          * public.entropy_from_sums(
              (s.no_w_known + ((total_w - s.yes_w_known - s.no_w_known) / 2))::numeric,
              (s.no_w_ln_w_known
                + ((total_w_ln_w - s.yes_w_ln_w_known - s.no_w_ln_w_known) / 2)
                - ((ln(2)::double precision / 2) * (total_w - s.yes_w_known - s.no_w_known))
              )::numeric
            ) as expected_entropy
      from attribute_stats s
      where total_w > 0
        and (s.yes_w_known + ((total_w - s.yes_w_known - s.no_w_known) / 2)) > 0
        and (s.no_w_known + ((total_w - s.yes_w_known - s.no_w_known) / 2)) > 0
    ),
    best as (
      select
        s.attribute_id,
        (s.entropy_before - s.expected_entropy) as info_gain,
        qpick.id as question_id,
        qpick.question_text,
        qpick.manual_weight,
        (
          select count(*)
          from remaining2 r
          left join public.player_attributes pa_any
            on pa_any.player_id = r.id and pa_any.attribute_id = s.attribute_id
          where pa_any.player_id is null
        ) as missing_n,
        (
          select coalesce(jsonb_agg(jsonb_build_object('player_id', m.id, 'name', m.name)), '[]'::jsonb)
          from (
            select r.id, r.name
            from remaining2 r
            left join public.player_attributes pa_any
              on pa_any.player_id = r.id and pa_any.attribute_id = s.attribute_id
            where pa_any.player_id is null
            order by r.w desc, r.name asc
            limit 20
          ) m
        ) as missing_players,
        (s.entropy_before - s.expected_entropy)
          * (1 - (abs((s.yes_w) - (s.no_w)) / total_w))
          * (case when asked_attribute_keys is not null and (s.normalized_key = any(asked_attribute_keys)) then 0.6 else 1 end)
          * (1 + greatest(-0.95, qpick.manual_weight))
          * (1 - least(0.95, coalesce(s.unknown_n::double precision / greatest(n, 1), 0))) as score
      from scored s
      join lateral (
        select q.id, q.question_text, q.manual_weight
        from public.questions q
        where q.attribute_id = s.attribute_id
        order by q.manual_weight desc, q.success_count desc, q.seen_count desc, q.updated_at desc
        limit 1
      ) qpick on true
      order by score desc, info_gain desc
      limit 1
    )
  select
    b.attribute_id,
    b.question_id,
    b.question_text,
    b.info_gain,
    b.score,
    b.missing_n,
    b.missing_players
  into
    best_attribute_id,
    best_question_id,
    best_question_text,
    best_info_gain,
    best_score,
    best_missing_n,
    best_missing_players
  from best b;

  if best_attribute_id is null or best_question_id is null or best_question_text is null then
    return jsonb_build_object(
      'type', 'guess',
      'player_id', top_player_id,
      'content', top_player_name,
      'confidence', top_prob,
      'meta', jsonb_build_object(
        'remaining', n,
        'entropy', entropy_before,
        'reason', 'no_good_question_guess'
      )
    );
  end if;

  return jsonb_build_object(
    'type', 'question',
    'question_id', best_question_id,
    'attribute_id', best_attribute_id,
    'content', best_question_text,
    'meta', jsonb_build_object(
      'remaining', n,
      'entropy', entropy_before,
      'top_player', jsonb_build_object(
        'player_id', top_player_id,
        'name', top_player_name,
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

-- -----------------------------------------------------
-- Session-based wrappers (optional, for analytics)
-- -----------------------------------------------------

-- If you previously deployed the legacy schema, `game_step` existed with the same
-- argument types but different parameter names; Postgres requires an explicit DROP.
drop function if exists public.game_step(uuid, uuid, uuid, public.answer_kind, text[]);

create or replace function public.bump_question_seen(p_question_id uuid)
returns void
language sql
volatile
as $$
  update public.questions
  set seen_count = seen_count + 1
  where id = p_question_id;
$$;

create or replace function public.bump_question_success(p_question_id uuid)
returns void
language sql
volatile
as $$
  update public.questions
  set success_count = success_count + 1
  where id = p_question_id;
$$;

create or replace function public.get_optimal_move(p_session_id uuid)
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
    'attribute_id', gm.attribute_id,
    'answer_kind', gm.answer_kind
  ) order by gm.move_index), '[]'::jsonb)
  into current_history
  from public.game_moves gm
  where gm.session_id = p_session_id and gm.attribute_id is not null;

  move := public.get_optimal_move(current_history, rejected_names);

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

  move := public.get_optimal_move(sid);
  return jsonb_build_object('session_id', sid) || move;
end;
$$;

create or replace function public.game_step(
  p_session_id uuid,
  p_question_id uuid,
  p_attribute_id uuid,
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

  insert into public.game_moves (session_id, move_index, question_id, attribute_id, answer_kind)
  values (p_session_id, next_index, p_question_id, p_attribute_id, p_answer);

  update public.game_sessions
  set history = coalesce(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'move_index', next_index,
    'question_id', p_question_id,
    'attribute_id', p_attribute_id,
    'answer_kind', p_answer
  )),
  rejected_guess_names = coalesce(p_rejected_guess_names, rejected_guess_names),
  question_count = next_index
  where id = p_session_id;

  move := public.get_optimal_move(p_session_id);
  return jsonb_build_object('session_id', p_session_id) || move;
end;
$$;

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
      q.question_text,
      count(*) as times_asked,
      avg(coalesce(gm.info_gain, 0)) as avg_info_gain
    from public.game_moves gm
    join public.questions q on q.id = gm.question_id
    group by gm.question_id, q.question_text
    order by avg(coalesce(gm.info_gain, 0)) desc, count(*) desc
    limit 25
  ),
  top_guesses as (
    select
      gs.guessed_player_id,
      coalesce(p.name, gs.guessed_name) as name,
      count(*) as guess_count,
      count(*) filter (where gs.correct = true) as correct_count
    from public.game_sessions gs
    left join public.players p on p.id = gs.guessed_player_id
    where gs.status in ('won','lost')
    group by gs.guessed_player_id, coalesce(p.name, gs.guessed_name)
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
    'player_id', guessed_player_id,
    'name', name,
    'guess_count', guess_count,
    'correct_count', correct_count
  )), '[]'::jsonb) from top_guesses) as commonly_guessed_players;

commit;

-- Force PostgREST schema cache refresh (important after wipe & rebuild)
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
end $$;
