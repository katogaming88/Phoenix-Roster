-- Officers had no way to acknowledge a Priority List same-boss conflict
-- (a player holding #1 on 2+ items locked behind the same boss+track kill)
-- once they'd reviewed it and decided it was fine -- the banner just kept
-- re-showing it forever. One row per acknowledged (player, boss, track)
-- combination, scoped to the season the conflict was seen in (the same
-- Priority List Conflicts banner's own data -- DATA.priorityLiveFirstPrios,
-- js/common.js -- is season-scoped per remapPriorityDataForSeasonView()), so
-- a same-named boss recurring in a future season's raid doesn't inherit a
-- stale dismissal.
--
-- No RPC: mirrors item_preferences/streamers' direct-write-gated-by-RLS
-- shape rather than a SECURITY DEFINER function, since this is just "insert
-- one row" / "delete one row" with no cross-table validation or side effect.
create table public.priority_conflict_dismissals (
  id serial primary key,
  team_id integer not null references public.teams(id) on delete cascade,
  player_id integer references public.players(id) on delete set null,
  season text not null,
  boss text not null,
  track text not null,
  dismissed_by uuid references auth.users(id) on delete set null,
  dismissed_at timestamp with time zone not null default now(),
  unique (team_id, player_id, season, boss, track)
);

comment on table public.priority_conflict_dismissals is
  'Officer-acknowledged Priority List same-boss conflicts (a player holding #1 on 2+ items behind one boss+track kill), so buildPriorityConflictsBannerHtml() (js/tabs/tab-priority.js) stops re-flagging a reviewed one.';

create trigger trg_priority_conflict_dismissals_team_id_check
  before insert or update on public.priority_conflict_dismissals
  for each row execute function public.check_team_id_matches_player();

alter table public.priority_conflict_dismissals enable row level security;

create policy "Officers manage priority_conflict_dismissals" on public.priority_conflict_dismissals
  for all
  using (my_team_role(team_id) = any (array['officer', 'team_leader']) or is_site_admin())
  with check (my_team_role(team_id) = any (array['officer', 'team_leader']) or is_site_admin());

create policy "Claude readers read priority_conflict_dismissals" on public.priority_conflict_dismissals
  for select to claude_readers using (true);

grant select, insert, delete on table public.priority_conflict_dismissals to authenticated;
grant select on table public.priority_conflict_dismissals to claude_readers;
