import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// _renderPlayerSelector() (js/officer-quick-actions.js) gates index.html's
// "Look Up a Raider" card. It used to hide the whole card -- dropdown
// included -- for any logged-in account with no claimed character on the
// currently-viewed team, which locked a site admin (or an officer) out of
// browsing any team's roster except the one they'd personally claimed a
// character on. Loads the real file into a vm sandbox (same pattern as
// admin-tab-visibility.test.js) so this exercises the actual DOM-gating
// logic, not a reimplementation of it.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUICK_ACTIONS_JS = readFileSync(path.join(HERE, '../../js/officer-quick-actions.js'), 'utf8');

function makeEl() {
  return { style: {}, textContent: '', onclick: null };
}

function makeSandbox(session) {
  const els = {
    playerSelectorCard: makeEl(),
    playerSelectorLabel: makeEl(),
    playerDropdownOuter: makeEl(),
    myProfileOuter: makeEl(),
    myProfileBtn: makeEl()
  };
  const sandbox = {
    document: { getElementById: (id) => els[id] || null },
    getDiscordSession: () => session
  };
  vm.createContext(sandbox);
  vm.runInContext(QUICK_ACTIONS_JS, sandbox, { filename: 'officer-quick-actions.js' });
  return { sandbox, els };
}

describe('_renderPlayerSelector', () => {
  it('hides the card entirely with no session', () => {
    const { sandbox, els } = makeSandbox(null);
    sandbox._renderPlayerSelector();
    expect(els.playerSelectorCard.style.display).toBe('none');
  });

  it('hides the card for a logged-in account with no claim and no officer/admin access', () => {
    const { sandbox, els } = makeSandbox({ nameRealm: null, isOfficer: false, isAdmin: false });
    sandbox._renderPlayerSelector();
    expect(els.playerSelectorCard.style.display).toBe('none');
  });

  it('shows "Your Profile" only (no dropdown) for a claimed non-officer raider', () => {
    const { sandbox, els } = makeSandbox({ nameRealm: 'Kat-Illidan', isOfficer: false, isAdmin: false });
    sandbox._renderPlayerSelector();
    expect(els.playerSelectorCard.style.display).toBe('');
    expect(els.playerSelectorLabel.textContent).toBe('Your Profile');
    expect(els.playerDropdownOuter.style.display).toBe('none');
    expect(els.myProfileOuter.style.display).toBe('');
    expect(els.myProfileBtn.onclick).toBeTypeOf('function');
  });

  it('shows the full dropdown + "View My Profile" for a claimed officer', () => {
    const { sandbox, els } = makeSandbox({ nameRealm: 'Kat-Illidan', isOfficer: true, isAdmin: false });
    sandbox._renderPlayerSelector();
    expect(els.playerSelectorLabel.textContent).toBe('Look Up a Raider');
    expect(els.playerDropdownOuter.style.display).toBe('');
    expect(els.myProfileOuter.style.display).toBe('');
  });

  it('a site admin with no claim on this team still gets the dropdown, but no "View My Profile"', () => {
    const { sandbox, els } = makeSandbox({ nameRealm: null, isOfficer: false, isAdmin: true });
    sandbox._renderPlayerSelector();
    expect(els.playerSelectorCard.style.display).toBe('');
    expect(els.playerSelectorLabel.textContent).toBe('Look Up a Raider');
    expect(els.playerDropdownOuter.style.display).toBe('');
    expect(els.myProfileOuter.style.display).toBe('none');
    expect(els.myProfileBtn.onclick).toBeNull();
  });

  it('an officer with no claim on this team also still gets the dropdown', () => {
    const { sandbox, els } = makeSandbox({ nameRealm: null, isOfficer: true, isAdmin: false });
    sandbox._renderPlayerSelector();
    expect(els.playerSelectorCard.style.display).toBe('');
    expect(els.playerDropdownOuter.style.display).toBe('');
    expect(els.myProfileOuter.style.display).toBe('none');
  });
});
