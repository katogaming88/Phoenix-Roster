-- The Priority Order editor (js/tabs/tab-priority.js prioEditRenderList())
-- showed the raw "Wishlist: Good"/"Wishlist: OK"/"Wishlist: Catalyst Only"
-- text baked into status_label, ignoring a team's custom wishlist status
-- label overrides (team_settings.config.wishlistStatusLabels, set via the
-- officer admin panel) -- every other wishlist status display on the site
-- already respects those overrides. Splits the wishlist portion out into
-- its own raw `wishlist_status` column so the client can build the label
-- itself with WISHLIST_LABEL_DEFAULTS + labelOverrides, the same pattern
-- js/tabs/tab-priority.js's own buildPriorityNotesTab() already uses.
--
-- 'bis'/untagged (bis_items-only) intentionally still return no wishlist
-- label at all here (via the CLIENT's own "only build a label for
-- good/ok/catalyst" check) -- unchanged from before, BiS is the unlabeled
-- default case, only a sidegrade tag gets called out.
--
-- Second change, same migration: wishlist status previously only affected
-- ranking as a score MULTIPLIER (applied to raw_score before sorting), so a
-- well-performing Good/OK/Catalyst raider could out-rank a lower-performing
-- BiS raider on a regular (non-tier-token) item -- reported as "Torbjorn
-- (2nd Choice) ranked above Katorri (BiS) on Gebbo's Bottomless Bag."
-- Tier tokens already avoid this via bis_match_rank, a hard BiS-vs-sidegrade
-- sort tier ahead of score. Generalized that into `wishlist_rank`, a 3-way
-- hard tier (BiS/untagged-bis-pick > Good > OK/Catalyst, tied) applied to
-- ALL items, with raw_score only breaking ties within a tier. Tier tokens
-- keep their existing binary split unchanged, since tier_rank (tier-piece
-- catch-up) is a stronger signal there than a 3-way wishlist split.
--
-- Adding a new output column requires dropping the function first --
-- CREATE OR REPLACE cannot change an existing function's return type/shape.
drop function if exists public.generate_priority_order(integer, text, integer, text);

create function public.generate_priority_order(
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
      tm.is_tier_token
    from candidates c
    join public.players p on p.id = c.player_id
    left join public.classes_specs cs on cs.id = p.class_spec_id
    left join public.scoring sc on sc.player_id = p.id and sc.season = p_season
    left join recip r on r.player_id = p.id
    left join wishlist w on w.player_id = p.id
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
    coalesce(case when raw_score is not null then round(raw_score * final_mult, 1) end, -1) desc;
end;
$$;

-- Re-apply the grants dropping the function wiped -- same restriction as
-- when it was first created (20260710130000_priority_generator.sql):
-- officer/team_leader/site_admin only, via the my_team_role()/is_site_admin()
-- check inside the function body, not anon or public execute.
revoke all on function public.generate_priority_order(integer, text, integer, text) from public;
revoke execute on function public.generate_priority_order(integer, text, integer, text) from anon;
grant execute on function public.generate_priority_order(integer, text, integer, text) to authenticated;

-- check_priority_order_drift() (20260731023544_priority_order_drift_check.sql)
-- calls generate_priority_order() via `WITH ORDINALITY AS t(...)` with a
-- hardcoded positional column list sized for the old 5-column return shape.
-- Adding wishlist_status shifted every column after it by one -- the real
-- ordinality value (each row's live rank position, used for `order by
-- t.ord` and the `limit 3`) silently landed on wishlist_status's TEXT value
-- instead, scrambling the "current top 3" order entirely rather than
-- erroring. Caught by tests/rls/priority-order-drift-check.test.js. No
-- other logic changed -- only the alias list gains wishlist_status before
-- ord, matching the new column.
create or replace function public.check_priority_order_drift(
  p_team_id integer,
  p_season text
)
returns table (
  item_id integer,
  item_name text,
  track text,
  saved_top3 text[],
  current_top3 text[]
)
language plpgsql
security invoker
set search_path = public
stable
as $$
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  return query
  with combos as (
    select distinct po.item_id, po.track
    from public.priority_order po
    where po.team_id = p_team_id
      and po.season = p_season
  ),
  saved as (
    select
      po.item_id,
      po.track,
      array_agg(p.name_realm order by po.rank) as top3
    from public.priority_order po
    join public.players p on p.id = po.player_id
    where po.team_id = p_team_id
      and po.season = p_season
      and po.rank <= 3
    group by po.item_id, po.track
  ),
  current as (
    select
      c.item_id,
      c.track,
      array_agg(g.name_realm order by g.ord) as top3
    from combos c
    cross join lateral (
      select t.name_realm, t.ord
      from public.generate_priority_order(p_team_id, p_season, c.item_id, c.track)
        with ordinality as t(player_id, name_realm, role, weighted_total, status_label, wishlist_status, ord)
      order by t.ord
      limit 3
    ) g
    group by c.item_id, c.track
  )
  select
    co.item_id,
    i.name,
    co.track,
    coalesce(s.top3, array[]::text[]),
    coalesce(cu.top3, array[]::text[])
  from combos co
  join public.items i on i.id = co.item_id
  left join saved s on s.item_id = co.item_id and s.track = co.track
  left join current cu on cu.item_id = co.item_id and cu.track = co.track
  where coalesce(s.top3, array[]::text[]) is distinct from coalesce(cu.top3, array[]::text[])
  order by i.name, co.track;
end;
$$;
