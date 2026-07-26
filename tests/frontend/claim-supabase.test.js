import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// js/discord.js and js/officer-quick-actions.js are plain browser scripts (no
// exports), so these tests load them into a vm sandbox with just enough browser
// globals stubbed. Everything they declare with var/function lands on the sandbox,
// which is how the tests reach submitCharacterClaim/showDiscordClaimModal/
// resolveDiscordSession and _renderClaimPrompt. The backend RPC is already covered
// by tests/rls/claim.test.js -- here we only assert the JS mapping and UI wiring
// against a mocked supabase client.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DISCORD_JS = readFileSync(path.join(HERE, '../../js/discord.js'), 'utf8');
const QUICK_ACTIONS_JS = readFileSync(path.join(HERE, '../../js/officer-quick-actions.js'), 'utf8');
const ROSTER_JS = readFileSync(path.join(HERE, '../../js/roster.js'), 'utf8');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// --- Fake DOM elements ------------------------------------------------------

function makeEl(extra) {
  return Object.assign({ style: {}, textContent: '', value: '', disabled: false }, extra);
}

// A <select> stand-in: appendChild collects options, and setting innerHTML resets
// the collected list the way the browser clears children on assignment.
function makeSelect() {
  const el = { style: {}, value: '', disabled: false, options: [] };
  Object.defineProperty(el, 'innerHTML', {
    set(v) {
      el._html = v;
      el.options = [];
    },
    get() {
      return el._html;
    }
  });
  el.appendChild = (opt) => el.options.push(opt);
  return el;
}

// --- Mock supabase client ---------------------------------------------------

// Routes .from(table) and .rpc(name) to per-test resolvers and records the chain
// so tests can assert the filters used. Each resolver returns a { data, error }.
function makeClient(config) {
  const captured = { byTable: {}, rpc: null };
  function builder(resolve) {
    const calls = { select: null, eq: [], neq: [], is: [], order: [], limit: null, maybeSingle: false };
    const b = {
      select(c) {
        calls.select = c;
        return b;
      },
      eq(c, v) {
        calls.eq.push([c, v]);
        return b;
      },
      neq(c, v) {
        calls.neq.push([c, v]);
        return b;
      },
      is(c, v) {
        calls.is.push([c, v]);
        return b;
      },
      order(c) {
        calls.order.push(c);
        return b;
      },
      limit(n) {
        calls.limit = n;
        return b;
      },
      maybeSingle() {
        calls.maybeSingle = true;
        return b;
      },
      then(ok, err) {
        return Promise.resolve()
          .then(() => resolve())
          .then(ok, err);
      }
    };
    return { b, calls };
  }
  const client = {
    from(table) {
      const { b, calls } = builder(() => (config[table] ? config[table]() : { data: null, error: null }));
      captured.byTable[table] = calls;
      return b;
    },
    rpc(name, params) {
      captured.rpc = { name, params };
      const fn = (config.rpc && config.rpc[name]) || (() => ({ data: null, error: null }));
      const { b } = builder(fn);
      return b;
    }
  };
  return { client, captured };
}

// --- Sandbox loaders --------------------------------------------------------

function baseSandbox(els, store) {
  return {
    TEAM_SLUG: 'phoenix',
    _teamCfg: { supabaseTeamId: 1 },
    TEAMS: {
      phoenix: { name: 'Phoenix', supabaseTeamId: 1 },
      hellfire: { name: 'Hellfire Rollers', supabaseTeamId: 2 }
    },
    console,
    document: {
      getElementById: (id) => els[id] || null,
      createElement: () => ({ value: '', textContent: '' }),
      querySelector: (sel) => (sel.indexOf('claim-submit-btn') !== -1 ? els._submitBtn || null : null)
    },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => {
        delete store[k];
      }
    },
    setTimeout,
    clearTimeout,
    Promise
  };
}

function loadDiscordJs({ supabaseClient, els = {}, store = {}, hooks = {} } = {}) {
  const sandbox = baseSandbox(els, store);
  sandbox.supabaseClient = supabaseClient;
  Object.assign(sandbox, hooks);
  vm.createContext(sandbox);
  vm.runInContext(DISCORD_JS, sandbox, { filename: 'discord.js' });
  return sandbox;
}

function loadQuickActions({ els = {}, getSession } = {}) {
  const sandbox = baseSandbox(els, {});
  // _qaRefresh() runs eagerly at load; getDiscordSession must already resolve.
  sandbox.getDiscordSession = getSession || (() => null);
  vm.createContext(sandbox);
  vm.runInContext(QUICK_ACTIONS_JS, sandbox, { filename: 'officer-quick-actions.js' });
  return sandbox;
}

// ---------------------------------------------------------------------------

describe('submitCharacterClaim', () => {
  function seededSession() {
    return { username: 'Kato', nameRealm: null, isOfficer: false, isAdmin: false };
  }

  function setup(rpcResult, selectValue) {
    const els = {
      claimCharacterSelect: makeEl({ value: selectValue }),
      claimError: makeEl({ style: { display: 'none' } }),
      discordClaimModal: makeEl({ style: { display: '' } }),
      _submitBtn: makeEl({ textContent: 'Confirm claim' })
    };
    const store = { wga_discord_phoenix: JSON.stringify(seededSession()) };
    const { client, captured } = makeClient({ rpc: { claim_character: () => rpcResult } });
    const onDiscordClaimComplete = vi.fn();
    const sandbox = loadDiscordJs({ supabaseClient: client, els, store, hooks: { onDiscordClaimComplete } });
    return { els, sandbox, captured, onDiscordClaimComplete };
  }

  it('sends the right params and maps the claimed character into the session', async () => {
    const { els, sandbox, captured, onDiscordClaimComplete } = setup(
      { data: [{ name_realm: 'Seedplayertwo-Illidan', role: 'raider' }], error: null },
      'Seedplayertwo-Illidan'
    );
    sandbox.submitCharacterClaim();
    await flush();

    expect(captured.rpc.name).toBe('claim_character');
    expect(captured.rpc.params).toEqual({ p_team_id: 1, p_name_realm: 'Seedplayertwo-Illidan' });
    const mapped = sandbox.getDiscordSession();
    expect(mapped.nameRealm).toBe('Seedplayertwo-Illidan');
    expect(mapped.isOfficer).toBe(false);
    expect(els.discordClaimModal.style.display).toBe('none');
    expect(els._submitBtn.disabled).toBe(false);
    expect(els._submitBtn.textContent).toBe('Confirm claim');
    expect(onDiscordClaimComplete).toHaveBeenCalledTimes(1);
    expect(onDiscordClaimComplete.mock.calls[0][0].nameRealm).toBe('Seedplayertwo-Illidan');
  });

  it('derives isOfficer from a team_leader/officer role', async () => {
    const { sandbox } = setup(
      { data: [{ name_realm: 'Kato-Illidan', role: 'team_leader' }], error: null },
      'Kato-Illidan'
    );
    sandbox.submitCharacterClaim();
    await flush();
    const mapped = sandbox.getDiscordSession();
    expect(mapped.isOfficer).toBe(true);
    expect(mapped.isTeamLeader).toBe(true);
  });

  it('does not set isTeamLeader for a plain officer role', async () => {
    const { sandbox } = setup({ data: [{ name_realm: 'Rex-Illidan', role: 'officer' }], error: null }, 'Rex-Illidan');
    sandbox.submitCharacterClaim();
    await flush();
    const mapped = sandbox.getDiscordSession();
    expect(mapped.isOfficer).toBe(true);
    expect(mapped.isTeamLeader).toBe(false);
  });

  it('shows the RPC error message and leaves the modal open on a rejected claim', async () => {
    const { els, sandbox, onDiscordClaimComplete } = setup(
      { data: null, error: { message: 'Seedplayertwo-Illidan is already claimed' } },
      'Seedplayertwo-Illidan'
    );
    sandbox.submitCharacterClaim();
    await flush();
    expect(els.claimError.textContent).toBe('Seedplayertwo-Illidan is already claimed');
    expect(els.claimError.style.display).toBe('');
    expect(els.discordClaimModal.style.display).toBe('');
    expect(els._submitBtn.disabled).toBe(false);
    expect(onDiscordClaimComplete).not.toHaveBeenCalled();
  });

  it('short-circuits with a prompt when no character is selected (no RPC)', async () => {
    const { els, sandbox, captured } = setup({ data: null, error: null }, '');
    sandbox.submitCharacterClaim();
    await flush();
    expect(els.claimError.textContent).toBe('Please select a character.');
    expect(captured.rpc).toBeNull();
  });
});

describe('showDiscordClaimModal', () => {
  function setup(playersResult) {
    const els = {
      discordClaimModal: makeEl({ style: { display: 'none' } }),
      claimDiscordName: makeEl(),
      claimError: makeEl({ style: { display: '' } }),
      claimCharacterSelect: makeSelect()
    };
    const { client, captured } = makeClient({ players: () => playersResult });
    const sandbox = loadDiscordJs({ supabaseClient: client, els });
    return { els, sandbox, captured };
  }

  it('shows the modal synchronously and queries unclaimed active characters', async () => {
    const { els, sandbox, captured } = setup({
      data: [
        { name_realm: 'Aaa-Illidan', classes_specs: { class: 'Mage', role: 'Ranged' } },
        { name_realm: 'Bbb-Illidan', classes_specs: { class: 'Priest', role: 'Heal' } }
      ],
      error: null
    });
    sandbox.showDiscordClaimModal({ username: 'Kato' });
    expect(els.discordClaimModal.style.display).toBe(''); // synchronous
    expect(els.claimDiscordName.textContent).toBe('Kato');
    await flush();

    const q = captured.byTable.players;
    expect(q.eq).toEqual([['team_id', 1]]);
    expect(q.is).toEqual([
      ['team_member_id', null],
      ['archived_at', null]
    ]);
    expect(q.order).toEqual(['name_realm']);
    // placeholder + 2 characters
    expect(els.claimCharacterSelect.options.map((o) => o.value)).toEqual(['Aaa-Illidan', 'Bbb-Illidan']);
    expect(els.claimCharacterSelect.options[0].textContent).toBe('Aaa-Illidan (Mage)');
  });

  it('skips rows without a role (departed-loot stubs never appear)', async () => {
    const { els, sandbox } = setup({
      data: [
        { name_realm: 'Real-Illidan', classes_specs: { class: 'Warrior', role: 'Tank' } },
        { name_realm: 'Stub-Illidan', classes_specs: null },
        { name_realm: 'Stub2-Illidan', classes_specs: { class: 'X', role: null } }
      ],
      error: null
    });
    sandbox.showDiscordClaimModal({ username: 'Kato' });
    await flush();
    expect(els.claimCharacterSelect.options.map((o) => o.value)).toEqual(['Real-Illidan']);
  });

  it('leaves just the placeholder when there are no unclaimed characters', async () => {
    const { els, sandbox } = setup({ data: [], error: null });
    sandbox.showDiscordClaimModal({ username: 'Kato' });
    await flush();
    expect(els.claimCharacterSelect.options).toEqual([]);
    expect(els.claimCharacterSelect.innerHTML).toContain('Select your character');
  });
});

describe('resolveDiscordSession', () => {
  const session = { user: { id: 'u1', user_metadata: { full_name: 'Kato' } } };

  function setup({ member, linkedPlayer, admin = false }) {
    const { client, captured } = makeClient({
      team_members: () => ({ data: member, error: null }),
      players: () => ({ data: linkedPlayer, error: null }),
      rpc: { is_site_admin: () => ({ data: admin, error: null }) }
    });
    const sandbox = loadDiscordJs({ supabaseClient: client });
    return { sandbox, captured };
  }

  it('resolves nameRealm from the linked player and filters the lookup', async () => {
    const { sandbox, captured } = setup({
      member: { id: 5, role: 'raider', name_realm: null },
      linkedPlayer: { name_realm: 'Linked-Illidan' }
    });
    const mapped = await sandbox.resolveDiscordSession(session);
    expect(mapped).toEqual({
      authUserId: 'u1',
      teamMemberId: 5,
      username: 'Kato',
      discordId: null,
      nameRealm: 'Linked-Illidan',
      isOfficer: false,
      isTeamLeader: false,
      isAdmin: false
    });
    const q = captured.byTable.players;
    expect(q.eq).toEqual([['team_member_id', 5]]);
    expect(q.is).toEqual([['archived_at', null]]);
    expect(q.order).toEqual(['name_realm']);
    expect(q.limit).toBe(1);
  });

  it('falls back to team_members.name_realm when no player is linked', async () => {
    const { sandbox } = setup({
      member: { id: 5, role: 'officer', name_realm: 'Bridge-Illidan' },
      linkedPlayer: null
    });
    const mapped = await sandbox.resolveDiscordSession(session);
    expect(mapped.nameRealm).toBe('Bridge-Illidan');
    expect(mapped.isOfficer).toBe(true);
  });

  it('is null nameRealm with no member row, and reflects is_site_admin', async () => {
    const { sandbox, captured } = setup({ member: null, linkedPlayer: null, admin: true });
    const mapped = await sandbox.resolveDiscordSession(session);
    expect(mapped.nameRealm).toBeNull();
    expect(mapped.isOfficer).toBe(false);
    expect(mapped.isAdmin).toBe(true);
    // no player lookup issued when there is no member row
    expect(captured.byTable.players).toBeUndefined();
  });

  // "Members read own team_members" (#212) has no team_id filter, so a raider's
  // row on another team is visible from this team's page too -- used to tell
  // "never claimed anywhere" apart from "claimed, just on the other team".
  describe('claimedElsewhere (#368 follow-up)', () => {
    function setupElsewhere(elsewhereRows) {
      let teamMembersCalls = 0;
      const { client, captured } = makeClient({
        team_members: () => {
          teamMembersCalls += 1;
          // First call: this-team lookup (no local member). Second call: the
          // cross-team findClaimElsewhere() query.
          return teamMembersCalls === 1 ? { data: null, error: null } : { data: elsewhereRows, error: null };
        },
        rpc: { is_site_admin: () => ({ data: false, error: null }) }
      });
      const sandbox = loadDiscordJs({ supabaseClient: client });
      return { sandbox, captured };
    }

    it('sets claimedElsewhere with the team and character when found on another team', async () => {
      const { sandbox, captured } = setupElsewhere([{ team_id: 2, players: [{ name_realm: 'Alt-Illidan' }] }]);
      const mapped = await sandbox.resolveDiscordSession(session);
      expect(mapped.nameRealm).toBeNull();
      expect(mapped.claimedElsewhere).toEqual({
        teamSlug: 'hellfire',
        teamName: 'Hellfire Rollers',
        nameRealm: 'Alt-Illidan'
      });
      const q = captured.byTable.team_members;
      expect(q.eq).toEqual([['auth_user_id', 'u1']]);
      expect(q.neq).toEqual([['team_id', 1]]);
    });

    it('leaves claimedElsewhere null when the other team row has no linked player', async () => {
      const { sandbox } = setupElsewhere([{ team_id: 2, players: [] }]);
      const mapped = await sandbox.resolveDiscordSession(session);
      expect(mapped.claimedElsewhere).toBeNull();
    });

    it('leaves claimedElsewhere null when there is no row on any other team', async () => {
      const { sandbox } = setupElsewhere([]);
      const mapped = await sandbox.resolveDiscordSession(session);
      expect(mapped.claimedElsewhere).toBeNull();
    });
  });
});

describe('_renderClaimPrompt', () => {
  function setup() {
    const els = {
      claimPromptCard: makeEl({ style: { display: '' } }),
      claimPromptName: makeEl(),
      claimPromptLoading: makeEl({ style: { display: '' } }),
      claimPromptDesc: makeEl({ style: { display: 'none' } }),
      claimPromptElsewhereDesc: makeEl({ style: { display: 'none' } }),
      claimPromptElsewhereWho: makeEl(),
      claimPromptElsewhereChar: makeEl(),
      claimPromptElsewhereTeam: makeEl(),
      claimPromptBtn: makeEl({ style: { display: 'none' } })
    };
    let current = null;
    const sandbox = loadQuickActions({ els, getSession: () => current });
    return { els, sandbox, setSession: (s) => (current = s) };
  }

  it('shows the elsewhere message and wires the button to switch teams (#368 follow-up)', () => {
    const { els, sandbox, setSession } = setup();
    setSession({
      username: 'Kato',
      nameRealm: null,
      claimedElsewhere: { teamSlug: 'hellfire', teamName: 'Hellfire Rollers', nameRealm: 'Alt-Illidan' }
    });
    sandbox._renderClaimPrompt();
    expect(els.claimPromptCard.style.display).toBe('');
    expect(els.claimPromptDesc.style.display).toBe('none');
    expect(els.claimPromptElsewhereDesc.style.display).toBe('');
    expect(els.claimPromptElsewhereWho.textContent).toBe('Kato');
    expect(els.claimPromptElsewhereChar.textContent).toBe('Alt-Illidan');
    expect(els.claimPromptElsewhereTeam.textContent).toBe('Hellfire Rollers');
    expect(els.claimPromptBtn.textContent).toBe('Switch to Hellfire Rollers');
    expect(typeof els.claimPromptBtn.onclick).toBe('function');
  });

  it('shows the box and sets the name when logged in without a claim', () => {
    const { els, sandbox, setSession } = setup();
    setSession({ username: 'Kato', nameRealm: null });
    sandbox._renderClaimPrompt();
    expect(els.claimPromptCard.style.display).toBe('');
    expect(els.claimPromptName.textContent).toBe('Kato');
  });

  it('hides the box when logged out', () => {
    const { els, sandbox, setSession } = setup();
    setSession(null);
    sandbox._renderClaimPrompt();
    expect(els.claimPromptCard.style.display).toBe('none');
  });

  it('hides the box once a character is claimed', () => {
    const { els, sandbox, setSession } = setup();
    setSession({ username: 'Kato', nameRealm: 'Kato-Illidan' });
    sandbox._renderClaimPrompt();
    expect(els.claimPromptCard.style.display).toBe('none');
  });

  it('restores the real description and button, hiding the loading text, once resolved (#371)', () => {
    const { els, sandbox, setSession } = setup();
    // Simulate having shown the loading placeholder first, the way
    // _renderClaimPromptLoading() leaves it before resolution completes.
    els.claimPromptLoading.style.display = '';
    els.claimPromptDesc.style.display = 'none';
    els.claimPromptBtn.style.display = 'none';
    setSession({ username: 'Kato', nameRealm: null });
    sandbox._renderClaimPrompt();
    expect(els.claimPromptLoading.style.display).toBe('none');
    expect(els.claimPromptDesc.style.display).toBe('');
    expect(els.claimPromptBtn.style.display).toBe('');
  });
});

describe('_renderOfficerNavLink', () => {
  function setup() {
    const els = { navOfficer: makeEl({ style: { display: 'none' } }) };
    let current = null;
    const sandbox = loadQuickActions({ els, getSession: () => current });
    return { els, sandbox, setSession: (s) => (current = s) };
  }

  it('shows the link for an officer', () => {
    const { els, sandbox, setSession } = setup();
    setSession({ username: 'Kato', isOfficer: true, isAdmin: false });
    sandbox._renderOfficerNavLink();
    expect(els.navOfficer.style.display).toBe('');
  });

  it('shows the link for a site admin who is not an officer on this team', () => {
    const { els, sandbox, setSession } = setup();
    setSession({ username: 'Kato', isOfficer: false, isAdmin: true });
    sandbox._renderOfficerNavLink();
    expect(els.navOfficer.style.display).toBe('');
  });

  it('hides the link for a plain raider', () => {
    const { els, sandbox, setSession } = setup();
    setSession({ username: 'Kato', isOfficer: false, isAdmin: false });
    sandbox._renderOfficerNavLink();
    expect(els.navOfficer.style.display).toBe('none');
  });

  it('hides the link when logged out', () => {
    const { els, sandbox, setSession } = setup();
    setSession(null);
    sandbox._renderOfficerNavLink();
    expect(els.navOfficer.style.display).toBe('none');
  });
});

// #371: shown the instant a real auth session exists but resolveDiscordSession()
// hasn't resolved the mapped shape yet, so the card isn't just invisible for
// however long that takes.
describe('_renderClaimPromptLoading', () => {
  function setup(getSession) {
    const els = {
      claimPromptCard: makeEl({ style: { display: 'none' } }),
      claimPromptLoading: makeEl({ style: { display: 'none' } }),
      claimPromptDesc: makeEl({ style: { display: '' } }),
      claimPromptBtn: makeEl({ style: { display: '' } })
    };
    const sandbox = loadQuickActions({ els, getSession });
    return { els, sandbox };
  }

  it('shows the card with the loading text and hides the real description/button', () => {
    const { els, sandbox } = setup(() => null);
    sandbox._renderClaimPromptLoading();
    expect(els.claimPromptCard.style.display).toBe('');
    expect(els.claimPromptLoading.style.display).toBe('');
    expect(els.claimPromptDesc.style.display).toBe('none');
    expect(els.claimPromptBtn.style.display).toBe('none');
  });

  it('does nothing when a cached session already exists', () => {
    const { els, sandbox } = setup(() => ({ username: 'Kato', nameRealm: 'Kato-Illidan' }));
    sandbox._renderClaimPromptLoading();
    expect(els.claimPromptCard.style.display).toBe('none');
    expect(els.claimPromptLoading.style.display).toBe('none');
  });
});

// #371: the gap between a SIGNED_IN event and resolveDiscordSession() resolving
// (a team_members lookup, then a players lookup + is_site_admin in parallel) had
// no visual feedback, so a backgrounded tab deferring those requests looked like
// login had silently failed.
describe('renderDiscordNavLoading (#371)', () => {
  function setupInitLogin(storedSession) {
    const { client } = makeClient({
      team_members: () => ({ data: null, error: null }),
      rpc: { is_site_admin: () => ({ data: false, error: null }) }
    });
    let authStateCb = null;
    client.auth = {
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      onAuthStateChange: (cb) => {
        authStateCb = cb;
      }
    };
    const navBtn = makeEl({
      textContent: 'Login with Discord',
      disabled: false,
      classList: { add: () => {}, remove: () => {} }
    });
    const els = { navDiscord: navBtn };
    const store = storedSession ? { wga_discord_phoenix: JSON.stringify(storedSession) } : {};
    const sandbox = loadDiscordJs({ supabaseClient: client, els, store });
    sandbox.initDiscordLogin();
    const fakeSession = { user: { id: 'u1', user_metadata: { full_name: 'Kato' } } };
    return { navBtn, fireSignedIn: () => authStateCb('SIGNED_IN', fakeSession) };
  }

  it('shows "Signing in..." synchronously on SIGNED_IN when there is no cached session', async () => {
    const { navBtn, fireSignedIn } = setupInitLogin(null);
    await flush();
    fireSignedIn();
    expect(navBtn.textContent).toBe('Signing in...');
    expect(navBtn.disabled).toBe(true);
    await flush();
    await flush();
    expect(navBtn.textContent).not.toBe('Signing in...');
  });

  it('does not flash the loading state when a cached session already exists', () => {
    // No flush before firing: the mock getSession() resolves null on a
    // microtask and would clear this seeded cache via fallBackToNoSession()
    // once it settles, same as a real expired-session case would -- firing
    // synchronously checks the SIGNED_IN handler's own gating in isolation.
    const { navBtn, fireSignedIn } = setupInitLogin({ username: 'Kato', nameRealm: null, isOfficer: false });
    fireSignedIn();
    expect(navBtn.textContent).not.toBe('Signing in...');
  });

  it('falls back to logged-out instead of hanging forever if the lookup never settles', async () => {
    vi.useFakeTimers();
    try {
      // team_members never resolves nor rejects -- simulates a stalled request
      // (accepted but never answered), which fetch() has no default timeout for.
      const { client } = makeClient({ team_members: () => new Promise(() => {}) });
      let authStateCb = null;
      client.auth = {
        getSession: () => Promise.resolve({ data: { session: null }, error: null }),
        onAuthStateChange: (cb) => {
          authStateCb = cb;
        }
      };
      const navBtn = makeEl({
        textContent: 'Login with Discord',
        disabled: false,
        classList: { add: () => {}, remove: () => {} }
      });
      const sandbox = loadDiscordJs({ supabaseClient: client, els: { navDiscord: navBtn }, store: {} });
      sandbox.initDiscordLogin();
      await vi.advanceTimersByTimeAsync(0);

      authStateCb('SIGNED_IN', { user: { id: 'u1', user_metadata: { full_name: 'Kato' } } });
      expect(navBtn.textContent).toBe('Signing in...');

      await vi.advanceTimersByTimeAsync(15000);
      expect(navBtn.textContent).toBe('Login with Discord');
      expect(navBtn.disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

// #371 regression: js/roster.js and js/officer-quick-actions.js both declared a
// global onDiscordSessionRestored -- roster.js's declaration loads last on
// index.html and silently won the naming collision, so officer-quick-actions.js's
// version (the one that refreshes the officer bar/player selector/claim prompt)
// was dead code that never ran. Fixed by having roster.js's version call
// _qaRefresh() itself. This test loads the real roster.js the way index.html
// does and asserts the merged behavior, so the collision can't silently return.
describe('onDiscordSessionRestored (#371 collision regression)', () => {
  function loadRosterJs() {
    const qaRefresh = vi.fn();
    const els = {
      playerSelect: { addEventListener: () => {}, options: [], value: '' }
    };
    const sandbox = {
      document: {
        getElementById: (id) => els[id] || null
      },
      sessionStorage: {
        _store: {},
        getItem(k) {
          return k in this._store ? this._store[k] : null;
        },
        setItem(k, v) {
          this._store[k] = String(v);
        },
        removeItem(k) {
          delete this._store[k];
        }
      },
      window: {},
      console,
      loadData: () => {}, // no-op: roster.js's own boot call, not under test here
      checkMaintenanceMode: () => Promise.resolve({ enabled: false }), // common.js stub, same reason
      _qaRefresh: qaRefresh
    };
    sandbox.window.DATA = null;
    vm.createContext(sandbox);
    vm.runInContext(ROSTER_JS, sandbox, { filename: 'roster.js' });
    return { sandbox, qaRefresh, sessionStorage: sandbox.sessionStorage };
  }

  it('calls _qaRefresh() when a session is restored, not just the profile deep-link', () => {
    const { sandbox, qaRefresh } = loadRosterJs();
    sandbox.onDiscordSessionRestored({ username: 'Kato', nameRealm: null });
    expect(qaRefresh).toHaveBeenCalledOnce();
  });

  it('still calls _qaRefresh() when the profile deep-link flag is also set', () => {
    const { sandbox, qaRefresh, sessionStorage } = loadRosterJs();
    sessionStorage.setItem('wga_open_profile', '1');
    // autoOpenClaimedProfile() bails out early (no window.DATA in this sandbox),
    // but _qaRefresh() must still run -- the two behaviors are independent.
    sandbox.onDiscordSessionRestored({ username: 'Kato', nameRealm: 'Kato-Illidan' });
    expect(qaRefresh).toHaveBeenCalledOnce();
  });
});

// #365 follow-up, reshaped by #317: adminAccessLevel() is the single source
// of truth both showAdminTab() call sites (officer.html, js/officer.js) defer
// to for the tri-state result. 'team_leader' grants the team-leader surfaces
// (the sub-tab map itself lives in adminSubTabVisibility, tested in
// admin-tab-visibility.test.js); true grants everything.
describe('adminAccessLevel', () => {
  function load() {
    const sandbox = loadDiscordJs({ supabaseClient: null });
    return sandbox;
  }

  it('grants full access to a site admin', () => {
    const sandbox = load();
    expect(sandbox.adminAccessLevel({ isAdmin: true, isTeamLeader: false })).toBe(true);
  });

  it('grants full access to a site admin who is also a team leader', () => {
    const sandbox = load();
    expect(sandbox.adminAccessLevel({ isAdmin: true, isTeamLeader: true })).toBe(true);
  });

  it('grants team_leader access to a team leader who is not a site admin', () => {
    const sandbox = load();
    expect(sandbox.adminAccessLevel({ isAdmin: false, isTeamLeader: true })).toBe('team_leader');
  });

  it('denies access to a plain officer or raider', () => {
    const sandbox = load();
    expect(sandbox.adminAccessLevel({ isAdmin: false, isTeamLeader: false })).toBe(false);
  });

  it('denies access with no session', () => {
    const sandbox = load();
    expect(sandbox.adminAccessLevel(null)).toBe(false);
  });
});
