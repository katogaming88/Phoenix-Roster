import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 'Other' is the only self-received source that still requires officer
// review after auto-approve was added -- every other source (M+, Great
// Vault, Crafted, Catalyst, Bonus Roll) auto-approves for a raider tagging
// their own character (see the paired migration
// 20260819191008_self_received_other_source_requires_review.sql). The form's
// note text needs to say the right thing for whichever source is picked,
// live as the raider changes the dropdown -- not a static "an officer will
// review" that's wrong for every non-Other source.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');

function makeSandbox() {
  const elements = {};
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      getElementById: (id) => elements[id] || null,
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
  return { sandbox, elements };
}

describe('selfReceivedNoteText', () => {
  it("says an officer will review for source 'Other'", () => {
    const { sandbox } = makeSandbox();
    expect(sandbox.selfReceivedNoteText('Other')).toContain('officer will review');
  });

  it('says it will be added right away for every other source', () => {
    const { sandbox } = makeSandbox();
    ['M+', 'Great Vault', 'Crafted', 'Catalyst', 'Bonus Roll', ''].forEach((source) => {
      expect(sandbox.selfReceivedNoteText(source)).not.toContain('officer will review');
    });
  });
});

describe('selfReceivedSourceChanged', () => {
  it('updates the note text to match the newly-selected source', () => {
    const { sandbox, elements } = makeSandbox();
    elements['src-row1'] = { value: 'Other' };
    elements['note-row1'] = { textContent: 'stale' };

    sandbox.selfReceivedSourceChanged('row1');

    expect(elements['note-row1'].textContent).toContain('officer will review');
  });

  it('switches back to the instant-approval text when the source changes away from Other', () => {
    const { sandbox, elements } = makeSandbox();
    elements['src-row1'] = { value: 'M+' };
    elements['note-row1'] = { textContent: 'An officer will review and approve this.' };

    sandbox.selfReceivedSourceChanged('row1');

    expect(elements['note-row1'].textContent).not.toContain('officer will review');
  });

  it('no-ops when the note element is absent (officer Mark Received form)', () => {
    const { sandbox, elements } = makeSandbox();
    elements['src-row1'] = { value: 'Other' };
    // No 'note-row1' element -- the officer form never renders one.
    expect(() => sandbox.selfReceivedSourceChanged('row1')).not.toThrow();
  });
});
