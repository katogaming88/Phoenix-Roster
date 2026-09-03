-- Donated payouts (#862). Some finders give their cut to the guild; the sheet
-- recorded that in its Notes column and the Form's note field carries the
-- intent, so a donated sale looked exactly like an unpaid one and the guild
-- income totals left the donated cut out. This is a flag on the settle step,
-- not a status: the lifecycle vocabulary and every status constraint stay as
-- they are, and the money columns keep their policy meaning (finder_payout is
-- what the finder was owed, guild_cut the policy remainder), so #861's fee
-- applies the same way either route. Reporting counts guild_cut plus
-- finder_payout on donated paid rows.
--
-- The flag is written only by the two RPCs below. check_boe_status_transition
-- already blocks it on a plain UPDATE, since it is not in the trigger's list
-- of directly editable columns.

alter table public.boe_items add column payout_donated boolean not null default false;

-- boe_mark_paid gains p_donated. Appended with a default, so the existing
-- two-argument calls resolve; a new signature all the same, so the grant and
-- revoke pair moves with it. The flag is set explicitly from the argument:
-- Mark Paid on a row the raider flagged clears the intent, because the
-- manager's button is what decides.
drop function if exists public.boe_mark_paid(integer, timestamptz);

create function public.boe_mark_paid(
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

  update public.boe_items
  set status = 'paid',
      payout_paid_at = coalesce(p_paid_at, now()),
      payout_donated = coalesce(p_donated, false)
  where id = p_id;
end $$;

revoke all on function public.boe_mark_paid(integer, timestamptz, boolean) from public;
grant execute on function public.boe_mark_paid(integer, timestamptz, boolean) to authenticated;

-- submit_boe_found gains p_donate for the raider checkbox: intent, recorded
-- on the row so the manager knows which button to reach for. Body otherwise
-- as #875 left it (catalog BoEs only, case-insensitive, catalog spelling).
drop function if exists public.submit_boe_found(integer, text, text, text, text);

create function public.submit_boe_found(
  p_team_id integer,
  p_name_realm text,
  p_item_name text,
  p_track text default null,
  p_note text default null,
  p_donate boolean default false
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id integer;
  v_item_id integer;
  v_item_name text;
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

  select i.id, i.name into v_item_id, v_item_name
  from public.items i
  where i.is_boe and lower(i.name) = lower(trim(p_item_name));

  select ts.config ->> 'seasonName' into v_season
  from public.team_settings ts where ts.team_id = p_team_id;

  insert into public.boe_items (team_id, player_id, finder_name, item_id, item_name, track, season, note, payout_donated)
  values (p_team_id, v_player_id, trim(p_name_realm), v_item_id, coalesce(v_item_name, trim(p_item_name)), p_track,
          v_season, nullif(trim(coalesce(p_note, '')), ''), coalesce(p_donate, false))
  returning boe_items.id into v_id;

  return v_id;
end $$;

revoke all on function public.submit_boe_found(integer, text, text, text, text, boolean) from public;
grant execute on function public.submit_boe_found(integer, text, text, text, text, boolean) to anon, authenticated;

-- Backfill: the rows whose note already said the cut was donated, read on
-- 2026-09-02 (nine on prod: seven sold or paid from the sheets and the site,
-- two open finds whose flag lands as the raider's intent). Keyed on
-- (team_id, found_at) rather than id, since prod ids were not assigned in
-- import-file order. For the record the prod ids were 1, 19, 22, 25, 30, 37,
-- 61, 65 and 66. Runs as postgres, so the trigger's authenticated-only
-- check does not fire. Idempotent through the flag itself.
do $$
declare
  v_count integer;
begin
  update public.boe_items b
  set payout_donated = true
  where not b.payout_donated
    and (b.team_id, b.found_at) in (
      (3, '2026-05-12 04:00:00+00'::timestamptz),
      (4, '2026-04-21 03:34:52+00'::timestamptz),
      (3, '2026-05-01 02:42:02+00'::timestamptz),
      (3, '2026-08-26 04:06:35+00'::timestamptz),
      (1, '2026-04-14 03:33:25+00'::timestamptz),
      (1, '2026-04-28 03:30:03+00'::timestamptz),
      (1, '2026-04-25 20:24:38+00'::timestamptz),
      (1, '2026-09-02 20:14:13.760078+00'::timestamptz),
      (3, '2026-09-02 23:24:24.164095+00'::timestamptz)
    );
  get diagnostics v_count = row_count;
  raise notice 'Flagged % boe_items rows as donated', v_count;
end $$;
