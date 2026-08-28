import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The signup form styles its spec radios and off-spec checkboxes as chips: a
// .signup-radio-label / .signup-checkbox-label wrapping a native control, with
// the checked state drawn on the label through :has(input:checked). The native
// control was hidden with display:none, which does not just hide it -- it takes
// it out of the focus order and out of the accessibility tree, so the whole
// form was mouse-only (#435).
//
// The fix is .sr-only, which hides the control visually and keeps it focusable,
// with the focus ring drawn on the label through :has(input:focus-visible), the
// same way the checked state already works. These assertions are what stops the
// class going missing again from a control added later.

const SIGNUP_JS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../js/signup.js');
const SIGNUP_JS = readFileSync(SIGNUP_JS_PATH, 'utf8');

// js/signup.js declares vars and functions and runs nothing at load, so it
// needs no stubs beyond what any script touches.
function loadSignupJs() {
  const sandbox = { window: {}, document: { getElementById: () => null }, console };
  vm.createContext(sandbox);
  vm.runInContext(SIGNUP_JS, sandbox, { filename: 'signup.js' });
  return sandbox;
}

describe('buildOffSpecHTML', () => {
  const { buildOffSpecHTML } = loadSignupJs();
  const SPECS = ['Frost', 'Fire', 'Arcane'];

  it('renders a checkbox per spec other than the main one', () => {
    const html = buildOffSpecHTML(SPECS, 'Frost', []);
    // Matched loosely on purpose: the attribute order is not the contract, and
    // pinning it made this fail the moment class="sr-only" went in front.
    expect(html.match(/<input [^>]*type="checkbox"/g)).toHaveLength(2);
    expect(html).toContain('Fire');
    expect(html).toContain('Arcane');
    expect(html).not.toContain('value="Frost"');
  });

  it('keeps every checkbox in the focus order', () => {
    // The behavioural half of the change, on the one render path here that is
    // a pure function. display:none would satisfy "renders a checkbox" just as
    // well, and be unreachable by keyboard.
    const html = buildOffSpecHTML(SPECS, 'Frost', []);
    const inputs = html.match(/<input [^>]*>/g) || [];
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.filter((tag) => !/class="sr-only"/.test(tag))).toEqual([]);
  });

  it('still marks the selected off specs checked', () => {
    // Guards the sr-only edit against having disturbed the attribute next to it.
    const html = buildOffSpecHTML(SPECS, 'Frost', ['Arcane']);
    expect(html).toMatch(/value="Arcane"[^>]* checked/);
    expect(html).not.toMatch(/value="Fire"[^>]* checked/);
  });
});

describe('the chip-styled signup controls', () => {
  // Keyed on the wrapping label class, which is what the stylesheet targets,
  // rather than on every <input type="radio|checkbox"> in the file. Two of the
  // five are the claim-differs and class-mismatch confirmations, which are
  // native visible checkboxes in a plain label and must keep their own box: an
  // assertion over all five would demand sr-only on those too and hide two
  // working controls.
  const chips = SIGNUP_JS.match(/class="signup-(?:radio|checkbox)-label"><input [^>]*>/g) || [];

  it('is the set this file expects to find', () => {
    // main spec, primary role, off spec. A fourth chip group is fine; zero
    // means the render changed shape and the assertion below stopped meaning
    // anything.
    expect(chips.length).toBeGreaterThanOrEqual(3);
  });

  it('carries sr-only rather than being hidden outright', () => {
    // The main-spec and primary-role radios are built inside
    // renderSignupStep(), a 180-line function that writes straight into the
    // DOM and has no sandbox here. Read as source rather than rendered, which
    // is weaker than the buildOffSpecHTML assertions above and still catches
    // the thing that actually regresses: a chip added later without the class.
    expect(chips.filter((tag) => !tag.includes('class="sr-only"'))).toEqual([]);
  });

  it('leaves the natively rendered confirmation checkboxes alone', () => {
    // These two draw a real checkbox with accent-color and are not chips.
    // Hiding them would be a regression this file should refuse to help with.
    for (const id of ['signupClaimDiffersConfirm', 'signupClassMismatchConfirm']) {
      const tag = SIGNUP_JS.match(new RegExp('<input type="checkbox" id="' + id + '"'));
      expect(tag, id).not.toBeNull();
      expect(SIGNUP_JS).not.toMatch(new RegExp('id="' + id + '"[^>]*sr-only'));
    }
  });

  it('is not hidden by a stylesheet rule instead', () => {
    // The other half of the same fix: .sr-only on the control does nothing
    // while a label rule still sets display:none on it, because they are
    // different properties and both apply.
    const css = readFileSync(path.join(path.dirname(SIGNUP_JS_PATH), '../css/styles.css'), 'utf8');
    const hidden = css.match(/^\.signup-(?:radio|checkbox)-label input \{[^}]*display:\s*none/gm) || [];
    expect(hidden).toEqual([]);
  });
});
