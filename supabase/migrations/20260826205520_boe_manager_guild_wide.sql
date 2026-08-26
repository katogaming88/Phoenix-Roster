-- Make the BoE manager grant guild-wide (#766). #745 shipped it per-team:
-- boe_managers hung off team_member_id, and is_boe_manager(p_team_id)
-- required both tm.team_id = p_team_id and a live officer/team_leader role
-- there. Neither condition matches how the role works. BoEs are guild
-- property, and whoever runs the guild bank runs it for the whole guild
-- regardless of which team they raid on.
--
-- Reshaped onto the pattern the other two guild-wide grants already use
-- (site_admins, guild_officers #607): a standalone discord_id + auth_user_id
-- membership table and an argument-less is_boe_manager(). Both BoE tables
-- were empty on prod when this was written (verified 2026-08-26), so this is
-- a drop and recreate rather than a data-preserving alter.
--
-- Accepted consequence, stated so nobody reads it as an oversight: the old
-- grant self-revoked when someone lost their officer role, because it joined
-- through team_members.role. A guild-wide grant persists until a site admin
-- revokes it, exactly like guild_officers and site_admins.

-- Policies depend on the old signature, so they come down before the
-- function does and go back up after the new one exists.
drop policy if exists "BoE managers update boe_items" on public.boe_items;
drop policy if exists "BoE managers delete boe_items" on public.boe_items;
drop policy if exists "BoE managers delete boe_listings" on public.boe_listings;

drop function if exists public.is_boe_manager(integer);
drop table if exists public.boe_managers;

create table public.boe_managers (
  id serial primary key,
  discord_id text not null unique,
  auth_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.boe_managers owner to postgres;
alter table public.boe_managers enable row level security;

-- Same table grants guild_officers carries: no select/insert/update/delete to
-- anon or authenticated, so the admin trio below is the only write path.
grant references, trigger, truncate, maintain on table public.boe_managers to anon;
grant references, trigger, truncate, maintain on table public.boe_managers to authenticated;
grant references, trigger, truncate, maintain on table public.boe_managers to service_role;
grant select on table public.boe_managers to claude_readers;

-- Guild-wide, no team_id param, same shape as is_guild_officer().
create or replace function public.is_boe_manager() returns boolean
language sql stable security definer set search_path to 'public'
as $$ select exists (select 1 from boe_managers where auth_user_id = auth.uid()); $$;

-- Policies referencing it are evaluated for anon too; without EXECUTE for
-- anon they error instead of resolving false (the
-- 20260706193110_anon_is_site_admin_execute.sql class of bug). A drop and
-- recreate is the easiest moment to lose this, hence the explicit re-grant.
revoke all on function public.is_boe_manager() from public;
grant execute on function public.is_boe_manager() to anon, authenticated;

-- True when the caller holds officer or team_leader on any team. SECURITY
-- DEFINER on purpose: a policy that read team_members inline would be
-- evaluated under the caller's own row security on that table, so its
-- correctness would rest on an unrelated policy staying as it is.
create or replace function public.is_any_team_officer() returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from team_members
    where auth_user_id = auth.uid()
      and role = any (array['officer', 'team_leader'])
  );
$$;

revoke all on function public.is_any_team_officer() from public;
grant execute on function public.is_any_team_officer() to anon, authenticated;

-- Mutation policies back up against the new signature.
create policy "BoE managers update boe_items" on public.boe_items
  for update
  using (public.is_boe_manager() or public.is_site_admin())
  with check (public.is_boe_manager() or public.is_site_admin());

create policy "BoE managers delete boe_items" on public.boe_items
  for delete
  using (public.is_boe_manager() or public.is_site_admin());

create policy "BoE managers delete boe_listings" on public.boe_listings
  for delete
  using (public.is_boe_manager() or public.is_site_admin());

-- The read half of the same grant. Without this a manager who happens to be
-- an officer only on Phoenix could mutate Hellfire rows while being unable to
-- see them, which is the sort of asymmetry that reads as data loss.
alter policy "Officers read boe_items" on public.boe_items
  using (
    public.my_team_role(team_id) = any (array['officer', 'team_leader'])
    or public.is_boe_manager()
    or public.is_site_admin()
  );

alter policy "Officers read boe_listings" on public.boe_listings
  using (
    public.my_team_role(team_id) = any (array['officer', 'team_leader'])
    or public.is_boe_manager()
    or public.is_site_admin()
  );

-- boe_managers' own policies. Site admins assign; any officer or team leader
-- on any team reads the list. That read is deliberately wider than
-- guild_officers' site-admin-only one: an ungranted officer looking at a find
-- they cannot act on needs an in-app way to see who can.
drop policy if exists "Claude readers read boe_managers" on public.boe_managers;
drop policy if exists "Officers read boe_managers" on public.boe_managers;
drop policy if exists "Site Admins write boe_managers" on public.boe_managers;

create policy "Claude readers read boe_managers" on public.boe_managers
  for select to claude_readers using (true);

create policy "Officers read boe_managers" on public.boe_managers
  for select
  using (public.is_any_team_officer() or public.is_site_admin());

create policy "Site Admins write boe_managers" on public.boe_managers
  using (public.is_site_admin())
  with check (public.is_site_admin());

-- A grant issued before the holder's first sign-in resolves auth_user_id to
-- null, and only this trigger can fill it in. Without the boe_managers
-- statement such a grant stays dead permanently with nothing surfacing the
-- failure. guild_officers has exactly this bug today and is filed as #768;
-- it is deliberately not fixed here.
create or replace function public.link_auth_user_to_member() returns trigger
language plpgsql security definer set search_path to 'public'
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

  return new;
end;
$$;

-- write_audit_log()'s gate needs the same OR, for the reason #607 needed it:
-- js/tabs/tab-boe.js calls writeAuditLog() after each successful lifecycle
-- mutation, and js/common.js only console.warns when that call fails. A
-- manager holding no officer role anywhere would therefore move money and log
-- nothing. Deliberate widening: such a manager can now write an audit entry
-- on any team and for any action, which is the price of the money trail
-- staying complete.
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

  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin() or public.is_guild_officer() or public.is_boe_manager()) then
    raise exception 'Not authorized';
  end if;

  insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
  values (p_team_id, v_uid, p_action, p_target_type, p_target_id, p_detail)
  returning id into v_id;

  return v_id;
end;
$$;

-- Grant, list and revoke, mirroring admin_{grant,list,revoke}_guild_officer
-- (20260730113259_guild_officer_tier.sql) exactly. Site-admin gated: handing
-- someone the guild bank is an admin action, not something managers do to
-- each other. auth_user_id resolves at grant time when that Discord account
-- has already signed in, and the trigger above covers the case where it has
-- not.
create or replace function public.admin_list_boe_managers()
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
    select b.id, b.discord_id, b.auth_user_id,
      coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
    from public.boe_managers b
    left join auth.users u on u.id = b.auth_user_id
    order by b.id;
end;
$$;

create or replace function public.admin_grant_boe_manager(
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

  if exists (select 1 from public.boe_managers where discord_id = p_discord_id) then
    raise exception 'That Discord account already has BoE manager access';
  end if;

  insert into public.boe_managers (discord_id, auth_user_id)
  values (
    p_discord_id,
    (select id from auth.users where raw_user_meta_data ->> 'provider_id' = p_discord_id limit 1)
  )
  returning id into v_id;

  perform public.write_audit_log(null, 'boe_manager_granted', 'boe_manager', v_id, jsonb_build_object('discord_id', p_discord_id));

  return v_id;
end;
$$;

create or replace function public.admin_revoke_boe_manager(
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

  delete from public.boe_managers where discord_id = p_discord_id
  returning id into v_id;

  if v_id is null then
    raise exception 'That Discord account does not have BoE manager access';
  end if;

  perform public.write_audit_log(null, 'boe_manager_revoked', 'boe_manager', v_id, jsonb_build_object('discord_id', p_discord_id));
end;
$$;

revoke all on function public.admin_list_boe_managers() from public;
revoke execute on function public.admin_list_boe_managers() from anon;
grant execute on function public.admin_list_boe_managers() to authenticated;

revoke all on function public.admin_grant_boe_manager(text) from public;
revoke execute on function public.admin_grant_boe_manager(text) from anon;
grant execute on function public.admin_grant_boe_manager(text) to authenticated;

revoke all on function public.admin_revoke_boe_manager(text) from public;
revoke execute on function public.admin_revoke_boe_manager(text) from anon;
grant execute on function public.admin_revoke_boe_manager(text) to authenticated;

-- The five lifecycle RPCs, reissued from #745 with the gate's team argument
-- dropped. They are plpgsql and resolve is_boe_manager at runtime, so they
-- did not block the function drop above; they are reissued because the old
-- signature no longer exists.
--
-- Four of the five also lose their v_team_id local. The gate was its last
-- reader in boe_record_sale, boe_mark_paid, boe_retire and boe_revert, and
-- plpgsql_check warns "never read variable" on a local that is only ever
-- assigned, which CI treats as a failure (supabase db lint --fail-on
-- warning). boe_record_listing keeps it: it still inserts the listing row
-- with that team id. Everything else in these bodies is unchanged from
-- 20260825225243_boe_tracker.sql.

create or replace function public.boe_record_listing(
  p_id integer,
  p_price bigint,
  p_listed_at timestamptz default null,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id integer;
  v_status text;
begin
  select b.team_id, b.status into v_team_id, v_status
  from public.boe_items b where b.id = p_id for update;
  if not found then
    raise exception 'BoE item not found';
  end if;
  if not (public.is_boe_manager() or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if v_status <> all (array['found', 'listed']) then
    raise exception 'Cannot record a listing on a % BoE', v_status;
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'Listing price must be zero or more';
  end if;

  insert into public.boe_listings (team_id, boe_item_id, price, listed_at, note)
  values (v_team_id, p_id, p_price, coalesce(p_listed_at, now()), nullif(trim(coalesce(p_note, '')), ''));

  update public.boe_items set status = 'listed' where id = p_id;
end $$;

revoke all on function public.boe_record_listing(integer, bigint, timestamptz, text) from public;
grant execute on function public.boe_record_listing(integer, bigint, timestamptz, text) to authenticated;

create or replace function public.boe_record_sale(
  p_id integer,
  p_sale_price bigint,
  p_sold_at timestamptz default null
) returns table(sale_price bigint, finder_payout bigint, guild_cut bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_floor bigint;
  v_pivot bigint;
  v_payout bigint;
begin
  select b.status into v_status
  from public.boe_items b where b.id = p_id for update;
  if not found then
    raise exception 'BoE item not found';
  end if;
  if not (public.is_boe_manager() or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if v_status <> all (array['found', 'listed']) then
    raise exception 'Cannot record a sale on a % BoE', v_status;
  end if;
  if p_sale_price is null or p_sale_price <= 0 then
    raise exception 'Sale price must be positive';
  end if;

  select s.boe_payout_floor, s.boe_payout_pivot into v_floor, v_pivot
  from public.site_settings s where s.id = 1;

  -- Guild policy (#745 comment): 20%-of-gross or the floor, whichever is
  -- larger, capped at the sale itself; rounded to the nearest gold, half
  -- away from zero. The guild keeps the rest and absorbs the AH cut.
  v_payout := least(p_sale_price, greatest(v_floor, round(p_sale_price::numeric * v_floor / v_pivot)))::bigint;

  update public.boe_items b
  set status = 'sold',
      sold_at = coalesce(p_sold_at, now()),
      sale_price = p_sale_price,
      finder_payout = v_payout,
      guild_cut = p_sale_price - v_payout,
      payout_floor = v_floor,
      payout_pivot = v_pivot
  where b.id = p_id;

  return query select p_sale_price, v_payout, p_sale_price - v_payout;
end $$;

revoke all on function public.boe_record_sale(integer, bigint, timestamptz) from public;
grant execute on function public.boe_record_sale(integer, bigint, timestamptz) to authenticated;

create or replace function public.boe_mark_paid(
  p_id integer,
  p_paid_at timestamptz default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select b.status into v_status
  from public.boe_items b where b.id = p_id for update;
  if not found then
    raise exception 'BoE item not found';
  end if;
  if not (public.is_boe_manager() or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if v_status <> 'sold' then
    raise exception 'Cannot mark a % BoE paid', v_status;
  end if;

  update public.boe_items set status = 'paid', payout_paid_at = coalesce(p_paid_at, now()) where id = p_id;
end $$;

revoke all on function public.boe_mark_paid(integer, timestamptz) from public;
grant execute on function public.boe_mark_paid(integer, timestamptz) to authenticated;

create or replace function public.boe_retire(
  p_id integer,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select b.status into v_status
  from public.boe_items b where b.id = p_id for update;
  if not found then
    raise exception 'BoE item not found';
  end if;
  if not (public.is_boe_manager() or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if v_status <> all (array['found', 'listed']) then
    raise exception 'Cannot retire a % BoE', v_status;
  end if;

  update public.boe_items
  set status = 'retired', retired_at = now(),
      note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note)
  where id = p_id;
end $$;

revoke all on function public.boe_retire(integer, text) from public;
grant execute on function public.boe_retire(integer, text) to authenticated;

-- Correction edges. sold walks back to listed while listing rows exist
-- (else found) and nulls the whole money receipt; listed refuses while
-- listing rows exist, since deleting the junk listing is the correction
-- that makes 'found' true again.
create or replace function public.boe_revert(p_id integer) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_new text;
begin
  select b.status into v_status
  from public.boe_items b where b.id = p_id for update;
  if not found then
    raise exception 'BoE item not found';
  end if;
  if not (public.is_boe_manager() or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  if v_status = 'paid' then
    update public.boe_items set status = 'sold', payout_paid_at = null where id = p_id;
    return 'sold';
  elsif v_status = 'sold' then
    select case when exists (select 1 from public.boe_listings l where l.boe_item_id = p_id)
      then 'listed' else 'found' end into v_new;
    update public.boe_items
    set status = v_new, sold_at = null, sale_price = null, finder_payout = null,
        guild_cut = null, payout_floor = null, payout_pivot = null
    where id = p_id;
    return v_new;
  elsif v_status = 'listed' then
    if exists (select 1 from public.boe_listings l where l.boe_item_id = p_id) then
      raise exception 'Delete the listing rows first to revert a listed BoE to found';
    end if;
    update public.boe_items set status = 'found' where id = p_id;
    return 'found';
  elsif v_status = 'retired' then
    update public.boe_items set status = 'found', retired_at = null where id = p_id;
    return 'found';
  else
    raise exception 'Nothing to revert on a found BoE';
  end if;
end $$;

revoke all on function public.boe_revert(integer) from public;
grant execute on function public.boe_revert(integer) to authenticated;
