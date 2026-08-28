-- Backfill for the attendance-carryover bug fixed in
-- 20260828122750_add_signup_to_roster_carry_attendance.sql. Two Team 1
-- main-swaps pushed earlier today (before the fix landed) left attendance
-- stranded on the archived character:
--   players 179 (Atilladapun-Area 52, archived)  -> 223 (Spoonsakimbo-Area 52)
--   players 198 (Phluffy-Stormrage, archived)     -> 222 (Fluffyfistz-Stormrage)
-- Confirmed via read-only query: each archived row held 5 attendance rows,
-- each new row held 0.
update public.attendance a set player_id = v.new_id
  from (values (179, 223), (198, 222)) as v(old_id, new_id)
 where a.player_id = v.old_id
   and not exists (
     select 1 from public.attendance b
      where b.team_id = a.team_id
        and b.player_id = v.new_id
        and b.raid_date = a.raid_date
   );
