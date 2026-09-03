-- #865: the upgrade rank on a BoE find.
--
-- Two finds of the same item on the same track are one first-come-first-served
-- queue only at the same rank; a different rank is a different item. The rank
-- is what raiders read off the tooltip ("2/6"). Decided 2026-09-03: it is a
-- six-option select on the raider form (1/6 to 6/6), required together with
-- the track, and there is no item level column, because a track at a rank is
-- one item level within a season and the row already snapshots the season.
--
-- The column check is the shape, not the six values: the 61 rows imported
-- from the sheets carry null, the manager's edit form keeps a blank option
-- for them, and a season whose track goes to another denominator changes the
-- option lists and the RPC's array, not the schema.

alter table public.boe_items
  add column upgrade_rank text,
  add constraint boe_items_upgrade_rank_shape check (upgrade_rank ~ '^[0-9]{1,2}/[0-9]{1,2}$');

comment on column public.boe_items.upgrade_rank is
  'Upgrade rank as the tooltip shows it ("2/6"); with the track it is the identity of the item in the queue (#865). Null on rows imported from the sheets.';

-- The trigger admits the rank on a plain UPDATE, next to the other metadata
-- columns the manager's edit form writes.
create or replace function public.check_boe_status_transition() returns trigger
language plpgsql
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if (to_jsonb(new) - 'note' - 'finder_name' - 'player_id' - 'item_id' - 'item_name' - 'track' - 'upgrade_rank' - 'season' - 'updated_at')
     is distinct from
     (to_jsonb(old) - 'note' - 'finder_name' - 'player_id' - 'item_id' - 'item_name' - 'track' - 'upgrade_rank' - 'season' - 'updated_at') then
    raise exception 'Direct updates may only edit note, finder, item, track, rank, or season; lifecycle changes go through the BoE RPCs';
  end if;
  return new;
end $$;

alter function public.check_boe_status_transition() owner to postgres;

-- submit_boe_found gains p_upgrade_rank and now requires a track and a rank.
-- The argument keeps a default so the existing positional calls still parse;
-- the raise is what enforces it. The form checks all of this first with its
-- own wording, so these catch a stale cached client. Check order matters to
-- the callers: name, item, track, the unknown-track raise, then the rank.
drop function if exists public.submit_boe_found(integer, text, text, text, text, boolean);

create function public.submit_boe_found(
  p_team_id integer,
  p_name_realm text,
  p_item_name text,
  p_track text default null,
  p_note text default null,
  p_donate boolean default false,
  p_upgrade_rank text default null
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
  v_rank text;
  v_id integer;
begin
  if trim(coalesce(p_name_realm, '')) = '' then
    raise exception 'Character name is required';
  end if;
  if trim(coalesce(p_item_name, '')) = '' then
    raise exception 'Item name is required';
  end if;
  if p_track is null then
    raise exception 'Track is required';
  end if;
  if p_track <> all (array['Champion', 'Hero', 'Myth']) then
    raise exception 'Unknown track: %', p_track;
  end if;
  v_rank := nullif(regexp_replace(coalesce(p_upgrade_rank, ''), '\s', '', 'g'), '');
  if v_rank is null then
    raise exception 'Upgrade rank is required';
  end if;
  if v_rank <> all (array['1/6', '2/6', '3/6', '4/6', '5/6', '6/6']) then
    raise exception 'Upgrade rank must be one of 1/6 to 6/6';
  end if;

  select p.id into v_player_id
  from public.players p
  where p.team_id = p_team_id and p.name_realm = trim(p_name_realm) and p.archived_at is null;

  select i.id, i.name into v_item_id, v_item_name
  from public.items i
  where i.is_boe and lower(i.name) = lower(trim(p_item_name));

  select ts.config ->> 'seasonName' into v_season
  from public.team_settings ts where ts.team_id = p_team_id;

  insert into public.boe_items (team_id, player_id, finder_name, item_id, item_name, track, upgrade_rank, season, note, payout_donated)
  values (p_team_id, v_player_id, trim(p_name_realm), v_item_id, coalesce(v_item_name, trim(p_item_name)), p_track, v_rank,
          v_season, nullif(trim(coalesce(p_note, '')), ''), coalesce(p_donate, false))
  returning boe_items.id into v_id;

  return v_id;
end $$;

revoke all on function public.submit_boe_found(integer, text, text, text, text, boolean, text) from public;
grant execute on function public.submit_boe_found(integer, text, text, text, text, boolean, text) to anon, authenticated;

-- Backfill: the six imported rows whose Form submission carried a rank or a
-- level, read from the original export on 2026-09-03. Keyed on
-- (team_id, found_at) rather than id, since prod ids were not assigned in
-- import-file order; for the record the prod ids were 17, 22, 7, 16 and 40
-- for the ranks and 56 for the level. On the two Wrathless rows the whole
-- note was the rank, so it moves into the column. The one row that carried
-- "(Mythic 279)" and no rank keeps the number in its note, since there is no
-- level column. Runs as postgres, so the trigger's authenticated-only check
-- does not fire. Idempotent through the guards.
do $$
declare
  v_count integer := 0;
  v_n integer;
begin
  update public.boe_items b
  set upgrade_rank = r.rank,
      note = case when b.note = r.rank then null else b.note end
  from (values
    (1, '2026-04-14 02:10:23+00'::timestamptz, '3/6'),
    (3, '2026-05-01 02:42:02+00'::timestamptz, '4/6'),
    (4, '2026-09-01 01:40:34+00'::timestamptz, '2/6'),
    (4, '2026-09-01 01:41:09+00'::timestamptz, '3/6'),
    (1, '2026-09-02 03:14:48+00'::timestamptz, '2/6')
  ) as r(team_id, found_at, rank)
  where b.team_id = r.team_id and b.found_at = r.found_at and b.upgrade_rank is null;
  get diagnostics v_n = row_count;
  v_count := v_count + v_n;

  update public.boe_items b
  set note = concat_ws('; ', b.note, 'ilvl 279')
  where b.team_id = 2
    and b.found_at = '2026-05-01 04:07:05+00'::timestamptz
    and coalesce(b.note, '') not like '%ilvl 279%';
  get diagnostics v_n = row_count;
  v_count := v_count + v_n;

  raise notice 'Backfilled % boe_items rows', v_count;
end $$;
