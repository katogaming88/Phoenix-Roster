import { describe, it, expect } from 'vitest';
import { loadCommonJs, quietConsole } from './helpers/common-sandbox.js';

// fetchBoeAccess() in js/common.js (#864) answers who may open the BoE Sales
// surface and who may act in it. It moved here from js/guild.js when boe.html
// became its own page, because three pages now need the same answer: guild.html
// and officer.html to reveal the link, boe.html to gate itself.
//
// Loaded through loadCommonJs() rather than a page suite's sandbox, because a
// page suite stubs what it does not own and this is the helper itself.

function withClient({ rpc = {}, reject = false } = {}) {
  const sandbox = loadCommonJs(quietConsole);
  const calls = [];
  sandbox.supabaseClient = {
    rpc: (name) => {
      calls.push(name);
      if (reject) return Promise.reject(new Error('network'));
      return Promise.resolve({ data: rpc[name] === true, error: null });
    }
  };
  return { sandbox, calls };
}

describe('fetchBoeAccess', () => {
  it('is defined by js/common.js', () => {
    const { sandbox } = withClient();
    expect(typeof sandbox.fetchBoeAccess).toBe('function');
  });

  it('signed out, resolves to no access without a single RPC', async () => {
    const { sandbox, calls } = withClient({ rpc: { is_boe_manager: true } });
    const access = await sandbox.fetchBoeAccess(null);
    expect(access).toEqual({ visible: false, canManage: false });
    expect(calls).toEqual([]);
  });

  it('asks exactly the three grant functions once each', async () => {
    const { sandbox, calls } = withClient();
    await sandbox.fetchBoeAccess({ user: { id: 'auth-1' } });
    expect(calls.sort()).toEqual(['is_any_team_officer', 'is_boe_manager', 'is_site_admin']);
  });

  it('a plain officer may see but not act', async () => {
    const { sandbox } = withClient({ rpc: { is_any_team_officer: true } });
    expect(await sandbox.fetchBoeAccess({ user: { id: 'auth-1' } })).toEqual({ visible: true, canManage: false });
  });

  it('a BoE manager may act, officer role or not', async () => {
    const { sandbox } = withClient({ rpc: { is_boe_manager: true } });
    expect(await sandbox.fetchBoeAccess({ user: { id: 'auth-1' } })).toEqual({ visible: true, canManage: true });
  });

  it('a site admin may act, whom is_boe_manager does not cover', async () => {
    const { sandbox } = withClient({ rpc: { is_site_admin: true } });
    expect(await sandbox.fetchBoeAccess({ user: { id: 'auth-1' } })).toEqual({ visible: true, canManage: true });
  });

  it('none of the three means no access', async () => {
    const { sandbox } = withClient();
    expect(await sandbox.fetchBoeAccess({ user: { id: 'auth-1' } })).toEqual({ visible: false, canManage: false });
  });

  it('a rejected RPC counts as false rather than throwing', async () => {
    const { sandbox } = withClient({ reject: true });
    expect(await sandbox.fetchBoeAccess({ user: { id: 'auth-1' } })).toEqual({ visible: false, canManage: false });
  });

  it('with no client at all, resolves to no access', async () => {
    const { sandbox } = withClient();
    sandbox.supabaseClient = null;
    expect(await sandbox.fetchBoeAccess({ user: { id: 'auth-1' } })).toEqual({ visible: false, canManage: false });
  });
});
