-- Officer per-row delete for self_received_requests (#756).
--
-- Approve/reject on the Requests tab are one-way: a misclick or a duplicate
-- submission permanently pollutes the raider's profile loot history and the
-- fairness views (8 exact duplicate approved rows existed in live data when
-- this was designed, all from raiders resubmitting when feedback failed).
-- Revert-to-pending needs no backend at all: the existing "Officers update
-- self_received_requests" policy carries a plain status UPDATE, and the
-- team-check trigger re-validates on the way through. Delete cannot ride a
-- policy: this table deliberately has NO DELETE policy for anyone (the
-- docs/RLS.md write contract: request-table writes go through SECURITY
-- DEFINER functions only), and adding one would loosen that contract for
-- every ad-hoc client query. So delete is an RPC, the per-row officer-tier
-- complement to danger_clear_self_received_requests() (site-admin,
-- whole-team, 20260711222738).
--
-- Same shape as the BoE lifecycle RPCs (20260825225243): lock the row
-- first, not-found raise, authorization derived from the row's own team
-- rather than a caller-supplied team id. The role check wraps my_team_role()
-- in coalesce so a caller with no role on the team is refused rather than
-- slipping through on a null comparison (the #752 bug shape). Guild
-- officers are deliberately excluded, matching their exclusion from every
-- approval surface on this table. Any status may be deleted: restricting to
-- approved/rejected would only force a reject-then-delete two-step for a
-- pending duplicate, with the same end state and no added safety.
--
-- The audit entry is written inside the RPC (like set_boe_payout_settings)
-- because the row is gone afterwards: a client-side follow-up call that
-- failed would leave an unlogged delete, and write_audit_log()'s own gate is
-- identical to this function's, so it cannot add a refusal. target_type is
-- 'players' with the row's player_id (possibly null), never the request
-- row: the Audit tab resolves targets against live tables, and a deleted
-- row would blank the TARGET column forever. The detail is a human-readable
-- summary string (#377 convention), naming the item, slot, track, source,
-- and prior status, captured before the delete.
--
-- Deliberately NOT undone here: bis_items.obtained set by the approval
-- sync. That sync is one-way on purpose (20260725100000): an officer may
-- have ticked the box by hand for an unrelated reason. The Requests tab
-- points officers at BiS Manager instead.

create or replace function public.delete_self_received_request(p_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id integer;
  v_player_id integer;
  v_item_id integer;
  v_status text;
  v_track text;
  v_source text;
  v_slot text;
  v_player_name text;
  v_item_name text;
begin
  select r.team_id, r.player_id, r.self_item_id, r.status, r.track, r.source, r.slot
    into v_team_id, v_player_id, v_item_id, v_status, v_track, v_source, v_slot
  from public.self_received_requests r
  where r.id = p_id
  for update;
  if not found then
    raise exception 'Self-received request not found';
  end if;

  if not (coalesce(public.my_team_role(v_team_id) = any (array['officer', 'team_leader']), false)
          or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;

  select p.name_realm into v_player_name from public.players p where p.id = v_player_id;
  select i.name into v_item_name from public.items i where i.id = v_item_id;

  delete from public.self_received_requests where id = p_id;

  perform public.write_audit_log(
    v_team_id,
    'Self-Received Deleted',
    'players',
    v_player_id,
    to_jsonb(
      'Deleted ' || v_status || ' request: ' || coalesce(v_item_name, 'unknown item')
      || coalesce(' (' || nullif(v_slot, '') || ')', '')
      || coalesce(', ' || v_track, '')
      || coalesce(', ' || v_source, '')
      || case when v_player_id is null or v_player_name is null
              then ', player no longer on roster' else '' end
    )
  );
end $$;

revoke all on function public.delete_self_received_request(integer) from public;
grant execute on function public.delete_self_received_request(integer) to authenticated;
