-- A grant path for per-team roles (#910).
--
-- site_admins, boe_managers and guild_officers each have an
-- admin_{list,grant,revoke}_* trio that resolves auth_user_id from auth.users
-- at grant time. team_members, the per-team tier every role helper reads, has
-- none: the only writer is claim_character(), which requires a claimable
-- character on that team. So membership needs a roster, the role needs
-- membership, and a team with no players cannot be given an officer through
-- any path in the site. Wrathless (team 4) is exactly that team, and its BoE
-- finds have nobody who can settle them.
--
-- This adds the missing trio's grant and revoke, modelled on
-- admin_grant_guild_officer / admin_revoke_guild_officer
-- (20260730113259_guild_officer_tier.sql).
--
-- Note on the gate: my_team_role(t) is null for everybody on a team with no
-- members, so the team-leader half cannot open an empty team. Bootstrapping a
-- rosterless team is a site-admin action by construction, which is the whole
-- reason this works at all.

create or replace function public.admin_grant_team_role(
  p_team_id integer,
  p_discord_id text,
  p_role text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team public.teams%rowtype;
  v_existing public.team_members%rowtype;
  v_auth_user_id uuid;
  v_id integer;
begin
  if not (public.is_site_admin() or public.my_team_role(p_team_id) = 'team_leader') then
    raise exception 'Not authorized';
  end if;

  if p_role is null or p_role not in ('raider', 'officer', 'team_leader') then
    raise exception 'Role must be one of raider, officer, team_leader';
  end if;

  if p_discord_id is null or btrim(p_discord_id) = '' then
    raise exception 'A Discord id is required';
  end if;

  select * into v_team from public.teams where id = p_team_id;
  if not found then
    raise exception 'No team with id %', p_team_id;
  end if;
  if v_team.archived_at is not null then
    raise exception 'That team is archived';
  end if;

  -- Resolved here rather than left for a trigger to fill later. The trigger
  -- that does exist, on_auth_user_created, is AFTER INSERT ON auth.users, so
  -- it fires once at account creation and never again: a row inserted for
  -- somebody who signed in months ago would keep a null auth_user_id, read as
  -- no role at all, and look perfectly correct in the table. Null here means
  -- the account does not exist yet, which is the case the trigger does cover.
  -- (This reads auth.users; it is why the function is security definer.)
  select id into v_auth_user_id
  from auth.users
  where raw_user_meta_data ->> 'provider_id' = p_discord_id
  limit 1;

  select * into v_existing
  from public.team_members
  where team_id = p_team_id and discord_id = p_discord_id
  for update;

  if not found then
    insert into public.team_members (team_id, discord_id, auth_user_id, role)
    values (p_team_id, p_discord_id, v_auth_user_id, p_role)
    returning id into v_id;

    perform public.write_audit_log(
      p_team_id, 'team_role_granted', 'team_member', v_id,
      jsonb_build_object('discord_id', p_discord_id, 'role', p_role, 'linked', v_auth_user_id is not null)
    );

    return v_auth_user_id;
  end if;

  -- An existing row is never rewritten. `role` drives every team role helper
  -- and a wide slice of the read rules, so a conflict branch that overwrote it
  -- would let one mistyped Discord id demote a sitting team leader, with the
  -- audit entry reading like a fresh grant. Changing somebody's role stays
  -- with the promote path in the officer dashboard.
  if v_existing.role is distinct from p_role then
    raise exception 'That Discord account already has the % role on this team. Change a role through the promote path, not this grant.', v_existing.role;
  end if;

  if v_existing.auth_user_id is not null then
    raise exception 'That Discord account already has the % role on this team.', v_existing.role;
  end if;

  if v_auth_user_id is null then
    raise exception 'That Discord account already has the % role on this team, and no account exists for it to link to yet.', v_existing.role;
  end if;

  -- The repair: same role, and the link that was never made. This is the one
  -- case where re-granting writes anything.
  update public.team_members
  set auth_user_id = v_auth_user_id
  where id = v_existing.id;

  perform public.write_audit_log(
    p_team_id, 'team_role_relinked', 'team_member', v_existing.id,
    jsonb_build_object('discord_id', p_discord_id, 'role', v_existing.role)
  );

  return v_auth_user_id;
end;
$$;

comment on function public.admin_grant_team_role(integer, text, text) is
  'Grants a per-team role by Discord id, resolving auth_user_id from auth.users at grant time. Site admins may grant on any team; a team leader only on their own, which means a team with no members can only be opened by a site admin. Refuses to change a role that is already set; the one repeat case that writes is filling an auth_user_id that was never linked. (#910)';

create or replace function public.admin_revoke_team_role(
  p_team_id integer,
  p_discord_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.team_members%rowtype;
  v_claimed integer;
begin
  if not (public.is_site_admin() or public.my_team_role(p_team_id) = 'team_leader') then
    raise exception 'Not authorized';
  end if;

  select * into v_existing
  from public.team_members
  where team_id = p_team_id and discord_id = p_discord_id
  for update;

  if not found then
    raise exception 'That Discord account does not have a role on this team';
  end if;

  -- players_team_member_id_fkey is ON DELETE SET NULL, so deleting a member a
  -- character points at would silently unclaim that character, with no error
  -- anywhere and nothing in the audit log saying it happened. Somebody who
  -- has claimed a character stays on the team as a raider instead.
  select count(*) into v_claimed from public.players where team_member_id = v_existing.id;

  if v_claimed > 0 then
    update public.team_members set role = 'raider' where id = v_existing.id;

    perform public.write_audit_log(
      p_team_id, 'team_role_demoted', 'team_member', v_existing.id,
      jsonb_build_object('discord_id', p_discord_id, 'from_role', v_existing.role, 'claimed_characters', v_claimed)
    );
    return;
  end if;

  delete from public.team_members where id = v_existing.id;

  perform public.write_audit_log(
    p_team_id, 'team_role_revoked', 'team_member', v_existing.id,
    jsonb_build_object('discord_id', p_discord_id, 'from_role', v_existing.role)
  );
end;
$$;

comment on function public.admin_revoke_team_role(integer, text) is
  'Removes a per-team role by Discord id. Demotes to raider when any character is claimed against the member, because the foreign key from players is ON DELETE SET NULL and a delete would silently unclaim it; removes the row only when nothing points at it. (#910)';

-- The link trigger has covered team_members, site_admins and boe_managers
-- since #766 and has never covered guild_officers, so a guild officer granted
-- before they first sign in stays unlinked with no way to notice. Both
-- current grant holders happen to have signed in first, which is why nobody
-- has hit it. Same signature, so the trigger binding and grants survive.
create or replace function public.link_auth_user_to_member()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  update team_members
  set auth_user_id = new.id
  where discord_id = new.raw_user_meta_data ->> 'provider_id'
    and auth_user_id is null;

  update site_admins
  set auth_user_id = new.id
  where discord_id = new.raw_user_meta_data ->> 'provider_id'
    and auth_user_id is null;

  update boe_managers
  set auth_user_id = new.id
  where discord_id = new.raw_user_meta_data ->> 'provider_id'
    and auth_user_id is null;

  update guild_officers
  set auth_user_id = new.id
  where discord_id = new.raw_user_meta_data ->> 'provider_id'
    and auth_user_id is null;

  return new;
end;
$$;

revoke all on function public.admin_grant_team_role(integer, text, text) from public;
revoke execute on function public.admin_grant_team_role(integer, text, text) from anon;
grant execute on function public.admin_grant_team_role(integer, text, text) to authenticated;

revoke all on function public.admin_revoke_team_role(integer, text) from public;
revoke execute on function public.admin_revoke_team_role(integer, text) from anon;
grant execute on function public.admin_revoke_team_role(integer, text) to authenticated;
