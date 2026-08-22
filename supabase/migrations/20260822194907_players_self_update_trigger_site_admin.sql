-- restrict_players_self_update_to_bonus_roll() was written to hand-mirror
-- "Officers write players"' predicate (my_team_role officer/team_leader OR
-- is_guild_officer()), but that predicate has since grown a third clause,
-- is_site_admin(), that this trigger was never updated to match (see
-- 20260809220657_players_bonus_roll_target.sql's own comment warning this
-- would drift). A site admin acting on a team they have no team_members row
-- on and aren't a guild officer for -- exactly the Reports tab's bulk
-- Raider.IO tier sync run against another team -- passed the RLS check but
-- then hit this trigger's raise exception on every row, surfaced to the
-- browser as a 400 on every players PATCH.
create or replace function "public"."restrict_players_self_update_to_bonus_roll"() returns "trigger"
    language "plpgsql"
    as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if coalesce(public.my_team_role(new.team_id) = any (array['officer', 'team_leader']), false)
     or public.is_guild_officer()
     or public.is_site_admin()
  then
    return new;
  end if;

  if (to_jsonb(new) - 'bonus_roll_encounter_id' - 'updated_at')
     is distinct from (to_jsonb(old) - 'bonus_roll_encounter_id' - 'updated_at') then
    raise exception 'Raiders may only update bonus_roll_encounter_id on their own player row';
  end if;
  return new;
end $$;
