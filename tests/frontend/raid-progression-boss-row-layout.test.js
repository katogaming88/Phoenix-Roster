import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A raid boss row (Season Settings > Progression tab) reused the
// `.prio-drag-item` CSS class for drag-and-drop reordering, but that class
// is `display:flex; flex-direction:column` -- every other consumer
// (js/tabs/tab-priority.js's priority editor) wraps its actual row content
// in a nested `.prio-drag-item-row` (display:flex; align-items:center) to
// get a real horizontal row back. The boss row was missing that wrapper
// entirely, so its drag handle/number/name input/date input/remove button
// all stacked vertically instead of sitting in one row -- and the small "x"
// remove button, as a direct flex-column child with no align-items override,
// stretched to the column's full width (the column's default
// align-items:stretch), rendering as a big empty-looking box with a tiny
// "x" centered in it. Confirmed live in the officer dashboard.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEASON_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-season.js'), 'utf8');

function makeEl() {
  return { style: {}, textContent: '', innerHTML: '', disabled: false, value: '' };
}

function makeSandbox() {
  var wrap = makeEl();
  var sandbox = {
    console,
    document: {
      getElementById: (id) => (id === 'raidProgressionCards' ? wrap : null)
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(SEASON_JS, sandbox, { filename: 'tab-season.js' });
  return { sandbox, wrap };
}

describe('raid boss row layout', () => {
  it("wraps each boss row's content in .prio-drag-item-row, not directly in .prio-drag-item", () => {
    const { sandbox, wrap } = makeSandbox();
    sandbox.SEASON_RAIDS = [
      {
        name: 'The Venomous Abyss',
        wclZoneId: '53',
        isMiniRaid: false,
        bosses: [{ name: "Nek'zali the Soulcoiler", mythicDate: '' }]
      }
    ];
    sandbox.renderRaidProgressionCards();

    expect(wrap.innerHTML).toContain('class="raid-boss-row prio-drag-item"');
    expect(wrap.innerHTML).toContain('class="prio-drag-item-row"');

    // The row wrapper must open *before* the boss-name-input and its
    // sibling controls, i.e. right after the raid-boss-row div opens --
    // guards against the wrapper being present but misplaced.
    const rowOpenIdx = wrap.innerHTML.indexOf('class="raid-boss-row prio-drag-item"');
    const innerRowIdx = wrap.innerHTML.indexOf('class="prio-drag-item-row"');
    const nameInputIdx = wrap.innerHTML.indexOf('class="boss-name-input');
    expect(rowOpenIdx).toBeGreaterThanOrEqual(0);
    expect(innerRowIdx).toBeGreaterThan(rowOpenIdx);
    expect(nameInputIdx).toBeGreaterThan(innerRowIdx);
  });
});
