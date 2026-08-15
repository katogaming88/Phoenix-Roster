-- A site admin browsing a team's officer.html without a team_members row
-- there (the common case -- site admins aren't expected to hold officer on
-- every team) hit RLS write rejections on any of these ten tables, e.g.
-- "new row violates row-level security policy for table
-- player_wcl_season_perf" when fetching WCL performance from a team the
-- admin hasn't personally claimed a character on. is_site_admin() was
-- already OR'd into most read-only officer-view policies (item_preferences,
-- audit_log, team_members) but was missed on these officer *write* policies
-- when each was created -- unlike is_guild_officer() (#607), which is
-- deliberately excluded from approvals/priority generation/loot import,
-- is_site_admin() carries no such scoping decision anywhere else in the
-- schema and should pass every officer-gated write, same as it already does
-- for reads.
alter policy "Officers write players" on public.players
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]) or is_guild_officer() or is_site_admin())
  with check (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]) or is_guild_officer() or is_site_admin());

alter policy "Officers write attendance" on public.attendance
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]) or is_guild_officer() or is_site_admin())
  with check (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]) or is_guild_officer() or is_site_admin());

alter policy "Officers write bis_items" on public.bis_items
  using (my_team_role((select players.team_id from players where players.id = bis_items.player_id)) = any (array['officer'::text, 'team_leader'::text]) or is_site_admin())
  with check (my_team_role((select players.team_id from players where players.id = bis_items.player_id)) = any (array['officer'::text, 'team_leader'::text]) or is_site_admin());

alter policy "Officers clear item_preferences note" on public.item_preferences
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]) or is_site_admin())
  with check (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]) or is_site_admin());

alter policy "Officers write player_wcl_season_perf" on public.player_wcl_season_perf
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]) or is_site_admin())
  with check (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]) or is_site_admin());

alter policy "Officers write priority_order" on public.priority_order
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]) or is_site_admin())
  with check (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]) or is_site_admin());

alter policy "Officer write loot" on public.rclc_loot
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]) or is_site_admin())
  with check (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]) or is_site_admin());

alter policy "Officers write scoring" on public.scoring
  using (my_team_role((select players.team_id from players where players.id = scoring.player_id)) = any (array['officer'::text, 'team_leader'::text]) or is_site_admin())
  with check (my_team_role((select players.team_id from players where players.id = scoring.player_id)) = any (array['officer'::text, 'team_leader'::text]) or is_site_admin());

alter policy "Officers write streamers" on public.streamers
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]) or is_site_admin())
  with check (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]) or is_site_admin());

alter policy "Officers write team_raid_progress" on public.team_raid_progress
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]) or is_site_admin())
  with check (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]) or is_site_admin());
