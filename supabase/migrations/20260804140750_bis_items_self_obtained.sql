-- #651: the Raider.IO tier sync needs a raider to be able to flip their own
-- bis_items.obtained without an officer in the loop -- bis_items writes were
-- officer-only until now (RLS: "Officers write bis_items", initial_schema.sql).
--
-- This adds a narrow self-service UPDATE policy (is_own_player(player_id),
-- same predicate streamers/notifications/item_preferences already use) plus a
-- trigger that locks every UPDATE -- officer or raider -- to the obtained
-- column only. item_id/player_id/slot/season are set once at insert
-- (bisSlotPickItem, js/tabs/tab-bis.js) and no code path updates them today;
-- the trigger just makes that already-true assumption load-bearing, so a
-- raider can never use this new policy to quietly reassign their own BiS pick
-- to a different item.
create policy "Raiders update own bis_items obtained" on "public"."bis_items"
    for update
    using ("public"."is_own_player"("player_id"))
    with check ("public"."is_own_player"("player_id"));

create or replace function "public"."restrict_bis_items_update_to_obtained"() returns "trigger"
    language "plpgsql"
    as $$
begin
  if new.item_id is distinct from old.item_id
    or new.player_id is distinct from old.player_id
    or new.slot is distinct from old.slot
    or new.season is distinct from old.season
  then
    raise exception 'bis_items updates may only change obtained';
  end if;
  return new;
end $$;

alter function "public"."restrict_bis_items_update_to_obtained"() owner to "postgres";

create trigger "trg_bis_items_restrict_update"
    before update on "public"."bis_items"
    for each row execute function "public"."restrict_bis_items_update_to_obtained"();
