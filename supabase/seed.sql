-- Local/CI test fixtures. Applied automatically by `supabase db reset`
-- (config.toml [db.seed]). Never pushed to the cloud: `db push` only runs
-- migrations.
--
-- Identities used by tests/rls/. The UUIDs are what the harness puts in
-- request.jwt.claims to impersonate each person; they must stay in sync
-- with tests/rls/helpers.js.
--
--   ...0001  officer on team 1
--   ...0002  team leader on team 1
--   ...0003  raider on team 1
--   ...0004  site admin (no team role)
--   ...0005  officer on team 2
--   ...0006  a season_signups.auth_user_id owner, no team_members/players row
--            (get_own_signup()/update_own_signup() never touch those tables)
--   ...0007  guild officer (#607): a plain raider on team 1, no officer/
--            team_leader role anywhere, but granted guild_officers -- models
--            a Guild Master raiding on one team with no team-leadership role

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000004'),
  ('00000000-0000-0000-0000-000000000005'),
  ('00000000-0000-0000-0000-000000000006'),
  ('00000000-0000-0000-0000-000000000007');

insert into public.teams (id, name, slug) values
  (1, 'Team Phoenix', 'phoenix'),
  (2, 'Hellfire Rollers', 'hellfire');

insert into public.team_members (id, team_id, discord_id, auth_user_id, role, name_realm) values
  (1, 1, 'discord-officer-1', '00000000-0000-0000-0000-000000000001', 'officer', 'Seedofficer-Illidan'),
  (2, 1, 'discord-leader-1',  '00000000-0000-0000-0000-000000000002', 'team_leader', 'Seedleader-Illidan'),
  (3, 1, 'discord-raider-1',  '00000000-0000-0000-0000-000000000003', 'raider',  'Seedraider-Illidan'),
  (4, 2, 'discord-officer-2', '00000000-0000-0000-0000-000000000005', 'officer', 'Seedofficertwo-Illidan'),
  (5, 1, 'discord-guildofficer-1', '00000000-0000-0000-0000-000000000007', 'raider', 'Seedguildofficer-Illidan');

insert into public.site_admins (id, discord_id, auth_user_id) values
  (1, 'discord-site-admin', '00000000-0000-0000-0000-000000000004');

insert into public.guild_officers (id, discord_id, auth_user_id) values
  (1, 'discord-guildofficer-1', '00000000-0000-0000-0000-000000000007');

insert into public.classes_specs (id, class, spec, role) values
  (1, 'Mage', 'Frost', 'Ranged');

-- Item 3 is the seed's one BoE (#875): submit_boe_found links a find to a
-- flagged row only, and the picker suites want one to offer. Unscoped (no
-- wcl_zone_id), like the other two, so it shows for every season.
insert into public.items (id, wow_item_id, name, slot, armor_type, is_boe) values
  (1, 100001, 'Seed Test Staff', 'Two-Hand', null, false),
  (2, 100002, 'Seed Test Robe', 'Chest', 'Cloth', false),
  (3, 100003, 'Seed Test BoE Belt', 'Waist', 'Leather', true);

insert into public.players (id, team_id, name_realm, class_spec_id) values
  (1, 1, 'Seedraider-Illidan', 1),
  (2, 1, 'Seedplayertwo-Illidan', 1),
  (3, 2, 'Seedhellfire-Illidan', 1);

-- One row per gated table so the harness can prove invisibility to the
-- wrong roles and visibility plus UPDATE reach to the right ones.

insert into public.audit_log (id, team_id, actor_id, action) values
  (1, 1, '00000000-0000-0000-0000-000000000001', 'seed_test_action');

insert into public.bis_requests (id, team_id, player_id, bis_link, status) values
  (1, 1, 1, 'https://example.com/seed-bis-link', 'pending');

insert into public.mplus_exclusion_requests (id, team_id, player_id, reason, status) values
  (1, 1, 1, 'seed test reason', 'pending');

-- #925: player 1 carries the note so the gated-table matrix has a row to
-- prove invisible to anon and raiders. Player 2 is left without one, so the
-- write assertions have a free primary key to insert against.
insert into public.player_officer_notes (player_id, team_id, officer_notes) values
  (1, 1, 'seed officer note');

-- Signup 1 exercises the gated-table matrix; 2 and 3 are approved so the
-- pending_roster view and add_signup_to_roster() have rows to work with.
insert into public.season_signups (id, team_id, signup_name_realm, class_spec_id, season, status) values
  (1, 1, 'Seedsignup-Illidan', 1, 'seed-season', 'pending'),
  (2, 1, 'Seedapproved-Illidan', 1, 'seed-season', 'approved'),
  (3, 2, 'Seedapprovedtwo-Illidan', 1, 'seed-season', 'approved');

insert into public.self_received_requests (id, team_id, player_id, self_item_id, status) values
  (1, 1, 1, 2, 'pending');

-- Corrections fixtures (#756): an approved and a rejected row on team 1 plus
-- an approved row on team 2, so delete_self_received_request() and the
-- revert-to-pending UPDATE path have per-role targets. Placed before the
-- bis_items block below on purpose: the approved inserts fire
-- trg_self_received_sync_bis_obtained, and with no matching bis_items row
-- existing yet the seed's obtained flags stay false. Row 2 shares
-- (player 1, item 1) with the bis_items seed row so the sync tests can
-- exercise the trigger against it.
insert into public.self_received_requests (id, team_id, player_id, self_item_id, status, track, source, slot) values
  (2, 1, 1, 1, 'approved', 'Hero', 'M+', null),
  (3, 1, 2, 2, 'rejected', 'Champion', 'Great Vault', null),
  (4, 2, 3, 1, 'approved', 'Myth', 'Crafted', null);

-- BoE tracker (#745): item 1 is found and owned by (unlinked) player 1 so
-- own-row read tests can link and see it; item 2 is sold with an unresolved
-- finder and a split satisfying the policy formula (150000 -> 30000 / 112500
-- with a 7500 auction house fee at floor 20000 / pivot 100000, #861);
-- listing 1 hangs off the sold item. The
-- manager grant goes to the team-1 officer's Discord id; the team-1 leader
-- stays ungranted to prove grant-only writes. The grant is guild-wide (#766),
-- so it authorizes that person on every team, not just team 1.
insert into public.boe_items (id, team_id, player_id, finder_name, item_id, item_name, track, season, status, found_at) values
  (1, 1, 1, 'Seedraider-Illidan', 1, 'Seed Test Staff', 'Hero', 'seed-season', 'found', '2026-01-02T00:00:00Z');

insert into public.boe_items (id, team_id, player_id, finder_name, item_id, item_name, track, season, status,
    found_at, sold_at, sale_price, finder_payout, guild_cut, ah_fee, payout_floor, payout_pivot) values
  (2, 1, null, 'Oldfinder-Illidan', null, 'Seed Sold Sash', 'Myth', 'seed-season', 'sold',
    '2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z', 150000, 30000, 112500, 7500, 20000, 100000);

insert into public.boe_listings (id, team_id, boe_item_id, price, listed_at) values
  (1, 1, 2, 160000, '2026-01-02T12:00:00Z');

insert into public.boe_managers (id, discord_id, auth_user_id) values
  (1, 'discord-officer-1', '00000000-0000-0000-0000-000000000001');

-- Rows for public-read tables the matrix test asserts are visible.

insert into public.attendance (id, team_id, player_id, raid_date, status) values
  (1, 1, 1, '2026-01-01', 'Present');

insert into public.bis_items (id, player_id, item_id, obtained) values
  (1, 1, 1, false);

insert into public.scoring (id, player_id, season) values
  (1, 1, 'seed-season');

insert into public.priority_order (id, team_id, season, item_id, track, rank, player_id) values
  (1, 1, 'seed-season', 1, 'Myth', 1, 1);

insert into public.rclc_loot (id, team_id, player_id, item_id, track, season) values
  (1, 1, 1, 1, 'Myth', 'seed-season');

insert into public.player_wcl_season_perf (player_id, team_id, season) values
  (1, 1, 'seed-season');

insert into public.team_settings (team_id, config) values
  (1, '{"activeSignupSeason":"seed-season"}'),
  (2, '{"activeSignupSeason":"seed-season"}');

insert into public.item_bosses (item_id, boss) values
  (1, 'Seed Test Boss');

-- Serial sequences must move past the explicit ids above or the first
-- INSERT a test makes collides on the primary key.
select setval('public.teams_id_seq', 10);
select setval('public.team_members_id_seq', 10);
select setval('public.site_admins_id_seq', 10);
select setval('public.guild_officers_id_seq', 10);
select setval('public.classes_specs_id_seq', 10);
select setval('public.items_id_seq', 10);
select setval('public.players_id_seq', 10);
select setval('public.audit_log_id_seq', 10);
select setval('public.bis_requests_id_seq', 10);
select setval('public.mplus_exclusion_requests_id_seq', 10);
select setval('public.signups_id_seq', 10);
select setval('public.self_received_requests_id_seq', 10);
select setval('public.attendance_id_seq', 10);
select setval('public.bis_items_id_seq', 10);
select setval('public.scoring_id_seq', 10);
select setval('public.priority_order_id_seq', 10);
select setval('public.loot_id_seq', 10);
select setval('public.boe_items_id_seq', 10);
select setval('public.boe_listings_id_seq', 10);
select setval('public.boe_managers_id_seq', 10);
