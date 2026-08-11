import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// buildPriorityNotesTab()/updatePriorityNotesBadge() (Priority > Notes
// sub-tab) used `if (p.slot) return` / `!p.slot` as a placeholder-item
// signal -- correct back when only Other Sources (M+/Crafted/Catalyst) rows
// carried an explicit slot, but Finger 1/2, Trinket 1/2, Weapon, and Off
// Hand real items now write an explicit disambiguating slot too (#623/
// #673). That silently dropped every note on a real item tagged in one of
// those rows from both the Notes tab and its nav badge count. Fixed to key
// off DATA.itemPlaceholders (the item's own identity) instead.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRIORITY_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-priority.js'), 'utf8');

function makeSandbox({ itemSlots = {}, itemIds = {}, itemPlaceholders = {}, roster = [], prefs = [] } = {}) {
  const sandbox = {
    console,
    document: { getElementById: () => null },
    DATA: { itemSlots, itemIds, itemPlaceholders, roster },
    escHtml: (s) => String(s),
    itemNameBlockHtml: (name) => '<span>' + name + '</span>',
    classBadgeStyle: () => '',
    normalise: (s) => String(s || '').toLowerCase(),
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(PRIORITY_JS, sandbox, { filename: 'tab-priority.js' });
  sandbox._teamItemPreferences = prefs;
  return sandbox;
}

describe('buildPriorityNotesTab (disambiguated-slot real items)', () => {
  it('shows a note on a real item tagged under a numbered slot (Trinket 2)', () => {
    const itemSlots = { "Zul'jin's Guillotine Technique": 'Trinket' };
    const itemIds = { "Zul'jin's Guillotine Technique": 1 };
    const roster = [{ id: 5, firstName: 'Phluffy', nameRealm: 'Phluffy-Stormrage' }];
    const prefs = [
      {
        player_id: 5,
        item_id: 1,
        status: 'bis',
        slot: 'Trinket 2',
        note: 'Will not be picking up something for the set so put me low on list'
      }
    ];
    const el = { innerHTML: '' };
    const sandbox = makeSandbox({ itemSlots, itemIds, roster, prefs });
    sandbox.document.getElementById = (id) => (id === 'priorityNotesContent' ? el : null);

    sandbox.buildPriorityNotesTab();

    expect(el.innerHTML).toContain('Will not be picking up something for the set');
    expect(el.innerHTML).toContain('Phluffy');
  });

  it('still excludes a placeholder (M+/Crafted/Catalyst) note by item identity, not slot', () => {
    const itemSlots = { 'M+': '' };
    const itemIds = { 'M+': 2 };
    const itemPlaceholders = { 'M+': true };
    const roster = [{ id: 5, firstName: 'Phluffy', nameRealm: 'Phluffy-Stormrage' }];
    const prefs = [{ player_id: 5, item_id: 2, status: 'bis', slot: 'Neck', note: 'placeholder note' }];
    const el = { innerHTML: '' };
    const sandbox = makeSandbox({ itemSlots, itemIds, itemPlaceholders, roster, prefs });
    sandbox.document.getElementById = (id) => (id === 'priorityNotesContent' ? el : null);

    sandbox.buildPriorityNotesTab();

    expect(el.innerHTML).not.toContain('placeholder note');
    expect(el.innerHTML).toContain('No wishlist notes yet');
  });
});

describe('updatePriorityNotesBadge (disambiguated-slot real items)', () => {
  it('counts a note on a real item tagged under a numbered slot', () => {
    const itemIds = { "Zul'jin's Guillotine Technique": 1 };
    const prefs = [{ player_id: 5, item_id: 1, status: 'bis', slot: 'Trinket 2', note: 'a real note' }];
    const badge = { textContent: '', style: { display: '' } };
    const sandbox = makeSandbox({ itemIds, prefs });
    sandbox.document.getElementById = (id) => (id === 'prioNotesBadge' ? badge : null);

    sandbox.updatePriorityNotesBadge();

    expect(badge.textContent).toBe(1);
    expect(badge.style.display).toBe('');
  });

  it('excludes a placeholder note from the count', () => {
    const itemIds = { 'M+': 2 };
    const itemPlaceholders = { 'M+': true };
    const prefs = [{ player_id: 5, item_id: 2, status: 'bis', slot: 'Neck', note: 'placeholder note' }];
    const badge = { textContent: '', style: { display: '' } };
    const sandbox = makeSandbox({ itemIds, itemPlaceholders, prefs });
    sandbox.document.getElementById = (id) => (id === 'prioNotesBadge' ? badge : null);

    sandbox.updatePriorityNotesBadge();

    expect(badge.textContent).toBe(0);
    expect(badge.style.display).toBe('none');
  });
});
