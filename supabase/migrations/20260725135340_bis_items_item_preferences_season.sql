-- Other Sources rows (M+/Crafted/Catalyst placeholders in bis_items and
-- item_preferences) aren't tied to a raid zone the way real items are, so
-- the existing season scope check (items.wcl_zone_id) always treats them as
-- in scope regardless of which season is being viewed. A pick tagged for one
-- season kept showing up forever, never expiring when the team moved on to
-- a later season. This column lets the client stamp/compare the season a
-- placeholder row was tagged under, same as the read side already compares
-- raid_zones.season for real items.
alter table "public"."bis_items" add column "season" text;
alter table "public"."item_preferences" add column "season" text;

-- One-time backfill: stamp every existing row with whatever season name
-- each team currently has configured (team_settings.config->>'seasonName'),
-- the best available guess for "when was this tagged" for rows that predate
-- this column. bis_items has no team_id of its own, so it goes through
-- players.team_id; item_preferences already carries team_id directly.
update "public"."bis_items" b
set "season" = ts.config ->> 'seasonName'
from "public"."players" p
join "public"."team_settings" ts on ts.team_id = p.team_id
where b.player_id = p.id
  and b.season is null;

update "public"."item_preferences" ip
set "season" = ts.config ->> 'seasonName'
from "public"."team_settings" ts
where ip.team_id = ts.team_id
  and ip.season is null;
