-- Update the get_candidate_summary function to add randomization
create or replace function public.get_candidate_summary(
  p_yes_attribute_ids uuid[] default '{}'::uuid[],
  p_no_attribute_ids uuid[] default '{}'::uuid[],
  p_rejected_names text[] default '{}'::text[]
)
returns table (
  candidate_count integer,
  top_player_id uuid,
  top_player_name text,
  total_weight numeric,
  top_weight numeric
)
language sql
stable
as $$
  with
    yes_ids as (select unnest(coalesce(p_yes_attribute_ids, '{}'::uuid[])) as attribute_id),
    no_ids as (select unnest(coalesce(p_no_attribute_ids, '{}'::uuid[])) as attribute_id),
    base as (
      select p.id, p.name, p.normalized_name, p.prior_weight
      from public.players p
      where (p_rejected_names is null or p.normalized_name <> all(p_rejected_names))
    ),
    filtered as (
      select b.*
      from base b
      where not exists (
        select 1
        from yes_ids y
        left join public.player_matrix pm
          on pm.player_id = b.id
          and pm.attribute_id = y.attribute_id
          and pm.value is true
        where pm.player_id is null
      )
      and not exists (
        select 1
        from no_ids n
        join public.player_matrix pm
          on pm.player_id = b.id
          and pm.attribute_id = n.attribute_id
          and pm.value is true
      )
    )
  select
    count(*)::integer as candidate_count,
    (select id from filtered order by prior_weight desc, random() limit 1) as top_player_id,
    (select name from filtered order by prior_weight desc, random() limit 1) as top_player_name,
    coalesce(sum(prior_weight), 0)::numeric as total_weight,
    coalesce((select prior_weight from filtered order by prior_weight desc, random() limit 1), 0)::numeric as top_weight
  from filtered;
$$;