import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A raider reported that marking their crafted Off Hand received also
// auto-marked an unrelated Crafted-tagged slot as received. Root cause: the
// placeholder sources ('M+', 'Crafted', 'Catalyst') all share one catalog
// item name across every slot they're tagged against (#386's bis_items
// uniqueness note), so any display-side lookup keyed on item name alone
// collapses every "Crafted" row into a single entry -- one approval lit up
// every row with that name, regardless of slot. The fix threads dbSlot
// through both mapSupabaseSelfReceived() (now sourced from
// self_received_requests.slot, not the catalog's always-'Placeholder' slot)
// and selfReceivedEntryForRow(), which only trusts a name-only match when
// there's just one candidate.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');

function loadSandbox() {
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({}),
      head: { appendChild: () => {} }
    },
    console,
    Intl,
    setTimeout,
    clearTimeout,
    DATA: {}
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  return sandbox;
}

describe('selfReceivedEntryForRow does not collapse same-name placeholder rows', () => {
  it('only reports the slot that was actually approved', () => {
    const sandbox = loadSandbox();
    const selfRecItems = [{ item: 'Crafted', slot: 'Off Hand', source: 'Mythic: Crafted' }];

    expect(sandbox.selfReceivedEntryForRow(selfRecItems, 'Crafted', 'Off Hand')).toBeTruthy();
    // The bug: a second Crafted-tagged slot must NOT show as received too.
    expect(sandbox.selfReceivedEntryForRow(selfRecItems, 'Crafted', 'Chest')).toBeFalsy();
  });

  it('still matches a single legacy row with no slot recorded on either side', () => {
    const sandbox = loadSandbox();
    // Pre-#386 data: neither side ever got a slot. Only safe because there's
    // exactly one candidate -- matches sync_bis_obtained_from_self_received()'s
    // own single-row inference on the DB side.
    const selfRecItems = [{ item: 'Some Trinket', slot: '', source: 'Heroic: Raid' }];
    expect(sandbox.selfReceivedEntryForRow(selfRecItems, 'Some Trinket', 'Trinket 1')).toBeTruthy();
  });

  it('does not guess between two same-named rows that both lack a slot', () => {
    const sandbox = loadSandbox();
    const selfRecItems = [
      { item: 'Crafted', slot: '', source: 'Mythic: Crafted' },
      { item: 'Crafted', slot: '', source: 'Mythic: Crafted' }
    ];
    expect(sandbox.selfReceivedEntryForRow(selfRecItems, 'Crafted', 'Off Hand')).toBeFalsy();
  });
});

describe('mapSupabaseSelfReceived carries the request-level slot, not the catalog slot', () => {
  it("uses row.slot (bis_items.slot) over the placeholder catalog row's Placeholder sentinel", () => {
    const sandbox = loadSandbox();
    const rows = [
      {
        track: 'Myth',
        source: 'Crafted',
        slot: 'Off Hand',
        players: { name_realm: 'Kat-Stormrage' },
        items: { name: 'Crafted', slot: 'Placeholder' }
      }
    ];
    const mapped = sandbox.mapSupabaseSelfReceived(rows);
    expect(mapped['Kat'][0].slot).toBe('Off Hand');
  });
});

describe('optimistic DATA.selfReceived pushes store dbSlot, not the display slot', () => {
  function makeSandbox() {
    const els = {};
    function el(id) {
      if (!els[id]) els[id] = { value: '', innerHTML: '', style: {} };
      return els[id];
    }
    const sandbox = {
      window: {},
      location: { search: '', pathname: '/' },
      sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      localStorage: { getItem: () => null, setItem: () => {} },
      document: {
        getElementById: (id) => els[id] || null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => ({}),
        head: { appendChild: () => {} }
      },
      console,
      Intl,
      setTimeout: (fn, ms) => {
        const t = setTimeout(fn, ms);
        if (t.unref) t.unref();
        return t;
      },
      clearTimeout
    };
    vm.createContext(sandbox);
    vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
    el('src-row1').value = 'Crafted';
    el('notes-row1').value = '';
    el('diff-row1').value = 'Mythic';
    el('form-row1');
    sandbox.DATA = { selfReceived: {}, roster: [] };
    return { sandbox, els };
  }

  it('submitSelfReceivedRequest auto-approve push uses dbSlot', async () => {
    const { sandbox } = makeSandbox();
    sandbox.supabaseClient = {
      rpc: () => Promise.resolve({ data: [{ id: 1, auto_approved: true }], error: null })
    };
    await sandbox.submitSelfReceivedRequest('Kat', 'Kat-Stormrage', 'Crafted', 'Crafted', 'row1', 'Off Hand');
    expect(sandbox.DATA.selfReceived['Kat'][0].slot).toBe('Off Hand');
  });

  it('submitDirectMarkReceived push uses dbSlot', async () => {
    const { sandbox } = makeSandbox();
    sandbox.supabaseClient = {
      rpc: () => Promise.resolve({ data: [{ id: 1 }], error: null }),
      functions: { invoke: () => Promise.resolve({}) }
    };
    await sandbox.submitDirectMarkReceived('Kat', 'Kat-Stormrage', 'Crafted', 'Crafted', 'row1', 'Off Hand');
    expect(sandbox.DATA.selfReceived['Kat'][0].slot).toBe('Off Hand');
  });
});
