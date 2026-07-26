-- Exposes swap_from_name_realm on the public incoming_roster view (#586
-- follow-up): the signup-time "who's already playing this class" feature
-- needs to know which existing roster character a main-swap signup
-- replaces, so the old character can be excluded from that comparison
-- instead of double-counting one real person under two different names.
--
-- Not a security change -- character names are already public everywhere
-- else in this app (roster, bios, loot log). The view's existing column
-- boundary (player_note, signup_officer_note, reviewed_at, reviewed_by,
-- off_specs, submitted_at all stay out of reach) is unaffected; this only
-- adds one more already-public-shaped column.
create or replace view public.incoming_roster
as
select s.id as signup_id,
       s.team_id,
       s.signup_name_realm,
       cs.class,
       cs.spec,
       cs.role,
       s.swap_from_name_realm
from public.season_signups s
join public.team_settings ts
  on ts.team_id = s.team_id
left join public.classes_specs cs
  on cs.id = coalesce(s.swap_class_spec_id, s.class_spec_id)
where s.status = 'approved'
  and s.approved_player_id is null
  and s.season = ts.config->>'activeSignupSeason';

grant select on public.incoming_roster to anon, authenticated;
