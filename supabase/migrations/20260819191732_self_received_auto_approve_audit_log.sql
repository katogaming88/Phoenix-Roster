-- submit_self_received()'s auto-approve path (a raider tagging their own
-- character with a non-'Other' source) left zero trace anywhere an officer
-- could see it: it never appears on the Requests tab (that only lists
-- status='pending' rows) and never wrote an audit_log entry the way a manual
-- approve/reject does (tab-requests.js's approveRequest()/rejectRequest()).
-- An officer had no way to see who self-reported what and when unless they
-- happened to already know to look at the raider's profile loot history.
--
-- write_audit_log() (the client-facing RPC, js/common.js's writeAuditLog())
-- requires an officer/team_leader/site_admin/guild_officer caller, so a
-- plain raider's own submission can't call it -- this inserts into
-- audit_log directly instead, since submit_self_received() is already
-- SECURITY DEFINER and this is an internal record of what the function
-- itself just did, not a generic client audit call.
create or replace function public.submit_self_received(
  p_team_id integer,
  p_name_realm text,
  p_item_name text,
  p_track text default null::text,
  p_source text default null::text,
  p_note text default null::text,
  p_slot text default null::text
)
returns table(id integer, auto_approved boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_player_id integer;
  v_item_id integer;
  v_auto_approved boolean := false;
  v_request_id integer;
begin
  select p.id into v_player_id
  from public.players p
  where p.team_id = p_team_id and p.name_realm = p_name_realm and p.archived_at is null;
  if not found then
    raise exception 'Character not found on roster';
  end if;

  select i.id into v_item_id from public.items i where i.name = p_item_name;
  if not found then
    raise exception 'Unknown item: %', p_item_name;
  end if;

  if auth.uid() is not null and coalesce(p_source, '') <> 'Other' then
    select true into v_auto_approved
    from public.players p
    join public.team_members tm on tm.id = p.team_member_id
    where p.id = v_player_id and tm.auth_user_id = auth.uid();
  end if;

  insert into public.self_received_requests
    (team_id, player_id, self_item_id, track, source, note, slot, status)
  values
    (p_team_id, v_player_id, v_item_id, p_track, nullif(p_source, ''), nullif(p_note, ''),
     nullif(p_slot, ''),
     case when coalesce(v_auto_approved, false) then 'approved' else 'pending' end)
  returning self_received_requests.id into v_request_id;

  if coalesce(v_auto_approved, false) then
    insert into public.audit_log (team_id, actor_id, action, target_type, target_id, detail)
    values (
      p_team_id,
      auth.uid(),
      'Self-Received Auto-Approved',
      'players',
      v_player_id,
      jsonb_build_object('item', p_item_name, 'track', p_track, 'source', p_source)
    );
  end if;

  return query select v_request_id, coalesce(v_auto_approved, false);
end $$;
