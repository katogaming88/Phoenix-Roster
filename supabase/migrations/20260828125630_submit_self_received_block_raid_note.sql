-- The self-received request form only ever offers sources for loot earned
-- outside of raid (M+, Great Vault, Crafted, Catalyst, Bonus Roll, Other) --
-- there's no "Raid Drop" option, since actual raid drops are recorded by the
-- officer's RCLootCouncil import (import_rclc_loot()) instead. Raiders kept
-- working around that by picking 'Other' and describing a raid drop in the
-- note ("got it in raid last night", "raid drop"). Approving one of these
-- double-counts the item: it lands in bis_items.obtained via this request,
-- then again when the officer's loot import processes the same drop.
--
-- Reject the submission outright instead of letting it reach the officer
-- review queue, matching the reasoning of the 'Other' review gate itself
-- (20260819191008): the raider should wait for the import rather than
-- self-report something the system already has another path for. Word-
-- boundary match (\y...\y) so it only fires on "raid" as its own word --
-- not a substring hit inside "Raidbots" or "braided".
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
  if p_note ~* '\yraid\y' then
    raise exception 'Loot received from raid does not get self reported -- it will be added automatically once the officer imports raid loot.';
  end if;

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
