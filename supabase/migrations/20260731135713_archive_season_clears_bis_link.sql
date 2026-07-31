-- archive_current_season() already wipes real-item bis_items rows and
-- resets m_plus_excluded/is_bench on "Start New Season" (see
-- 20260714173649_archive_season_resets_bis_mplus_bench.sql), but never
-- touched players.bis_link at all. A BiS link points at a sim/list for a
-- specific tier's loot table -- nothing about the site behind it is
-- guaranteed to still be valid next tier (a Wowhead "current tier" guide
-- page might update in place under the same URL, but a personal sim export
-- or a version-pinned guide won't), so it's cleared unconditionally on
-- archive rather than left for a raider to notice it's stale on their own.
--
-- Not added to the historical bis_items snapshot (v_bis_snapshot) below --
-- that snapshot is bis_items rows only, and the ask here is "clear it going
-- forward," not "also start preserving a historical record of it." Left
-- entirely alone: bis_requests (the submission/approval queue), same as the
-- rest of that table's existing precedent of staying intact independent of
-- season resets.

create or replace function public.archive_current_season(
  p_team_id integer,
  p_roster_snapshot jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_config jsonb;
  v_entry jsonb;
  v_bis_snapshot jsonb;
begin
  select config into v_config from public.team_settings where team_id = p_team_id for update;
  if v_config is null then
    raise exception 'Not authorized';
  end if;
  if coalesce(v_config->>'seasonName', '') = '' then
    raise exception 'No active season to archive';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'nameRealm', p.name_realm,
        'item', i.name,
        'slot', coalesce(bi.slot, i.slot),
        'obtained', bi.obtained,
        'isPlaceholder', i.is_placeholder
      )
      order by p.name_realm, i.name
    ),
    '[]'::jsonb
  )
  into v_bis_snapshot
  from public.bis_items bi
  join public.players p on p.id = bi.player_id
  join public.items i on i.id = bi.item_id
  where p.team_id = p_team_id
    and p.archived_at is null;

  v_entry := jsonb_build_object(
    'name', coalesce(v_config->'seasonName', '""'::jsonb),
    'start', coalesce(v_config->'seasonStart', '""'::jsonb),
    'end', coalesce(v_config->'seasonEnd', '""'::jsonb),
    'raids', coalesce(v_config->'raidProgression', '[]'::jsonb),
    'roster', coalesce(p_roster_snapshot, '[]'::jsonb),
    'bis', v_bis_snapshot
  );

  update public.team_settings
  set config = config || jsonb_build_object(
    'seasonName', '""'::jsonb,
    'seasonStart', '""'::jsonb,
    'seasonEnd', '""'::jsonb,
    'raidProgression', '[]'::jsonb,
    'seasonHistory', coalesce(v_config->'seasonHistory', '[]'::jsonb) || jsonb_build_array(v_entry)
  )
  where team_id = p_team_id
  returning config into v_config;

  if not found then
    raise exception 'Not authorized';
  end if;

  delete from public.bis_items bi
  using public.players p, public.items i
  where bi.player_id = p.id
    and bi.item_id = i.id
    and p.team_id = p_team_id
    and p.archived_at is null
    and not i.is_placeholder;

  update public.players
  set m_plus_excluded = false, m_plus_note = null
  where team_id = p_team_id
    and archived_at is null
    and m_plus_excluded = true;

  update public.players
  set is_bench = false
  where team_id = p_team_id
    and archived_at is null
    and is_bench = true;

  -- A new tier's loot table invalidates whatever the link was pointing at.
  update public.players
  set bis_link = null
  where team_id = p_team_id
    and archived_at is null
    and bis_link is not null;

  return v_config;
end;
$$;

revoke all on function public.archive_current_season(integer, jsonb) from public;
revoke execute on function public.archive_current_season(integer, jsonb) from anon;
grant execute on function public.archive_current_season(integer, jsonb) to authenticated;
