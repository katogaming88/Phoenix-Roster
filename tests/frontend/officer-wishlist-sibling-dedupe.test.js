import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// officerWishlistSectionHTML() (the officer-facing read-only "Wishlist"
// section on a raider's profile) previously rendered one row per
// item_preferences row with no dedup. wishlistSetStatus() (js/wishlist.js)
// mirrors a real ring/trinket's status into its sibling numbered slot, so
// every tagged ring/trinket showed up twice here -- once for Trinket 1, once
// for Trinket 2 -- even though it's one raider opinion about one physical
// item. Weapon/Off Hand is deliberately excluded: a dual-wield class can
// legitimately want two copies of the same non-unique one-hander.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');

function makeSandbox() {
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
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  return sandbox;
}

function countOccurrences(html, needle) {
  return html.split(needle).length - 1;
}

describe('officerWishlistSectionHTML sibling-slot dedupe', () => {
  it('shows a real trinket BiS on both Trinket 1 and Trinket 2 only once', () => {
    const sandbox = makeSandbox();
    sandbox.DATA = {
      itemIds: { 'Gebbos Bottomless Bag': 322 },
      itemSlots: { 'Gebbos Bottomless Bag': 'Trinket' },
      itemPlaceholders: {},
      itemIcons: {},
      itemWowIds: {},
      itemIsPtr: {},
      wishlistStatusLabels: {}
    };
    sandbox._teamItemPreferences = [
      { player_id: 175, item_id: 322, status: 'bis', slot: 'Trinket 1', note: null },
      { player_id: 175, item_id: 322, status: 'bis', slot: 'Trinket 2', note: null }
    ];

    const html = sandbox.officerWishlistSectionHTML(
      { id: 175, firstName: 'Angryamazon', nameRealm: 'Angryamazon-WRA' },
      'officer'
    );
    expect(countOccurrences(html, 'Gebbos Bottomless Bag')).toBe(1);
  });

  it('keeps two distinct rows for a dual-wielder BiS on the same one-hander (Weapon + Off Hand)', () => {
    const sandbox = makeSandbox();
    sandbox.DATA = {
      itemIds: { 'Jans Soul Fang': 400 },
      itemSlots: { 'Jans Soul Fang': 'One-Hand' },
      itemPlaceholders: {},
      itemIcons: {},
      itemWowIds: {},
      itemIsPtr: {},
      wishlistStatusLabels: {}
    };
    sandbox._teamItemPreferences = [
      { player_id: 175, item_id: 400, status: 'bis', slot: 'Weapon', note: null },
      { player_id: 175, item_id: 400, status: 'bis', slot: 'Off Hand', note: null }
    ];

    const html = sandbox.officerWishlistSectionHTML(
      { id: 175, firstName: 'Angryamazon', nameRealm: 'Angryamazon-WRA' },
      'officer'
    );
    expect(countOccurrences(html, 'Jans Soul Fang')).toBe(2);
  });

  it('prefers the BiS status when a sibling pair disagrees (defensive against stale data)', () => {
    const sandbox = makeSandbox();
    sandbox.DATA = {
      itemIds: { 'Gebbos Bottomless Bag': 322 },
      itemSlots: { 'Gebbos Bottomless Bag': 'Trinket' },
      itemPlaceholders: {},
      itemIcons: {},
      itemWowIds: {},
      itemIsPtr: {},
      wishlistStatusLabels: {}
    };
    sandbox._teamItemPreferences = [
      { player_id: 175, item_id: 322, status: 'good', slot: 'Trinket 1', note: null },
      { player_id: 175, item_id: 322, status: 'bis', slot: 'Trinket 2', note: null }
    ];

    const html = sandbox.officerWishlistSectionHTML(
      { id: 175, firstName: 'Angryamazon', nameRealm: 'Angryamazon-WRA' },
      'officer'
    );
    expect(countOccurrences(html, 'Gebbos Bottomless Bag')).toBe(1);
    expect(html).not.toContain('No BiS picks tagged yet.');
    expect(html).toContain('BiS');
  });
});
