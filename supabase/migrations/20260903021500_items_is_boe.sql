-- The season BoE catalog lives in items under a flag (#875). boe_items.item_id
-- already points at items, submit_boe_found already resolves the name there,
-- and the frontend already loads the table, so a BoE is an items row with
-- is_boe set. The catalog rows themselves are a generated data file
-- (scripts/fetch-boe-items.js -> data/sql/boe-catalog.sql), not this
-- migration: seed.sql inserts items ids 1 to 3 explicitly after migrations
-- run, so sequence-assigned rows here would collide at every db reset.
-- buildItemMaps() in js/common.js skips flagged rows for every existing map,
-- which is what keeps BoEs out of BiS, wishlists and the Priority tab.

alter table public.items add column if not exists is_boe boolean not null default false;

-- submit_boe_found links a find to a catalog BoE only, case-insensitively
-- (items_lower_name_key is unique on lower(name)), and stores the catalog's
-- spelling, so the server agrees with both clients when the items read has
-- not resolved. A same-named boss drop no longer links: a find is a BoE.
-- Same signature, so the existing grants stand.
create or replace function public.submit_boe_found(
  p_team_id integer,
  p_name_realm text,
  p_item_name text,
  p_track text default null,
  p_note text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id integer;
  v_item_id integer;
  v_item_name text;
  v_season text;
  v_id integer;
begin
  if trim(coalesce(p_name_realm, '')) = '' then
    raise exception 'Character name is required';
  end if;
  if trim(coalesce(p_item_name, '')) = '' then
    raise exception 'Item name is required';
  end if;
  if p_track is not null and p_track <> all (array['Champion', 'Hero', 'Myth']) then
    raise exception 'Unknown track: %', p_track;
  end if;

  select p.id into v_player_id
  from public.players p
  where p.team_id = p_team_id and p.name_realm = trim(p_name_realm) and p.archived_at is null;

  select i.id, i.name into v_item_id, v_item_name
  from public.items i
  where i.is_boe and lower(i.name) = lower(trim(p_item_name));

  select ts.config ->> 'seasonName' into v_season
  from public.team_settings ts where ts.team_id = p_team_id;

  insert into public.boe_items (team_id, player_id, finder_name, item_id, item_name, track, season, note)
  values (p_team_id, v_player_id, trim(p_name_realm), v_item_id, coalesce(v_item_name, trim(p_item_name)), p_track,
          v_season, nullif(trim(coalesce(p_note, '')), ''))
  returning boe_items.id into v_id;

  return v_id;
end $$;
