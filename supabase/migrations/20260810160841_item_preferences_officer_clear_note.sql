-- Officers had no way to clean up a raider's redundant/noisy item_preferences
-- note (e.g. restating "BiS" in the note when the status tier already says
-- so) without going through the raider -- the Priority > Notes sub-tab
-- (js/tabs/tab-priority.js's buildPriorityNotesTab()) is read-only today.
-- This adds a narrow officer write path: an officer/team_leader can null out
-- the note column on any item_preferences row on their team, nothing else.

create policy "Officers clear item_preferences note" on "public"."item_preferences"
    for update
    using (("public"."my_team_role"("team_id") = any (array['officer'::text, 'team_leader'::text])))
    with check (("public"."my_team_role"("team_id") = any (array['officer'::text, 'team_leader'::text])));

-- The policy above only scopes *which row* an officer can update, not which
-- column or what value -- without this trigger, an officer could use it to
-- rewrite any column (status/item_id/slot) or set note to arbitrary text,
-- not just clear it.
--
-- First exemption: anything not running as literal current_user =
-- 'authenticated' (service-role sync, an officer running SQL Editor
-- directly, migrations, test seeding) -- mirrors
-- restrict_players_self_update_to_bonus_roll()
-- (20260809220657_players_bonus_roll_target.sql).
--
-- Second exemption: is_own_player(player_id) -- a raider's own existing
-- "Raiders manage own item_preferences" policy grants full column freedom
-- on their own rows (status/note/slot, whatever the wishlist editor writes),
-- and this trigger must not regress that.
--
-- Everything else reaches this row only through the new officer policy
-- above, so it's restricted to touching note alone, and only ever setting it
-- to NULL -- a clear, not a general edit, so an officer can't quietly
-- rewrite a raider's note to something else.
create or replace function "public"."restrict_item_preferences_officer_update_to_note_clear"() returns "trigger"
    language "plpgsql"
    as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if public.is_own_player(new.player_id) then
    return new;
  end if;

  if new.note is not null
     or (to_jsonb(new) - 'note' - 'updated_at') is distinct from (to_jsonb(old) - 'note' - 'updated_at')
  then
    raise exception 'Officers may only clear (set to null) the note column on item_preferences';
  end if;
  return new;
end $$;

alter function "public"."restrict_item_preferences_officer_update_to_note_clear"() owner to "postgres";

create trigger "trg_item_preferences_restrict_officer_update"
    before update on "public"."item_preferences"
    for each row execute function "public"."restrict_item_preferences_officer_update_to_note_clear"();
