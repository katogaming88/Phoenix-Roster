-- Which primary stat(s) an item scales with, e.g. '["AGILITY","INTELLECT"]'.
-- Nullable: null means not yet backfilled (scripts/fetch-item-stats.js);
-- '[]' means confirmed stat-less (most on-use/proc trinkets), which the
-- wishlist/BiS filter treats as "visible to everyone", same as
-- secondary_stats' null-vs-empty convention.
alter table "public"."items" add column "main_stats" jsonb;
