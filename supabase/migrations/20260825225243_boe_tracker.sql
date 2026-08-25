-- BoE tracker backend (#745): fold the guild-bank BoE workflow into the
-- site. Three tables -- boe_items (one row per found BoE, carrying the
-- lifecycle found -> listed -> sold -> paid plus retired, and the money
-- receipt), boe_listings (one row per AH listing event, so relists keep
-- their history), and boe_managers (the standalone grant that scopes money
-- mutations, same shape as guild_officers #607) -- plus the lifecycle RPCs.
--
-- Access model (decided 2026-08-25): grant-only writes. Every lifecycle
-- mutation requires a boe_managers grant on that team (held by an officer
-- or team leader) or is_site_admin(). Officers without the grant are
-- read-only. is_guild_officer() deliberately passes no BoE gate, matching
-- its exclusion from approvals and loot import.
--
-- Split formula (guild policy, pinned in the #745 comment): the finder gets
-- 20% of the gross sale or the 20,000g floor, whichever is larger, capped
-- at the sale itself; the guild keeps the rest and absorbs the AH cut.
-- floor/pivot live on site_settings (guild-wide, site-admin editable) and
-- are snapshotted per sold row so history survives a policy change.

create table if not exists public.boe_items (
  id serial primary key,
  team_id integer not null references public.teams(id) on delete cascade,
  player_id integer references public.players(id) on delete set null,
  finder_name text,
  item_id integer references public.items(id) on delete set null,
  item_name text not null,
  track text check (track = any (array['Champion', 'Hero', 'Myth'])),
  season text,
  note text,
  status text not null default 'found'
    check (status = any (array['found', 'listed', 'sold', 'paid', 'retired'])),
  found_at timestamptz not null default now(),
  sold_at timestamptz,
  payout_paid_at timestamptz,
  retired_at timestamptz,
  sale_price bigint,
  finder_payout bigint,
  guild_cut bigint,
  payout_floor bigint,
  payout_pivot bigint,
  updated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint boe_items_sale_price_nonneg check (sale_price >= 0),
  constraint boe_items_finder_payout_nonneg check (finder_payout >= 0),
  constraint boe_items_guild_cut_nonneg check (guild_cut >= 0),
  constraint boe_items_payout_lte_sale check (finder_payout <= sale_price),
  constraint boe_items_floor_nonneg check (payout_floor >= 0),
  constraint boe_items_pivot_positive check (payout_pivot > 0),
  -- Money travels only with sold/paid, and then completely: no half-written
  -- receipts, no stray money on found/listed/retired rows.
  constraint boe_items_money_only_when_sold check (
    status in ('sold', 'paid')
    or (sale_price is null and finder_payout is null and guild_cut is null
        and payout_floor is null and payout_pivot is null)
  ),
  constraint boe_items_money_complete_when_sold check (
    status not in ('sold', 'paid')
    or (sale_price is not null and finder_payout is not null and guild_cut is not null
        and payout_floor is not null and payout_pivot is not null)
  ),
  constraint boe_items_sold_at_iff_sold check ((status in ('sold', 'paid')) = (sold_at is not null)),
  constraint boe_items_paid_at_iff_paid check ((status = 'paid') = (payout_paid_at is not null)),
  constraint boe_items_retired_at_iff_retired check ((status = 'retired') = (retired_at is not null))
);

alter table public.boe_items owner to postgres;
alter table public.boe_items enable row level security;

create table if not exists public.boe_listings (
  id serial primary key,
  team_id integer not null references public.teams(id) on delete cascade,
  boe_item_id integer not null references public.boe_items(id) on delete cascade,
  listed_at timestamptz not null default now(),
  price bigint not null check (price >= 0),
  note text,
  updated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists boe_listings_boe_item_id_idx on public.boe_listings (boe_item_id);

alter table public.boe_listings owner to postgres;
alter table public.boe_listings enable row level security;

create table if not exists public.boe_managers (
  id serial primary key,
  team_member_id integer not null unique references public.team_members(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.boe_managers owner to postgres;
alter table public.boe_managers enable row level security;

-- Guild-wide payout policy constants. The pivot CHECK makes the sale RPC's
-- division structurally safe; set_boe_payout_settings() below is the only
-- write path, like the other site_settings columns.
alter table public.site_settings
  add column if not exists boe_payout_floor bigint not null default 20000,
  add column if not exists boe_payout_pivot bigint not null default 100000;

alter table public.site_settings
  add constraint site_settings_boe_payout_floor_nonneg check (boe_payout_floor >= 0),
  add constraint site_settings_boe_payout_pivot_positive check (boe_payout_pivot > 0);

-- boe_listings.team_id must match its item's team, mirroring
-- check_team_id_matches_player() on the player-linked tables.
create or replace function public.check_team_id_matches_boe_item() returns trigger
language plpgsql
as $$
declare
  v_item_team integer;
begin
  select team_id into v_item_team from public.boe_items where id = new.boe_item_id;
  if v_item_team is not null and v_item_team <> new.team_id then
    raise exception 'boe_listings.team_id % does not match the boe_item team %', new.team_id, v_item_team;
  end if;
  return new;
end $$;

alter function public.check_team_id_matches_boe_item() owner to postgres;

-- Direct UPDATEs (the manager-gated metadata policy below) may only edit
-- the columns listed in the subtraction; everything else -- status, money,
-- lifecycle timestamps, team_id, and any column added later -- is protected
-- and changes only through the SECURITY DEFINER RPCs, which run as postgres
-- and take the current_user exemption. An unconditional forward-edge
-- trigger (the restrict_bis_items_update_to_obtained shape) would block
-- boe_revert()'s correction edges, so the edge legality lives in the RPCs
-- and this trigger's job is that a plain UPDATE cannot move the lifecycle.
create or replace function public.check_boe_status_transition() returns trigger
language plpgsql
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if (to_jsonb(new) - 'note' - 'finder_name' - 'player_id' - 'item_id' - 'item_name' - 'track' - 'season' - 'updated_at')
     is distinct from
     (to_jsonb(old) - 'note' - 'finder_name' - 'player_id' - 'item_id' - 'item_name' - 'track' - 'season' - 'updated_at') then
    raise exception 'Direct updates may only edit note, finder, item, track, or season; lifecycle changes go through the BoE RPCs';
  end if;
  return new;
end $$;

alter function public.check_boe_status_transition() owner to postgres;

create trigger trg_boe_items_team_id_check
  before insert or update on public.boe_items
  for each row execute function public.check_team_id_matches_player();

create trigger trg_boe_items_updated_at
  before update on public.boe_items
  for each row execute function public.set_updated_at();

create trigger trg_boe_items_status_transition
  before update on public.boe_items
  for each row execute function public.check_boe_status_transition();

create trigger trg_boe_listings_team_id_check
  before insert or update on public.boe_listings
  for each row execute function public.check_team_id_matches_boe_item();

create trigger trg_boe_listings_updated_at
  before update on public.boe_listings
  for each row execute function public.set_updated_at();

-- True when the caller is a boe_managers grantee on that team who still
-- holds officer or team_leader there -- so a demotion self-revokes, and a
-- grant held on one team reaches nothing on another.
create or replace function public.is_boe_manager(p_team_id integer) returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1
    from team_members tm
    join boe_managers bm on bm.team_member_id = tm.id
    where tm.team_id = p_team_id
      and tm.auth_user_id = auth.uid()
      and tm.role = any (array['officer', 'team_leader'])
  );
$$;

-- Policies call it, and policies are also evaluated for anon; without
-- EXECUTE for anon they error instead of resolving false (the
-- 20260706193110_anon_is_site_admin_execute.sql class of bug).
revoke all on function public.is_boe_manager(integer) from public;
grant execute on function public.is_boe_manager(integer) to anon, authenticated;

-- boe_items: no public read (payouts owed per person and live listing
-- prices are undercutting intel -- the item_preferences privacy call, not
-- the rclc_loot transparency call). No INSERT policy for anyone:
-- submit_boe_found() is the only way a row appears.
create policy "Claude readers read boe_items" on public.boe_items
  for select to claude_readers using (true);

create policy "Officers read boe_items" on public.boe_items
  for select
  using (public.my_team_role(team_id) = any (array['officer', 'team_leader']) or public.is_site_admin());

create policy "Raiders read own boe_items" on public.boe_items
  for select
  using (public.is_own_player(player_id));

create policy "BoE managers update boe_items" on public.boe_items
  for update
  using (public.is_boe_manager(team_id) or public.is_site_admin())
  with check (public.is_boe_manager(team_id) or public.is_site_admin());

create policy "BoE managers delete boe_items" on public.boe_items
  for delete
  using (public.is_boe_manager(team_id) or public.is_site_admin());

create policy "Claude readers read boe_listings" on public.boe_listings
  for select to claude_readers using (true);

create policy "Officers read boe_listings" on public.boe_listings
  for select
  using (public.my_team_role(team_id) = any (array['officer', 'team_leader']) or public.is_site_admin());

create policy "BoE managers delete boe_listings" on public.boe_listings
  for delete
  using (public.is_boe_manager(team_id) or public.is_site_admin());

-- boe_managers: site admins assign (all ops); officers and team leaders see
-- who their own team's managers are, scoped through the granted member's
-- team since the table itself has no team_id.
create policy "Claude readers read boe_managers" on public.boe_managers
  for select to claude_readers using (true);

create policy "Officers read boe_managers" on public.boe_managers
  for select
  using (exists (
    select 1 from public.team_members tm
    where tm.id = boe_managers.team_member_id
      and public.my_team_role(tm.team_id) = any (array['officer', 'team_leader'])
  ));

create policy "Site Admins write boe_managers" on public.boe_managers
  using (public.is_site_admin()) with check (public.is_site_admin());

-- The raider-facing submit (#746 calls this). Anon-callable for parity with
-- the Google Form it replaces (precedent submit_season_signup). Unlike
-- submit_self_received, resolution is non-fatal: an unrostered finder keeps
-- the raw name with player_id null, and a BoE missing from the boss-loot
-- catalog keeps item_id null -- a found BoE is a fact, not a request.
create or replace function public.submit_boe_found(
  p_team_id integer,
  p_name_realm text,
  p_item_name text,
  p_track text default null,
  p_note text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id integer;
  v_item_id integer;
  v_season text;
  v_id integer;
begin
  if trim(coalesce(p_name_realm, '')) = '' then
    raise exception 'Character name is required';
  end if;
  if trim(coalesce(p_item_name, '')) = '' then
    raise exception 'Item name is required';
  end if;
  if p_track is not null and p_track <> all (array['Champion', 'Hero', 'Myth']) then
    raise exception 'Unknown track: %', p_track;
  end if;

  select p.id into v_player_id
  from public.players p
  where p.team_id = p_team_id and p.name_realm = trim(p_name_realm) and p.archived_at is null;

  select i.id into v_item_id from public.items i where i.name = trim(p_item_name);

  select ts.config ->> 'seasonName' into v_season
  from public.team_settings ts where ts.team_id = p_team_id;

  insert into public.boe_items (team_id, player_id, finder_name, item_id, item_name, track, season, note)
  values (p_team_id, v_player_id, trim(p_name_realm), v_item_id, trim(p_item_name), p_track, v_season,
          nullif(trim(coalesce(p_note, '')), ''))
  returning boe_items.id into v_id;

  return v_id;
end $$;

revoke all on function public.submit_boe_found(integer, text, text, text, text) from public;
grant execute on function public.submit_boe_found(integer, text, text, text, text) to anon, authenticated;

-- The five lifecycle RPCs share one shape: lock the row (select ... for
-- update, the signup_roster_promotion idiom, so two managers acting at once
-- serialize instead of double-applying), gate on the manager grant, then
-- validate the from-status. Edge legality lives here, not in the trigger.

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
  if not (public.is_boe_manager(v_team_id) or public.is_site_admin()) then
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
  v_team_id integer;
  v_status text;
  v_floor bigint;
  v_pivot bigint;
  v_payout bigint;
begin
  select b.team_id, b.status into v_team_id, v_status
  from public.boe_items b where b.id = p_id for update;
  if not found then
    raise exception 'BoE item not found';
  end if;
  if not (public.is_boe_manager(v_team_id) or public.is_site_admin()) then
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
  v_team_id integer;
  v_status text;
begin
  select b.team_id, b.status into v_team_id, v_status
  from public.boe_items b where b.id = p_id for update;
  if not found then
    raise exception 'BoE item not found';
  end if;
  if not (public.is_boe_manager(v_team_id) or public.is_site_admin()) then
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
  v_team_id integer;
  v_status text;
begin
  select b.team_id, b.status into v_team_id, v_status
  from public.boe_items b where b.id = p_id for update;
  if not found then
    raise exception 'BoE item not found';
  end if;
  if not (public.is_boe_manager(v_team_id) or public.is_site_admin()) then
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
  v_team_id integer;
  v_status text;
  v_new text;
begin
  select b.team_id, b.status into v_team_id, v_status
  from public.boe_items b where b.id = p_id for update;
  if not found then
    raise exception 'BoE item not found';
  end if;
  if not (public.is_boe_manager(v_team_id) or public.is_site_admin()) then
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

-- The only write path onto the payout constants, mirroring
-- admin_set_maintenance_mode(). Site admin only: money policy, narrower
-- than the bios setter's site-or-guild-officer gate on purpose.
create or replace function public.set_boe_payout_settings(
  p_floor bigint,
  p_pivot bigint
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;
  if p_floor is null or p_floor < 0 then
    raise exception 'Payout floor must be zero or more';
  end if;
  if p_pivot is null or p_pivot <= 0 then
    raise exception 'Payout pivot must be positive';
  end if;

  update public.site_settings
  set boe_payout_floor = p_floor, boe_payout_pivot = p_pivot, updated_at = now()
  where id = 1;

  perform public.write_audit_log(
    null,
    'boe_payout_settings_updated',
    'site_settings',
    null,
    jsonb_build_object('floor', p_floor, 'pivot', p_pivot)
  );
end $$;

revoke all on function public.set_boe_payout_settings(bigint, bigint) from public;
revoke execute on function public.set_boe_payout_settings(bigint, bigint) from anon;
grant execute on function public.set_boe_payout_settings(bigint, bigint) to authenticated;

-- Table grants. Sequences are already covered by the schema-wide default
-- privileges from 20260709150000_sequence_grants.sql. No INSERT on the two
-- data tables for anyone: the RPCs above are the only insert paths.
grant select, update, delete on table public.boe_items to authenticated;
grant select on table public.boe_items to claude_readers;
grant select, delete on table public.boe_listings to authenticated;
grant select on table public.boe_listings to claude_readers;
grant select, insert, delete on table public.boe_managers to authenticated;
grant select on table public.boe_managers to claude_readers;
