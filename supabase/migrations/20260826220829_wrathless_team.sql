-- The Wrathless team row (#767). Wrathless raids with the guild but does not
-- use the site: no roster, no members, nobody there opening a team page. It
-- needs a teams row anyway, because submit_boe_found(p_team_id, ...) takes a
-- foreign key and prod holds only Phoenix, Hellfire and Immolation, so a
-- Wrathless BoE find cannot be recorded at all today.
--
-- Data in a migration is unusual here: every other team was created through
-- admin_create_team() on prod. This one is a migration because js/common.js's
-- TEAMS object is a hardcoded mirror of this table and needs the id as a
-- compile-time constant, so the id has to be the same locally, in CI and on
-- prod rather than whatever the sequence happens to hand out. Hence the
-- explicit id: a collision raises here instead of silently disagreeing with
-- the client config.
--
-- The team is hidden client-side only. It is a perfectly ordinary row as far
-- as the database is concerned; TEAMS marks it `hidden: true`, which keeps it
-- out of the team switcher and the cold-landing picker while ?team=wrathless
-- still resolves and the BoE reporting dropdown still lists it.

insert into public.teams (id, name, slug) values (4, 'Wrathless', 'wrathless');

-- Every write path (set_team_setting, fetchSupabaseSettings) assumes the row
-- exists and errors or returns null otherwise, so create it the same way
-- admin_create_team() does. An empty config means every feature flag is
-- unset, and an unset flag reads as enabled, so Wrathless can receive BoE
-- finds from the moment this lands.
insert into public.team_settings (team_id, config) values (4, '{}'::jsonb);

-- An explicit id does not advance the sequence, so the next admin_create_team()
-- would try to reuse it. greatest() rather than a bare setval so this can never
-- move the sequence backwards, whatever it currently holds (the read-only role
-- cannot inspect it, so this migration does not assume a starting value).
select setval(
  'public.teams_id_seq',
  greatest((select last_value from public.teams_id_seq), (select max(id) from public.teams))
);
