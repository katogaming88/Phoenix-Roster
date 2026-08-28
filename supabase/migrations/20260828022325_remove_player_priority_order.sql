-- Removing a player from the roster (players.archived_at) only ever soft-
-- deleted the players row -- their existing priority_order rows for the
-- current season were left completely untouched. generate_priority_order()
-- already excludes archived players from *new* suggestions (p.archived_at is
-- null), but that only takes effect the next time an officer regenerates
-- that specific item+track -- every other item/track's priority_order still
-- carried the departed player's rank until someone happened to re-suggest
-- it, so a removed raider kept showing up in the officer Priority tab, the
-- RCLootCouncil export, and the addon's Full Priority Order panel
-- indefinitely.
--
-- Scoped to the given season only (not a blanket delete of every season this
-- player ever appeared in) -- past seasons' priority_order rows are a
-- historical record, same reasoning as rclc_loot/bis_items/attendance being
-- preserved across a soft-delete rather than purged (docs/database-decisions.md).
-- Only the live/current season's standing list needs to drop them right now.
--
-- No rank renumbering: every priority_order reader (build_rclc_export's
-- jsonb_agg(... order by rank), tab-priority.js's mapSupabasePriorityOrder)
-- already derives display order by sorting on rank and taking array
-- position, not by treating the stored rank as a dense 1..N sequence, so a
-- gap left behind by the deleted row is harmless.
create or replace function public.remove_player_priority_order(
  p_team_id integer,
  p_season text,
  p_player_id integer
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  delete from public.priority_order
   where team_id = p_team_id
     and season = p_season
     and player_id = p_player_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.remove_player_priority_order(integer, text, integer) from public;
revoke execute on function public.remove_player_priority_order(integer, text, integer) from anon;
grant execute on function public.remove_player_priority_order(integer, text, integer) to authenticated;
