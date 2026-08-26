-- build_rclc_export()'s ranked priority list has always been just an
-- ordered array of names -- officers looking at the addon's voting frame
-- can see *that* someone ranks 3rd for an item, but not *why*: whether it's
-- their actual wishlist BiS pick, a lower-tier Good/OK pick that still made
-- the ranked list, or nothing they explicitly wished for at all (tier-token
-- matching and other fallback ranking signals can place a player without
-- any item_preferences row backing it). Add each ranked player's wishlist
-- status for that item, keyed by name so a rank with no matching wishlist
-- entry simply has no status to show -- additive only (new "<track>_status"
-- sibling keys alongside the existing H/M name arrays), so an addon client
-- that hasn't picked up the new field yet keeps working unchanged.
--
-- Also attaches a top-level "statusLabels" object so the addon shows each
-- team's actual configured wishlist tier names (Wishlist Tier Labels,
-- team_settings.config->'wishlistStatusLabels', officer-editable, #515
-- Phase 2) instead of hardcoding the site's own bis/good/ok defaults --
-- confirmed live that at least one team has overridden both (good ->
-- "2nd Choice", ok -> "Sidegrade"), so a hardcoded label would already be
-- wrong for that team on day one.
create or replace function public.build_rclc_export(
  p_team_id integer,
  p_season text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
stable
as $$
declare
  v_players jsonb;
  v_priority jsonb;
  v_status_labels jsonb;
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  with bis as (
    select
      p.name_realm,
      i.wow_item_id,
      ip.id,
      case coalesce(ip.slot, i.slot)
        -- BIS_SLOTS row labels (an officer-assigned position).
        when 'Head' then 'helm'
        when 'Neck' then 'neck'
        when 'Shoulder' then 'shoulders'
        when 'Back' then 'cloak'
        when 'Chest' then 'chest'
        when 'Wrist' then 'bracers'
        when 'Hands' then 'gloves'
        when 'Waist' then 'belt'
        when 'Legs' then 'legs'
        when 'Feet' then 'boots'
        when 'Finger 1' then 'ring1'
        when 'Finger 2' then 'ring2'
        when 'Trinket 1' then 'trinket1'
        when 'Trinket 2' then 'trinket2'
        when 'Weapon' then 'mh2h'
        when 'Off Hand' then 'oh'
        -- Catalog slots (an item type), reached when a preference row has no
        -- slot of its own. A type cannot say which of a paired position it
        -- fills, so default to the first rather than dropping the entry.
        when 'Finger' then 'ring1'
        when 'Trinket' then 'trinket1'
        when 'Two-Hand' then 'mh2h'
        when 'One-Hand' then 'mh2h'
        when 'Ranged' then 'mh2h'
        when 'Held In Off-hand' then 'oh'
        -- 'Curio' deliberately has no arm: a class-set trade token names no
        -- gear position, so it is not exportable as a BiS slot.
        else null
      end as slot_key
    from public.item_preferences ip
    join public.players p on p.id = ip.player_id
    join public.items i on i.id = ip.item_id
    where p.team_id = p_team_id
      and p.archived_at is null
      and ip.status = 'bis'
      and not i.is_placeholder
      and i.wow_item_id is not null
  ),
  bis_by_slot as (
    select name_realm, slot_key, jsonb_agg(wow_item_id order by id) as item_ids
    from bis
    where slot_key is not null
    group by name_realm, slot_key
  ),
  players_agg as (
    select name_realm, jsonb_object_agg(slot_key, jsonb_build_object('bis', item_ids)) as slots
    from bis_by_slot
    group by name_realm
  ),
  -- Same exclusion generate_priority_order() applies at generation time
  -- (#480): a Mythic recipient drops from every track's ranked list for that
  -- item; a Heroic recipient drops from the Heroic list only.
  recip as (
    select
      player_id,
      item_id,
      bool_or(track = 'Myth') as has_myth,
      bool_or(track = 'Hero') as has_hero
    from public.rclc_loot
    where team_id = p_team_id
      and season = p_season
      and player_id is not null
    group by player_id, item_id
  ),
  -- A rank's own player+item wishlist tier, when one actually exists --
  -- only bis/good/ok are wishlist "wants this" tiers (catalyst and pass
  -- aren't ranking signals in that sense, so left unmatched on purpose).
  -- Not every ranked player has a row here: tier-token matching and other
  -- fallback signals in generate_priority_order() can place a player with
  -- no item_preferences entry behind them at all.
  wish as (
    select player_id, item_id, status
    from public.item_preferences
    where team_id = p_team_id
      and season = p_season
      and status in ('bis', 'good', 'ok')
  ),
  prio as (
    select
      i.wow_item_id,
      po.track,
      p.name_realm,
      po.rank,
      w.status as wish_status
    from public.priority_order po
    join public.items i on i.id = po.item_id
    join public.players p on p.id = po.player_id
    left join recip r on r.player_id = po.player_id and r.item_id = po.item_id
    left join wish w on w.player_id = po.player_id and w.item_id = po.item_id
    where po.team_id = p_team_id
      and po.season = p_season
      and not coalesce(r.has_myth, false)
      and not (po.track = 'Hero' and coalesce(r.has_hero, false))
  ),
  prio_by_track as (
    select
      wow_item_id,
      case track when 'Hero' then 'H' when 'Myth' then 'M' end as track_key,
      jsonb_agg(name_realm order by rank) as names,
      coalesce(
        jsonb_object_agg(name_realm, wish_status) filter (where wish_status is not null),
        '{}'::jsonb
      ) as statuses
    from prio
    group by wow_item_id, track
  ),
  prio_agg as (
    select
      wow_item_id,
      jsonb_object_agg(track_key, names) || jsonb_object_agg(track_key || '_status', statuses) as tracks
    from prio_by_track
    group by wow_item_id
  )
  select
    coalesce((select jsonb_object_agg(name_realm, slots) from players_agg), '{}'::jsonb),
    coalesce((select jsonb_object_agg(wow_item_id::text, tracks) from prio_agg), '{}'::jsonb)
  into v_players, v_priority;

  -- WISHLIST_LABEL_DEFAULTS (js/tabs/tab-admin.js) is the site's own
  -- default for each tier -- mirrored here (bis/good/ok only, the only
  -- tiers this export attaches statuses for) so the export always hands
  -- the addon a complete label set, whether or not the team has overridden
  -- any of them.
  select jsonb_build_object('bis', 'BiS', 'good', '2nd Choice', 'ok', 'Sidegrade')
      || coalesce(
           (select ts.config -> 'wishlistStatusLabels' from public.team_settings ts where ts.team_id = p_team_id),
           '{}'::jsonb
         )
  into v_status_labels;

  return jsonb_build_object('players', v_players, 'priority', v_priority, 'statusLabels', v_status_labels);
end;
$$;

revoke all on function public.build_rclc_export(integer, text) from public;
revoke execute on function public.build_rclc_export(integer, text) from anon;
grant execute on function public.build_rclc_export(integer, text) to authenticated;
