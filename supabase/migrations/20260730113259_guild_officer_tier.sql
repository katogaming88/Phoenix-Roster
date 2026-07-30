-- Guild Officer access tier (#607): a standalone, manually-granted
-- guild-wide role for people with real cross-team authority (e.g. a Guild
-- Master) who don't necessarily hold officer/team_leader on any one team's
-- roster. Structurally identical to site_admins -- a separate membership
-- table, not a team_members role value or anything derived from one -- but
-- narrower in scope: full write on players/attendance/guild officer bios,
-- read-only on audit_log/team_members, and deliberately excluded from
-- approvals, season settings, priority generation, and loot import (those
-- policies are untouched by this migration on purpose).

create table if not exists public.guild_officers (
    id integer not null,
    discord_id text not null,
    auth_user_id uuid
);

alter table public.guild_officers owner to postgres;

create sequence if not exists public.guild_officers_id_seq
    as integer
    start with 1
    increment by 1
    no minvalue
    no maxvalue
    cache 1;

alter sequence public.guild_officers_id_seq owner to postgres;
alter sequence public.guild_officers_id_seq owned by public.guild_officers.id;
alter table only public.guild_officers alter column id set default nextval('public.guild_officers_id_seq'::regclass);

alter table only public.guild_officers
    add constraint guild_officers_pkey primary key (id);

alter table only public.guild_officers
    add constraint guild_officers_discord_id_key unique (discord_id);

alter table only public.guild_officers
    add constraint guild_officers_auth_user_id_fkey foreign key (auth_user_id) references auth.users(id) on delete set null;

alter table public.guild_officers enable row level security;

create policy "Claude readers read guild_officers" on public.guild_officers for select to claude_readers using (true);
create policy "Site Admins read guild_officers" on public.guild_officers for select using (public.is_site_admin());
create policy "Site Admins write guild_officers" on public.guild_officers using (public.is_site_admin()) with check (public.is_site_admin());

grant references, trigger, truncate, maintain on table public.guild_officers to anon;
grant references, trigger, truncate, maintain on table public.guild_officers to authenticated;
grant references, trigger, truncate, maintain on table public.guild_officers to service_role;
grant select on table public.guild_officers to claude_readers;

-- is_guild_officer(): guild-wide, no team_id param -- true when auth.uid()
-- appears in guild_officers, same shape as is_site_admin().
create or replace function public.is_guild_officer() returns boolean
    language sql stable security definer set search_path to 'public'
    as $$ select exists (select 1 from guild_officers where auth_user_id = auth.uid()); $$;

-- Row-security rules on players/attendance/audit_log/team_members now call
-- is_guild_officer(), and those policies are also evaluated for the anon
-- role (public read). Without EXECUTE granted to anon too, evaluating the
-- policy for an anon caller errors "permission denied for function
-- is_guild_officer" instead of just resolving false -- same class of bug
-- 20260706193110_anon_is_site_admin_execute.sql fixed for is_site_admin().
revoke all on function public.is_guild_officer() from public;
grant execute on function public.is_guild_officer() to anon, authenticated;

-- Grant/revoke/list, mirroring admin_{list,grant,revoke}_site_admin exactly
-- (20260719100000_admin_site_admin_management.sql). Gated by is_site_admin()
-- only -- granting this tier is an admin action, not something a guild
-- officer can do to themselves or each other.

create or replace function public.admin_list_guild_officers()
returns table (id integer, discord_id text, auth_user_id uuid, display_name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  return query
    select g.id, g.discord_id, g.auth_user_id,
      coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
    from public.guild_officers g
    left join auth.users u on u.id = g.auth_user_id
    order by g.id;
end;
$$;

create or replace function public.admin_grant_guild_officer(
  p_discord_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id integer;
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  if exists (select 1 from public.guild_officers where discord_id = p_discord_id) then
    raise exception 'That Discord account already has guild officer access';
  end if;

  insert into public.guild_officers (discord_id, auth_user_id)
  values (
    p_discord_id,
    (select id from auth.users where raw_user_meta_data ->> 'provider_id' = p_discord_id limit 1)
  )
  returning id into v_id;

  perform public.write_audit_log(null, 'guild_officer_granted', 'guild_officer', v_id, jsonb_build_object('discord_id', p_discord_id));

  return v_id;
end;
$$;

create or replace function public.admin_revoke_guild_officer(
  p_discord_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id integer;
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;

  delete from public.guild_officers where discord_id = p_discord_id
  returning id into v_id;

  if v_id is null then
    raise exception 'That Discord account does not have guild officer access';
  end if;

  perform public.write_audit_log(null, 'guild_officer_revoked', 'guild_officer', v_id, jsonb_build_object('discord_id', p_discord_id));
end;
$$;

revoke all on function public.admin_list_guild_officers() from public;
revoke execute on function public.admin_list_guild_officers() from anon;
grant execute on function public.admin_list_guild_officers() to authenticated;

revoke all on function public.admin_grant_guild_officer(text) from public;
revoke execute on function public.admin_grant_guild_officer(text) from anon;
grant execute on function public.admin_grant_guild_officer(text) to authenticated;

revoke all on function public.admin_revoke_guild_officer(text) from public;
revoke execute on function public.admin_revoke_guild_officer(text) from anon;
grant execute on function public.admin_revoke_guild_officer(text) to authenticated;

-- Full access: players write, attendance write.
alter policy "Officers write players" on public.players
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]) or is_guild_officer())
  with check (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]) or is_guild_officer());

alter policy "Officers write attendance" on public.attendance
  using (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]) or is_guild_officer())
  with check (my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text]) or is_guild_officer());

-- View-only: audit_log read, team_members read (Roster tab's Discord Claims
-- sub-panel reads team_members for a guild officer covering another team).
alter policy "Officers read audit_log" on public.audit_log
  using ((my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text])) or is_site_admin() or is_guild_officer());

alter policy "Officers read own team_members" on public.team_members
  using ((my_team_role(team_id) = any (array['officer'::text, 'team_leader'::text])) or is_site_admin() or is_guild_officer());

-- write_audit_log() gate: every player/attendance write calls this after
-- the fact to log itself (js/common.js writeAuditLog()), so it needs the
-- same is_guild_officer() OR as the players/attendance policies above --
-- otherwise a guild officer's player edit would succeed but the follow-up
-- audit-log write would raise 'Not authorized' and surface as an error.
create or replace function public.write_audit_log(
  p_team_id integer,
  p_action text,
  p_target_type text default null,
  p_target_id integer default null,
  p_detail jsonb default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id integer;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin() or public.is_guild_officer()) then
    raise exception 'Not authorized';
  end if;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, p_action, p_target_type, p_target_id, p_detail)
  returning id into v_id;

  return v_id;
end;
$$;

-- Guild officer bios (site_settings.guild_officer_bios) write gate: extend
-- beyond is_site_admin() to also admit guild officers. Deliberate reversal
-- of the 2026-07-26 decision that only site admins should write guild-wide
-- content -- that reasoning was specifically about a single team's own
-- leader having no natural authority over guild-wide content; a guild
-- officer represents genuine cross-team leadership, so the exclusion
-- doesn't apply here.
create or replace function public.set_guild_officer_bios(p_bios jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bios jsonb;
begin
  if not (public.is_site_admin() or public.is_guild_officer()) then
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

-- Deliberately untouched, so a guild-officer-only caller is denied by RLS
-- the same as a raider regardless of what the frontend renders: bis_requests,
-- mplus_exclusion_requests, season_signups, self_received_requests,
-- team_settings, priority_order write policy, rclc_loot write policy,
-- team_members write policy.
