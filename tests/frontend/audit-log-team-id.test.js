import { describe, it, expect } from 'vitest';
import { loadCommonJs, quietConsole } from './helpers/common-sandbox.js';

// writeAuditLog() took the team id from _teamCfg, which is the page's team.
// Two things broke on that (#774):
//
//   1. js/guild.js nulls _teamCfg on purpose so a team-dependent helper called
//      on a team-free page throws instead of silently rendering Phoenix. Any
//      audit write from the guild page was therefore a TypeError.
//   2. Since #765 the BoE read is guild-wide, so a manager acting on another
//      team's find logged the row under whichever team's dashboard they
//      happened to be looking at. Live mis-attribution, not just a crash.
//
// Both are the same fix: let the caller name the team the entry is about.

function withClient(sandbox) {
  const calls = [];
  sandbox.supabaseClient = {
    rpc: (name, params) => {
      calls.push({ name, params });
      return Promise.resolve({ error: null });
    }
  };
  return calls;
}

describe('writeAuditLog team id (#774)', () => {
  it('uses the page team when no team is named, unchanged from before', async () => {
    const s = loadCommonJs(quietConsole);
    const calls = withClient(s);
    s._teamCfg = { supabaseTeamId: 2 };

    await s.writeAuditLog('Player Renamed', 'players', 7, 'a -> b');

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('write_audit_log');
    expect(calls[0].params.p_team_id).toBe(2);
    expect(calls[0].params.p_action).toBe('Player Renamed');
  });

  it('uses the named team over the page team, for a guild-wide row', async () => {
    const s = loadCommonJs(quietConsole);
    const calls = withClient(s);
    // The officer viewing Phoenix's dashboard, acting on a Wrathless find.
    s._teamCfg = { supabaseTeamId: 1 };

    await s.writeAuditLog('BoE Sale Recorded', 'boe_items', 12, 'sold', 4);

    expect(calls[0].params.p_team_id).toBe(4);
  });

  it('does not throw on a page with no team, given a team to name', async () => {
    const s = loadCommonJs(quietConsole);
    const calls = withClient(s);
    // guild.js:26-28. Reading .supabaseTeamId off this is the TypeError.
    s._teamCfg = null;

    await expect(s.writeAuditLog('BoE Retired', 'boe_items', 3, 'gone', 3)).resolves.toBeUndefined();
    expect(calls[0].params.p_team_id).toBe(3);
  });

  it('sends a null team rather than throwing when there is neither', async () => {
    const s = loadCommonJs(quietConsole);
    const calls = withClient(s);
    s._teamCfg = null;

    await s.writeAuditLog('Something', 'players', 1, 'detail');

    expect(calls[0].params.p_team_id).toBeNull();
  });
});
