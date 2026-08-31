-- avg_existing_rank (20260817135343, #714) pooled a candidate's placements
-- across BOTH Heroic and Mythic together when averaging "how much priority
-- do they already carry elsewhere this season" -- so a great Heroic rank on
-- some other item could deprioritize a candidate for a Mythic suggestion,
-- or a poor Mythic rank could wrongly boost them on a Heroic one. Heroic and
-- Mythic are separate priority lists on purpose: the whole point of this
-- factor is that the same few people shouldn't land in the same order on
-- every item within one difficulty, not across difficulties (Kat-confirmed
-- -- she wants the factor itself, just not mixing tracks). Caught live via
-- the same report that already fixed the client-side #1-only version of
-- this same mistake (prioEditFirstPriorityCounts(), js/tabs/tab-priority.js).
--
-- Only the existing_priority CTE changes: it now filters to po.track =
-- p_track, so a candidate's average is built entirely from their OTHER
-- placements on the SAME track being generated. Everything else -- the sort
-- order, the multipliers, the return shape -- is unchanged.
create or replace function public.generate_priority_order(
  p_team_id integer,
  p_season text,
  p_item_id integer,
  p_track text
)
returns table (
  player_id integer,
  name_realm text,
  role text,
  weighted_total numeric,
  status_label text,
  wishlist_status text
)
language plpgsql
security invoker
set search_path = public
stable
as $$
#variable_conflict use_column
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if p_track not in ('Hero', 'Myth') then
    raise exception 'Invalid track';
  end if;

  return query
  with bis as (
    select distinct bi.player_id
    from public.bis_items bi
    join public.players p on p.id = bi.player_id
    where bi.item_id = p_item_id
      and p.team_id = p_team_id
      and p.archived_at is null
  ),
  wishlist as (
    select
      ip.player_id,
      (array_agg(ip.status order by
        case ip.status
          when 'bis' then 1
          when 'good' then 2
          when 'catalyst' then 3
          when 'ok' then 4
          when 'pass' then 5
        end
      ))[1] as status
    from public.item_preferences ip
    join public.players p on p.id = ip.player_id
    where ip.item_id = p_item_id
      and p.team_id = p_team_id
      and p.archived_at is null
    group by ip.player_id
  ),
  candidates as (
    (select player_id from bis union select player_id from wishlist where status <> 'pass')
    except
    select player_id from wishlist where status = 'pass'
  ),
  recip as (
    select
      player_id,
      bool_or(track = 'Myth') as has_myth,
      bool_or(track = 'Hero') as has_hero,
      bool_or(track = 'Champion') as has_champ
    from public.rclc_loot
    where team_id = p_team_id
      and item_id = p_item_id
      and season = p_season
      and player_id is not null
    group by player_id
  ),
  tier_meta as (
    select exists(
      select 1 from public.tier_token_map where token_item_id = p_item_id
    ) as is_tier_token
  ),
  existing_priority as (
    select
      po.player_id,
      avg(po.rank) as avg_existing_rank
    from public.priority_order po
    where po.team_id = p_team_id
      and po.season = p_season
      and po.track = p_track
      and po.item_id <> p_item_id
    group by po.player_id
  ),
  base as (
    select
      p.id as player_id,
      p.name_realm,
      cs.role,
      p.is_bench,
      p.is_trial,
      p.tier_pieces_equipped,
      sc.performance_score,
      sc.attendance_score,
      coalesce(r.has_myth, false) as has_myth,
      coalesce(r.has_hero, false) as has_hero,
      coalesce(r.has_champ, false) as has_champ,
      w.status as wishlist_status,
      exists(select 1 from bis b where b.player_id = p.id) as has_bis_pick,
      tm.is_tier_token,
      ep.avg_existing_rank
    from candidates c
    join public.players p on p.id = c.player_id
    left join public.classes_specs cs on cs.id = p.class_spec_id
    left join public.scoring sc on sc.player_id = p.id and sc.season = p_season
    left join recip r on r.player_id = p.id
    left join wishlist w on w.player_id = p.id
    left join existing_priority ep on ep.player_id = p.id
    cross join tier_meta tm
    where not coalesce(r.has_myth, false)
      and not (p_track = 'Hero' and coalesce(r.has_hero, false))
  ),
  scored as (
    select
      player_id,
      name_realm,
      role,
      case
        when role in ('Tank', 'Heal') then
          case when attendance_score > 0 then attendance_score else null end
        else
          case
            when performance_score > 0 or attendance_score > 0
              then round((coalesce(performance_score, 0) * 0.5 + coalesce(attendance_score, 0) * 0.5), 1)
            else null
          end
      end as raw_score,
      case role
        when 'Tank' then 0.50
        when 'Heal' then 0.75
        else 1.0
      end as role_mult,
      -- Sort tier only, no longer a score input: 0 = full status, 1 =
      -- trial, 2 = bench. Bench takes precedence over trial if somehow
      -- both are set, matching the old status branch's precedence order.
      case when is_bench then 2 when is_trial then 1 else 0 end as status_tier,
      -- Wishlist status as a hard sort tier, not just a score multiplier --
      -- BiS (or an untagged bis_items pick) always outranks Good, which
      -- always outranks OK/Catalyst (tied), regardless of raw_score. Tier
      -- tokens keep their existing binary split (0 = keeping it, 1 = any
      -- sidegrade tag) since tier_rank is a stronger, more specific signal
      -- there than a 3-way wishlist split would add.
      case
        when is_tier_token then
          case
            when wishlist_status = 'bis' then 0
            when wishlist_status is null and has_bis_pick then 0
            else 1
          end
        when wishlist_status = 'bis' then 0
        when wishlist_status is null and has_bis_pick then 0
        when wishlist_status = 'good' then 1
        when wishlist_status in ('ok', 'catalyst') then 2
        else 0
      end as wishlist_rank,
      case
        when not is_tier_token then 0
        else case coalesce(tier_pieces_equipped, 0)
          when 1 then 1
          when 0 then 2
          when 3 then 3
          when 2 then 4
          when 4 then 5
          else 6
        end
      end as tier_rank,
      avg_existing_rank,
      is_tier_token,
      tier_pieces_equipped,
      is_bench,
      is_trial,
      has_myth,
      has_hero,
      has_champ,
      wishlist_status
    from base
  ),
  multiplied as (
    select
      player_id,
      name_realm,
      role,
      raw_score,
      status_tier,
      wishlist_rank,
      tier_rank,
      avg_existing_rank,
      wishlist_status,
      (role_mult
      -- Item-ownership multipliers stack on top, mythic and heroic branches
      -- are mutually exclusive since p_track is one or the other.
      * case when p_track = 'Myth' and has_hero then 0.85 else 1.0 end
      * case when p_track = 'Myth' and has_champ and not has_hero then 1.07 else 1.0 end
      * case when p_track = 'Myth' and not has_hero and not has_champ then 1.15 else 1.0 end
      * case when p_track = 'Hero' and has_champ then 0.90 else 1.0 end
      -- Wishlist multiplier (#515): 'bis'/untagged (bis_items-only) both
      -- stay at 1.0, today's math unchanged. 'pass' never reaches here --
      -- already excluded by the candidates CTE above.
      * case wishlist_status
          when 'bis' then 1.0
          when 'good' then 0.90
          when 'ok' then 0.60
          when 'catalyst' then 0.75
          else 1.0
        end
      ) as final_mult,
      (case
        when is_bench then 'Bench'
        when is_trial then 'Trial'
        else ''
      end) as base_status,
      case when is_tier_token then 'Tier: ' || coalesce(tier_pieces_equipped, 0) || '/5' end as tier_status_label,
      case when p_track = 'Myth' and has_hero then 'Has Heroic' end as myth_hero_status,
      case when p_track = 'Myth' and has_champ and not has_hero then 'Has Champion' end as myth_champ_status,
      case when p_track = 'Myth' and not has_hero and not has_champ then 'No Version' end as myth_neither_status,
      case when p_track = 'Hero' and has_champ then 'Has Champion' end as hero_champ_status
    from scored
  )
  select
    player_id,
    name_realm,
    role,
    case when raw_score is not null then round(raw_score * final_mult, 1) end as weighted_total,
    nullif(
      array_to_string(
        array_remove(
          array[
            nullif(base_status, ''),
            tier_status_label,
            myth_hero_status,
            myth_champ_status,
            myth_neither_status,
            hero_champ_status
          ],
          null
        ),
        ', '
      ),
      ''
    ) as status_label,
    wishlist_status
  from multiplied
  order by
    status_tier asc,
    wishlist_rank asc,
    tier_rank asc,
    avg_existing_rank desc nulls first,
    coalesce(case when raw_score is not null then round(raw_score * final_mult, 1) end, -1) desc;
end;
$$;

-- CREATE OR REPLACE preserves existing grants, but re-apply explicitly to
-- match the same defensive pattern every prior migration touching this
-- function uses (officer/team_leader/site_admin only, via the
-- my_team_role()/is_site_admin() check inside the function body -- never
-- anon or public execute).
revoke all on function public.generate_priority_order(integer, text, integer, text) from public;
revoke execute on function public.generate_priority_order(integer, text, integer, text) from anon;
grant execute on function public.generate_priority_order(integer, text, integer, text) to authenticated;
