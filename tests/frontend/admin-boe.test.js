import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #748: the site admin dashboard's BoE tab -- the manager grant panel and the
// guild-wide payout constants.
//
// This is the first test file over js/admin.js. admin-tab-visibility.test.js
// covers js/tabs/tab-admin.js, which is the *officer* dashboard's Admin tab, a
// different file on a different page. Three things about js/admin.js shape the
// sandbox below and are worth knowing before adding to it:
//
//   1. It calls checkAdminAccess() at module scope. With window: {} the
//      supabaseClient initializer resolves to null, so that call falls through
//      to showState('adminDeniedMsg') and the onAuthStateChange registration
//      is skipped by its own guard. Tests assign sandbox.supabaseClient after
//      load, before calling anything.
//   2. escapeHtml() goes through document.createElement('div'), sets
//      textContent and reads innerHTML back. The usual createElement: () => ({})
//      stub returns undefined from it, which would make every escaping
//      assertion vacuous. makeEscapingDiv() below reproduces the real
//      serialization instead.
//   3. switchTab() reads the bare global `event`.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_JS = readFileSync(path.join(HERE, '../../js/admin.js'), 'utf8');

function makeEl() {
  return {
    disabled: false,
    textContent: '',
    value: '',
    innerHTML: '',
    style: {},
    classList: { add: vi.fn(), remove: vi.fn() }
  };
}

// What a browser actually does on textContent -> innerHTML: escapes &, < and
// >, and leaves quotes alone. escapeHtml() is only as strong as this, which is
// why the escaping test below asserts on angle brackets rather than quotes.
function makeEscapingDiv() {
  const div = { innerHTML: '', _text: '' };
  Object.defineProperty(div, 'textContent', {
    get() {
      return this._text;
    },
    set(value) {
      this._text = String(value);
      this.innerHTML = this._text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  });
  return div;
}

// Records every rpc() call, and serves the one from().select().eq().maybeSingle()
// read the payout panel makes.
function makeSupabaseClient({ rpcResults = {}, settingsResult } = {}) {
  const rpcCalls = [];
  const fromCalls = [];
  const client = {
    rpc(name, params) {
      rpcCalls.push({ name, params });
      const configured = rpcResults[name];
      return Promise.resolve(configured !== undefined ? configured : { data: null, error: null });
    },
    from(table) {
      const call = { table };
      fromCalls.push(call);
      return {
        select(cols) {
          call.cols = cols;
          return {
            eq(col, val) {
              call.eq = { col, val };
              return {
                maybeSingle() {
                  call.maybeSingle = true;
                  return Promise.resolve(settingsResult !== undefined ? settingsResult : { data: null, error: null });
                }
              };
            }
          };
        }
      };
    }
  };
  return { client, rpcCalls, fromCalls };
}

function makeSandbox({ els = {}, rpcResults, settingsResult, confirmResult = true } = {}) {
  const allEls = { ...els };
  const { client, rpcCalls, fromCalls } = makeSupabaseClient({ rpcResults, settingsResult });
  const confirmFn = vi.fn(() => confirmResult);
  const alertFn = vi.fn();
  const sandbox = {
    console,
    window: {},
    document: {
      getElementById: (id) => {
        if (!allEls[id]) allEls[id] = makeEl();
        return allEls[id];
      },
      querySelectorAll: () => [],
      createElement: () => makeEscapingDiv()
    },
    confirm: confirmFn,
    alert: alertFn,
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(ADMIN_JS, sandbox, { filename: 'admin.js' });
  // Module scope already ran with supabaseClient null (see note 1 above).
  sandbox.supabaseClient = client;
  return { sandbox, els: allEls, rpcCalls, fromCalls, confirmFn, alertFn };
}

const MANAGER_LIST = [
  { id: 1, discord_id: '111111111111111111', auth_user_id: 'uuid-a', display_name: 'Bankie' },
  { id: 2, discord_id: '222222222222222222', auth_user_id: null, display_name: null }
];

describe('boeManagerDisplayName / boeManagerActivated (#748)', () => {
  it('reads a signed-in grant by its Discord name', () => {
    const { sandbox } = makeSandbox();
    expect(sandbox.boeManagerDisplayName({ auth_user_id: 'uuid-a', display_name: 'Bankie' })).toBe('Bankie');
    expect(sandbox.boeManagerActivated({ auth_user_id: 'uuid-a', display_name: 'Bankie' })).toBe(true);
  });

  it('never says "not yet logged in" about a grant that has activated', () => {
    // auth_user_id set but no name in raw_user_meta_data: activated, just
    // nameless. Falling back to the guild-officer panel's single
    // "(not yet logged in)" string here would contradict the Active badge
    // sitting in the next column.
    const row = { auth_user_id: 'uuid-b', display_name: null };
    expect(sandbox_of(row).name).toBe('(no name on file)');
    expect(sandbox_of(row).activated).toBe(true);
  });

  it('reports a grant made before first sign-in as not activated', () => {
    const row = { auth_user_id: null, display_name: null };
    expect(sandbox_of(row).name).toBe('(not yet logged in)');
    expect(sandbox_of(row).activated).toBe(false);
  });

  function sandbox_of(row) {
    const { sandbox } = makeSandbox();
    return { name: sandbox.boeManagerDisplayName(row), activated: sandbox.boeManagerActivated(row) };
  }
});

describe('the BoE manager list (#748)', () => {
  it('renders a row per grant from admin_list_boe_managers', async () => {
    const { sandbox, els, rpcCalls } = makeSandbox({
      rpcResults: { admin_list_boe_managers: { data: MANAGER_LIST, error: null } }
    });
    await sandbox.loadBoeManagers();

    expect(rpcCalls).toEqual([{ name: 'admin_list_boe_managers', params: undefined }]);
    const html = els.adminBoeManagerRows.innerHTML;
    expect(html).toContain('Bankie');
    expect(html).toContain('111111111111111111');
    expect(html).toContain('222222222222222222');
    expect((html.match(/<tr>/g) || []).length).toBe(2);
  });

  it('badges each grant according to its own auth_user_id', async () => {
    const { sandbox, els } = makeSandbox({
      rpcResults: { admin_list_boe_managers: { data: MANAGER_LIST, error: null } }
    });
    await sandbox.loadBoeManagers();

    // Per row, not over the whole table: with one activated grant and one
    // not, asserting that both badges appear somewhere passes just as well
    // when the two are swapped, which is the one thing this has to catch.
    const rows = els.adminBoeManagerRows.innerHTML.split('<tr>').filter(Boolean);
    const live = rows.find((r) => r.includes('111111111111111111'));
    const pending = rows.find((r) => r.includes('222222222222222222'));

    expect(live).toContain('admin-status-active');
    expect(live).toContain('>Active<');
    expect(live).not.toContain('Not activated');
    expect(pending).toContain('admin-status-archived');
    expect(pending).toContain('>Not activated<');
  });

  it('escapes markup in a Discord ID', async () => {
    // escapeHtml() neutralizes & < > and not quotes -- asserting on quotes
    // here would be asserting a guarantee the helper does not make.
    const { sandbox, els } = makeSandbox({
      rpcResults: {
        admin_list_boe_managers: {
          data: [{ id: 1, discord_id: '<img src=x>&', auth_user_id: null, display_name: null }],
          error: null
        }
      }
    });
    await sandbox.loadBoeManagers();

    const html = els.adminBoeManagerRows.innerHTML;
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x&gt;&amp;');
  });
});

describe('granting a BoE manager (#748)', () => {
  it('sends the trimmed Discord ID, clears the input, and reloads the list', async () => {
    const els = { grantBoeManagerDiscordId: makeEl() };
    els.grantBoeManagerDiscordId.value = '  333333333333333333  ';
    const { sandbox, rpcCalls } = makeSandbox({
      els,
      rpcResults: {
        admin_grant_boe_manager: { data: 3, error: null },
        admin_list_boe_managers: { data: [], error: null }
      }
    });
    await sandbox.submitGrantBoeManager();

    expect(rpcCalls[0]).toEqual({
      name: 'admin_grant_boe_manager',
      params: { p_discord_id: '333333333333333333' }
    });
    expect(els.grantBoeManagerDiscordId.value).toBe('');
    expect(rpcCalls.some((c) => c.name === 'admin_list_boe_managers')).toBe(true);
  });

  it('blocks an empty Discord ID with text feedback and no RPC', () => {
    const els = { grantBoeManagerDiscordId: makeEl(), grantBoeManagerError: makeEl() };
    els.grantBoeManagerDiscordId.value = '   ';
    const { sandbox, rpcCalls } = makeSandbox({ els });
    sandbox.submitGrantBoeManager();

    expect(rpcCalls).toHaveLength(0);
    expect(els.grantBoeManagerError.textContent).toBeTruthy();
    expect(els.grantBoeManagerError.style.display).toBe('');
  });

  it('surfaces a grant error as text and keeps what was typed', async () => {
    const els = { grantBoeManagerDiscordId: makeEl(), grantBoeManagerError: makeEl() };
    els.grantBoeManagerDiscordId.value = '444444444444444444';
    const { sandbox } = makeSandbox({
      els,
      rpcResults: {
        admin_grant_boe_manager: {
          data: null,
          error: { message: 'That Discord account already has BoE manager access' }
        }
      }
    });
    await sandbox.submitGrantBoeManager();

    expect(els.grantBoeManagerError.textContent).toBe('That Discord account already has BoE manager access');
    expect(els.grantBoeManagerError.style.display).toBe('');
    expect(els.grantBoeManagerDiscordId.value).toBe('444444444444444444');
  });
});

describe('revoking a BoE manager (#748)', () => {
  it('sends admin_revoke_boe_manager once confirmed', async () => {
    const { sandbox, rpcCalls, confirmFn } = makeSandbox({
      rpcResults: {
        admin_revoke_boe_manager: { data: null, error: null },
        admin_list_boe_managers: { data: [], error: null }
      }
    });
    await sandbox.submitRevokeBoeManager('111111111111111111');

    expect(confirmFn).toHaveBeenCalledTimes(1);
    expect(rpcCalls[0]).toEqual({
      name: 'admin_revoke_boe_manager',
      params: { p_discord_id: '111111111111111111' }
    });
  });

  it('sends nothing when the confirm is declined', () => {
    const { sandbox, rpcCalls } = makeSandbox({ confirmResult: false });
    sandbox.submitRevokeBoeManager('111111111111111111');
    expect(rpcCalls).toHaveLength(0);
  });
});

describe('boePayoutSummary (#748)', () => {
  // boe_record_sale computes least(sale - fee, greatest(floor, round(sale * floor /
  // pivot))) with fee = 5% of the sale (#861). Two exact identities fall out of that and are all this line
  // states: the rate is floor/pivot, and the percentage overtakes the floor
  // exactly when sale > pivot (S * floor/pivot > floor <=> S > pivot, for any
  // values). Nothing here mirrors the round/greatest/least logic itself.
  it('states the rate and the crossover for the shipped constants', () => {
    const { sandbox } = makeSandbox();
    expect(sandbox.boePayoutSummary('20000', '100000')).toBe(
      "Finder gets 20% on sales above 100,000g, or a flat 20,000g below that, never more than the sale minus the game's 5% auction house fee. The guild keeps the rest."
    );
  });

  it('renders a non-round rate to two decimals without trailing zeros', () => {
    const { sandbox } = makeSandbox();
    expect(sandbox.boePayoutSummary('20000', '30000')).toContain('66.67%');
    expect(sandbox.boePayoutSummary('25000', '100000')).toContain('25%');
  });

  it('returns nothing rather than dividing by zero mid-typing', () => {
    // The line recomputes on every keystroke, so the pivot passes through ''
    // and '0' on the way to any new value.
    const { sandbox } = makeSandbox();
    expect(sandbox.boePayoutSummary('20000', '')).toBe('');
    expect(sandbox.boePayoutSummary('20000', '0')).toBe('');
    expect(sandbox.boePayoutSummary('', '100000')).toBe('');
    expect(sandbox.boePayoutSummary('abc', '100000')).toBe('');
  });
});

describe('reading the payout settings (#748)', () => {
  it('renders the stored values into the two inputs', async () => {
    const { sandbox, els, fromCalls } = makeSandbox({
      settingsResult: { data: { boe_payout_floor: 20000, boe_payout_pivot: 100000 }, error: null }
    });
    await sandbox.loadBoePayoutSettings();

    expect(fromCalls[0].table).toBe('site_settings');
    expect(fromCalls[0].eq).toEqual({ col: 'id', val: 1 });
    expect(fromCalls[0].maybeSingle).toBe(true);
    expect(els.boePayoutFloor.value).toBe('20000');
    expect(els.boePayoutPivot.value).toBe('100000');
    expect(els.boePayoutSummary.textContent).toContain('20%');
  });

  it('leaves the inputs empty on a failed read rather than showing the defaults', async () => {
    // The maintenance panel can safely fall back to its defaults because
    // nothing writes them back. Here it would not be safe: an admin who then
    // pressed Save would overwrite the real payout policy with whatever the
    // page happened to be displaying.
    const { sandbox, els } = makeSandbox({
      settingsResult: { data: null, error: { message: 'permission denied' } }
    });
    await sandbox.loadBoePayoutSettings();

    expect(els.boePayoutFloor.value).toBe('');
    expect(els.boePayoutPivot.value).toBe('');
    expect(els.boePayoutError.textContent).toBe('permission denied');
    expect(els.boePayoutError.style.display).toBe('');
  });
});

describe('saving the payout settings (#748)', () => {
  function payoutEls(floor, pivot) {
    const els = {
      boePayoutFloor: makeEl(),
      boePayoutPivot: makeEl(),
      boePayoutError: makeEl(),
      boePayoutStatus: makeEl()
    };
    els.boePayoutFloor.value = floor;
    els.boePayoutPivot.value = pivot;
    return els;
  }

  it('sends the parsed integers through set_boe_payout_settings', async () => {
    const { sandbox, rpcCalls } = makeSandbox({
      els: payoutEls('20000', '100000'),
      rpcResults: { set_boe_payout_settings: { data: null, error: null } },
      settingsResult: { data: { boe_payout_floor: 20000, boe_payout_pivot: 100000 }, error: null }
    });
    await sandbox.submitBoePayoutSettings();

    expect(rpcCalls[0]).toEqual({
      name: 'set_boe_payout_settings',
      params: { p_floor: 20000, p_pivot: 100000 }
    });
  });

  it('accepts the comma-formatted gold an officer would paste', async () => {
    const { sandbox, rpcCalls } = makeSandbox({
      els: payoutEls('20,000', '100,000g'),
      rpcResults: { set_boe_payout_settings: { data: null, error: null } },
      settingsResult: { data: {}, error: null }
    });
    await sandbox.submitBoePayoutSettings();

    expect(rpcCalls[0].params).toEqual({ p_floor: 20000, p_pivot: 100000 });
  });

  it.each([
    ['a non-numeric floor', 'twenty thousand', '100000'],
    ['a negative floor', '-5000', '100000'],
    ['a zero pivot', '20000', '0'],
    ['a negative pivot', '20000', '-100000'],
    ['a non-numeric pivot', '20000', 'lots'],
    // floor and pivot are bigint server-side; parseInt past 2^53 rounds
    // silently, so a number that large would be sent as a different number.
    ['a floor past MAX_SAFE_INTEGER', '9007199254740993', '100000']
  ])('blocks %s with text feedback and no RPC', (_label, floor, pivot) => {
    const els = payoutEls(floor, pivot);
    const { sandbox, rpcCalls } = makeSandbox({ els });
    sandbox.submitBoePayoutSettings();

    expect(rpcCalls).toHaveLength(0);
    expect(els.boePayoutError.textContent).toBeTruthy();
    expect(els.boePayoutError.style.display).toBe('');
  });

  it('surfaces a save error as text', async () => {
    const els = payoutEls('20000', '100000');
    const { sandbox } = makeSandbox({
      els,
      rpcResults: { set_boe_payout_settings: { data: null, error: { message: 'Not authorized' } } }
    });
    await sandbox.submitBoePayoutSettings();

    expect(els.boePayoutError.textContent).toBe('Not authorized');
    expect(els.boePayoutError.style.display).toBe('');
    expect(els.boePayoutStatus.textContent).toBe('');
  });
});

describe('BoE tab wiring (#748)', () => {
  it('switchTab("boe") shows the panel and loads both halves', () => {
    const els = { 'tab-boe': makeEl() };
    const { sandbox, rpcCalls, fromCalls } = makeSandbox({
      els,
      rpcResults: { admin_list_boe_managers: { data: [], error: null } },
      settingsResult: { data: {}, error: null }
    });
    sandbox.event = { target: { classList: { add: vi.fn(), remove: vi.fn() } } };
    sandbox.switchTab('boe');

    expect(els['tab-boe'].classList.add).toHaveBeenCalledWith('active');
    expect(rpcCalls.some((c) => c.name === 'admin_list_boe_managers')).toBe(true);
    expect(fromCalls.some((c) => c.table === 'site_settings')).toBe(true);
  });
});
