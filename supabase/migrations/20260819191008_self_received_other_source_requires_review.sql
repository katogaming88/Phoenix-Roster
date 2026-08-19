-- submit_self_received() auto-approves any self-tagged receipt on the
-- raider's own character (auth.uid() matches that player's team_member),
-- regardless of source. That's fine for M+/Great Vault/Crafted/Catalyst/
-- Bonus Roll -- each is a specific, verifiable source -- but 'Other' is the
-- catch-all for anything that doesn't cleanly fit one of those, so it needs
-- an officer's eyes before it counts as received. Caught live: a raider
-- self-tagged a raid drop as 'Other' that had already been logged from the
-- RCLC loot import, and it auto-approved with no review.
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

  return query select v_request_id, coalesce(v_auto_approved, false);
end $$;
