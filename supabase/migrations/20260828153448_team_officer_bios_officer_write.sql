-- Team Officer Bios save was routed through the generic set_team_setting()
-- RPC, whose underlying team_settings RLS policy ("Team leaders write
-- settings") only admits my_team_role(team_id) = 'team_leader' or
-- is_site_admin() -- deliberately, since most of what rides that path
-- (season config, signup/BiS/M+ toggles, feature flags) really is
-- team-leader-only. But the Officer Bios tab's UI never gated Save Bios the
-- same way -- any officer sees the button -- so a plain officer (e.g.
-- Grihz) hit a hard "Not authorized" trying to add their own bio, even
-- though the officer.html help text and #477's original intent both frame
-- this as an officer-facing editor, not a team-leader-only one.
--
-- Rather than loosen team_settings' write policy (which would also open up
-- season config etc. to every officer), give Team Officer Bios its own
-- SECURITY DEFINER RPC with its own gate, same shape as
-- set_guild_officer_bios (20260726002000 / 20260730113259) -- officer or
-- above, matching the "Officers write players/attendance" convention
-- (20260730113259_guild_officer_tier.sql) of officer/team_leader or
-- is_guild_officer(), plus is_site_admin() since a site admin can already
-- write team_settings directly today.
create or replace function public.set_team_officer_bios(p_team_id integer, p_bios jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config jsonb;
begin
  if not (
    coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false)
    or public.is_site_admin()
    or public.is_guild_officer()
  ) then
    raise exception 'Not authorized';
  end if;

  update public.team_settings
  set config = config || jsonb_build_object('teamOfficerBios', p_bios)
  where team_id = p_team_id
  returning config into v_config;

  if not found then
    raise exception 'Not authorized';
  end if;

  perform public.write_audit_log(
    p_team_id,
    'Team Officer Bios Saved',
    'team_settings',
    null,
    jsonb_build_object('count', jsonb_array_length(p_bios))
  );

  return v_config;
end;
$$;

revoke all on function public.set_team_officer_bios(integer, jsonb) from public;
revoke execute on function public.set_team_officer_bios(integer, jsonb) from anon;
grant execute on function public.set_team_officer_bios(integer, jsonb) to authenticated;
