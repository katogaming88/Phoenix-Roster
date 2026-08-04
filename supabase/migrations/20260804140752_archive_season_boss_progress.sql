-- Preserves each boss's Mythic pull count / best % into seasonHistory at
-- archive time, not just the kill date. The data already lives durably in
-- team_raid_progress (kept fresh by the wcl-progression-sync cron Edge
-- Function, see supabase/functions/wcl-progression-sync/index.ts) --
-- archive_current_season() previously copied team_settings.config's
-- raidProgression (officer-curated name/mythicDate/wclEncounterId per boss)
-- straight into seasonHistory without ever joining it, so an unkilled
-- boss's progress at season end was lost the moment a new season started
-- and raidProgression got reset. This is a snapshot at archive time, not a
-- running history -- a boss pulled again between the last wcl-progression-sync
-- run and archiving won't reflect those last pulls.
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
  v_raids_enriched jsonb;
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

  -- Rebuilds raidProgression's raid array, folding each boss's current
  -- team_raid_progress row (mythic_pulls, mythic_best_pct) into its object.
  -- `with ordinality` on both levels preserves the original raid/boss array
  -- order -- jsonb_agg has no inherent ordering of its own otherwise.
  select coalesce(
    jsonb_agg(
      raid_obj || jsonb_build_object(
        'bosses', (
          select coalesce(
            jsonb_agg(
              boss_obj || jsonb_build_object(
                'mythicPulls', trp.mythic_pulls,
                'mythicBestPct', trp.mythic_best_pct
              )
              order by boss_ord
            ),
            '[]'::jsonb
          )
          from jsonb_array_elements(raid_obj->'bosses') with ordinality as b(boss_obj, boss_ord)
          -- raid_encounters is only unique on (zone_id, wcl_encounter_id), not
          -- wcl_encounter_id alone -- resolved as a LIMIT 1 scalar subquery
          -- (not a join) so a theoretical cross-zone id collision can never
          -- fan this aggregation out into duplicate boss rows.
          left join public.team_raid_progress trp
            on trp.team_id = p_team_id
            and trp.encounter_id = (
              select re.id
              from public.raid_encounters re
              join public.raid_zones rz on rz.id = re.zone_id
              where rz.wcl_zone_id = (raid_obj->>'wclZoneId')::integer
                and re.wcl_encounter_id = (boss_obj->>'wclEncounterId')::integer
              limit 1
            )
        )
      )
      order by raid_ord
    ),
    '[]'::jsonb
  )
  into v_raids_enriched
  from jsonb_array_elements(coalesce(v_config->'raidProgression', '[]'::jsonb)) with ordinality as r(raid_obj, raid_ord);

  v_entry := jsonb_build_object(
    'name', coalesce(v_config->'seasonName', '""'::jsonb),
    'start', coalesce(v_config->'seasonStart', '""'::jsonb),
    'end', coalesce(v_config->'seasonEnd', '""'::jsonb),
    'raids', v_raids_enriched,
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
