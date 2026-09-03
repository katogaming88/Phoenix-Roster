import { describe, it, expect } from 'vitest';
import { loadCommonJs, quietConsole } from './helpers/common-sandbox.js';

// fetchBoeAccess() in js/common.js (#864, reshaped in #890) answers what the
// caller may DO on the BoE Sales page. It no longer answers whether they may
// open it: since #890 anyone signed in may, and the read policies decide what
// comes back -- a manager or site admin every find, an officer the teams they
// staff, a raider their own (#889).
//
// Two things, then: `manage` for the lifecycle actions (is_boe_manager() or
// is_site_admin(), the same pair every money RPC gates on), and
// `settleTeamIds` for the payout buttons, which can_settle_boe() grants an
// officer or team leader on that team (#888). The teams come from the
// caller's own team_members rows, readable through the self-read policy
// ("Members read own team_members") rather than an RPC, because the page
// needs the ids themselves and not a yes/no.
//
// Loaded through loadCommonJs() rather than a page suite's sandbox, because a
// page suite stubs what it does not own and this is the helper itself.

function withClient({ rpc = {}, members = [], reject = false, memberError = false } = {}) {
  const sandbox = loadCommonJs(quietConsole);
  const calls = [];
  sandbox.supabaseClient = {
    rpc: (name) => {
      calls.push('rpc:' + name);
      if (reject) return Promise.reject(new Error('network'));
      return Promise.resolve({ data: rpc[name] === true, error: null });
    },
    from: (table) => {
      calls.push('from:' + table);
      const b = {
        select: (cols) => {
          calls.push('select:' + cols);
          return b;
        },
        eq: (col, val) => {
          calls.push('eq:' + col + '=' + val);
          return b;
        },
        then: (resolve, rejectFn) =>
          Promise.resolve(
            memberError ? { data: null, error: { message: 'permission denied' } } : { data: members, error: null }
          ).then(resolve, rejectFn)
      };
      return b;
    }
  };
  return { sandbox, calls };
}

const SESSION = { user: { id: 'auth-1' } };
const OFFICER_ROW = (teamId) => ({ team_id: teamId, role: 'officer' });

describe('fetchBoeAccess', () => {
  it('is defined by js/common.js', () => {
    const { sandbox } = withClient();
    expect(typeof sandbox.fetchBoeAccess).toBe('function');
  });

  it('signed out, resolves to nothing without a single read', async () => {
    const { sandbox, calls } = withClient({ rpc: { is_boe_manager: true } });
    const access = await sandbox.fetchBoeAccess(null);
    expect(access).toEqual({ signedIn: false, manage: false, settleTeamIds: [] });
    expect(calls).toEqual([]);
  });

  it('asks the two grant functions and nothing else', async () => {
    // is_any_team_officer() is no longer asked here (#890): it answers "any
    // team at all", which was the old visible gate, and the page needs the
    // team ids instead. The RPC itself stays for the boe_managers read policy.
    const { sandbox, calls } = withClient();
    await sandbox.fetchBoeAccess(SESSION);
    expect(calls.filter((c) => c.startsWith('rpc:')).sort()).toEqual(['rpc:is_boe_manager', 'rpc:is_site_admin']);
  });

  it('reads the settle teams from the caller own team_members rows', async () => {
    const { sandbox, calls } = withClient();
    await sandbox.fetchBoeAccess(SESSION);
    expect(calls).toContain('from:team_members');
    expect(calls).toContain('eq:auth_user_id=auth-1');
  });

  it('a signed-in raider may open the page and act on nothing', async () => {
    const { sandbox } = withClient({ members: [{ team_id: 1, role: 'raider' }] });
    expect(await sandbox.fetchBoeAccess(SESSION)).toEqual({ signedIn: true, manage: false, settleTeamIds: [] });
  });

  it('an officer settles the teams they staff, and only those', async () => {
    const { sandbox } = withClient({
      members: [OFFICER_ROW(1), { team_id: 2, role: 'team_leader' }, { team_id: 3, role: 'raider' }]
    });
    const access = await sandbox.fetchBoeAccess(SESSION);
    expect(access.manage).toBe(false);
    expect(access.settleTeamIds.sort()).toEqual([1, 2]);
  });

  it('a BoE manager may act, officer role or not', async () => {
    const { sandbox } = withClient({ rpc: { is_boe_manager: true } });
    const access = await sandbox.fetchBoeAccess(SESSION);
    expect(access.manage).toBe(true);
    expect(access.signedIn).toBe(true);
  });

  it('a site admin may act, whom is_boe_manager does not cover', async () => {
    const { sandbox } = withClient({ rpc: { is_site_admin: true } });
    expect((await sandbox.fetchBoeAccess(SESSION)).manage).toBe(true);
  });

  it('a manager who also staffs a team keeps both answers', async () => {
    const { sandbox } = withClient({ rpc: { is_boe_manager: true }, members: [OFFICER_ROW(2)] });
    const access = await sandbox.fetchBoeAccess(SESSION);
    expect(access.manage).toBe(true);
    expect(access.settleTeamIds).toEqual([2]);
  });

  it('a rejected RPC counts as false and still leaves them signed in', async () => {
    // The page renders on signedIn alone, so a flaky grant read has to cost
    // the buttons and not the records the policies would have returned.
    const { sandbox } = withClient({ reject: true });
    expect(await sandbox.fetchBoeAccess(SESSION)).toEqual({ signedIn: true, manage: false, settleTeamIds: [] });
  });

  it('a team_members read that errors reads as no settle teams', async () => {
    const { sandbox } = withClient({ memberError: true, rpc: { is_boe_manager: true } });
    const access = await sandbox.fetchBoeAccess(SESSION);
    expect(access.settleTeamIds).toEqual([]);
    expect(access.manage).toBe(true);
  });

  it('with no client at all, says signed in and grants nothing', async () => {
    const { sandbox } = withClient();
    sandbox.supabaseClient = null;
    expect(await sandbox.fetchBoeAccess(SESSION)).toEqual({ signedIn: true, manage: false, settleTeamIds: [] });
  });
});
