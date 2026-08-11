import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Other Sources rows (M+/Crafted/Catalyst) are set to 'bis' the moment
// they're added (wishlistRevealPlaceholderSlot) and then lock permanently
// (wishlistStatusButtonsHTML's lockOnceSet) -- Good/OK/Catalyst Only/Pass
// could never actually be reached there (a real raid item tagged BiS for
// the same slot removes the placeholder outright rather than demoting it),
// so those 4 buttons only ever rendered as dead, always-disabled controls.
// wishlistStatusButtonsHTML() now only renders the BiS button for
// lockOnceSet rows; regular gear-slot rows keep all 5.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const WISHLIST_JS = readFileSync(path.join(HERE, '../../js/wishlist.js'), 'utf8');

function makeSandbox(prefs) {
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
  vm.runInContext(WISHLIST_JS, sandbox, { filename: 'wishlist.js' });

  sandbox.DATA = { itemSlots: {}, itemPlaceholders: {}, itemIds: { 'M+': 1, Helm: 2 }, wishlistOpen: true };
  sandbox._wishlistPrefs = prefs;
  return sandbox;
}

describe('wishlistStatusButtonsHTML lockOnceSet (Other Sources rows)', () => {
  it('only renders the BiS button for a lockOnceSet row', () => {
    const sandbox = makeSandbox([{ id: 1, item_id: 1, status: 'bis', note: null, slot: 'Head' }]);
    const html = sandbox.wishlistStatusButtonsHTML(1, 'Head', true);

    expect(html).toContain('>BiS<');
    expect(html).not.toContain('>Good<');
    expect(html).not.toContain('>OK<');
    expect(html).not.toContain('>Catalyst Only<');
    expect(html).not.toContain('>Pass<');
  });

  it('still renders all 5 buttons for a regular (non-lockOnceSet) row', () => {
    const sandbox = makeSandbox([]);
    const html = sandbox.wishlistStatusButtonsHTML(2, null, false);

    expect(html).toContain('>BiS<');
    expect(html).toContain('>Good<');
    expect(html).toContain('>OK<');
    expect(html).toContain('>Catalyst Only<');
    expect(html).toContain('>Pass<');
  });
});
