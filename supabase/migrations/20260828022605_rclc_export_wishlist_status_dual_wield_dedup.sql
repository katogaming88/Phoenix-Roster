-- 20260828021126's "wish" CTE fix (drop the season filter) exposed a second
-- bug in the same CTE: item_preferences legitimately carries *two* rows for
-- the same player+item on a dual-wieldable weapon -- one for the Weapon
-- slot, one for Off Hand -- so a dual-wielder can BiS two copies of the same
-- item (the item_preferences.slot dedup rule: Trinket1/2 and Finger1/2
-- collapse to one BiS pick since they're unique-equip, but Weapon/OffHand
-- deliberately do not). "wish" selected every matching row unfiltered, so a
-- player with e.g. a 'bis' Weapon row and a 'good' Off Hand row for the same
-- item joined into "prio" *twice* -- confirmed live against item 351
-- (Jan'thrazet, a dagger): Bearsdh/Twañ/Raintotem/Bbldrizzy/Luminouss all
-- have exactly this shape. That duplicated their name_realm in the H/M
-- ranked arrays (reported live: "Bearsdh" appearing twice in the addon's
-- Full Priority Order panel) and made jsonb_object_agg(name_realm,
-- wish_status) pick whichever of the two rows happened to aggregate last --
-- unspecified group-by row order, so several players showed "2nd Choice"
-- despite actually holding a 'bis' row too (also reported live).
--
-- Fix: dedupe "wish" to one row per player+item before joining, keeping only
-- the higher-priority status when a player has more than one -- the exact
-- same bis > good > catalyst > ok > pass precedence and
-- array_agg(... order by case ...)[1] technique generate_priority_order()'s
-- own "wishlist" CTE already uses for this (20260817135343 and earlier).
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
  -- no item_preferences entry behind them at all. No season filter --
  -- item_preferences.season is stamped with the display-name format, not
  -- p_season's short code, and generate_priority_order() itself doesn't
  -- filter by season either; item_id + team_id is the correct scope.
  -- Deduped to one row per player+item -- a dual-wieldable weapon can have
  -- separate Weapon/Off Hand preference rows for the same item_id, and only
  -- the single best-tier status should ever reach the export.
  wish as (
    select
      player_id,
      item_id,
      (array_agg(status order by
        case status
          when 'bis' then 1
          when 'good' then 2
          when 'ok' then 3
        end
      ))[1] as status
    from public.item_preferences
    where team_id = p_team_id
      and status in ('bis', 'good', 'ok')
    group by player_id, item_id
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
