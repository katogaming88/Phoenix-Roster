-- build_rclc_export() returned both Hero and Myth ranked lists for every
-- item in one JSON blob -- live-measured at ~68.5k raw JSON chars / ~91k
-- base64 chars for team 1's full roster+season (Kat, 2026-09-02). Pasting
-- that into the RCLootCouncil_PriorityLoot addon's import box stalls the
-- WoW client for several seconds, close to a disconnect -- confirmed this
-- is independent of the addon's EditBox being single- or multi-line (#853,
-- #857's follow-up investigation): the string itself is just too large for
-- WoW's native paste handling, not a wrap-layout issue.
--
-- Fix (Kat's call): split the export by track instead of shrinking/chunking
-- it another way. p_track ('Hero' or 'Myth') scopes the priority half of
-- the payload to that track only, roughly halving each string. players
-- (BiS data) and statusLabels aren't track-specific and stay whole in both
-- halves -- they're small (one entry per player's BiS picks, not per-item
-- ranked lists) and the addon needs them regardless of which track was
-- imported last.
--
-- Addon-side counterpart: RCPL_Data_SaveImportedData() no longer wipes
-- RCPL_DB.priority/players on every import -- it merges per-item track
-- keys instead, so importing Hero then Myth (or vice versa, or re-
-- importing just one track later) accumulates into one complete dataset
-- rather than each import overwriting the other's data. See
-- RCLootCouncil_PriorityLoot's Data/db.lua.
create or replace function public.build_rclc_export(
  p_team_id integer,
  p_season text,
  p_track text
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
  v_track_key text;
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if p_track not in ('Hero', 'Myth') then
    raise exception 'Invalid track';
  end if;
  v_track_key := case p_track when 'Hero' then 'H' when 'Myth' then 'M' end;

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
      and po.track = p_track
      and not coalesce(r.has_myth, false)
      and not (po.track = 'Hero' and coalesce(r.has_hero, false))
  ),
  prio_agg as (
    select
      wow_item_id,
      jsonb_build_object(v_track_key, jsonb_agg(name_realm order by rank))
      || jsonb_build_object(
           v_track_key || '_status',
           coalesce(
             jsonb_object_agg(name_realm, wish_status) filter (where wish_status is not null),
             '{}'::jsonb
           )
         ) as tracks
    from prio
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

-- Old 2-arg signature is dropped, not kept as an overload -- both known
-- callers (js/tabs/tab-priority.js, js/officer-quick-actions.js) are
-- updated in this same change to always pass p_track, and a stray caller
-- silently getting a half-empty export (whichever track happened to be
-- default) would be worse than a clean break.
drop function if exists public.build_rclc_export(integer, text);

revoke all on function public.build_rclc_export(integer, text, text) from public;
revoke execute on function public.build_rclc_export(integer, text, text) from anon;
grant execute on function public.build_rclc_export(integer, text, text) to authenticated;
