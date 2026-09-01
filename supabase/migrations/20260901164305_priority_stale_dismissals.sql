-- Officers could already acknowledge a Priority List same-boss conflict
-- (priority_conflict_dismissals, 20260831132302) and have it stop
-- re-flagging, but the other conflict type buildPriorityConflictsBannerHtml()
-- (js/tabs/tab-priority.js) shows -- a Mythic #1 who already has the Heroic
-- version of that same item (priority_order_stale_after_heroic) -- had no
-- such acknowledgment path. It's a genuinely different shape (keyed by
-- player+item, not player+boss+track, and always Myth-track by the view's
-- own definition), so this is a sibling table rather than overloading
-- priority_conflict_dismissals with nullable alternates -- that table's
-- (boss, track) columns are NOT NULL and its unique constraint would need a
-- partial-index rework to safely allow a second, differently-shaped key
-- alongside them.
create table public.priority_stale_dismissals (
  id serial primary key,
  team_id integer not null references public.teams(id) on delete cascade,
  player_id integer references public.players(id) on delete set null,
  season text not null,
  item_id integer not null references public.items(id) on delete cascade,
  dismissed_by uuid references auth.users(id) on delete set null,
  dismissed_at timestamp with time zone not null default now(),
  unique (team_id, player_id, season, item_id)
);

comment on table public.priority_stale_dismissals is
  'Officer-acknowledged "stale-after-Heroic" Priority List conflicts (a Mythic #1 who already has the Heroic version of the same item), so buildPriorityConflictsBannerHtml() (js/tabs/tab-priority.js) stops re-flagging a reviewed one. Sibling to priority_conflict_dismissals, kept separate since this is keyed by player+item rather than player+boss+track.';

-- Reuses the existing generic trigger (initial_schema.sql) -- it only
-- checks NEW.team_id against players.team_id for NEW.player_id, so it works
-- unmodified for any table shaped like this one.
create trigger trg_priority_stale_dismissals_team_id_check
  before insert or update on public.priority_stale_dismissals
  for each row execute function public.check_team_id_matches_player();

alter table public.priority_stale_dismissals enable row level security;

create policy "Officers manage priority_stale_dismissals" on public.priority_stale_dismissals
  for all
  using (my_team_role(team_id) = any (array['officer', 'team_leader']) or is_site_admin())
  with check (my_team_role(team_id) = any (array['officer', 'team_leader']) or is_site_admin());

create policy "Claude readers read priority_stale_dismissals" on public.priority_stale_dismissals
  for select to claude_readers using (true);

grant select, insert, delete on table public.priority_stale_dismissals to authenticated;
grant select on table public.priority_stale_dismissals to claude_readers;
