-- archive_current_season() excluded placeholder (M+/Crafted/Catalyst "Other
-- Sources") bis_items rows from the season-end wipe, only clearing real
-- item picks. Per Kat: every BiS list/wishlist is per-season, and what a
-- raider wants from M+ or has crafted can change slot/target entirely next
-- tier, so there's no reason to carry those forward either -- wipe the whole
-- bis_items table for the active roster, not just the real-item subset.
-- The season-history snapshot (v_bis_snapshot below) was never filtered by
-- is_placeholder in the first place -- it already records placeholders
-- (tagged via the isPlaceholder field) alongside real items, so nothing
-- changes there.
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

  -- Wipes every bis_items row for the active roster, placeholders included
  -- (was `and not i.is_placeholder` -- see comment at top of file).
  delete from public.bis_items bi
  using public.players p
  where bi.player_id = p.id
    and p.team_id = p_team_id
    and p.archived_at is null;

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
