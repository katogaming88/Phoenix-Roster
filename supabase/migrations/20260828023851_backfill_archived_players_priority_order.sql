-- 20260828022325_remove_player_priority_order.sql only wired the cleanup
-- into the roster-removal flow going forward -- anyone already archived
-- before that shipped (e.g. Sully-Thrall, removed earlier tonight) still has
-- stale priority_order rows sitting in the live season, same problem the
-- feature was meant to fix. One-time backfill: for every currently-archived
-- player, delete their priority_order rows for their team's live season
-- only -- past seasons are left alone as a historical record, same
-- reasoning as the RPC itself.
--
-- The live season code isn't stored anywhere as a code -- team_settings.config
-- ->>'seasonName' holds the display name ("Midnight Season 2"), same format
-- as item_preferences.season (20260828021126's fix). Reproduces
-- seasonCodeForDisplay()'s (js/common.js) "MID" + number regex conversion
-- in SQL, since there's no server-side equivalent to call. SEASON_LABELS is
-- an empty override map today, so the regex path is the only one that
-- actually runs client-side either.
delete from public.priority_order po
using public.players p, public.team_settings ts
where po.player_id = p.id
  and p.team_id = ts.team_id
  and p.archived_at is not null
  and po.season = regexp_replace(ts.config ->> 'seasonName', '^Midnight Season (\d+)$', 'MID\1');
