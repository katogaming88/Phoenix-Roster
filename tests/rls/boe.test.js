// RLS and lifecycle assertions for the BoE tracker backend (#745, reshaped
// guild-wide in #766): boe_items / boe_listings / boe_managers. No public
// read; an ungranted officer reads their own team; a raider reads their own
// rows via is_own_player(); a boe_managers grantee reads and mutates every
// team, because BoEs are guild property. Every lifecycle mutation is gated on
// that grant (or site admin), never on plain officer role. The split formula
// tests encode the guild policy pinned in the #745 comment (floor 20000,
// pivot 100000, gross sale, capped at the sale). Same withTxn harness as
// tests/rls/item-preferences.test.js (unique savepoint name), since these
// tests mix privileged setup with impersonated RPC calls and expected raises.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  OFFICER_T1,
  TEAM_LEADER_T1,
  RAIDER_T1,
  SITE_ADMIN,
  OFFICER_T2,
  GUILD_OFFICER,
  RLS_DENIED
} from './helpers.js';

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRole = (role, uid) => async (text, params) => {
      await q('savepoint boe_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role })
      ]);
      await q(`set local role ${role}`);
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint boe_call');
        throw err;
      }
    };
    const asUser = (uid, text, params) => asRole('authenticated', uid)(text, params);
    const asAnon = (text, params) => asRole('anon', null)(text, params);
    return await fn({ q, asUser, asAnon });
  } finally {
    await client.query('rollback');
    client.release();
  }
}

// Seed player 1 (Seedraider-Illidan, team 1) ships unlinked (supabase/seed.sql);
// tests link it ephemerally inside their own rolled-back transaction.
const linkPlayer1ToRaider = (q) => q('update public.players set team_member_id = 3 where id = 1');

// Seeded BoE fixtures (supabase/seed.sql): boe_items 1 = found, player 1,
// team 1; boe_items 2 = sold, unresolved finder, team 1, split 150000 ->
// 30000 / 120000; boe_listings 1 hangs off item 2; boe_managers grants
// discord-officer-1 (OFFICER_T1). The team-1 leader stays ungranted on
// purpose. No team-2 BoE rows are seeded: the cross-team fixtures below are
// created inside the test transaction so no other suite's counts move.
const addTeam2Item = (q) =>
  q(
    "insert into public.boe_items (team_id, item_name, finder_name) values (2, 'Hellfire Find', 'Nobody-Illidan') returning id"
  ).then((res) => res.rows[0].id);

// A plain raider on team 1 with no officer role anywhere and no guild officer
// grant, so a boe_managers grant is the only authority they hold (#766).
const RAIDER_DISCORD = 'discord-raider-1';
const grantRaider = (q) =>
  q('insert into public.boe_managers (discord_id, auth_user_id) values ($1, $2)', [RAIDER_DISCORD, RAIDER_T1]);

describe('no public read; officer reads are team-scoped unless granted', () => {
  it('anon sees no rows in any of the three tables', async () => {
    await withTxn(async ({ asAnon }) => {
      expect((await asAnon('select id from public.boe_items')).rows.length).toBe(0);
      expect((await asAnon('select id from public.boe_listings')).rows.length).toBe(0);
      expect((await asAnon('select id from public.boe_managers')).rows.length).toBe(0);
    });
  });

  it('a guild officer sees nothing (deliberately excluded, like approvals)', async () => {
    await withTxn(async ({ asUser }) => {
      expect((await asUser(GUILD_OFFICER, 'select id from public.boe_items')).rows.length).toBe(0);
      expect((await asUser(GUILD_OFFICER, 'select id from public.boe_listings')).rows.length).toBe(0);
    });
  });

  it('an ungranted team 2 officer sees no team 1 rows', async () => {
    await withTxn(async ({ asUser }) => {
      expect((await asUser(OFFICER_T2, 'select id from public.boe_items')).rows.length).toBe(0);
      expect((await asUser(OFFICER_T2, 'select id from public.boe_listings')).rows.length).toBe(0);
    });
  });

  // The read half of the guild-wide grant (#766). Without is_boe_manager() on
  // the read policies a manager could mutate rows they cannot see.
  it('a manager reads a team they hold no role on', async () => {
    await withTxn(async ({ q, asUser }) => {
      const id = await addTeam2Item(q);
      const seen = await asUser(OFFICER_T1, 'select id from public.boe_items where team_id = 2');
      expect(seen.rows.map((r) => r.id)).toEqual([id]);
    });
  });

  it('a manager with no officer role anywhere reads every team', async () => {
    await withTxn(async ({ q, asUser }) => {
      await addTeam2Item(q);
      await grantRaider(q);
      const seen = await asUser(RAIDER_T1, 'select team_id from public.boe_items order by team_id');
      expect(seen.rows.map((r) => r.team_id)).toEqual([1, 1, 2]);
    });
  });

  // boe_listings carries the same OR and needs its own assertion: dropping it
  // there alone left the whole suite green, since every other listings test
  // reads team 1 as an officer of team 1.
  it('a manager reads another team listings, not just its items', async () => {
    await withTxn(async ({ q, asUser }) => {
      const id = await addTeam2Item(q);
      await q('insert into public.boe_listings (team_id, boe_item_id, price) values (2, $1, 250000)', [id]);
      await grantRaider(q);
      const seen = await asUser(RAIDER_T1, 'select team_id from public.boe_listings order by team_id');
      expect(seen.rows.map((r) => r.team_id)).toEqual([1, 2]);
    });
  });

  it('the team officer, team leader, and site admin see the team rows', async () => {
    await withTxn(async ({ asUser }) => {
      expect((await asUser(OFFICER_T1, 'select id from public.boe_items')).rows.length).toBe(2);
      expect((await asUser(OFFICER_T1, 'select id from public.boe_listings')).rows.length).toBe(1);
      expect((await asUser(TEAM_LEADER_T1, 'select id from public.boe_items')).rows.length).toBe(2);
      expect((await asUser(SITE_ADMIN, 'select id from public.boe_items')).rows.length).toBe(2);
      expect((await asUser(SITE_ADMIN, 'select id from public.boe_listings')).rows.length).toBe(1);
    });
  });

  it('an unlinked raider sees nothing; a linked raider sees only their own rows', async () => {
    await withTxn(async ({ q, asUser }) => {
      expect((await asUser(RAIDER_T1, 'select id from public.boe_items')).rows.length).toBe(0);
      await linkPlayer1ToRaider(q);
      const res = await asUser(RAIDER_T1, 'select id from public.boe_items');
      expect(res.rows.map((r) => r.id)).toEqual([1]);
    });
  });
});

describe('direct INSERT has no path on the data tables', () => {
  // The shared write-policies suite covers the officer role; site admin and
  // the granted manager are the sharper cases, since both hold every other
  // write. #745: a found BoE arrives only through submit_boe_found().
  const ITEM_INSERT = "insert into public.boe_items (team_id, item_name, finder_name) values (1, 'X', 'Y-Illidan')";
  const LISTING_INSERT = 'insert into public.boe_listings (team_id, boe_item_id, price) values (1, 1, 100000)';

  it('site admin cannot insert into boe_items or boe_listings', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(asUser(SITE_ADMIN, ITEM_INSERT)).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(asUser(SITE_ADMIN, LISTING_INSERT)).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });

  it('the granted BoE manager cannot insert directly either', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(asUser(OFFICER_T1, ITEM_INSERT)).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(asUser(OFFICER_T1, LISTING_INSERT)).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });
});

describe('submit_boe_found', () => {
  const submit = (args) => `select public.submit_boe_found(${args}) as id`;

  // Since #875 only a catalog BoE links; the seed staff is a boss drop, so its
  // resolution is null even on an exact name. The belt test below is the link.
  it('anon submit with a rostered name resolves the player, and a boss drop stays unlinked', async () => {
    await withTxn(async ({ q, asAnon }) => {
      const res = await asAnon(submit("1, 'Seedraider-Illidan', 'Seed Test Staff', 'Hero', 'from trash'"));
      const id = res.rows[0].id;
      const row = (
        await q(
          'select team_id, player_id, finder_name, item_id, item_name, track, note, status from public.boe_items where id = $1',
          [id]
        )
      ).rows[0];
      expect(row).toMatchObject({
        team_id: 1,
        player_id: 1,
        finder_name: 'Seedraider-Illidan',
        item_id: null,
        item_name: 'Seed Test Staff',
        track: 'Hero',
        note: 'from trash',
        status: 'found'
      });
    });
  });

  it('a catalog BoE links case-insensitively and is stored with the catalog spelling', async () => {
    await withTxn(async ({ q, asAnon }) => {
      const res = await asAnon(submit("1, 'Seedraider-Illidan', '  seed test boe belt ', 'Hero', null"));
      const row = (await q('select item_id, item_name from public.boe_items where id = $1', [res.rows[0].id])).rows[0];
      expect(row).toEqual({ item_id: 3, item_name: 'Seed Test BoE Belt' });
    });
  });

  it('an unrostered name keeps the raw finder_name with a null player_id', async () => {
    await withTxn(async ({ q, asAnon }) => {
      const res = await asAnon(submit("1, 'Stranger-Proudmoore', 'Unknown Green Blade', null, null"));
      const row = (
        await q('select player_id, finder_name, item_id, status from public.boe_items where id = $1', [res.rows[0].id])
      ).rows[0];
      expect(row).toMatchObject({
        player_id: null,
        finder_name: 'Stranger-Proudmoore',
        item_id: null,
        status: 'found'
      });
    });
  });

  it('a logged-in raider can submit too', async () => {
    await withTxn(async ({ asUser }) => {
      const res = await asUser(RAIDER_T1, submit("1, 'Seedraider-Illidan', 'Some BoE Cloak', 'Champion', null"));
      expect(res.rows[0].id).toBeGreaterThan(0);
    });
  });

  it('an empty item name is rejected', async () => {
    await withTxn(async ({ asAnon }) => {
      await expect(asAnon(submit("1, 'Seedraider-Illidan', '  ', null, null"))).rejects.toThrow(
        /Item name is required/
      );
    });
  });

  it('an empty character name is rejected', async () => {
    await withTxn(async ({ asAnon }) => {
      await expect(asAnon(submit("1, '', 'Some BoE Cloak', null, null"))).rejects.toThrow(/Character name is required/);
    });
  });

  it('an unknown track is rejected', async () => {
    await withTxn(async ({ asAnon }) => {
      await expect(asAnon(submit("1, 'Seedraider-Illidan', 'Some BoE Cloak', 'Mythic', null"))).rejects.toThrow(
        /Unknown track/
      );
    });
  });

  it('the submit snapshots the seasonName in force', async () => {
    await withTxn(async ({ q, asAnon }) => {
      await q(`update public.team_settings set config = config || '{"seasonName": "Test Season 3"}' where team_id = 1`);
      const res = await asAnon(submit("1, 'Seedraider-Illidan', 'Season Snapshot Blade', null, null"));
      const row = (await q('select season from public.boe_items where id = $1', [res.rows[0].id])).rows[0];
      expect(row.season).toBe('Test Season 3');
    });
  });
});

describe('the manager gate on every lifecycle RPC', () => {
  const LIFECYCLE_CALLS = [
    'select public.boe_record_listing(1, 100000)',
    'select public.boe_record_sale(1, 100000)',
    'select public.boe_mark_paid(2)',
    'select public.boe_retire(1)',
    'select public.boe_revert(2)'
  ];

  it('the ungranted team leader is denied on all five', async () => {
    await withTxn(async ({ asUser }) => {
      for (const sql of LIFECYCLE_CALLS) {
        await expect(asUser(TEAM_LEADER_T1, sql)).rejects.toThrow(/Not authorized/);
      }
    });
  });

  it('an other-team officer is denied on a team 1 row', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(asUser(OFFICER_T2, 'select public.boe_record_listing(1, 100000)')).rejects.toThrow(/Not authorized/);
    });
  });

  // #766 inverts the old per-team assertions. BoEs are guild property, so the
  // grant is the whole authority: it reaches every team, and it does not need
  // an officer role underneath it.
  it('a grant reaches a team the holder has no role on', async () => {
    await withTxn(async ({ q, asUser }) => {
      const id = await addTeam2Item(q);
      await asUser(OFFICER_T1, 'select public.boe_record_listing($1, 100000)', [id]);
      expect((await q('select status from public.boe_items where id = $1', [id])).rows[0].status).toBe('listed');
    });
  });

  it('a grant held by someone with no officer role anywhere still passes', async () => {
    await withTxn(async ({ q, asUser }) => {
      await grantRaider(q);
      await asUser(RAIDER_T1, 'select public.boe_record_listing(1, 100000)');
      expect((await q('select status from public.boe_items where id = 1')).rows[0].status).toBe('listed');
    });
  });

  it('a grant whose auth_user_id never resolved authorizes nobody', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q('insert into public.boe_managers (discord_id, auth_user_id) values ($1, null)', [RAIDER_DISCORD]);
      await expect(asUser(RAIDER_T1, 'select public.boe_record_listing(1, 100000)')).rejects.toThrow(/Not authorized/);
    });
  });

  // The dead-grant trap: a grant made before the holder's first sign-in
  // resolves to null and only link_auth_user_to_member() can revive it.
  it('a grant made before first sign-in activates on that first sign-in', async () => {
    await withTxn(async ({ q, asUser }) => {
      const uid = '00000000-0000-0000-0000-0000000000ff';
      await asUser(SITE_ADMIN, "select public.admin_grant_boe_manager('discord-not-yet-seen')");
      expect(
        (await q("select auth_user_id from public.boe_managers where discord_id = 'discord-not-yet-seen'")).rows[0]
          .auth_user_id
      ).toBeNull();

      await q(
        "insert into auth.users (id, raw_user_meta_data) values ($1, jsonb_build_object('provider_id', 'discord-not-yet-seen'))",
        [uid]
      );
      expect(
        (await q("select auth_user_id from public.boe_managers where discord_id = 'discord-not-yet-seen'")).rows[0]
          .auth_user_id
      ).toBe(uid);

      await asUser(uid, 'select public.boe_record_listing(1, 100000)');
      expect((await q('select status from public.boe_items where id = 1')).rows[0].status).toBe('listed');
    });
  });

  // A manager with no officer role fails write_audit_log()'s own gate unless
  // it admits is_boe_manager() too, and js/common.js only console.warns on
  // that failure -- so the money mutation would land and log nothing (#766).
  it('a manager with no officer role can still write the audit entry', async () => {
    await withTxn(async ({ q, asUser }) => {
      await grantRaider(q);
      const res = await asUser(RAIDER_T1, "select public.write_audit_log(1, 'BoE Listed', 'boe_items', 1, null) as id");
      expect(res.rows[0].id).toBeGreaterThan(0);
    });
  });

  it('a plain raider with no grant still cannot write an audit entry', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(
        asUser(RAIDER_T1, "select public.write_audit_log(1, 'BoE Listed', 'boe_items', 1, null)")
      ).rejects.toThrow(/Not authorized/);
    });
  });

  it('a site admin passes every gate with no grant at all', async () => {
    await withTxn(async ({ q, asUser }) => {
      await asUser(SITE_ADMIN, 'select public.boe_retire(1)');
      const row = (await q('select status, retired_at from public.boe_items where id = 1')).rows[0];
      expect(row.status).toBe('retired');
      expect(row.retired_at).not.toBeNull();
    });
  });

  it('only a site admin can insert or delete boe_managers rows', async () => {
    await withTxn(async ({ asUser }) => {
      const INS = "insert into public.boe_managers (discord_id) values ('discord-leader-1')";
      await expect(asUser(OFFICER_T1, INS)).rejects.toMatchObject({ code: RLS_DENIED });
      const ins = await asUser(SITE_ADMIN, INS);
      expect(ins.rowCount).toBe(1);
      const del = await asUser(SITE_ADMIN, "delete from public.boe_managers where discord_id = 'discord-leader-1'");
      expect(del.rowCount).toBe(1);
    });
  });

  // The read deviates from the guild_officers template on purpose (#766): an
  // ungranted officer looking at a find they cannot act on needs an in-app
  // way to see who can, so any officer on any team reads the list.
  it('any officer reads boe_managers; a raider and anon do not', async () => {
    await withTxn(async ({ asUser, asAnon }) => {
      expect((await asUser(OFFICER_T1, 'select id from public.boe_managers')).rows.length).toBe(1);
      expect((await asUser(OFFICER_T2, 'select id from public.boe_managers')).rows.length).toBe(1);
      expect((await asUser(TEAM_LEADER_T1, 'select id from public.boe_managers')).rows.length).toBe(1);
      expect((await asUser(SITE_ADMIN, 'select id from public.boe_managers')).rows.length).toBe(1);
      expect((await asUser(RAIDER_T1, 'select id from public.boe_managers')).rows.length).toBe(0);
      expect((await asAnon('select id from public.boe_managers')).rows.length).toBe(0);
    });
  });
});

describe('the boe_manager admin trio is site-admin only (#766)', () => {
  it('a site admin can grant, list, and revoke', async () => {
    await withTxn(async ({ asUser }) => {
      const grant = await asUser(SITE_ADMIN, "select public.admin_grant_boe_manager('discord-test-boe') as id");
      expect(grant.rows[0].id).toBeGreaterThan(0);
      const list = await asUser(SITE_ADMIN, 'select * from public.admin_list_boe_managers()');
      expect(list.rows.some((r) => r.discord_id === 'discord-test-boe')).toBe(true);
      await asUser(SITE_ADMIN, "select public.admin_revoke_boe_manager('discord-test-boe')");
      const after = await asUser(SITE_ADMIN, 'select * from public.admin_list_boe_managers()');
      expect(after.rows.some((r) => r.discord_id === 'discord-test-boe')).toBe(false);
    });
  });

  it('granting the same Discord account twice is refused', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(asUser(SITE_ADMIN, "select public.admin_grant_boe_manager('discord-officer-1')")).rejects.toThrow(
        /already/i
      );
    });
  });

  it('revoking an account that holds no grant is refused', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(asUser(SITE_ADMIN, "select public.admin_revoke_boe_manager('discord-nobody')")).rejects.toThrow(
        /does not have/i
      );
    });
  });

  it('an existing manager cannot grant, list, or revoke', async () => {
    await withTxn(async ({ asUser }) => {
      for (const sql of [
        "select public.admin_grant_boe_manager('discord-test-boe-2')",
        'select * from public.admin_list_boe_managers()',
        "select public.admin_revoke_boe_manager('discord-officer-1')"
      ]) {
        await expect(asUser(OFFICER_T1, sql)).rejects.toThrow(/Not authorized/);
      }
    });
  });

  it('a team leader cannot grant', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(
        asUser(TEAM_LEADER_T1, "select public.admin_grant_boe_manager('discord-test-boe-3')")
      ).rejects.toThrow(/Not authorized/);
    });
  });
});

describe('lifecycle transitions', () => {
  it('a listing flips found to listed and a second listing relists', async () => {
    await withTxn(async ({ q, asUser }) => {
      await asUser(OFFICER_T1, 'select public.boe_record_listing(1, 180000)');
      expect((await q('select status from public.boe_items where id = 1')).rows[0].status).toBe('listed');
      await asUser(OFFICER_T1, "select public.boe_record_listing(1, 170000, now(), 'undercut')");
      expect((await q('select status from public.boe_items where id = 1')).rows[0].status).toBe('listed');
      const listings = await q('select price::int as price from public.boe_listings where boe_item_id = 1 order by id');
      expect(listings.rows.map((r) => r.price)).toEqual([180000, 170000]);
    });
  });

  it('a listing on a sold item raises', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(asUser(OFFICER_T1, 'select public.boe_record_listing(2, 180000)')).rejects.toThrow(
        /Cannot record a listing on a sold BoE/
      );
    });
  });

  it('a direct sale from found is legal', async () => {
    await withTxn(async ({ q, asUser }) => {
      await asUser(OFFICER_T1, 'select public.boe_record_sale(1, 100000)');
      const row = (await q('select status, sold_at from public.boe_items where id = 1')).rows[0];
      expect(row.status).toBe('sold');
      expect(row.sold_at).not.toBeNull();
    });
  });

  it('a sale from retired raises', async () => {
    await withTxn(async ({ asUser }) => {
      await asUser(OFFICER_T1, 'select public.boe_retire(1)');
      await expect(asUser(OFFICER_T1, 'select public.boe_record_sale(1, 100000)')).rejects.toThrow(
        /Cannot record a sale on a retired BoE/
      );
    });
  });

  it('a non-positive sale price is rejected', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(asUser(OFFICER_T1, 'select public.boe_record_sale(1, 0)')).rejects.toThrow(
        /Sale price must be positive/
      );
      await expect(asUser(OFFICER_T1, 'select public.boe_record_sale(1, -5)')).rejects.toThrow(
        /Sale price must be positive/
      );
    });
  });

  it('a negative listing price is rejected', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(asUser(OFFICER_T1, 'select public.boe_record_listing(1, -1)')).rejects.toThrow(/Listing price/);
    });
  });

  it('mark_paid moves sold to paid and only from sold', async () => {
    await withTxn(async ({ q, asUser }) => {
      await asUser(OFFICER_T1, 'select public.boe_mark_paid(2)');
      const row = (await q('select status, payout_paid_at from public.boe_items where id = 2')).rows[0];
      expect(row.status).toBe('paid');
      expect(row.payout_paid_at).not.toBeNull();
      await expect(asUser(OFFICER_T1, 'select public.boe_mark_paid(1)')).rejects.toThrow(
        /Cannot mark a found BoE paid/
      );
    });
  });

  it('retire works from found or listed and from nothing else', async () => {
    await withTxn(async ({ q, asUser }) => {
      await asUser(OFFICER_T1, "select public.boe_retire(1, 'kept for the bank')");
      const row = (await q('select status, retired_at, note from public.boe_items where id = 1')).rows[0];
      expect(row).toMatchObject({ status: 'retired', note: 'kept for the bank' });
      expect(row.retired_at).not.toBeNull();
      await expect(asUser(OFFICER_T1, 'select public.boe_retire(2)')).rejects.toThrow(/Cannot retire a sold BoE/);
    });
  });
});

describe('the split formula (policy pinned on #745)', () => {
  // [sale, finder, guild] -- the first five transcribed from last season's
  // sheet (both rounding directions included); the last two exercise the
  // cap branch the sheet never reached (its minimum sale was 27,500).
  const SPLITS = [
    [617518, 123504, 494014],
    [95000, 20000, 75000],
    [285026, 57005, 228021],
    [27500, 20000, 7500],
    [1187535, 237507, 950028],
    [15000, 15000, 0],
    [20000, 20000, 0]
  ];

  for (const [sale, finder, guild] of SPLITS) {
    it(`splits a ${sale.toLocaleString('en-US')}g sale into ${finder.toLocaleString('en-US')} / ${guild.toLocaleString('en-US')}`, async () => {
      await withTxn(async ({ q, asUser }) => {
        const inserted = await q(
          "insert into public.boe_items (team_id, item_name) values (1, 'Split Test Blade') returning id"
        );
        const id = inserted.rows[0].id;
        const res = await asUser(
          OFFICER_T1,
          `select sale_price::int as sale_price, finder_payout::int as finder_payout, guild_cut::int as guild_cut from public.boe_record_sale(${id}, ${sale})`
        );
        expect(res.rows[0]).toEqual({ sale_price: sale, finder_payout: finder, guild_cut: guild });
        const stored = (
          await q(
            'select finder_payout::int as f, guild_cut::int as g, payout_floor::int as pf, payout_pivot::int as pp from public.boe_items where id = $1',
            [id]
          )
        ).rows[0];
        expect(stored).toEqual({ f: finder, g: guild, pf: 20000, pp: 100000 });
      });
    });
  }

  it('a changed floor and pivot apply to the next sale and are snapshotted', async () => {
    await withTxn(async ({ q, asUser }) => {
      await asUser(SITE_ADMIN, 'select public.set_boe_payout_settings(30000, 100000)');
      const inserted = await q(
        "insert into public.boe_items (team_id, item_name) values (1, 'Override Test Blade') returning id"
      );
      const id = inserted.rows[0].id;
      const res = await asUser(
        OFFICER_T1,
        `select finder_payout::int as finder_payout, guild_cut::int as guild_cut from public.boe_record_sale(${id}, 95000)`
      );
      expect(res.rows[0]).toEqual({ finder_payout: 30000, guild_cut: 65000 });
      const stored = (
        await q('select payout_floor::int as pf, payout_pivot::int as pp from public.boe_items where id = $1', [id])
      ).rows[0];
      expect(stored).toEqual({ pf: 30000, pp: 100000 });
    });
  });

  it('set_boe_payout_settings is site-admin only and validates its bounds', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(asUser(OFFICER_T1, 'select public.set_boe_payout_settings(30000, 100000)')).rejects.toThrow(
        /Not authorized/
      );
      await expect(asUser(SITE_ADMIN, 'select public.set_boe_payout_settings(20000, 0)')).rejects.toThrow(
        /pivot must be positive/
      );
      await expect(asUser(SITE_ADMIN, 'select public.set_boe_payout_settings(-1, 100000)')).rejects.toThrow(
        /floor must be zero or more/
      );
    });
  });
});

describe('revert walks the correction edges', () => {
  it('paid reverts to sold, keeping the money but clearing the payout timestamp', async () => {
    await withTxn(async ({ q, asUser }) => {
      await asUser(OFFICER_T1, 'select public.boe_mark_paid(2)');
      const res = await asUser(OFFICER_T1, 'select public.boe_revert(2) as status');
      expect(res.rows[0].status).toBe('sold');
      const row = (await q('select status, payout_paid_at, sale_price::int as sp from public.boe_items where id = 2'))
        .rows[0];
      expect(row).toMatchObject({ status: 'sold', payout_paid_at: null, sp: 150000 });
    });
  });

  it('sold reverts to listed while listings exist, nulling the money', async () => {
    await withTxn(async ({ q, asUser }) => {
      const res = await asUser(OFFICER_T1, 'select public.boe_revert(2) as status');
      expect(res.rows[0].status).toBe('listed');
      const row = (
        await q(
          'select status, sold_at, sale_price, finder_payout, guild_cut, payout_floor, payout_pivot from public.boe_items where id = 2'
        )
      ).rows[0];
      expect(row).toEqual({
        status: 'listed',
        sold_at: null,
        sale_price: null,
        finder_payout: null,
        guild_cut: null,
        payout_floor: null,
        payout_pivot: null
      });
    });
  });

  it('listed with listing rows refuses to revert until they are deleted', async () => {
    await withTxn(async ({ q, asUser }) => {
      await asUser(OFFICER_T1, 'select public.boe_revert(2)');
      await expect(asUser(OFFICER_T1, 'select public.boe_revert(2)')).rejects.toThrow(/listing rows/);
      const del = await asUser(OFFICER_T1, 'delete from public.boe_listings where boe_item_id = 2');
      expect(del.rowCount).toBe(1);
      const res = await asUser(OFFICER_T1, 'select public.boe_revert(2) as status');
      expect(res.rows[0].status).toBe('found');
      expect((await q('select status from public.boe_items where id = 2')).rows[0].status).toBe('found');
    });
  });

  it('sold reverts straight to found when no listings exist', async () => {
    await withTxn(async ({ q, asUser }) => {
      const inserted = await q(
        "insert into public.boe_items (team_id, item_name) values (1, 'Revert Test Blade') returning id"
      );
      const id = inserted.rows[0].id;
      await asUser(OFFICER_T1, `select public.boe_record_sale(${id}, 100000)`);
      const res = await asUser(OFFICER_T1, `select public.boe_revert(${id}) as status`);
      expect(res.rows[0].status).toBe('found');
      const row = (await q('select sale_price, finder_payout from public.boe_items where id = $1', [id])).rows[0];
      expect(row).toEqual({ sale_price: null, finder_payout: null });
    });
  });

  it('retired reverts to found and found has nothing to revert', async () => {
    await withTxn(async ({ q, asUser }) => {
      await asUser(OFFICER_T1, 'select public.boe_retire(1)');
      const res = await asUser(OFFICER_T1, 'select public.boe_revert(1) as status');
      expect(res.rows[0].status).toBe('found');
      expect((await q('select retired_at from public.boe_items where id = 1')).rows[0].retired_at).toBeNull();
      await expect(asUser(OFFICER_T1, 'select public.boe_revert(1)')).rejects.toThrow(/Nothing to revert/);
    });
  });
});

describe('plain UPDATE is metadata-only and DELETE is manager-gated', () => {
  it('a manager can edit the note, the finder, the item name and the track, but not move status', async () => {
    await withTxn(async ({ q, asUser }) => {
      await asUser(OFFICER_T1, "update public.boe_items set note = 'checked with the bank' where id = 1");
      await asUser(OFFICER_T1, 'update public.boe_items set player_id = 2 where id = 1');
      // The #874 edit form's payload shape: name and track in one statement.
      const edit = await asUser(
        OFFICER_T1,
        "update public.boe_items set item_name = 'Corrected Staff', track = 'Myth' where id = 1"
      );
      expect(edit.rowCount).toBe(1);
      const row = (await q('select note, player_id, item_name, track from public.boe_items where id = 1')).rows[0];
      expect(row).toMatchObject({
        note: 'checked with the bank',
        player_id: 2,
        item_name: 'Corrected Staff',
        track: 'Myth'
      });
      await expect(asUser(OFFICER_T1, "update public.boe_items set status = 'paid' where id = 1")).rejects.toThrow(
        /go through the BoE RPCs/
      );
    });
  });

  it('an ungranted officer or leader updates and deletes nothing', async () => {
    await withTxn(async ({ asUser }) => {
      const upd = await asUser(TEAM_LEADER_T1, "update public.boe_items set note = 'sneaky' where id = 1");
      expect(upd.rowCount).toBe(0);
      const del = await asUser(TEAM_LEADER_T1, 'delete from public.boe_items where id = 1');
      expect(del.rowCount).toBe(0);
    });
  });

  it('a manager can delete a junk row', async () => {
    await withTxn(async ({ q, asUser }) => {
      const inserted = await q(
        "insert into public.boe_items (team_id, item_name) values (1, 'Junk Submission') returning id"
      );
      const del = await asUser(OFFICER_T1, 'delete from public.boe_items where id = $1', [inserted.rows[0].id]);
      expect(del.rowCount).toBe(1);
    });
  });
});

afterAll(() => pool.end());
