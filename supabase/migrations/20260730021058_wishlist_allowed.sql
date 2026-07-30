-- Per-raider Wishlist edit exception (#610/#611 follow-up).
--
-- item_preferences' RLS ("Raiders manage own item_preferences") never
-- checked the team-wide Wishlist Editing toggle at all -- that toggle
-- (team_settings.config.wishlistOpen) is purely a client-side gate in
-- js/wishlist.js, so a raider can already write their own rows any time at
-- the DB level. The gap is entirely UI: once wishlistOpen() is false, every
-- raider's edit controls disable, and there was no way to reopen just one
-- raider's the way bis_allowed (20260713100000_bis_link_requests.sql)
-- already lets an officer do for BiS Submissions. Same shape here: a plain
-- boolean column on players, gated by the same officer-write RLS rule that
-- table already has -- no new RPC needed, since (unlike BiS Submission,
-- which runs unauthenticated on the public roster page) Wishlist editing
-- only ever happens for an already-authenticated, already-claimed raider,
-- so there's no unauthenticated write path to re-validate server-side.
alter table public.players
  add column wishlist_allowed boolean not null default false;
