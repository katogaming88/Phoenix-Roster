-- A real ring/trinket is always unique-equip, so when a raider tags it BiS
-- on one numbered slot (Trinket 1, say), the app mirrors that same status
-- onto its sibling row (Trinket 2) too -- it's the same physical item and
-- can land in either socket. Until now that mirror was indistinguishable
-- from an explicit tag: both rows just read status='bis', so the Wishlist
-- card for *either* slot showed "Already your Trinket 2 BiS pick" even on
-- the slot the raider actually clicked.
--
-- synced_bis marks which side is the mirror: false on the row the raider
-- explicitly tagged, true on the row the app wrote to keep the sibling in
-- sync. The Wishlist card only shows the "Already your X BiS pick" note (and
-- disables its buttons) on the synced=true side; the explicit side stays
-- freely editable with no note.
alter table "public"."item_preferences"
    add column "synced_bis" boolean not null default false;

-- Backfill: every existing pair of same-item BiS rows across Finger 1/2 or
-- Trinket 1/2 came from the mirror-on-set logic (either the raider's own
-- earlier tagging, or the 2026-08-19 backfill that caught up rows tagged
-- before that logic mirrored correctly). In every case the earlier
-- created_at is the row the raider actually clicked; the later one is the
-- mirror write a few seconds after. Flag the later side as synced.
update "public"."item_preferences"
set synced_bis = true
where id in (
  245, 283, 293, 963, 368, 431, 432, 482, 481, 565,
  575, 595, 605, 658, 2083, 786, 779, 791, 797, 1030,
  1034, 1033, 1036, 1044, 1046, 2092, 1137, 1139, 1291, 1293,
  1453, 1461, 3116, 1491, 3050, 3048, 2455, 1577, 1630, 1633,
  1685, 1720, 1726, 1727, 1764, 1770, 1947, 2020, 1998, 2019,
  2018, 2045, 2167, 2125, 2137, 2181, 2205, 2309, 2257, 2260,
  2262, 2427, 2547, 2549, 2760, 2771, 2842, 2800, 2860, 2877,
  2878, 3003, 2992, 3001
);
