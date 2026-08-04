-- Midnight Season 2 (12.1) tier gear doesn't drop as the wearable class
-- piece -- bosses drop a generic per-armor-type token (e.g. "Venomwoven
-- Idol"), which a raider manually converts via an NPC into their class's
-- named tier item (e.g. "Damned Necrolyte's Charred Grasps"). rclc_loot and
-- the wishlist's item_preferences both need to stay keyed to the token's
-- item_id, since that's what actually drops and what RCLootCouncil logs --
-- but the wishlist should *display* the raider's resolved class item, not
-- the generic token name/icon. This table is that lookup, used purely at
-- render time; it's never joined into priority/loot logic, which keeps
-- matching on the token item_id exactly as it does today.
--
-- Excludes the last-boss Omni-Curio on purpose -- that token can become any
-- of a class's 5 slots (raider's choice at the NPC, not deterministic like
-- the per-slot tokens below), so it's handled by loot-council judgment
-- entirely outside the wishlist/priority system.
--
-- Seeded by hand each tier from each class's Wowhead item-set page (same
-- category of manual per-season lookup as TOKEN_SLOT_KEYWORDS in
-- scripts/fetch-items.js) -- see scripts/fetch-tier-resolved-items.js for
-- the resolved items themselves.

create table "public"."tier_token_map" (
    "id" serial primary key,
    "token_item_id" integer not null references "public"."items"("id") on delete cascade,
    "class" text not null,
    "resolved_item_id" integer not null references "public"."items"("id") on delete cascade,
    "created_at" timestamp with time zone not null default now()
);

alter table "public"."tier_token_map" owner to "postgres";

-- One resolved item per token+class, and a resolved item never belongs to
-- more than one token/class pair.
create unique index "tier_token_map_token_class_key"
    on "public"."tier_token_map" ("token_item_id", "class");

create unique index "tier_token_map_resolved_item_key"
    on "public"."tier_token_map" ("resolved_item_id");

alter table "public"."tier_token_map" enable row level security;

-- Same trust model as items itself (Public read items, initial_schema.sql):
-- pure catalog reference data, no per-team/per-player scoping, world-visible.
create policy "Public read tier_token_map" on "public"."tier_token_map"
    for select using (true);

create policy "Claude readers read tier_token_map" on "public"."tier_token_map"
    for select to "claude_readers" using (true);

grant select on table "public"."tier_token_map" to "anon";
grant select on table "public"."tier_token_map" to "authenticated";
grant select on table "public"."tier_token_map" to "claude_readers";
