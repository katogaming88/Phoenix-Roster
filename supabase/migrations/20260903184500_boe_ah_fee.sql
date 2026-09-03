-- #861: the auction house fee. The game keeps 5% of every sale, and
-- boe_record_sale wrote guild_cut = sale_price - finder_payout, so every
-- guild cut overstated what the bank receives by that much (about 491,000
-- gold over last season's 9.8 million of sales). Two decisions on the issue
-- (2026-09-03): the fee is the game's fixed rate and not a setting, so there
-- is no site_settings column, no admin field and no third argument on
-- set_boe_payout_settings, only the named constant in boe_record_sale and
-- the same literal in the backfill below; and the finder is capped at the
-- net (sale - fee) rather than the gross, so on a sub-floor sale the guild
-- takes zero instead of going out of pocket by the fee. Every payout above
-- the floor is unchanged.
--
-- Order matters: the column first, the backfill of every sold or paid row
-- second, the constraints third, because the constraints require the fee on
-- exactly those rows. The backfill runs as postgres, and
-- check_boe_status_transition returns early for any role but authenticated,
-- so no trigger bypass is needed.

alter table public.boe_items add column ah_fee bigint;

comment on column public.boe_items.ah_fee is
  'The auction house fee the game kept on the sale, whole gold: round(sale_price * 5 / 100), half away from zero (#861). Present iff sold/paid; finder_payout + guild_cut + ah_fee = sale_price by constraint.';

alter table public.boe_items add constraint boe_items_ah_fee_nonneg check (ah_fee >= 0);

-- Backfill every row sold before the fee was modeled, the rows imported from
-- the sheets included (the sheet never subtracted it either). Guarded on
-- ah_fee is null so a second run is a no-op. The finder's cap at the net
-- moves only sub-floor rows (two on prod at apply time, ids 2 and 25); on
-- every other row the fee comes out of the guild cut alone.
do $$
declare
  v_count integer;
  v_finder_before bigint;
  v_finder_after bigint;
  v_guild_before bigint;
  v_guild_after bigint;
  v_fee bigint;
begin
  create temp table boe_fee_backfill as
    select id from public.boe_items
    where status in ('sold', 'paid') and ah_fee is null;

  select count(*), coalesce(sum(b.finder_payout), 0), coalesce(sum(b.guild_cut), 0)
  into v_count, v_finder_before, v_guild_before
  from public.boe_items b where b.id in (select id from boe_fee_backfill);

  update public.boe_items b
  set ah_fee = f.fee,
      finder_payout = least(b.finder_payout, b.sale_price - f.fee),
      guild_cut = b.sale_price - f.fee - least(b.finder_payout, b.sale_price - f.fee)
  from (
    select id, round(sale_price::numeric * 5 / 100)::bigint as fee
    from public.boe_items
    where id in (select id from boe_fee_backfill)
  ) f
  where b.id = f.id;

  select coalesce(sum(b.finder_payout), 0), coalesce(sum(b.guild_cut), 0), coalesce(sum(b.ah_fee), 0)
  into v_finder_after, v_guild_after, v_fee
  from public.boe_items b where b.id in (select id from boe_fee_backfill);

  drop table boe_fee_backfill;

  raise notice 'boe_items: % sold or paid rows took the auction house fee; finder_payout % -> %, guild_cut % -> %, ah_fee %',
    v_count, v_finder_before, v_finder_after, v_guild_before, v_guild_after, v_fee;
end $$;

-- The two money-shape constraints learn the new column, and the sum is the
-- invariant this change creates: the one that would have caught the gap.
alter table public.boe_items drop constraint boe_items_money_only_when_sold;
alter table public.boe_items add constraint boe_items_money_only_when_sold check (
  status in ('sold', 'paid')
  or (sale_price is null and finder_payout is null and guild_cut is null and ah_fee is null
      and payout_floor is null and payout_pivot is null)
);

alter table public.boe_items drop constraint boe_items_money_complete_when_sold;
alter table public.boe_items add constraint boe_items_money_complete_when_sold check (
  status not in ('sold', 'paid')
  or (sale_price is not null and finder_payout is not null and guild_cut is not null and ah_fee is not null
      and payout_floor is not null and payout_pivot is not null)
);

alter table public.boe_items add constraint boe_items_money_sums check (
  status not in ('sold', 'paid') or finder_payout + guild_cut + ah_fee = sale_price
);

-- boe_record_sale returns the fee beside the split so the manager view can
-- render the row without a refetch. A new column in a returns table is a new
-- signature to Postgres, hence drop and create rather than replace, and the
-- grant is re-issued because a dropped function's grants go with it.
drop function public.boe_record_sale(integer, bigint, timestamptz);

create function public.boe_record_sale(
  p_id integer,
  p_sale_price bigint,
  p_sold_at timestamptz default null
) returns table(sale_price bigint, finder_payout bigint, guild_cut bigint, ah_fee bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The game's fixed auction house cut (#861), verified against two real
  -- mails. Not a setting: nothing reads it but this function and the
  -- backfill that introduced the column.
  c_ah_fee_pct constant numeric := 5;
  v_status text;
  v_floor bigint;
  v_pivot bigint;
  v_fee bigint;
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

  -- Whole gold, half away from zero: silver and copper are ignored by
  -- decision (a 47,999 sale carries a 2,399g 95s cut in game and 2,400 here),
  -- the same rounding the payout uses.
  v_fee := round(p_sale_price::numeric * c_ah_fee_pct / 100)::bigint;

  -- Guild policy (#745 comment): 20%-of-gross or the floor, whichever is
  -- larger, rounded to the nearest gold half away from zero, and never more
  -- than the sale net of the fee (#861), so the guild is never out of pocket
  -- on a sub-floor sale. The guild keeps what is left after the fee.
  v_payout := least(p_sale_price - v_fee, greatest(v_floor, round(p_sale_price::numeric * v_floor / v_pivot)))::bigint;

  update public.boe_items b
  set status = 'sold',
      sold_at = coalesce(p_sold_at, now()),
      sale_price = p_sale_price,
      finder_payout = v_payout,
      guild_cut = p_sale_price - v_fee - v_payout,
      ah_fee = v_fee,
      payout_floor = v_floor,
      payout_pivot = v_pivot
  where b.id = p_id;

  return query select p_sale_price, v_payout, p_sale_price - v_fee - v_payout, v_fee;
end $$;

revoke all on function public.boe_record_sale(integer, bigint, timestamptz) from public;
grant execute on function public.boe_record_sale(integer, bigint, timestamptz) to authenticated;

-- boe_revert's sold edge nulls the whole receipt, which now includes the fee.
-- Same signature, so create or replace; the body is otherwise the #766 one.
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
