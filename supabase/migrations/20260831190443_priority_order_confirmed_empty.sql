-- "Nobody wants this item" is a legitimate outcome of building a priority
-- list, not an unfinished one -- an officer can open Priority Edit, find no
-- one on the wishlist/BiS pool actually wants the drop, and hit Save with
-- zero players ranked. save_priority_order() already accepted that (it just
-- deletes any existing priority_order rows for the item/track and inserts
-- nothing), but with zero rows left behind there was nothing to distinguish
-- "officer confirmed this is empty" from "nobody has ever set this up" --
-- both looked identical to _isFullyManaged() (js/tabs/tab-priority.js),
-- which only checks whether the 'heroic'/'mythic' key is present at all, so
-- a deliberately-empty item fell right back into the Unmanaged Items list
-- the moment the page reloaded or Season View was re-derived.
--
-- This table is the missing marker: one row per team/season/item/track that
-- an officer has explicitly saved with an empty roster. A non-empty save
-- clears the marker for that item/track (see save_priority_order() below) --
-- it's only ever "empty on purpose" for whichever state was saved *last*.
--
-- Public read, same as priority_order itself -- this is display metadata
-- (mapSupabasePriorityOrder() reads it to seed an empty-but-present
-- heroic/mythic array), not anything sensitive. Write is officer/team_leader/
-- site_admin, same shape as "Officers write priority_order" -- in practice
-- only ever touched by save_priority_order() itself (security invoker), not
-- written directly by the frontend.
create table public.priority_order_confirmed_empty (
  team_id integer not null references public.teams(id) on delete cascade,
  season text not null,
  item_id integer not null references public.items(id) on delete cascade,
  track text not null check (track in ('Hero', 'Myth')),
  marked_at timestamp with time zone not null default now(),
  primary key (team_id, season, item_id, track)
);

comment on table public.priority_order_confirmed_empty is
  'Marks a team/season/item/track priority list as deliberately saved empty (no one wants the item) -- keeps it out of the Unmanaged Items list without a placeholder priority_order row. Cleared automatically the next time that item/track is saved with a non-empty roster.';

alter table public.priority_order_confirmed_empty enable row level security;

create policy "Public read priority_order_confirmed_empty" on public.priority_order_confirmed_empty
  for select using (true);

create policy "Officers write priority_order_confirmed_empty" on public.priority_order_confirmed_empty
  for all
  using (my_team_role(team_id) = any (array['officer', 'team_leader']) or is_site_admin())
  with check (my_team_role(team_id) = any (array['officer', 'team_leader']) or is_site_admin());

create policy "Claude readers read priority_order_confirmed_empty" on public.priority_order_confirmed_empty
  for select to claude_readers using (true);

-- save_priority_order(): unchanged delete+insert of priority_order itself,
-- plus keeping priority_order_confirmed_empty in sync -- upsert a marker row
-- when the save leaves nothing ranked, otherwise clear any marker left over
-- from a previous empty save of the same item/track.
create or replace function public.save_priority_order(
  p_team_id integer,
  p_season text,
  p_item_id integer,
  p_track text,
  p_player_ids jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item_name text;
  v_count integer;
begin
  if not (coalesce(public.my_team_role(p_team_id) = any (array['officer', 'team_leader']), false) or public.is_site_admin()) then
    raise exception 'Not authorized';
  end if;
  if p_track not in ('Hero', 'Myth') then
    raise exception 'Invalid track';
  end if;

  delete from public.priority_order
   where team_id = p_team_id
     and season = p_season
     and item_id = p_item_id
     and track = p_track;

  insert into public.priority_order (team_id, season, item_id, track, rank, player_id, updated_at)
  select p_team_id, p_season, p_item_id, p_track, ord::integer, (elem)::integer, now()
  from jsonb_array_elements_text(coalesce(p_player_ids, '[]'::jsonb)) with ordinality as t(elem, ord);

  get diagnostics v_count = row_count;

  if v_count = 0 then
    insert into public.priority_order_confirmed_empty (team_id, season, item_id, track, marked_at)
    values (p_team_id, p_season, p_item_id, p_track, now())
    on conflict (team_id, season, item_id, track) do update set marked_at = excluded.marked_at;
  else
    delete from public.priority_order_confirmed_empty
     where team_id = p_team_id
       and season = p_season
       and item_id = p_item_id
       and track = p_track;
  end if;

  select name into v_item_name from public.items where id = p_item_id;

  perform public.write_audit_log(
    p_team_id,
    'Priority Order Saved',
    'items',
    p_item_id,
    jsonb_build_object('item', v_item_name, 'track', p_track, 'players', v_count)
  );

  return v_count;
end;
$$;

revoke all on function public.save_priority_order(integer, text, integer, text, jsonb) from public;
revoke execute on function public.save_priority_order(integer, text, integer, text, jsonb) from anon;
grant execute on function public.save_priority_order(integer, text, integer, text, jsonb) to authenticated;
