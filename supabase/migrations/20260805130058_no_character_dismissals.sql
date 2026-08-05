-- #512: a Discord account with no claimed character gets an "I don't have a
-- character yet" option on the claim prompt (both the auto-popping modal and
-- the landing-page inline card) that persists so neither ever nags that
-- account again -- no existing row an unclaimed account can attach a flag to
-- (team_members/players rows are keyed by character, not by Discord account).
--
-- Global, not per-team: "I don't have a character" is inherently an
-- account-wide statement, not scoped to whichever team's page they happened
-- to be looking at when they said it.
--
-- No RPC -- mirrors streamers/notifications/item_preferences' direct-write-
-- gated-by-RLS self-service shape rather than claim_character()'s SECURITY
-- DEFINER RPC, since there's no cross-table validation or side effect here,
-- just "insert one row for myself." auth_user_id = auth.uid() inline (no
-- helper predicate) mirrors claim_character.sql's own "Members read own
-- team_members" policy, which skips a helper for the same single-column
-- check.
create table public.no_character_dismissals (
  id serial primary key,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  dismissed_at timestamp with time zone not null default now()
);

alter table public.no_character_dismissals enable row level security;

create policy "Raiders manage own no_character_dismissal" on public.no_character_dismissals
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

create policy "Claude readers read no_character_dismissals" on public.no_character_dismissals
  for select to claude_readers using (true);

grant select, insert on table public.no_character_dismissals to authenticated;
grant select on table public.no_character_dismissals to claude_readers;
