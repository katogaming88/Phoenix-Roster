// build_rclc_export() (#335, Phase 5) -- the RCLootCouncil priority export
// payload, computed live from item_preferences/priority_order/items/players
// instead of the retired Apps Script spreadsheet cache. Covers: slot-key
// derivation (item_preferences.slot override vs. legacy items.slot
// fallback), placeholder-item exclusion, track-split priority ordering,
// season scoping, and authorization.
//
// p_track became required (#859): a combined Hero+Myth export measured at
// ~91k base64 chars live, large enough to stall the WoW client on paste
// into the addon's import box. Every call below now passes an explicit
// track, and assertions that used to check both H and M off one combined
// payload now make two calls (one per track) instead.
import { describe, it, expect } from 'vitest';
import { pool, withRole, OFFICER_T1, TEAM_LEADER_T1, RAIDER_T1, OFFICER_T2 } from './helpers.js';

// items has no authenticated-write policy (it's a read-only shared catalog,
// populated only via migrations/import scripts), and
// item_preferences' own "Raiders manage own item_preferences" RLS policy
// only lets a player insert rows for themselves, not an officer inserting on
// their behalf -- seed as the unrestricted pool connection, same as items,
// before withRole() drops to `authenticated`.
async function withItemsAndBisSeeded(role, uid, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into public.items (id, wow_item_id, name, slot, armor_type, is_placeholder) values
         (900, 90001, 'Test Trinket', 'Trinket', null, false),
         (901, 90002, 'Test Placeholder', 'Placeholder', null, true)`
    );
    // player 1: explicit slot override (Trinket 2) + a legacy row with no
    // slot override, falling back to items.slot ('Trinket' -> ambiguous ->
    // defaults to trinket1) + a placeholder-item row that must be excluded.
    // Only status='bis' rows feed the export -- 'good'/'ok'/etc are wishlist
    // entries, not BiS.
    await client.query(
      `insert into public.item_preferences (id, team_id, player_id, item_id, status, slot) values
         (900, 1, 1, 900, 'bis', 'Trinket 2'),
         (901, 1, 2, 900, 'bis', null),
         (902, 1, 1, 901, 'bis', 'Trinket 1')`
    );
    if (uid) {
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role })]);
    }
    await client.query(`set local role ${role}`);
    return await fn((text, params) => client.query(text, params));
  } finally {
    await client.query('rollback');
    client.release();
  }
}

async function seedPriority(q) {
  await q(
    `insert into public.priority_order (team_id, season, item_id, track, rank, player_id) values
       (1, 'export-test', 2, 'Hero', 1, 2),
       (1, 'export-test', 2, 'Hero', 2, 1),
       (1, 'export-test', 2, 'Myth', 1, 1)`
  );
}

// Same reasoning as withItemsAndBisSeeded above: item_preferences' RLS
// policy only lets a player manage their own rows, not an officer seeding
// rows for other players' wishlists, so this seeds both priority_order and
// item_preferences on the unrestricted pool connection before withRole()
// drops to `authenticated` for the actual export call.
async function withPriorityAndWishlistSeeded(role, uid, wishlistRows, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into public.priority_order (team_id, season, item_id, track, rank, player_id) values
         (1, 'export-test', 2, 'Hero', 1, 2),
         (1, 'export-test', 2, 'Hero', 2, 1),
         (1, 'export-test', 2, 'Myth', 1, 1)`
    );
    if (wishlistRows) {
      await client.query(
        `insert into public.item_preferences (team_id, player_id, item_id, status, season) values ${wishlistRows}`
      );
    }
    if (uid) {
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role })]);
    }
    await client.query(`set local role ${role}`);
    return await fn((text, params) => client.query(text, params));
  } finally {
    await client.query('rollback');
    client.release();
  }
}

describe('build_rclc_export excludes already-awarded recipients (#480)', () => {
  it('a Mythic recipient drops from both the Hero and Myth ranked lists for that item', async () => {
    await withRole('authenticated', OFFICER_T1, async (q) => {
      await seedPriority(q);
      // player 1 (Seedraider-Illidan) already has Mythic loot for item 2.
      await q(
        `insert into public.rclc_loot (team_id, player_id, item_id, track, season) values
           (1, 1, 2, 'Myth', 'export-test')`
      );
      const hero = await q('select public.build_rclc_export(1, $1, $2) as payload', ['export-test', 'Hero']);
      const myth = await q('select public.build_rclc_export(1, $1, $2) as payload', ['export-test', 'Myth']);

      expect(hero.rows[0].payload.priority['100002'].H).toEqual(['Seedplayertwo-Illidan']);
      expect(myth.rows[0].payload.priority['100002']).toBeUndefined();
    });
  });

  it('a Hero recipient drops from the Hero list only, still eligible for Myth', async () => {
    await withRole('authenticated', OFFICER_T1, async (q) => {
      await seedPriority(q);
      // player 2 (Seedplayertwo-Illidan) already has Heroic loot for item 2.
      await q(
        `insert into public.rclc_loot (team_id, player_id, item_id, track, season) values
           (1, 2, 2, 'Hero', 'export-test')`
      );
      const hero = await q('select public.build_rclc_export(1, $1, $2) as payload', ['export-test', 'Hero']);
      const myth = await q('select public.build_rclc_export(1, $1, $2) as payload', ['export-test', 'Myth']);

      expect(hero.rows[0].payload.priority['100002'].H).toEqual(['Seedraider-Illidan']);
      expect(myth.rows[0].payload.priority['100002'].M).toEqual(['Seedraider-Illidan']);
    });
  });

  it('rclc_loot for a different season does not exclude anyone', async () => {
    await withRole('authenticated', OFFICER_T1, async (q) => {
      await seedPriority(q);
      await q(
        `insert into public.rclc_loot (team_id, player_id, item_id, track, season) values
           (1, 1, 2, 'Myth', 'some-other-season')`
      );
      const hero = await q('select public.build_rclc_export(1, $1, $2) as payload', ['export-test', 'Hero']);
      const myth = await q('select public.build_rclc_export(1, $1, $2) as payload', ['export-test', 'Myth']);

      expect(hero.rows[0].payload.priority['100002'].H).toEqual(['Seedplayertwo-Illidan', 'Seedraider-Illidan']);
      expect(myth.rows[0].payload.priority['100002'].M).toEqual(['Seedraider-Illidan']);
    });
  });
});

describe('build_rclc_export', () => {
  it('rejects a track that is not Hero or Myth', async () => {
    await withRole('authenticated', OFFICER_T1, async (q) => {
      await expect(
        q('select public.build_rclc_export(1, $1, $2)', ['export-test', 'Champion'])
      ).rejects.toThrow('Invalid track');
    });
  });

  it('an officer gets players built from item_preferences with slot-key precedence and placeholders excluded', async () => {
    await withItemsAndBisSeeded('authenticated', OFFICER_T1, async (q) => {
      const res = await q('select public.build_rclc_export(1, $1, $2) as payload', ['export-test', 'Hero']);
      const payload = res.rows[0].payload;

      expect(payload.players['Seedraider-Illidan'].trinket2.bis).toEqual([90001]);
      // Legacy row for player 2 has no item_preferences.slot, so it falls
      // back to items.slot 'Trinket' -> defaults to trinket1.
      expect(payload.players['Seedplayertwo-Illidan'].trinket1.bis).toEqual([90001]);
      // Placeholder item (id 901) must never appear in the export.
      const flatIds = JSON.stringify(payload.players);
      expect(flatIds).not.toContain('90002');
    });
  });

  it('scopes priority to the requested track only, keyed by wow_item_id and ordered by rank', async () => {
    await withRole('authenticated', OFFICER_T1, async (q) => {
      await seedPriority(q);
      const hero = await q('select public.build_rclc_export(1, $1, $2) as payload', ['export-test', 'Hero']);
      const myth = await q('select public.build_rclc_export(1, $1, $2) as payload', ['export-test', 'Myth']);

      // item 2 is Seed Test Robe, wow_item_id 100002 per seed.sql. No
      // item_preferences rows seeded here, so the status map comes back
      // empty rather than absent (#wishlist status export). Only that
      // track's H/H_status or M/M_status keys are present -- the other
      // track's data isn't in this payload at all.
      expect(hero.rows[0].payload.priority['100002']).toEqual({
        H: ['Seedplayertwo-Illidan', 'Seedraider-Illidan'],
        H_status: {}
      });
      expect(myth.rows[0].payload.priority['100002']).toEqual({
        M: ['Seedraider-Illidan'],
        M_status: {}
      });
    });
  });

  it("attaches each ranked player's wishlist status (bis/good/ok) for that item, keyed by name", async () => {
    await withPriorityAndWishlistSeeded(
      'authenticated',
      OFFICER_T1,
      `(1, 1, 2, 'bis', 'export-test'), (1, 2, 2, 'good', 'export-test')`,
      async (q) => {
        const hero = await q('select public.build_rclc_export(1, $1, $2) as payload', ['export-test', 'Hero']);
        const myth = await q('select public.build_rclc_export(1, $1, $2) as payload', ['export-test', 'Myth']);

        expect(hero.rows[0].payload.priority['100002'].H_status).toEqual({
          'Seedraider-Illidan': 'bis',
          'Seedplayertwo-Illidan': 'good'
        });
        expect(myth.rows[0].payload.priority['100002'].M_status).toEqual({ 'Seedraider-Illidan': 'bis' });
      }
    );
  });

  it('leaves a ranked player out of the status map when they have no matching wishlist row', async () => {
    // Only player 1 has a wishlist entry for item 2 -- player 2 is ranked
    // (via priority_order) but has no item_preferences row at all here,
    // simulating a fallback-ranked player (e.g. tier-token matching) with
    // no backing wishlist tier to report.
    await withPriorityAndWishlistSeeded('authenticated', OFFICER_T1, `(1, 1, 2, 'ok', 'export-test')`, async (q) => {
      const res = await q('select public.build_rclc_export(1, $1, $2) as payload', ['export-test', 'Hero']);
      const priority = res.rows[0].payload.priority['100002'];

      expect(priority.H_status).toEqual({ 'Seedraider-Illidan': 'ok' });
      expect(Object.keys(priority.H_status)).not.toContain('Seedplayertwo-Illidan');
    });
  });

  it("dedupes a player's multiple item_preferences rows for the same item (e.g. dual-wield Weapon + Off Hand), keeping only the best status", async () => {
    // player 1 has two rows for item 2 -- a 'bis' Weapon pick and a 'good'
    // Off Hand pick, the same shape a dual-wield-capable class's real
    // wishlist can produce for one weapon (item_preferences_no_dupe_item_key
    // is unique on player_id/item_id/slot, not player_id/item_id, precisely
    // so both rows can coexist). Without dedup this joined twice, duplicating
    // the name in the H array and racing on which status won.
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into public.priority_order (team_id, season, item_id, track, rank, player_id) values
           (1, 'export-test', 2, 'Hero', 1, 2),
           (1, 'export-test', 2, 'Hero', 2, 1),
           (1, 'export-test', 2, 'Myth', 1, 1)`
      );
      await client.query(
        `insert into public.item_preferences (team_id, player_id, item_id, status, season, slot) values
           (1, 1, 2, 'bis', 'export-test', 'Weapon'),
           (1, 1, 2, 'good', 'export-test', 'Off Hand')`
      );
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: OFFICER_T1, role: 'authenticated' })
      ]);
      await client.query('set local role authenticated');
      const res = await client.query('select public.build_rclc_export(1, $1, $2) as payload', ['export-test', 'Hero']);
      const priority = res.rows[0].payload.priority['100002'];

      expect(priority.H).toEqual(['Seedplayertwo-Illidan', 'Seedraider-Illidan']);
      expect(priority.H_status).toEqual({ 'Seedraider-Illidan': 'bis' });
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('ignores catalyst/pass rows -- only bis/good/ok are wishlist status', async () => {
    await withPriorityAndWishlistSeeded(
      'authenticated',
      OFFICER_T1,
      `(1, 1, 2, 'pass', 'export-test'), (1, 2, 2, 'catalyst', 'export-test')`,
      async (q) => {
        const res = await q('select public.build_rclc_export(1, $1, $2) as payload', ['export-test', 'Hero']);
        const priority = res.rows[0].payload.priority['100002'];

        expect(priority.H_status).toEqual({});
      }
    );
  });

  it("attaches the site's default wishlist tier labels when the team has no overrides", async () => {
    await withRole('authenticated', OFFICER_T1, async (q) => {
      const res = await q('select public.build_rclc_export(1, $1, $2) as payload', ['export-test', 'Hero']);
      expect(res.rows[0].payload.statusLabels).toEqual({ bis: 'BiS', good: '2nd Choice', ok: 'Sidegrade' });
    });
  });

  it("merges a team's configured wishlist tier label overrides over the defaults", async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `update public.team_settings set config = config || '{"wishlistStatusLabels":{"good":"2nd Choice","ok":"Sidegrade Pick"}}'::jsonb where team_id = 1`
      );
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: OFFICER_T1, role: 'authenticated' })
      ]);
      await client.query('set local role authenticated');
      const res = await client.query('select public.build_rclc_export(1, $1, $2) as payload', ['export-test', 'Hero']);
      // 'bis' was never overridden -- falls back to the site default,
      // merged alongside the two explicit overrides.
      expect(res.rows[0].payload.statusLabels).toEqual({
        bis: 'BiS',
        good: '2nd Choice',
        ok: 'Sidegrade Pick'
      });
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('scopes priority to the given season, not other seasons for the same team', async () => {
    await withRole('authenticated', OFFICER_T1, async (q) => {
      await seedPriority(q);
      const res = await q('select public.build_rclc_export(1, $1, $2) as payload', ['some-other-season', 'Hero']);
      expect(res.rows[0].payload.priority).toEqual({});
    });
  });

  it("an officer with no role on team 2 cannot request team 2's export", async () => {
    await withItemsAndBisSeeded('authenticated', OFFICER_T1, async (q) => {
      await seedPriority(q);
      await expect(q('select public.build_rclc_export(2, $1, $2)', ['export-test', 'Hero'])).rejects.toThrow(
        'Not authorized'
      );
    });
  });

  it('a team leader is also authorized', async () => {
    await withRole('authenticated', TEAM_LEADER_T1, async (q) => {
      const res = await q('select public.build_rclc_export(1, $1, $2) as payload', ['export-test', 'Hero']);
      // seed.sql has no item_preferences rows, so players comes back empty
      // here -- this test only asserts authorization succeeds and
      // season-scoped priority stays empty.
      expect(res.rows[0].payload.priority).toEqual({});
    });
  });

  it('a raider is not authorized', async () => {
    await withRole('authenticated', RAIDER_T1, async (q) => {
      await expect(q('select public.build_rclc_export(1, $1, $2)', ['export-test', 'Hero'])).rejects.toThrow(
        'Not authorized'
      );
    });
  });

  it('an officer on another team is not authorized for team 1', async () => {
    await withRole('authenticated', OFFICER_T2, async (q) => {
      await expect(q('select public.build_rclc_export(1, $1, $2)', ['export-test', 'Hero'])).rejects.toThrow(
        'Not authorized'
      );
    });
  });
});
