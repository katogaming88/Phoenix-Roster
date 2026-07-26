-- Guild Officer Bios must be guild-wide, not per-team (#586 follow-up).
--
-- Storing them in team_settings.config.guildOfficerBios meant a bio saved
-- on one team's site never showed up on another team's -- that jsonb
-- column is scoped per team_id, but the guild's officers are the same
-- people regardless of which team's site you're viewing. Moves to
-- site_settings (#245's genuinely guild-wide singleton table, id=1) instead,
-- mirroring maintenance_mode's exact shape: a typed column, public read
-- (RLS "Public read site_settings" already covers any column on that row,
-- and the base anon/authenticated SELECT grant already exists -- confirmed
-- working today via checkMaintenanceMode()), and the only write path is a
-- SECURITY DEFINER RPC.
--
-- Gated by is_site_admin(), not my_team_role(team_id) = 'team_leader' --
-- a team's own leader has no natural authority over guild-wide content;
-- only a site admin should be able to edit this.

alter table public.site_settings
  add column if not exists guild_officer_bios jsonb not null default '[]'::jsonb;

-- Backfill: whichever team currently has a non-empty guildOfficerBios wins
-- (there should be at most one with real data so far). Then strip the now-
-- dead key from every team's config so it doesn't linger as confusing dead
-- data alongside the new site-wide column.
update public.site_settings
set guild_officer_bios = coalesce(
  (
    select ts.config -> 'guildOfficerBios'
    from public.team_settings ts
    where jsonb_array_length(coalesce(ts.config -> 'guildOfficerBios', '[]'::jsonb)) > 0
    limit 1
  ),
  '[]'::jsonb
)
where id = 1;

update public.team_settings
set config = config - 'guildOfficerBios'
where config ? 'guildOfficerBios';

create or replace function public.set_guild_officer_bios(p_bios jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bios jsonb;
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  update public.site_settings
  set guild_officer_bios = p_bios, updated_at = now()
  where id = 1
  returning guild_officer_bios into v_bios;

  perform public.write_audit_log(
    null,
    'Guild Officer Bios Saved',
    'site_settings',
    null,
    jsonb_build_object('count', jsonb_array_length(p_bios))
  );

  return v_bios;
end;
$$;

revoke all on function public.set_guild_officer_bios(jsonb) from public;
revoke execute on function public.set_guild_officer_bios(jsonb) from anon;
grant execute on function public.set_guild_officer_bios(jsonb) to authenticated;
