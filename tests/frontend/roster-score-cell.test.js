import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// _rosterScoreCellHtml() (tab-roster.js) renders the Roster tab's Recent
// Score column -- the exact committed value generate_priority_order() reads
// for DPS priority. Tank/Heal are excluded from that formula's performance
// blend entirely (Attendance only), so they always show "--" regardless of
// whatever's in the scoring column for them. Same load-common.js-then-the-
// tab-file sandbox pattern as tests/frontend/priority-boss-filter-order.test.js.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const ROSTER_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-roster.js'), 'utf8');

function makeSandbox(supabase) {
  const windowObj = {};
  if (supabase) windowObj.supabase = supabase;
  const sandbox = {
    window: windowObj,
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    console,
    document: { getElementById: () => null, createElement: () => ({}), head: { appendChild: () => {} } },
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  vm.runInContext(ROSTER_JS, sandbox, { filename: 'tab-roster.js' });
  return sandbox;
}

// Chainable stand-in for .from('scoring').select(...).in(...).eq(...).then(...),
// capturing every call so the query shape itself can be asserted -- this is
// exactly what would have caught the scoring.team_id bug (that column
// doesn't exist; scoring is scoped by player_id/season only, and "Public
// read scoring" has no team restriction at the RLS level either, so
// team-scoping has to happen via .in('player_id', ...) against the roster
// already in DATA, not a filter column that isn't there).
function mockScoringSupabase(result) {
  const calls = { from: null, select: null, in: [], eq: [] };
  const builder = {
    select(cols) {
      calls.select = cols;
      return builder;
    },
    in(col, vals) {
      calls.in.push([col, vals]);
      return builder;
    },
    eq(col, val) {
      calls.eq.push([col, val]);
      return builder;
    },
    then(onFulfilled, onRejected) {
      return Promise.resolve()
        .then(() => result())
        .then(onFulfilled, onRejected);
    }
  };
  const supabase = {
    createClient: () => ({
      from(table) {
        calls.from = table;
        return builder;
      }
    })
  };
  return { calls, supabase };
}

describe('_rosterScoreCellHtml', () => {
  it('shows "--" for Tank regardless of a stored score', () => {
    const sandbox = makeSandbox();
    sandbox._teamScoringCache = { season: 'MID1', byPlayerId: { 1: 9.5 } };
    const html = sandbox._rosterScoreCellHtml({ id: 1, role: 'Tank' });
    expect(html).toContain('-');
    expect(html).toContain('Priority uses Attendance only for this role');
    expect(html).not.toContain('9.5');
  });

  it('shows "--" for Heal regardless of a stored score', () => {
    const sandbox = makeSandbox();
    sandbox._teamScoringCache = { season: 'MID1', byPlayerId: { 2: 3 } };
    const html = sandbox._rosterScoreCellHtml({ id: 2, role: 'Heal' });
    expect(html).toContain('Priority uses Attendance only for this role');
  });

  it('shows a green DPS score at or above 7', () => {
    const sandbox = makeSandbox();
    sandbox._teamScoringCache = { season: 'MID1', byPlayerId: { 3: 8.4 } };
    const html = sandbox._rosterScoreCellHtml({ id: 3, role: 'Ranged' });
    expect(html).toContain('8.40');
    expect(html).toContain('var(--heal)');
  });

  it('shows a gold DPS score between 5 and 7', () => {
    const sandbox = makeSandbox();
    sandbox._teamScoringCache = { season: 'MID1', byPlayerId: { 4: 5.5 } };
    const html = sandbox._rosterScoreCellHtml({ id: 4, role: 'Melee' });
    expect(html).toContain('5.50');
    expect(html).toContain('var(--gold)');
  });

  it('shows a dim DPS score below 5', () => {
    const sandbox = makeSandbox();
    sandbox._teamScoringCache = { season: 'MID1', byPlayerId: { 5: 2.1 } };
    const html = sandbox._rosterScoreCellHtml({ id: 5, role: 'Ranged' });
    expect(html).toContain('2.10');
    expect(html).toContain('var(--text-dim)');
  });

  it('shows a "no committed score yet" dash for a DPS player with no row in the cache', () => {
    const sandbox = makeSandbox();
    sandbox._teamScoringCache = { season: 'MID1', byPlayerId: {} };
    const html = sandbox._rosterScoreCellHtml({ id: 6, role: 'Ranged' });
    expect(html).toContain('No committed score yet this season');
  });

  it('shows the same "not yet" dash when the cache has not loaded at all', () => {
    const sandbox = makeSandbox();
    sandbox._teamScoringCache = null;
    const html = sandbox._rosterScoreCellHtml({ id: 7, role: 'Melee' });
    expect(html).toContain('No committed score yet this season');
  });
});

describe('_fetchTeamScoringIfNeeded', () => {
  it('scopes by player_id (from the roster already in DATA) and season -- never by a team_id column', async () => {
    const { calls, supabase } = mockScoringSupabase(() => ({
      data: [{ player_id: 1, performance_score: 8.4 }],
      error: null
    }));
    const sandbox = makeSandbox(supabase);
    sandbox.DATA = sandbox.window.DATA = {
      seasonName: 'Midnight Season 1',
      roster: [{ id: 1 }, { id: 2 }, { id: null }]
    };
    // The real success handler redraws the table; buildRosterTable() itself
    // needs DOM/filter globals this minimal sandbox doesn't set up and isn't
    // what's under test here, so it's stubbed out.
    sandbox.buildRosterTable = function () {};

    sandbox._fetchTeamScoringIfNeeded();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls.from).toBe('scoring');
    expect(calls.select).toBe('player_id, performance_score');
    // Filtered to this team's own roster ids (nulls dropped) -- not a
    // scoring.team_id column, which doesn't exist on this table at all.
    expect(calls.in).toEqual([['player_id', [1, 2]]]);
    expect(calls.eq).toEqual([['season', 'MID1']]);
    expect(sandbox._teamScoringCache).toEqual({ season: 'MID1', byPlayerId: { 1: 8.4 } });
  });

  it('does not query at all when the roster is empty', async () => {
    const { calls, supabase } = mockScoringSupabase(() => ({ data: [], error: null }));
    const sandbox = makeSandbox(supabase);
    sandbox.DATA = sandbox.window.DATA = { seasonName: 'Midnight Season 1', roster: [] };

    sandbox._fetchTeamScoringIfNeeded();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls.from).toBeNull();
    expect(sandbox._teamScoringCache).toBeNull();
  });

  it('does not re-query once the cache already matches the current season', async () => {
    const { calls, supabase } = mockScoringSupabase(() => ({ data: [], error: null }));
    const sandbox = makeSandbox(supabase);
    sandbox.DATA = sandbox.window.DATA = { seasonName: 'Midnight Season 1', roster: [{ id: 1 }] };
    sandbox._teamScoringCache = { season: 'MID1', byPlayerId: { 1: 5 } };

    sandbox._fetchTeamScoringIfNeeded();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls.from).toBeNull();
  });
});
