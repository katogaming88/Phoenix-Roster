-- Tier bench/trial status instead of discounting the score (#622 follow-up).
--
-- The old design multiplied role_mult by a second status multiplier
-- (BENCH_ROLE_MULTIPLIER 0.65 / TRIAL_ROLE_MULTIPLIER 0.80 for Tank/Heal,
-- flat 0.45/0.85 for Ranged/Melee) so bench/trial raiders sorted below
-- full-status ones. That broke down in practice: a flat 0.85 for trial
-- DPS is higher than a full-status healer's own role_mult (0.75), so a
-- trial DPS could outrank a permanent healer for the same item -- exactly
-- the "feels bad" case an officer flagged. Tuning the constants to fix
-- that (and the analogous trial-vs-full-tank case) only produced
-- razor-thin margins between other combinations (trial heal vs trial dps),
-- because one shared multiplicative score was being asked to encode two
-- independent orderings (status tier, and role-within-tier) at once.
--
-- Sorting on tier first and role/score second removes the tension
-- entirely: no bench/trial raider of any role can ever outrank a
-- full-status raider, by construction rather than by tuned constants, and
-- role ordering within a tier falls out of the existing role_mult/raw_score
-- math unchanged. Status no longer discounts weighted_total at all -- a
-- bench or trial raider's score is raw_score * role_mult, identical to a
-- full-status raider's, so officers see their real weighted score; status
-- only changes which tier they sort into.

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
  status_label text
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
    select ip.player_id, ip.status
    from public.item_preferences ip
    join public.players p on p.id = ip.player_id
    where ip.item_id = p_item_id
      and ip.slot is null
      and p.team_id = p_team_id
      and p.archived_at is null
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
  base as (
    select
      p.id as player_id,
      p.name_realm,
      cs.role,
      p.is_bench,
      p.is_trial,
      sc.performance_score,
      sc.attendance_score,
      coalesce(r.has_myth, false) as has_myth,
      coalesce(r.has_hero, false) as has_hero,
      coalesce(r.has_champ, false) as has_champ,
      w.status as wishlist_status
    from candidates c
    join public.players p on p.id = c.player_id
    left join public.classes_specs cs on cs.id = p.class_spec_id
    left join public.scoring sc on sc.player_id = p.id and sc.season = p_season
    left join recip r on r.player_id = p.id
    left join wishlist w on w.player_id = p.id
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
      case when p_track = 'Myth' and has_hero then 'Has Heroic' end as myth_hero_status,
      case when p_track = 'Myth' and has_champ and not has_hero then 'Has Champion' end as myth_champ_status,
      case when p_track = 'Myth' and not has_hero and not has_champ then 'No Version' end as myth_neither_status,
      case when p_track = 'Hero' and has_champ then 'Has Champion' end as hero_champ_status,
      case wishlist_status
        when 'good' then 'Wishlist: Good'
        when 'ok' then 'Wishlist: OK'
        when 'catalyst' then 'Wishlist: Catalyst Only'
      end as wishlist_status_label
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
            myth_hero_status,
            myth_champ_status,
            myth_neither_status,
            hero_champ_status,
            wishlist_status_label
          ],
          null
        ),
        ', '
      ),
      ''
    ) as status_label
  from multiplied
  order by
    status_tier asc,
    coalesce(case when raw_score is not null then round(raw_score * final_mult, 1) end, -1) desc;
end;
$$;

revoke all on function public.generate_priority_order(integer, text, integer, text) from public;
revoke execute on function public.generate_priority_order(integer, text, integer, text) from anon;
grant execute on function public.generate_priority_order(integer, text, integer, text) to authenticated;
