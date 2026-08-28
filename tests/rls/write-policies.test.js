// Write-path assertions per policy shape. Payloads reference seeded rows
// (supabase/seed.sql) and satisfy every CHECK constraint and the
// check_team_id_matches_player trigger, so the only variable is the role;
// a rejection can only come from RLS. Every statement runs in a rolled-back
// transaction.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  queryAs,
  withRole,
  RLS_DENIED,
  OFFICER_T1,
  TEAM_LEADER_T1,
  RAIDER_T1,
  SITE_ADMIN,
  OFFICER_T2,
  GUILD_OFFICER
} from './helpers.js';

async function expectDenied(role, uid, sql, params) {
  await expect(queryAs(role, uid, sql, params)).rejects.toMatchObject({ code: RLS_DENIED });
}

// Tables with a direct my_team_role(team_id) officer-write policy. All
// payloads target team 1 with team-1 players.
const DIRECT_TEAM_INSERTS = {
  players: "insert into public.players (team_id, name_realm) values (1, 'Testinsert-Illidan')",
  attendance:
    "insert into public.attendance (team_id, player_id, raid_date, status) values (1, 1, '2026-02-02', 'Present')",
  priority_order:
    "insert into public.priority_order (team_id, season, item_id, track, rank, player_id) values (1, 'test-season', 1, 'Hero', 1, 1)",
  rclc_loot:
    "insert into public.rclc_loot (team_id, player_id, item_id, track, season) values (1, 1, 1, 'Hero', 'test-season')",
  player_wcl_season_perf:
    "insert into public.player_wcl_season_perf (player_id, team_id, season) values (1, 1, 'test-season')"
};

describe('officer-write tables (direct team_id scope)', () => {
  for (const [table, sql] of Object.entries(DIRECT_TEAM_INSERTS)) {
    it(`team 1 officer can insert into ${table}`, async () => {
      const res = await queryAs('authenticated', OFFICER_T1, sql);
      expect(res.rowCount).toBe(1);
    });
    // Regression for #293 on player_wcl_season_perf: WITH CHECK used to
    // allow only officer, so admins passed USING but failed every write.
    it(`team 1 team leader can insert into ${table}`, async () => {
      const res = await queryAs('authenticated', TEAM_LEADER_T1, sql);
      expect(res.rowCount).toBe(1);
    });
    it(`raider cannot insert into ${table}`, async () => {
      await expectDenied('authenticated', RAIDER_T1, sql);
    });
    it(`anon cannot insert into ${table}`, async () => {
      await expectDenied('anon', null, sql);
    });
    it(`team 2 officer cannot insert team 1 rows into ${table}`, async () => {
      await expectDenied('authenticated', OFFICER_T2, sql);
    });
  }
});

describe('officer-write tables (team resolved through players subquery)', () => {
  // player 2 is on team 1; item 2 avoids the seeded unique pairs.
  const SUBQUERY_INSERTS = {
    bis_items: 'insert into public.bis_items (player_id, item_id) values (2, 2)',
    scoring: "insert into public.scoring (player_id, season) values (2, 'test-season')"
  };
  for (const [table, sql] of Object.entries(SUBQUERY_INSERTS)) {
    it(`team 1 officer can insert into ${table} for a team 1 player`, async () => {
      const res = await queryAs('authenticated', OFFICER_T1, sql);
      expect(res.rowCount).toBe(1);
    });
    it(`team 2 officer cannot insert into ${table} for a team 1 player`, async () => {
      await expectDenied('authenticated', OFFICER_T2, sql);
    });
    it(`raider cannot insert into ${table}`, async () => {
      await expectDenied('authenticated', RAIDER_T1, sql);
    });
  }
});

describe('team_members is team-leader and site-admin only', () => {
  const sql = "insert into public.team_members (team_id, discord_id, role) values (1, 'discord-new-member', 'raider')";
  it('team 1 team leader can insert', async () => {
    const res = await queryAs('authenticated', TEAM_LEADER_T1, sql);
    expect(res.rowCount).toBe(1);
  });
  it('site admin can insert', async () => {
    const res = await queryAs('authenticated', SITE_ADMIN, sql);
    expect(res.rowCount).toBe(1);
  });
  it('team 1 officer cannot insert', async () => {
    await expectDenied('authenticated', OFFICER_T1, sql);
  });
});

describe('team_settings is team-leader and site-admin only', () => {
  const sql = `update public.team_settings set config = '{"seeded": false}' where team_id = 1`;
  it('team 1 team leader can update team 1 settings', async () => {
    const res = await queryAs('authenticated', TEAM_LEADER_T1, sql);
    expect(res.rowCount).toBe(1);
  });
  it('site admin can update team 1 settings', async () => {
    const res = await queryAs('authenticated', SITE_ADMIN, sql);
    expect(res.rowCount).toBe(1);
  });
  it('team 1 officer update touches no rows', async () => {
    const res = await queryAs('authenticated', OFFICER_T1, sql);
    expect(res.rowCount).toBe(0);
  });
});

describe('site_admins is site-admin only', () => {
  const sql = "insert into public.site_admins (discord_id) values ('discord-new-site-admin')";
  it('site admin can insert', async () => {
    const res = await queryAs('authenticated', SITE_ADMIN, sql);
    expect(res.rowCount).toBe(1);
  });
  it('team 1 team leader cannot insert', async () => {
    await expectDenied('authenticated', TEAM_LEADER_T1, sql);
  });
});

describe('request tables have no INSERT path (service role only)', () => {
  const REQUEST_INSERTS = {
    bis_requests:
      "insert into public.bis_requests (team_id, player_id, bis_link) values (1, 1, 'https://example.com/test')",
    // #745: a found BoE arrives only through submit_boe_found(), and listing
    // rows only through boe_record_listing(). Payloads satisfy the CHECKs and
    // the check_team_id_matches_boe_item trigger (boe_items 1 is team 1).
    boe_items:
      "insert into public.boe_items (team_id, item_name, finder_name) values (1, 'Test BoE Bracers', 'Testfinder-Illidan')",
    boe_listings: 'insert into public.boe_listings (team_id, boe_item_id, price) values (1, 1, 100000)',
    mplus_exclusion_requests:
      "insert into public.mplus_exclusion_requests (team_id, player_id, reason) values (1, 2, 'test')",
    season_signups:
      "insert into public.season_signups (team_id, signup_name_realm, season) values (1, 'Testsignup-Illidan', 'test-season')",
    self_received_requests:
      'insert into public.self_received_requests (team_id, player_id, self_item_id) values (1, 1, 1)'
  };
  for (const [table, sql] of Object.entries(REQUEST_INSERTS)) {
    it(`even a team 1 officer cannot insert into ${table}`, async () => {
      await expectDenied('authenticated', OFFICER_T1, sql);
    });
  }
});

describe('request tables allow officer review updates', () => {
  const sql = "update public.bis_requests set status = 'approved' where id = 1";
  it('team 1 officer can update a team 1 request', async () => {
    const res = await queryAs('authenticated', OFFICER_T1, sql);
    expect(res.rowCount).toBe(1);
  });
  it('raider update touches no rows', async () => {
    const res = await queryAs('authenticated', RAIDER_T1, sql);
    expect(res.rowCount).toBe(0);
  });
  it('team 2 officer update touches no rows', async () => {
    const res = await queryAs('authenticated', OFFICER_T2, sql);
    expect(res.rowCount).toBe(0);
  });
  // #413: site admin has no team_members row on team 1 at all, unlike the
  // officer/raider/team-2-officer cases above.
  it('site admin can update a team 1 request despite no team_members role there', async () => {
    const res = await queryAs('authenticated', SITE_ADMIN, sql);
    expect(res.rowCount).toBe(1);
  });
});

describe('add_signup_to_roster is officer-gated through RLS', () => {
  // SECURITY INVOKER function; seeded signup 2 is team 1, status approved.
  const sql = 'select public.add_signup_to_roster(2) as player_id';
  it('team 1 officer can promote a team 1 signup', async () => {
    const res = await queryAs('authenticated', OFFICER_T1, sql);
    expect(res.rows[0].player_id).toBeGreaterThan(0);
  });
  it('team 1 team leader can promote a team 1 signup', async () => {
    const res = await queryAs('authenticated', TEAM_LEADER_T1, sql);
    expect(res.rows[0].player_id).toBeGreaterThan(0);
  });
  it('anon has no execute grant', async () => {
    await expectDenied('anon', null, sql);
  });
  it('raider cannot promote (signup invisible under RLS)', async () => {
    await expect(queryAs('authenticated', RAIDER_T1, sql)).rejects.toThrow(/not found/);
  });
  it('team 2 officer cannot promote a team 1 signup', async () => {
    await expect(queryAs('authenticated', OFFICER_T2, sql)).rejects.toThrow(/not found/);
  });
});

describe('guild officer tier (#607)', () => {
  // A standalone grant (guild_officers), not derived from any team_members
  // role -- GUILD_OFFICER is a plain raider on team 1 with no officer/
  // team_leader role anywhere. Full access: players/attendance, on a team
  // they hold no team-officer role on. Everything else stays a DENY, same
  // as a raider, since is_guild_officer() is deliberately never OR'd into
  // those policies.
  const FULL_ACCESS_INSERTS = {
    players: DIRECT_TEAM_INSERTS.players,
    attendance: DIRECT_TEAM_INSERTS.attendance
  };
  const EXCLUDED_INSERTS = {
    priority_order: DIRECT_TEAM_INSERTS.priority_order,
    rclc_loot: DIRECT_TEAM_INSERTS.rclc_loot,
    player_wcl_season_perf: DIRECT_TEAM_INSERTS.player_wcl_season_perf
  };

  for (const [table, sql] of Object.entries(FULL_ACCESS_INSERTS)) {
    it(`guild officer can insert into ${table} on a team with no officer role there`, async () => {
      const res = await queryAs('authenticated', GUILD_OFFICER, sql);
      expect(res.rowCount).toBe(1);
    });
  }

  for (const [table, sql] of Object.entries(EXCLUDED_INSERTS)) {
    it(`guild officer cannot insert into ${table} (excluded from the tier)`, async () => {
      await expectDenied('authenticated', GUILD_OFFICER, sql);
    });
  }

  it('guild officer cannot write team_members', async () => {
    await expectDenied(
      'authenticated',
      GUILD_OFFICER,
      "insert into public.team_members (team_id, discord_id, role) values (1, 'discord-guild-officer-write-test', 'raider')"
    );
  });

  it('guild officer cannot update team_settings', async () => {
    const res = await queryAs(
      'authenticated',
      GUILD_OFFICER,
      `update public.team_settings set config = '{"seeded": false}' where team_id = 1`
    );
    expect(res.rowCount).toBe(0);
  });

  it('guild officer cannot update a bis_requests row (approvals stay excluded)', async () => {
    const res = await queryAs(
      'authenticated',
      GUILD_OFFICER,
      "update public.bis_requests set status = 'approved' where id = 1"
    );
    expect(res.rowCount).toBe(0);
  });

  it('write_audit_log admits a guild officer', async () => {
    const res = await queryAs(
      'authenticated',
      GUILD_OFFICER,
      "select public.write_audit_log(1, 'guild officer test action') as id"
    );
    expect(res.rows[0].id).toBeGreaterThan(0);
  });

  it('a plain raider (no guild_officers grant) still cannot write players -- regression guard', async () => {
    await expectDenied('authenticated', RAIDER_T1, DIRECT_TEAM_INSERTS.players);
  });
});

describe('audit_log has no client write path', () => {
  const sql = "insert into public.audit_log (team_id, action) values (1, 'test-action')";
  it('team 1 officer cannot insert', async () => {
    await expectDenied('authenticated', OFFICER_T1, sql);
  });
  it('site admin cannot insert', async () => {
    await expectDenied('authenticated', SITE_ADMIN, sql);
  });
});

describe('set_guild_officer_bios admits site admins and guild officers (#607)', () => {
  const sql = "select public.set_guild_officer_bios('[]'::jsonb) as bios";
  it('site admin can call it', async () => {
    const res = await queryAs('authenticated', SITE_ADMIN, sql);
    expect(res.rows[0].bios).toEqual([]);
  });
  it('guild officer can call it', async () => {
    const res = await queryAs('authenticated', GUILD_OFFICER, sql);
    expect(res.rows[0].bios).toEqual([]);
  });
  it('a team 1 officer with no guild_officers grant cannot call it', async () => {
    await expect(queryAs('authenticated', OFFICER_T1, sql)).rejects.toThrow(/Not authorized/);
  });
  it('a plain raider cannot call it', async () => {
    await expect(queryAs('authenticated', RAIDER_T1, sql)).rejects.toThrow(/Not authorized/);
  });
});

describe('set_team_officer_bios admits any team-1 officer, not just team leaders', () => {
  const sql = "select public.set_team_officer_bios(1, '[]'::jsonb) as bios";
  it('a plain team 1 officer can call it', async () => {
    const res = await queryAs('authenticated', OFFICER_T1, sql);
    expect(res.rows[0].bios.teamOfficerBios).toEqual([]);
  });
  it('team 1 team leader can call it', async () => {
    const res = await queryAs('authenticated', TEAM_LEADER_T1, sql);
    expect(res.rows[0].bios.teamOfficerBios).toEqual([]);
  });
  it('site admin can call it', async () => {
    const res = await queryAs('authenticated', SITE_ADMIN, sql);
    expect(res.rows[0].bios.teamOfficerBios).toEqual([]);
  });
  it('guild officer can call it', async () => {
    const res = await queryAs('authenticated', GUILD_OFFICER, sql);
    expect(res.rows[0].bios.teamOfficerBios).toEqual([]);
  });
  it('a team 2 officer cannot call it for team 1', async () => {
    await expect(queryAs('authenticated', OFFICER_T2, sql)).rejects.toThrow(/Not authorized/);
  });
  it('a plain raider cannot call it', async () => {
    await expect(queryAs('authenticated', RAIDER_T1, sql)).rejects.toThrow(/Not authorized/);
  });
});

describe('guild officer grant/revoke/list is site-admin only (#607)', () => {
  it('site admin can grant, list, and revoke', async () => {
    // Grant/list/revoke must run in the same transaction -- queryAs() rolls
    // back after each call, so a separate call would never see the insert.
    await withRole('authenticated', SITE_ADMIN, async (q) => {
      const grant = await q("select public.admin_grant_guild_officer('discord-test-grant') as id");
      expect(grant.rows[0].id).toBeGreaterThan(0);
      const list = await q('select * from public.admin_list_guild_officers()');
      expect(list.rows.some((r) => r.discord_id === 'discord-test-grant')).toBe(true);
      await q("select public.admin_revoke_guild_officer('discord-test-grant')");
      const listAfter = await q('select * from public.admin_list_guild_officers()');
      expect(listAfter.rows.some((r) => r.discord_id === 'discord-test-grant')).toBe(false);
    });
  });
  it('a guild officer cannot grant guild officer access to someone else', async () => {
    await expect(
      queryAs('authenticated', GUILD_OFFICER, "select public.admin_grant_guild_officer('discord-test-grant-2')")
    ).rejects.toThrow(/Not authorized/);
  });
  it('a team leader cannot grant guild officer access', async () => {
    await expect(
      queryAs('authenticated', TEAM_LEADER_T1, "select public.admin_grant_guild_officer('discord-test-grant-3')")
    ).rejects.toThrow(/Not authorized/);
  });
});

afterAll(() => pool.end());
