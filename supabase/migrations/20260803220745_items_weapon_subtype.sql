-- Which weapon subtype an item is (e.g. 'Axe', 'Dagger', 'Staff', 'Shield'),
-- for Weapon/Off Hand row class-eligibility filtering (#609). Only
-- meaningful for items.slot in ('One-Hand','Two-Hand','Ranged','Off Hand') --
-- Wowhead/Blizzard's item_subclass name for an armor piece isn't a weapon
-- subtype at all, so scripts/fetch-item-stats.js only ever sets this for
-- items.slot values in that set. Nullable: null means not yet backfilled,
-- same convention as main_stats -- the wishlist/BiS filter treats a null
-- weapon_subtype as "visible to everyone" until backfilled.
alter table "public"."items" add column "weapon_subtype" text;
