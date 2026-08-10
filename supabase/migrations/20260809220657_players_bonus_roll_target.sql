-- Bonus Roll target (informational, not fed into generate_priority_order()):
-- a raider declares which current-raid boss they're planning to spend their
-- weekly Bonus Roll coin on, until they get the item(s) they're after --
-- purely a heads-up for officers, distinct from Wishlist/BiS. Self-service,
-- same is_own_player() predicate as streamers/notifications/item_preferences/
-- bis_items.obtained.
alter table "public"."players"
    add column "bonus_roll_encounter_id" integer references "public"."raid_encounters"("id") on delete set null;

create policy "Raiders update own bonus_roll_encounter_id" on "public"."players"
    for update
    using ("public"."is_own_player"("id"))
    with check ("public"."is_own_player"("id"));

-- The policy above only scopes *which row* a raider can update, not which
-- column -- without this trigger, a raider could use it to touch any column
-- on their own players row (class_spec_id, is_bench, nickname, ...), not
-- just bonus_roll_encounter_id.
--
-- First exemption: anything not running as literal current_user =
-- 'authenticated' -- a service-role sync, an officer running SQL Editor
-- directly, migrations, test seeding, or (the case that actually caught this
-- during testing) archive_current_season(). That function is SECURITY
-- INVOKER, not DEFINER, and is called by team_leader as well as officer to
-- legitimately rewrite several players columns during season archival --
-- but SET LOCAL ROLE authenticated only changes current_user for the outer
-- statement/session, and plpgsql function bodies don't re-derive it, so
-- current_user is *still* 'authenticated' inside it too. This first check
-- alone would not have caught that case; it only covers truly
-- role-switched-away-from-authenticated contexts (raw superuser writes,
-- SECURITY DEFINER functions where current_user briefly becomes the
-- function owner).
--
-- Second exemption: the exact predicate "Officers write players" (this
-- table's own officer/team_leader/guild-officer write policy,
-- 20260706195440_team_leader_role_rename.sql +
-- 20260730113259_guild_officer_tier.sql) currently uses -- kept in sync by
-- hand since RLS policy predicates aren't reusable as a function. If that
-- policy's predicate changes, update this to match or a legitimate
-- officer-role edit through archive_current_season() (or any other
-- SECURITY INVOKER function sharing that predicate) starts getting wrongly
-- blocked here.
--
-- Compares the whole row via to_jsonb() rather than an explicit column list
-- (the pattern restrict_bis_items_update_to_obtained() uses) since players
-- has grown many columns across migrations and a hardcoded list silently
-- goes stale the next time one is added -- a jsonb diff can't drift.
-- updated_at is excluded since trg_players_updated_at (initial_schema.sql)
-- legitimately changes it on every update regardless of who made it.
create or replace function "public"."restrict_players_self_update_to_bonus_roll"() returns "trigger"
    language "plpgsql"
    as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if coalesce(public.my_team_role(new.team_id) = any (array['officer', 'team_leader']), false)
     or public.is_guild_officer()
  then
    return new;
  end if;

  if (to_jsonb(new) - 'bonus_roll_encounter_id' - 'updated_at')
     is distinct from (to_jsonb(old) - 'bonus_roll_encounter_id' - 'updated_at') then
    raise exception 'Raiders may only update bonus_roll_encounter_id on their own player row';
  end if;
  return new;
end $$;

alter function "public"."restrict_players_self_update_to_bonus_roll"() owner to "postgres";

create trigger "trg_players_restrict_self_update"
    before update on "public"."players"
    for each row execute function "public"."restrict_players_self_update_to_bonus_roll"();
