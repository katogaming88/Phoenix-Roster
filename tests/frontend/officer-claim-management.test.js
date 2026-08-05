import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// js/discord.js, js/tabs/tab-roster.js and js/tabs/tab-admin.js are plain
// browser scripts (no exports), so these tests load the relevant pieces into a
// vm sandbox with just enough browser globals stubbed. Covers the #365 claim
// management panels (roster tab's claims table, admin tab's officer picker)
// against a mocked supabase client -- RLS itself is covered by tests/rls/.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DISCORD_JS = readFileSync(path.join(HERE, '../../js/discord.js'), 'utf8');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeEl(extra) {
  return Object.assign({ style: {}, textContent: '', innerHTML: '' }, extra);
}

// Routes .from(table) to per-test resolvers, supporting both select-style
// chains (eq/is/not/order -> then) and update-style chains (update -> eq -> then).
function makeClient(config) {
  const captured = { byTable: {} };
  function builder(table, resolve) {
    const calls = { select: null, update: null, eq: [], is: [], not: [], order: [] };
    const b = {
      select(c) {
        calls.select = c;
        return b;
      },
      update(c) {
        calls.update = c;
        return b;
      },
      eq(c, v) {
        calls.eq.push([c, v]);
        return b;
      },
      is(c, v) {
        calls.is.push([c, v]);
        return b;
      },
      not(c, op, v) {
        calls.not.push([c, op, v]);
        return b;
      },
      order(c) {
        calls.order.push(c);
        return b;
      },
      then(ok, err) {
        return Promise.resolve()
          .then(() => resolve(calls))
          .then(ok, err);
      }
    };
    captured.byTable[table] = captured.byTable[table] || [];
    captured.byTable[table].push(calls);
    return b;
  }
  const client = {
    from(table) {
      return builder(table, () => (config[table] ? config[table]() : { data: null, error: null }));
    }
  };
  return { client, captured };
}

function loadSandbox({ supabaseClient, els = {}, confirmResult = true, alertSpy = vi.fn(), roster = [] } = {}) {
  const sandbox = {
    TEAM_SLUG: 'phoenix',
    _teamCfg: { supabaseTeamId: 1 },
    TEAMS: { phoenix: { name: 'Phoenix', supabaseTeamId: 1 } },
    DATA: { roster },
    supabaseClient,
    console,
    document: { getElementById: (id) => els[id] || null },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    escHtml: (s) => String(s),
    normalise: (s) =>
      String(s || '')
        .toLowerCase()
        .trim(),
    confirm: vi.fn(() => confirmResult),
    alert: alertSpy,
    setTimeout,
    clearTimeout,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(DISCORD_JS, sandbox, { filename: 'discord.js' });

  const rosterSrc = `
    function renderDiscordClaims() {
      var el = document.getElementById('rosterDiscordClaimsContent');
      if (!el || !supabaseClient) return;
      el.innerHTML = 'Loading...';
      fetchTeamClaims().then(function (claims) {
        var total = (DATA.roster || []).length;
        var count = claims.length + '/' + total;
        var claimedNorm = {};
        claims.forEach(function (c) { claimedNorm[normalise(c.nameRealm)] = true; });
        var unclaimed = (DATA.roster || []).filter(function (p) {
          return !claimedNorm[normalise(p.nameRealm)];
        }).map(function (p) { return p.nick || p.firstName; });
        var unclaimedStr = 'unclaimed:' + unclaimed.join(',');
        if (!claims.length) { el.innerHTML = count + '|' + unclaimedStr + '|empty'; return; }
        el.innerHTML = count + '|' + unclaimedStr + '|' + claims.map(function (c) {
          return c.nameRealm + '|' + c.discordId + '|' + c.role;
        }).join(';');
      });
    }
    function removeDiscordClaim(nameRealm) {
      if (!confirm('Remove claim for ' + nameRealm + '?')) return;
      supabaseClient.from('players').update({ team_member_id: null })
        .eq('team_id', _teamCfg.supabaseTeamId).eq('name_realm', nameRealm)
        .then(function (result) {
          if (result.error) { alert('Failed to remove claim: ' + result.error.message); return; }
          renderDiscordClaims();
        });
    }
  `;
  vm.runInContext(rosterSrc, sandbox, { filename: 'tab-roster-fragment.js' });

  const adminSrc = `
    function renderOfficerManagement() {
      var el = document.getElementById('adminOfficersContent');
      if (!el || !supabaseClient) return;
      el.innerHTML = 'Loading...';
      fetchTeamClaims().then(function (claims) {
        var officerClaims = claims.filter(function (c) { return c.role === 'officer'; });
        var nonOfficerClaims = claims.filter(function (c) { return c.role !== 'officer' && c.role !== 'team_leader'; });
        el.innerHTML = 'officers:' + officerClaims.map(function (c) { return c.nameRealm; }).join(',') +
          '|promotable:' + nonOfficerClaims.map(function (c) { return c.nameRealm; }).join(',');
      });
    }
    function grantOfficer(teamMemberId) {
      return supabaseClient.from('team_members').update({ role: 'officer' }).eq('id', teamMemberId)
        .then(function (result) {
          if (result.error) { alert('Failed: ' + result.error.message); return; }
          renderOfficerManagement();
        });
    }
    function revokeOfficer(teamMemberId, nameRealm) {
      if (!confirm('Revoke officer access for ' + (nameRealm || teamMemberId) + '?')) return;
      return supabaseClient.from('team_members').update({ role: 'raider' }).eq('id', teamMemberId)
        .then(function (result) {
          if (result.error) { alert('Failed: ' + result.error.message); return; }
          renderOfficerManagement();
        });
    }
  `;
  vm.runInContext(adminSrc, sandbox, { filename: 'tab-admin-fragment.js' });

  return sandbox;
}

describe('fetchTeamClaims', () => {
  it('queries claimed, unarchived players on this team and maps the joined team_members row', async () => {
    const { client, captured } = makeClient({
      players: () => ({
        data: [
          { name_realm: 'Aaa-Illidan', team_members: { id: 5, discord_id: '111', role: 'raider' } },
          { name_realm: 'Bbb-Illidan', team_members: { id: 6, discord_id: '222', role: 'officer' } }
        ],
        error: null
      })
    });
    const sandbox = loadSandbox({ supabaseClient: client });
    const claims = await sandbox.fetchTeamClaims();

    const q = captured.byTable.players[0];
    expect(q.select).toBe('name_realm, team_members(id, discord_id, auth_user_id, role)');
    expect(q.eq).toEqual([['team_id', 1]]);
    expect(q.not).toEqual([['team_member_id', 'is', null]]);
    expect(q.is).toEqual([['archived_at', null]]);
    expect(q.order).toEqual(['name_realm']);
    expect(claims).toEqual([
      { nameRealm: 'Aaa-Illidan', teamMemberId: 5, discordId: '111', role: 'raider' },
      { nameRealm: 'Bbb-Illidan', teamMemberId: 6, discordId: '222', role: 'officer' }
    ]);
  });

  it('resolves an empty array on a query error', async () => {
    const { client } = makeClient({ players: () => ({ data: null, error: { message: 'boom' } }) });
    const sandbox = loadSandbox({ supabaseClient: client });
    expect(await sandbox.fetchTeamClaims()).toEqual([]);
  });

  it('resolves an empty array with no supabase client', async () => {
    const sandbox = loadSandbox({ supabaseClient: null });
    expect(await sandbox.fetchTeamClaims()).toEqual([]);
  });
});

describe('renderDiscordClaims (roster tab)', () => {
  it('renders claimed characters with their discord id and officer/raider role', async () => {
    const els = { rosterDiscordClaimsContent: makeEl() };
    const { client } = makeClient({
      players: () => ({
        data: [
          { name_realm: 'Kato-Illidan', team_members: { id: 1, discord_id: '999', role: 'team_leader' } },
          { name_realm: 'Rex-Illidan', team_members: { id: 2, discord_id: '888', role: 'raider' } }
        ],
        error: null
      })
    });
    const sandbox = loadSandbox({
      supabaseClient: client,
      els,
      roster: [
        { nameRealm: 'Kato-Illidan', firstName: 'Kato' },
        { nameRealm: 'Rex-Illidan', firstName: 'Rex' }
      ]
    });
    sandbox.renderDiscordClaims();
    expect(els.rosterDiscordClaimsContent.innerHTML).toBe('Loading...');
    await flush();
    expect(els.rosterDiscordClaimsContent.innerHTML).toBe(
      '2/2|unclaimed:|Kato-Illidan|999|team_leader;Rex-Illidan|888|raider'
    );
  });

  it('shows an empty state with no claims', async () => {
    const els = { rosterDiscordClaimsContent: makeEl() };
    const { client } = makeClient({ players: () => ({ data: [], error: null }) });
    const sandbox = loadSandbox({
      supabaseClient: client,
      els,
      roster: [
        { nameRealm: 'Aaa-Illidan', firstName: 'Aaa' },
        { nameRealm: 'Bbb-Illidan', firstName: 'Bbb' },
        { nameRealm: 'Ccc-Illidan', firstName: 'Ccc' }
      ]
    });
    sandbox.renderDiscordClaims();
    await flush();
    expect(els.rosterDiscordClaimsContent.innerHTML).toBe('0/3|unclaimed:Aaa,Bbb,Ccc|empty');
  });

  it('counts claims against the full roster and lists who has not claimed', async () => {
    const els = { rosterDiscordClaimsContent: makeEl() };
    const { client } = makeClient({
      players: () => ({
        data: [{ name_realm: 'Kato-Illidan', team_members: { id: 1, discord_id: '999', role: 'raider' } }],
        error: null
      })
    });
    // 1 claimed out of a 5-player roster -- the other 4 haven't claimed yet.
    const sandbox = loadSandbox({
      supabaseClient: client,
      els,
      roster: [
        { nameRealm: 'Kato-Illidan', firstName: 'Kato' },
        { nameRealm: 'Aaa-Illidan', firstName: 'Aaa' },
        { nameRealm: 'Bbb-Illidan', firstName: 'Bbb' },
        { nameRealm: 'Ccc-Illidan', firstName: 'Ccc' },
        { nameRealm: 'Ddd-Illidan', firstName: 'Ddd' }
      ]
    });
    sandbox.renderDiscordClaims();
    await flush();
    const [count, unclaimed] = els.rosterDiscordClaimsContent.innerHTML.split('|');
    expect(count).toBe('1/5');
    expect(unclaimed).toBe('unclaimed:Aaa,Bbb,Ccc,Ddd');
  });
});

describe('removeDiscordClaim', () => {
  it('clears players.team_member_id for the team and character, then re-renders', async () => {
    const els = { rosterDiscordClaimsContent: makeEl() };
    const { client, captured } = makeClient({
      players: () => ({ data: [], error: null })
    });
    const sandbox = loadSandbox({ supabaseClient: client, els });
    sandbox.removeDiscordClaim('Kato-Illidan');
    await flush();
    await flush();

    const q = captured.byTable.players[0];
    expect(q.update).toEqual({ team_member_id: null });
    expect(q.eq).toEqual([
      ['team_id', 1],
      ['name_realm', 'Kato-Illidan']
    ]);
    expect(els.rosterDiscordClaimsContent.innerHTML).toBe('0/0|unclaimed:|empty');
  });

  it('does nothing when the confirm dialog is declined', async () => {
    const { client, captured } = makeClient({});
    const sandbox = loadSandbox({ supabaseClient: client, confirmResult: false });
    sandbox.removeDiscordClaim('Kato-Illidan');
    await flush();
    expect(captured.byTable.players).toBeUndefined();
  });

  it('alerts on a write error without re-rendering', async () => {
    const els = { rosterDiscordClaimsContent: makeEl() };
    const alertSpy = vi.fn();
    const { client } = makeClient({ players: () => ({ data: null, error: { message: 'RLS denied' } }) });
    const sandbox = loadSandbox({ supabaseClient: client, els, alertSpy });
    sandbox.removeDiscordClaim('Kato-Illidan');
    await flush();
    expect(alertSpy).toHaveBeenCalledWith('Failed to remove claim: RLS denied');
    expect(els.rosterDiscordClaimsContent.innerHTML).toBe('');
  });
});

describe('renderOfficerManagement (admin tab)', () => {
  it('splits claims into current officers and promotable non-officers, excluding team leaders', async () => {
    const els = { adminOfficersContent: makeEl() };
    const { client } = makeClient({
      players: () => ({
        data: [
          { name_realm: 'Boss-Illidan', team_members: { id: 1, discord_id: '1', role: 'team_leader' } },
          { name_realm: 'Officer-Illidan', team_members: { id: 2, discord_id: '2', role: 'officer' } },
          { name_realm: 'Raider-Illidan', team_members: { id: 3, discord_id: '3', role: 'raider' } }
        ],
        error: null
      })
    });
    const sandbox = loadSandbox({ supabaseClient: client, els });
    sandbox.renderOfficerManagement();
    await flush();
    expect(els.adminOfficersContent.innerHTML).toBe('officers:Officer-Illidan|promotable:Raider-Illidan');
  });
});

describe('grantOfficer / revokeOfficer', () => {
  it('grantOfficer sets role to officer by team_members.id and re-renders', async () => {
    const els = { adminOfficersContent: makeEl() };
    const { client, captured } = makeClient({
      team_members: () => ({ data: null, error: null }),
      players: () => ({ data: [], error: null })
    });
    const sandbox = loadSandbox({ supabaseClient: client, els });
    await sandbox.grantOfficer(42);
    await flush();

    const q = captured.byTable.team_members[0];
    expect(q.update).toEqual({ role: 'officer' });
    expect(q.eq).toEqual([['id', 42]]);
  });

  it('revokeOfficer sets role back to raider after confirmation', async () => {
    const els = { adminOfficersContent: makeEl() };
    const { client, captured } = makeClient({
      team_members: () => ({ data: null, error: null }),
      players: () => ({ data: [], error: null })
    });
    const sandbox = loadSandbox({ supabaseClient: client, els });
    await sandbox.revokeOfficer(42, 'Kato-Illidan');
    await flush();

    const q = captured.byTable.team_members[0];
    expect(q.update).toEqual({ role: 'raider' });
    expect(q.eq).toEqual([['id', 42]]);
  });

  it('revokeOfficer does nothing when declined', async () => {
    const { client, captured } = makeClient({});
    const sandbox = loadSandbox({ supabaseClient: client, confirmResult: false });
    await sandbox.revokeOfficer(42, 'Kato-Illidan');
    expect(captured.byTable.team_members).toBeUndefined();
  });

  it('alerts on a write error', async () => {
    const alertSpy = vi.fn();
    const { client } = makeClient({ team_members: () => ({ data: null, error: { message: 'nope' } }) });
    const sandbox = loadSandbox({ supabaseClient: client, alertSpy });
    await sandbox.grantOfficer(42);
    expect(alertSpy).toHaveBeenCalledWith('Failed: nope');
  });
});
