-- Team officers settle BoE payouts for their own team (#888). Every lifecycle
-- RPC gated on is_boe_manager() or is_site_admin(), so a team officer read
-- their team's rows through my_team_role() and could act on none of them; in
-- practice a team's officers are who hand the finder their cut, and
-- Immolation and Wrathless raid with the guild without otherwise using the
-- site. Native, by role, payout only: one helper reads the same authority the
-- read policy already trusts, and it gates exactly two things, Mark Paid and
-- the undo of a payout. Listing, sale, retire, edit and delete stay with BoE
-- managers and site admins; the UPDATE and DELETE policies are untouched.

-- True for a BoE manager, a site admin, or an officer or team leader of the
-- given team. Same shape as is_boe_manager(): SECURITY DEFINER so it does not
-- depend on the caller's own team_members read, EXECUTE for anon as well so
-- anything that ever references it for anon resolves false instead of erroring.
create or replace function public.can_settle_boe(p_team_id integer) returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select public.is_boe_manager()
    or public.is_site_admin()
    or coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false);
$$;

comment on function public.can_settle_boe(integer) is
  'Who may settle a BoE payout on this team: a BoE manager, a site admin, or the team''s own officer or team leader (#888). Gates boe_mark_paid and the paid-to-sold edge of boe_revert and nothing else.';

revoke all on function public.can_settle_boe(integer) from public;
grant execute on function public.can_settle_boe(integer) to anon, authenticated;

-- boe_mark_paid: same signature as #862 left it, so create or replace keeps
-- the grants. The row's team is read under the same lock as its status and
-- the gate asks the helper for that team.
create or replace function public.boe_mark_paid(
  p_id integer,
  p_paid_at timestamptz default null,
  p_donated boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_team_id integer;
begin
  select b.status, b.team_id into v_status, v_team_id
  from public.boe_items b where b.id = p_id for update;
  if not found then
    raise exception 'BoE item not found';
  end if;
  if not public.can_settle_boe(v_team_id) then
    raise exception 'Not authorized';
  end if;
  if v_status <> 'sold' then
    raise exception 'Cannot mark a % BoE paid', v_status;
  end if;

  update public.boe_items
  set status = 'paid',
      payout_paid_at = coalesce(p_paid_at, now()),
      payout_donated = coalesce(p_donated, false)
  where id = p_id;
end $$;

-- boe_revert: the paid-to-sold edge is the undo of a settle, so it takes the
-- settle gate; every other edge undoes a manager's action and keeps the
-- manager gate. Body otherwise as #861 left it (the sold edge nulls the fee).
create or replace function public.boe_revert(p_id integer) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_team_id integer;
  v_new text;
begin
  select b.status, b.team_id into v_status, v_team_id
  from public.boe_items b where b.id = p_id for update;
  if not found then
    raise exception 'BoE item not found';
  end if;
  if v_status = 'paid' then
    if not public.can_settle_boe(v_team_id) then
      raise exception 'Not authorized';
    end if;
  elsif not (public.is_boe_manager() or public.is_site_admin()) then
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
        guild_cut = null, ah_fee = null, payout_floor = null, payout_pivot = null
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
