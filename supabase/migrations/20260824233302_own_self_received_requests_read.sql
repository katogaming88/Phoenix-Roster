-- Raiders can read their own self_received_requests rows.
--
-- self_received_requests only had two SELECT policies: officers/team_leaders/
-- site_admins, and the claude_readers diagnostic role. A raider auto-
-- approving their own submit_self_received() call (or an officer approving
-- it later) never became visible to that raider -- fetchSupabaseSelfReceived()
-- (js/common.js) queries this table directly from the browser, RLS returned
-- zero rows, and the profile page fell back to showing the bare "Mark
-- received" button forever, even though the row was already 'approved' in
-- the database. The officer's own view was unaffected since the officer-read
-- policy already covered it -- hence "it shows for me but not for them".
--
-- Scoped to is_own_player(player_id), same helper bis_items already uses for
-- its raider-own-row policy. Not restricted to status = 'approved': a raider
-- seeing their own still-pending or rejected request is not a leak (it's
-- their own submission), and the profile page already filters to approved
-- rows client-side for what it renders.
create policy "Raiders read own self_received_requests"
on public.self_received_requests
for select
using (public.is_own_player(player_id));
