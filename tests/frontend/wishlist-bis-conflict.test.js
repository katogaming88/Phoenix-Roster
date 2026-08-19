import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Only one item can be BiS per slot at a time (#515 follow-up): tagging a
// new item BiS should auto-demote whatever was previously BiS in an
// overlapping WISHLIST_SLOTS row to Good, rather than leaving two items both
// claiming BiS for the same slot.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const WISHLIST_JS = readFileSync(path.join(HERE, '../../js/wishlist.js'), 'utf8');

function makeSandbox(itemSlots, itemIds, existingPrefs, itemPlaceholders) {
  const requests = []; // { type: 'insert' | 'update', table, row/patch, eqs }
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      getElementById: () => null,
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
  vm.runInContext(WISHLIST_JS, sandbox, { filename: 'wishlist.js' });

  sandbox.DATA = { itemSlots, itemPlaceholders: itemPlaceholders || {}, itemIds, wishlistOpen: true, roster: [] };
  sandbox._wishlistPlayerId = 11;
  sandbox._wishlistPlayerFirstName = 'Kat';
  sandbox._wishlistPrefs = existingPrefs;

  sandbox.supabaseClient = {
    from(table) {
      return {
        insert(row) {
          const entry = { type: 'insert', table, row };
          requests.push(entry);
          return {
            select() {
              return Promise.resolve({ data: [{ id: 99, ...row }], error: null });
            }
          };
        },
        update(patch) {
          const entry = { type: 'update', table, patch, eqs: {} };
          requests.push(entry);
          const builder = {
            eq(col, val) {
              entry.eqs[col] = val;
              return builder;
            },
            is(col, val) {
              entry.eqs[col] = val;
              return builder;
            },
            select() {
              return Promise.resolve({ data: [{ id: 1, ...patch }], error: null });
            }
          };
          return builder;
        },
        delete() {
          const entry = { type: 'delete', table, eqs: {} };
          requests.push(entry);
          const builder = {
            eq(col, val) {
              entry.eqs[col] = val;
              return builder;
            },
            is(col, val) {
              entry.eqs[col] = val;
              return builder;
            },
            then(resolve) {
              return Promise.resolve({ error: null }).then(resolve);
            }
          };
          return builder;
        }
      };
    }
  };
  return { sandbox, requests };
}

describe('wishlistSetStatus BiS-per-slot conflict resolution', () => {
  it('demotes the previously-BiS item in the same slot to Good', () => {
    const { sandbox, requests } = makeSandbox(
      { 'Old Helm': 'Head', 'New Helm': 'Head' },
      { 'Old Helm': 1, 'New Helm': 2 },
      [{ id: 1, item_id: 1, status: 'bis', note: null, slot: null }]
    );

    sandbox.wishlistSetStatus(2, null, 'bis');

    const demote = requests.find((r) => r.type === 'update' && r.patch.status === 'good');
    expect(demote).toBeTruthy();
    expect(demote.eqs.item_id).toBe(1);

    const newInsert = requests.find((r) => r.type === 'insert');
    expect(newInsert.row).toMatchObject({ item_id: 2, status: 'bis' });
  });

  // The UI now passes an explicit 'Finger 1'/'Finger 2' (or 'Trinket 1'/
  // 'Trinket 2') slot per card so the two rows are tracked independently --
  // only calls with slot: null (the legacy/ambiguous shape) should still
  // collapse the pair together, per the test above.
  it('does not demote a BiS ring in Finger 1 when tagging a different ring BiS in Finger 2', () => {
    const { sandbox, requests } = makeSandbox(
      { 'Ring A': 'Finger', 'Ring B': 'Finger' },
      { 'Ring A': 1, 'Ring B': 2 },
      [{ id: 1, item_id: 1, status: 'bis', note: null, slot: 'Finger 1' }]
    );

    sandbox.wishlistSetStatus(2, 'Finger 2', 'bis');

    const demote = requests.find((r) => r.type === 'update' && r.patch.status === 'good');
    expect(demote).toBeFalsy();

    const newInsert = requests.find((r) => r.type === 'insert');
    expect(newInsert.row).toMatchObject({ item_id: 2, slot: 'Finger 2', status: 'bis' });
  });

  it('does not touch a BiS item in a different slot', () => {
    const { sandbox, requests } = makeSandbox({ Helm: 'Head', Cloak: 'Back' }, { Helm: 1, Cloak: 2 }, [
      { id: 1, item_id: 1, status: 'bis', note: null, slot: null }
    ]);

    sandbox.wishlistSetStatus(2, null, 'bis');

    const demote = requests.find((r) => r.type === 'update');
    expect(demote).toBeFalsy();
  });

  it('demotes an existing BiS ring since Finger 1/Finger 2 share the same item pool', () => {
    const { sandbox, requests } = makeSandbox(
      { 'Ring A': 'Finger', 'Ring B': 'Finger' },
      { 'Ring A': 1, 'Ring B': 2 },
      [{ id: 1, item_id: 1, status: 'bis', note: null, slot: null }]
    );

    sandbox.wishlistSetStatus(2, null, 'bis');

    const demote = requests.find((r) => r.type === 'update' && r.patch.status === 'good');
    expect(demote).toBeTruthy();
    expect(demote.eqs.item_id).toBe(1);
  });

  it('does not demote a non-BiS conflicting item', () => {
    const { sandbox, requests } = makeSandbox(
      { 'Old Helm': 'Head', 'New Helm': 'Head' },
      { 'Old Helm': 1, 'New Helm': 2 },
      [{ id: 1, item_id: 1, status: 'good', note: null, slot: null }]
    );

    sandbox.wishlistSetStatus(2, null, 'bis');

    const demote = requests.find((r) => r.type === 'update');
    expect(demote).toBeFalsy();
  });

  it('removes (not demotes) an Other Sources placeholder occupying the same slot', async () => {
    const { sandbox, requests } = makeSandbox(
      { 'New Helm': 'Head' },
      { 'New Helm': 2, 'M+': 3 },
      [{ id: 1, item_id: 3, status: 'bis', note: null, slot: 'Head' }],
      { 'M+': true }
    );

    sandbox.wishlistSetStatus(2, null, 'bis');
    await new Promise((r) => setImmediate(r));

    const demote = requests.find((r) => r.type === 'update' && r.patch.status === 'good');
    expect(demote).toBeFalsy();

    const del = requests.find((r) => r.type === 'delete');
    expect(del).toBeTruthy();
    expect(del.eqs.item_id).toBe(3);
    expect(sandbox._wishlistPrefs.some((p) => p.item_id === 3)).toBe(false);
  });

  it('leaves other slots alone when tagging a non-BiS status', () => {
    const { sandbox, requests } = makeSandbox(
      { 'Old Helm': 'Head', 'New Helm': 'Head' },
      { 'Old Helm': 1, 'New Helm': 2 },
      [{ id: 1, item_id: 1, status: 'bis', note: null, slot: null }]
    );

    sandbox.wishlistSetStatus(2, null, 'good');

    const demote = requests.find((r) => r.type === 'update');
    expect(demote).toBeFalsy();
  });

  it('tagging BiS marks the explicit row synced_bis: false and the mirrored sibling synced_bis: true', () => {
    const { sandbox, requests } = makeSandbox({ 'Ring A': 'Finger' }, { 'Ring A': 1 }, []);

    sandbox.wishlistSetStatus(1, 'Finger 1', 'bis');

    const finger1 = requests.find((r) => r.type === 'insert' && r.row.slot === 'Finger 1');
    const finger2 = requests.find((r) => r.type === 'insert' && r.row.slot === 'Finger 2');
    expect(finger1.row).toMatchObject({ status: 'bis', synced_bis: false });
    expect(finger2.row).toMatchObject({ status: 'bis', synced_bis: true });
  });

  it("mirrors a non-BiS status into a real ring/trinket item's sibling slot", () => {
    const { sandbox, requests } = makeSandbox({ 'Ring A': 'Finger' }, { 'Ring A': 1 }, []);

    sandbox.wishlistSetStatus(1, 'Finger 1', 'good');

    const finger1Insert = requests.find((r) => r.type === 'insert' && r.row.slot === 'Finger 1');
    const finger2Insert = requests.find((r) => r.type === 'insert' && r.row.slot === 'Finger 2');
    expect(finger1Insert.row).toMatchObject({ item_id: 1, status: 'good' });
    expect(finger2Insert.row).toMatchObject({ item_id: 1, status: 'good' });
  });

  it("does not mirror a placeholder's status into a sibling slot", () => {
    const { sandbox, requests } = makeSandbox({}, { 'M+': 3 }, [], { 'M+': true });

    sandbox.wishlistSetStatus(3, 'Finger 1', 'good');

    const finger2Write = requests.find((r) => (r.row && r.row.slot) === 'Finger 2');
    expect(finger2Write).toBeFalsy();
  });

  it('blocks any status change on the mirrored (synced_bis) side of a BiS ring', () => {
    const { sandbox, requests } = makeSandbox({ 'Ring A': 'Finger' }, { 'Ring A': 1 }, [
      { id: 1, item_id: 1, status: 'bis', note: null, slot: 'Finger 1', synced_bis: false },
      { id: 2, item_id: 1, status: 'bis', note: null, slot: 'Finger 2', synced_bis: true }
    ]);

    sandbox.wishlistSetStatus(1, 'Finger 2', 'good');

    expect(requests).toHaveLength(0);
  });

  it('does NOT block a status change on the explicit (synced_bis: false) side of a BiS ring', () => {
    const { sandbox, requests } = makeSandbox({ 'Ring A': 'Finger' }, { 'Ring A': 1 }, [
      { id: 1, item_id: 1, status: 'bis', note: null, slot: 'Finger 1', synced_bis: false },
      { id: 2, item_id: 1, status: 'bis', note: null, slot: 'Finger 2', synced_bis: true }
    ]);

    sandbox.wishlistSetStatus(1, 'Finger 1', 'good');

    expect(requests.length).toBeGreaterThan(0);
  });

  it('demoting a BiS ring off its slot mirrors the demotion into its sibling slot', () => {
    const { sandbox, requests } = makeSandbox(
      { 'Ring A': 'Finger', 'Ring B': 'Finger' },
      { 'Ring A': 1, 'Ring B': 2 },
      [{ id: 1, item_id: 1, status: 'bis', note: null, slot: 'Finger 1' }]
    );

    sandbox.wishlistSetStatus(2, 'Finger 1', 'bis');

    const demoteFinger1 = requests.find(
      (r) => r.type === 'update' && r.patch.status === 'good' && r.eqs.slot === 'Finger 1'
    );
    expect(demoteFinger1).toBeTruthy();
    expect(demoteFinger1.eqs.item_id).toBe(1);

    const mirrorInsert = requests.find((r) => r.type === 'insert' && r.row.slot === 'Finger 2' && r.row.item_id === 1);
    expect(mirrorInsert).toBeTruthy();
    expect(mirrorInsert.row.status).toBe('good');
  });
});
