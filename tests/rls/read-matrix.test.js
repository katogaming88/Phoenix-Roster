// Read-path assertions for every public table, driven by the policy matrix
// in docs/RLS.md. If a table is added or a read policy changes, this file
// and that matrix move together.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  countAs,
  OFFICER_T1,
  OFFICER_T2,
  RAIDER_T1,
  SITE_ADMIN,
  TEAM_LEADER_T1,
  GUILD_OFFICER
} from './helpers.js';

// Matrix: tables with a `using (true)` public SELECT policy.
const PUBLIC_READ = [
  'attendance',
  'bis_items',
  'classes_specs',
  'item_bosses',
  'items',
  'player_wcl_season_perf',
  'players',
  'priority_order',
  'rclc_loot',
  'scoring',
  'site_settings',
  'team_settings',
  'teams'
];

// Matrix: tables whose SELECT is officer/admin/site-admin scoped. All seeded
// rows in these belong to team 1, so visibility is asserted against team 1.
const GATED = [
  'audit_log',
  'bis_requests',
  'boe_items',
  'boe_listings',
  'boe_managers',
  'guild_officers',
  'mplus_exclusion_requests',
  'season_signups',
  'self_received_requests',
  'site_admins',
  'team_members'
];

// Gated tables an officer can read for their own team. Three exceptions, each
// with its own block below: site_admins and guild_officers are site-admin only
// ([#607](https://github.com/katogaming88/WGA-Raid-Hub/issues/607)), and
// boe_managers is readable by any officer on any team since the grant went
// guild-wide ([#766](https://github.com/katogaming88/WGA-Raid-Hub/issues/766)).
const OFFICER_READABLE = GATED.filter((t) => t !== 'site_admins' && t !== 'guild_officers' && t !== 'boe_managers');

describe('public-read tables are visible to everyone', () => {
  for (const table of PUBLIC_READ) {
    it(`anon sees seeded rows in ${table}`, async () => {
      expect(await countAs('anon', null, table)).toBeGreaterThan(0);
    });
    it(`raider sees seeded rows in ${table}`, async () => {
      expect(await countAs('authenticated', RAIDER_T1, table)).toBeGreaterThan(0);
    });
  }
});

describe('gated tables hide their rows from anon and raiders', () => {
  for (const table of GATED) {
    it(`anon sees no rows in ${table}`, async () => {
      expect(await countAs('anon', null, table)).toBe(0);
    });
  }
  // team_members has a self-read policy (a member reads their own row, #212);
  // the other gated tables stay fully hidden from raiders.
  for (const table of GATED.filter((t) => t !== 'team_members')) {
    it(`raider sees no rows in ${table}`, async () => {
      expect(await countAs('authenticated', RAIDER_T1, table)).toBe(0);
    });
  }
  it('raider sees only their own team_members row', async () => {
    expect(await countAs('authenticated', RAIDER_T1, 'team_members')).toBe(1);
    expect(await countAs('authenticated', RAIDER_T1, 'team_members', 'team_id = 2')).toBe(0);
  });
});

describe('officers read their own team, not other teams', () => {
  const where = { team_members: 'team_id = 1' };
  for (const table of OFFICER_READABLE) {
    it(`team 1 officer sees team 1 rows in ${table}`, async () => {
      expect(await countAs('authenticated', OFFICER_T1, table, where[table] ?? 'team_id = 1')).toBeGreaterThan(0);
    });
    it(`team 2 officer sees no team 1 rows in ${table}`, async () => {
      expect(await countAs('authenticated', OFFICER_T2, table, where[table] ?? 'team_id = 1')).toBe(0);
    });
  }
});

describe('boe_managers visibility (#766)', () => {
  // The grant is guild-wide and has no team_id to scope by, so the read is
  // "any officer anywhere", not "an officer on the granted member's team".
  // Deliberately wider than guild_officers: an ungranted officer looking at a
  // find they cannot act on needs a way to see who can.
  it('an officer on either team sees the grants', async () => {
    expect(await countAs('authenticated', OFFICER_T1, 'boe_managers')).toBeGreaterThan(0);
    expect(await countAs('authenticated', OFFICER_T2, 'boe_managers')).toBeGreaterThan(0);
  });
  it('a team leader sees the grants', async () => {
    expect(await countAs('authenticated', TEAM_LEADER_T1, 'boe_managers')).toBeGreaterThan(0);
  });
  it('a site admin sees the grants', async () => {
    expect(await countAs('authenticated', SITE_ADMIN, 'boe_managers')).toBeGreaterThan(0);
  });
  it('a raider and a guild officer do not', async () => {
    expect(await countAs('authenticated', RAIDER_T1, 'boe_managers')).toBe(0);
    expect(await countAs('authenticated', GUILD_OFFICER, 'boe_managers')).toBe(0);
  });
  it('anon does not', async () => {
    expect(await countAs('anon', null, 'boe_managers')).toBe(0);
  });
});

describe('pending_roster view inherits season_signups visibility', () => {
  // security_invoker view over season_signups; the underlying officer-only
  // policies must apply to callers of the view, not the view owner.
  it('anon sees no rows', async () => {
    expect(await countAs('anon', null, 'pending_roster')).toBe(0);
  });
  it('raider sees no rows', async () => {
    expect(await countAs('authenticated', RAIDER_T1, 'pending_roster')).toBe(0);
  });
  it('team 1 officer sees team 1 approved signups only', async () => {
    expect(await countAs('authenticated', OFFICER_T1, 'pending_roster', 'team_id = 1')).toBeGreaterThan(0);
    expect(await countAs('authenticated', OFFICER_T1, 'pending_roster', 'team_id = 2')).toBe(0);
  });
  it('team 2 officer sees no team 1 rows', async () => {
    expect(await countAs('authenticated', OFFICER_T2, 'pending_roster', 'team_id = 1')).toBe(0);
  });
  it('pending signups do not appear in the view', async () => {
    expect(
      await countAs('authenticated', OFFICER_T1, 'pending_roster', "signup_name_realm = 'Seedsignup-Illidan'")
    ).toBe(0);
  });
});

describe('site admin visibility', () => {
  it('site admin sees team_members', async () => {
    expect(await countAs('authenticated', SITE_ADMIN, 'team_members')).toBeGreaterThan(0);
  });
  it('site admin sees site_admins', async () => {
    expect(await countAs('authenticated', SITE_ADMIN, 'site_admins')).toBeGreaterThan(0);
  });
  it('team 1 team leader cannot see site_admins', async () => {
    expect(await countAs('authenticated', TEAM_LEADER_T1, 'site_admins')).toBe(0);
  });

  // #413: a site admin has no team_members row on any team (seed.sql), so
  // seeing team 1's rows here already proves cross-team access -- these four
  // were the only officer-scoped tables missing the is_site_admin()
  // OR-clause every other gated table already has.
  for (const table of ['season_signups', 'bis_requests', 'mplus_exclusion_requests', 'self_received_requests']) {
    it(`site admin sees ${table} rows despite no team_members role anywhere`, async () => {
      expect(await countAs('authenticated', SITE_ADMIN, table, 'team_id = 1')).toBeGreaterThan(0);
    });
  }
  it('site admin sees season_signups rows on team 2 too', async () => {
    expect(await countAs('authenticated', SITE_ADMIN, 'season_signups', 'team_id = 2')).toBeGreaterThan(0);
  });
});

describe('guild officer visibility (#607)', () => {
  // GUILD_OFFICER holds no team_members role on team 1 beyond a plain
  // raider row -- seeing team 1's audit_log/team_members rows here proves
  // the cross-team grant, same shape as the site-admin block above.
  it('guild officer sees team 1 audit_log rows', async () => {
    expect(await countAs('authenticated', GUILD_OFFICER, 'audit_log', 'team_id = 1')).toBeGreaterThan(0);
  });
  it('guild officer sees team 1 team_members rows beyond their own', async () => {
    expect(await countAs('authenticated', GUILD_OFFICER, 'team_members', 'team_id = 1')).toBeGreaterThan(0);
  });
  it('guild officer cannot see guild_officers (site-admin only, like site_admins)', async () => {
    expect(await countAs('authenticated', GUILD_OFFICER, 'guild_officers')).toBe(0);
  });
  it('site admin sees guild_officers', async () => {
    expect(await countAs('authenticated', SITE_ADMIN, 'guild_officers')).toBeGreaterThan(0);
  });
  it('team 1 team leader cannot see guild_officers', async () => {
    expect(await countAs('authenticated', TEAM_LEADER_T1, 'guild_officers')).toBe(0);
  });
});

afterAll(() => pool.end());
