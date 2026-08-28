-- Backfill for the priority_order-carryover bug fixed in
-- 20260828124142_add_signup_to_roster_clear_priority_order.sql. Confirmed
-- via read-only query: players 179 (Atilladapun-Area 52) and 198
-- (Phluffy-Stormrage), archived by today's two Team 1 main-swaps before the
-- fix landed, still held 20 and 26 priority_order rows in the live season
-- (MID2). Same query as the original backfill
-- (20260828023851_backfill_archived_players_priority_order.sql), rerun
-- since it's scoped to "every currently-archived player" and is a no-op for
-- anyone already cleaned up.
delete from public.priority_order po
using public.players p, public.team_settings ts
where po.player_id = p.id
  and p.team_id = ts.team_id
  and p.archived_at is not null
  and po.season = regexp_replace(ts.config ->> 'seasonName', '^Midnight Season (\d+)$', 'MID\1');
