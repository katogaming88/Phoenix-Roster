-- import_rclc_loot(): derive track from the item's own bonus IDs (embedded
-- permanently at generation, immune to whatever RCLC's ambient encounter
-- state was when the item got handed out) instead of only string-matching
-- the free-text instance field. Caught live (#822 follow-up conversation):
-- an officer killed Ula'tek on Normal, then moved on to a Heroic pull of a
-- different boss before finally passing out the Ula'tek trinket in RCLC's
-- UI -- RCLC stamped the award's instance/boss with whatever it was
-- currently tracking (the later Heroic pull), not the actual Normal kill
-- the item dropped from. The instance string is prose captured at whatever
-- moment RCLC finalizes the award, so it can drift; the bonus IDs baked
-- into the item can't.
--
-- Bonus IDs confirmed empirically against Wowhead for this tier (Midnight
-- Season 2, "Font of Venomous Rage" trinket, one rank block per track):
--   Champion 1/6-6/6: 12833-12838
--   Hero     1/6-6/6: 12841-12846
--   Myth     1/6-6/6: 12849-12854
--   Myth 9/6 (last two Mythic bosses' special drops): 13848
-- These are season-specific -- Blizzard reassigns a fresh block of bonus
-- IDs each tier, same as tier_token_map needing a manual re-seed each
-- season (docs/database-decisions.md). Update this ranges block when MID3
-- ships; until then, a row whose bonus IDs don't match any of them (an
-- older export with no itemString, or gear from a source outside this
-- season's raid) falls back to the pre-existing instance-string parse.
--
-- Position of the bonus ID list within itemString is fixed by Blizzard's
-- item-link format, not season-specific: "item:itemID:enchant:gem1-4:
-- suffix:unique:linkLevel:specializationId:upgradeTypeId:numBonusIds:
-- bonusId1:...:bonusIdN:...". Splitting the full string (with its "item:"
-- prefix) on ':' puts numBonusIds at position 14 and the bonus IDs
-- starting at position 15, regardless of item type/slot -- confirmed
-- against three real Season MID2 export entries of different item types.
create or replace function public.import_rclc_loot(
  p_team_id integer,
  p_season text,
  p_rows jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row jsonb;
  v_name_realm text;
  v_player_id integer;
  v_item_id integer;
  v_track text;
  v_track_from_bonus text;
  v_instance text;
  v_item_string text;
  v_string_parts text[];
  v_num_bonus integer;
  v_bonus_ids integer[];
  v_awarded_at timestamptz;
  v_rclc_id text;
  v_dedupe_key text;
  v_boss text;
  v_response text;
  v_new_id integer;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_unresolved_item integer := 0;
  v_detail text;
  -- Season MID2 raid gear track bonus IDs -- see migration header comment.
  c_champion_bonus_ids constant integer[] := array[12833,12834,12835,12836,12837,12838];
  c_hero_bonus_ids constant integer[] := array[12841,12842,12843,12844,12845,12846];
  c_myth_bonus_ids constant integer[] := array[12849,12850,12851,12852,12853,12854,13848];
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_name_realm := trim(both from coalesce(v_row->>'player', ''));
    v_rclc_id := nullif(trim(both from coalesce(v_row->>'id', '')), '');
    if v_name_realm = '' or v_rclc_id is null then
      continue;
    end if;

    -- Player: name_realm match, ignoring case and whitespace. RCLC's
    -- UnitName()-sourced realm strips spaces from multi-word realms
    -- ("Wyrmrest Accord" -> "WyrmrestAccord"); the DB's officer-typed
    -- name_realm keeps them. Comparing with spaces stripped from both sides
    -- makes either shape resolve to the same row. Unknown names still get
    -- an archived stub (same shape as the #320 import's stub rows), never
    -- a null player_id.
    select id into v_player_id from public.players
     where team_id = p_team_id
       and lower(replace(name_realm, ' ', '')) = lower(replace(v_name_realm, ' ', ''));
    if v_player_id is null then
      insert into public.players (team_id, name_realm, archived_at)
      values (p_team_id, v_name_realm, now())
      returning id into v_player_id;
    end if;

    -- Item: wow_item_id first (RCLC provides itemID directly and it's
    -- unambiguous), item name as fallback. Left null, not auto-created, when
    -- neither resolves -- a genuinely unresolved item means the season's Item
    -- Lookup needs updating, not something to paper over with a placeholder
    -- row (see docs/database-decisions.md).
    v_item_id := null;
    if (v_row->>'itemID') is not null and (v_row->>'itemID') ~ '^\d+$' then
      select id into v_item_id from public.items
       where wow_item_id = (v_row->>'itemID')::integer
       order by id limit 1;
    end if;
    if v_item_id is null and coalesce(v_row->>'itemName', '') <> '' then
      select id into v_item_id from public.items
       where lower(name) = lower(v_row->>'itemName')
       limit 1;
    end if;
    if v_item_id is null then
      v_unresolved_item := v_unresolved_item + 1;
    end if;

    -- Track, preferred source: the item's own bonus IDs (see header
    -- comment). v_bonus_ids/v_num_bonus reset every row -- a plpgsql
    -- variable keeps its value across loop iterations if not reassigned,
    -- and a row with no itemString must not inherit the previous row's.
    v_track_from_bonus := null;
    v_bonus_ids := null;
    v_item_string := coalesce(v_row->>'itemString', '');
    if v_item_string <> '' then
      v_string_parts := string_to_array(v_item_string, ':');
      if array_length(v_string_parts, 1) >= 14 then
        v_num_bonus := nullif(v_string_parts[14], '')::integer;
        if v_num_bonus is not null and v_num_bonus > 0
           and array_length(v_string_parts, 1) >= 14 + v_num_bonus then
          select array_agg(x::integer) into v_bonus_ids
            from unnest(v_string_parts[15 : 14 + v_num_bonus]) x
           where x ~ '^\d+$';
        end if;
      end if;
    end if;
    if v_bonus_ids is not null then
      v_track_from_bonus := case
        when v_bonus_ids && c_champion_bonus_ids then 'Champion'
        when v_bonus_ids && c_hero_bonus_ids then 'Hero'
        when v_bonus_ids && c_myth_bonus_ids then 'Myth'
        else null
      end;
    end if;

    -- Track, fallback source: search anywhere in the instance string for a
    -- standalone difficulty word (e.g. "The Dreamrift-Mythic" -> Myth,
    -- "Sporefall-Mythic - Flexible Raiding" -> Myth too) rather than
    -- assuming a fixed "<Name>-<Difficulty>" shape (20260806214054). Only
    -- used when the bonus IDs above didn't resolve a track -- prose can
    -- drift (see header comment), the item's own bonus IDs can't.
    v_instance := coalesce(v_row->>'instance', '');
    v_track := coalesce(v_track_from_bonus, case
      when v_instance ~* '\mmythic\M' then 'Myth'
      when v_instance ~* '\mheroic\M' then 'Hero'
      when v_instance ~* '\mnormal\M' then 'Champion'
      else null
    end);

    -- awarded_at: RCLC's date/time are the raid's local wall-clock time, same
    -- assumption the rest of the site already makes for this data (see
    -- mapSupabaseLoot()'s America/New_York formatting in js/common.js).
    -- Falls back to the import moment if either field is unparseable rather
    -- than failing the whole row.
    begin
      v_awarded_at := (
        to_date(replace(coalesce(v_row->>'date', ''), '/', '-'), 'YYYY-MM-DD')
        + coalesce(nullif(v_row->>'time', '')::interval, interval '0')
      ) at time zone 'America/New_York';
    exception when others then
      v_awarded_at := now();
    end;

    v_boss := nullif(trim(both from coalesce(v_row->>'boss', '')), '');
    v_response := nullif(trim(both from coalesce(v_row->>'response', '')), '');
    v_dedupe_key := 't' || p_team_id || ':rclc:' || v_rclc_id;

    insert into public.rclc_loot
      (team_id, player_id, item_id, track, season, awarded_at, rclc_id, dedupe_key, boss, response)
    values
      (p_team_id, v_player_id, v_item_id, v_track, nullif(p_season, ''), v_awarded_at, v_rclc_id, v_dedupe_key, v_boss, v_response)
    on conflict (dedupe_key) do nothing
    returning id into v_new_id;

    if v_new_id is not null then
      v_inserted := v_inserted + 1;
      v_detail := coalesce(v_track || ' - ', '') || coalesce(nullif(v_row->>'itemName', ''), 'Unknown item');
      perform public.write_audit_log(
        p_team_id, 'Loot Imported (RCLC)', 'players', v_player_id,
        jsonb_build_object('summary', v_detail, 'season', nullif(p_season, ''))
      );
    else
      v_skipped := v_skipped + 1;
    end if;
    v_new_id := null;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted,
    'skipped_duplicate', v_skipped,
    'unresolved_item', v_unresolved_item
  );
end;
$$;
