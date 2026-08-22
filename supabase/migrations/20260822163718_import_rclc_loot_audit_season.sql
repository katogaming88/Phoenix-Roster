-- The Loot Import tab's history view groups audit_log's 'Loot Imported
-- (RCLC)' entries into one row per import event (paste), and needs to
-- season-scope that list -- but audit_log carries no season column of its
-- own, and rclc_loot's season (the value this same call already writes) has
-- no reference back to which import wrote it, so it can't be joined after
-- the fact. import_rclc_loot() already has the season as p_season for every
-- row it processes; this just carries it into the audit detail alongside
-- the existing human-readable summary instead of writing a bare string.
--
-- Detail changes shape (plain string -> {summary, season} object) for every
-- new import from here on; rows written before this migration keep their
-- old plain-string detail and have no season to filter by -- the history
-- view treats those as "legacy / unknown season" rather than trying to
-- retroactively guess one, since there's no reliable way to match an
-- existing audit_log row back to the specific rclc_loot row it came from.
--
-- Based on 20260819200706's body (realm-space-match player lookup, itself
-- based on 20260806214054's flex-track word-boundary parser) -- only the
-- write_audit_log() detail argument changes here.
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
  v_instance text;
  v_awarded_at timestamptz;
  v_rclc_id text;
  v_dedupe_key text;
  v_boss text;
  v_new_id integer;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_unresolved_item integer := 0;
  v_detail text;
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

    -- Track: search anywhere in the instance string for a standalone
    -- difficulty word (e.g. "The Dreamrift-Mythic" -> Myth, "Sporefall-Mythic
    -- - Flexible Raiding" -> Myth too) rather than assuming a fixed
    -- "<Name>-<Difficulty>" shape (20260806214054). The RCLC itemString
    -- technically encodes the true track in its bonus IDs, but decoding
    -- those needs a maintained Blizzard bonus-ID reference table this repo
    -- doesn't have -- deferred, not attempted here.
    v_instance := coalesce(v_row->>'instance', '');
    v_track := case
      when v_instance ~* '\mmythic\M' then 'Myth'
      when v_instance ~* '\mheroic\M' then 'Hero'
      when v_instance ~* '\mnormal\M' then 'Champion'
      else null
    end;

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
    v_dedupe_key := 't' || p_team_id || ':rclc:' || v_rclc_id;

    insert into public.rclc_loot
      (team_id, player_id, item_id, track, season, awarded_at, rclc_id, dedupe_key, boss)
    values
      (p_team_id, v_player_id, v_item_id, v_track, nullif(p_season, ''), v_awarded_at, v_rclc_id, v_dedupe_key, v_boss)
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
