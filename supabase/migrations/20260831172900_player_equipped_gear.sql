-- generate_priority_order() has only ever compared candidates' loot-award
-- history for *this exact item* (rclc_loot/self_received_requests) against
-- the track being generated. It has no way to see "this raider already has
-- a Hero-equivalent item equipped in this same slot, just a different one"
-- -- e.g. a Hero belt from an earlier boss shouldn't leave someone first
-- priority on a different Hero belt drop. This table is the new signal a
-- later migration's generate_priority_order() change will read: one row
-- per player per physical gear slot, synced from the Blizzard API.
--
-- Keyed on Blizzard's own equipment slot vocabulary (HEAD/FINGER_1/
-- FINGER_2/TRINKET_1/TRINKET_2/MAIN_HAND/OFF_HAND/...), not items.slot/
-- BIS_SLOTS -- those are ambiguous by design (a Finger item fits either
-- finger slot; items.slot only says "Finger"), where the Character
-- Equipment Summary endpoint already tells us the raider's actual
-- positional assignment.
--
-- `track` is a display-only label, populated by the blizzard-gear-sync Edge
-- Function: the highest of Explorer/Adventurer/Veteran/Champion/Hero/Myth
-- in team_settings.config.trackIlvlThresholds (officer-maintained per
-- season, reseeded like tier_token_map) whose floor the item's item_level
-- clears -- not derived from any Blizzard API field. An earlier version of
-- this design tried reading the equipped item's own
-- `name_description.display_string` ("Heroic"/"Mythic"/etc), but that only
-- ever covers actual raid drops -- confirmed live (#845) that most of a
-- real roster's gear (Mythic+, crafted, delve) carries a completely
-- different descriptor or none at all, so most rows showed no label.
-- generate_priority_order()'s actual fairness comparison reads
-- `item_level` against the same thresholds directly, not this column --
-- `track` is purely the human-readable status label.
--
-- Public read, like player_wcl_season_perf/team_raid_progress -- equipped
-- gear is armory-visible information already, and this is what lets the
-- Priority Edit view explain a "Hero-Equivalent Equipped (Slot)" status
-- label to any visitor, not just officers. Write is officer/team_leader/
-- site_admin (the blizzard-gear-sync Edge Function's officer-triggered,
-- JWT-forwarded path) plus the service role (that same function's scheduled
-- cron sweep, which bypasses RLS entirely) -- no raider self-write path,
-- unlike bis_items, since nothing here is opinion/pick data a raider would
-- ever hand-edit.
create table public.player_equipped_gear (
  id serial primary key,
  player_id integer not null references public.players(id) on delete cascade,
  equipment_slot text not null,
  item_id integer,
  item_level integer,
  track text,
  synced_at timestamp with time zone not null default now(),
  unique (player_id, equipment_slot)
);

comment on table public.player_equipped_gear is
  'One row per player per physical gear slot (Blizzard API slot keys: HEAD, FINGER_1, FINGER_2, ...), synced from the Blizzard Character Equipment Summary endpoint. Feeds generate_priority_order()''s equipped-item-level fairness factor.';

alter table public.player_equipped_gear enable row level security;

create policy "Public read player_equipped_gear" on public.player_equipped_gear
  for select using (true);

create policy "Officers write player_equipped_gear" on public.player_equipped_gear
  for all
  using (my_team_role((select players.team_id from players where players.id = player_equipped_gear.player_id)) = any (array['officer', 'team_leader']) or is_site_admin())
  with check (my_team_role((select players.team_id from players where players.id = player_equipped_gear.player_id)) = any (array['officer', 'team_leader']) or is_site_admin());

create policy "Claude readers read player_equipped_gear" on public.player_equipped_gear
  for select to claude_readers using (true);
