import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Officer bio photo self-upload (#625): js/tabs/tab-bios.js gained a file
// input + Remove Photo control alongside the existing hand-typed imagePath
// field, on both the team and guild editors. The actual auth/resize/
// compression/write happens server-side in the upload-bio-photo Edge
// Function -- these tests cover the client-side contract: cheap pre-checks
// that never touch the network, what reaches functions.invoke on a real
// upload, and that a failure leaves the existing imagePath alone.
//
// Remove Photo used to also call the Edge Function's DELETE path -- dropped
// after a shared imagePath (the same person's photo copy-pasted into both
// their Team and Guild Officer Bios cards) meant removing it from one card
// silently deleted the file out from under the other. It's now a purely
// local clear; see bioRemovePhoto()'s comment in tab-bios.js.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TAB_BIOS_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-bios.js'), 'utf8');

const SUPABASE_URL = 'https://example.supabase.co';
const BUCKET_PREFIX = SUPABASE_URL + '/storage/v1/object/public/bio-photos/';

function makeEl(extra) {
  return Object.assign({ value: '', style: {}, textContent: '', innerHTML: '', disabled: false }, extra);
}

function makeFile(overrides) {
  return Object.assign({ type: 'image/jpeg', size: 1024 }, overrides);
}

// bioCollectFromDOM()/guildBioCollectFromDOM() only need an element with a
// no-op querySelectorAll here -- these tests set TEAM_OFFICER_BIOS/
// GUILD_OFFICER_BIOS directly rather than round-tripping through rendered
// input values.
function makeCardsWrap() {
  return Object.assign(makeEl(), { querySelectorAll: () => [] });
}

function recorderClient(invokeResult) {
  const calls = [];
  return {
    calls,
    client: {
      functions: {
        invoke(name, opts) {
          calls.push({ name, method: opts && opts.method, body: opts && opts.body });
          return Promise.resolve(invokeResult);
        }
      }
    }
  };
}

function makeSandbox() {
  const els = { bioCards: makeCardsWrap(), guildBioCards: makeCardsWrap() };
  const sandbox = {
    console,
    SUPABASE_URL,
    document: { getElementById: (id) => els[id] || null },
    CLASS_SPECS: {},
    _esc: (s) => String(s || ''),
    _escAttr: (s) => String(s || '')
  };
  vm.createContext(sandbox);
  vm.runInContext(TAB_BIOS_JS, sandbox, { filename: 'tab-bios.js' });
  return { sandbox, els };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0)).then(() => new Promise((r) => setTimeout(r, 0)));

describe('_bioValidatePhotoFile', () => {
  it('rejects a file over 5MB', () => {
    const { sandbox } = makeSandbox();
    const err = sandbox._bioValidatePhotoFile(makeFile({ size: 6 * 1024 * 1024 }));
    expect(err).toBe('Photo must be under 5MB.');
  });

  it('rejects an unsupported mime type', () => {
    const { sandbox } = makeSandbox();
    const err = sandbox._bioValidatePhotoFile(makeFile({ type: 'image/gif' }));
    expect(err).toBe('Photos must be PNG, JPEG, or WebP.');
  });

  it('accepts a small PNG/JPEG/WebP', () => {
    const { sandbox } = makeSandbox();
    expect(sandbox._bioValidatePhotoFile(makeFile({ type: 'image/png' }))).toBeNull();
    expect(sandbox._bioValidatePhotoFile(makeFile({ type: 'image/jpeg' }))).toBeNull();
    expect(sandbox._bioValidatePhotoFile(makeFile({ type: 'image/webp' }))).toBeNull();
  });
});

describe('bioUploadPhoto (team editor)', () => {
  it('an oversized file is rejected without calling functions.invoke', () => {
    const { sandbox } = makeSandbox();
    const { calls, client } = recorderClient();
    sandbox.supabaseClient = client;
    sandbox.TEAM_OFFICER_BIOS = [{ imagePath: '' }];
    const status = makeEl();
    const inputEl = {
      files: [makeFile({ size: 6 * 1024 * 1024 })],
      value: 'x',
      closest: () => ({ querySelector: () => status })
    };
    sandbox.bioUploadPhoto(0, inputEl);
    expect(calls).toEqual([]);
    expect(status.textContent).toBe('Photo must be under 5MB.');
    expect(inputEl.value).toBe('');
  });

  it('a successful upload sets imagePath from the returned url', async () => {
    const { sandbox } = makeSandbox();
    const { calls, client } = recorderClient({
      data: { success: true, url: BUCKET_PREFIX + 'uid-1/1.jpg' },
      error: null
    });
    sandbox.supabaseClient = client;
    sandbox.TEAM_OFFICER_BIOS = [{ imagePath: '' }];
    const status = makeEl();
    const inputEl = {
      files: [makeFile()],
      value: '',
      disabled: false,
      closest: () => ({ querySelector: () => status })
    };
    sandbox.bioUploadPhoto(0, inputEl);
    expect(calls[0]).toEqual({ name: 'upload-bio-photo', method: 'POST', body: inputEl.files[0] });
    await flush();
    expect(sandbox.TEAM_OFFICER_BIOS[0].imagePath).toBe(BUCKET_PREFIX + 'uid-1/1.jpg');
  });

  it('a server error surfaces the message and leaves the existing imagePath untouched', async () => {
    const { sandbox } = makeSandbox();
    const { client } = recorderClient({ data: { success: false, error: 'Not authorized' }, error: null });
    sandbox.supabaseClient = client;
    sandbox.TEAM_OFFICER_BIOS = [{ imagePath: 'assets/officers/kato.jpg' }];
    const status = makeEl();
    const inputEl = {
      files: [makeFile()],
      value: '',
      disabled: false,
      closest: () => ({ querySelector: () => status })
    };
    sandbox.bioUploadPhoto(0, inputEl);
    await flush();
    expect(status.textContent).toBe('Not authorized');
    expect(sandbox.TEAM_OFFICER_BIOS[0].imagePath).toBe('assets/officers/kato.jpg');
    expect(inputEl.disabled).toBe(false);
  });
});

describe('bioRemovePhoto (team editor)', () => {
  it('clears imagePath locally without touching the network, for an uploaded bucket photo', () => {
    const { sandbox } = makeSandbox();
    const { calls, client } = recorderClient({ error: null });
    sandbox.supabaseClient = client;
    sandbox.TEAM_OFFICER_BIOS = [{ imagePath: BUCKET_PREFIX + 'uid-1/1.jpg' }];
    sandbox.bioRemovePhoto(0);
    expect(calls).toEqual([]);
    expect(sandbox.TEAM_OFFICER_BIOS[0].imagePath).toBe('');
  });

  it('clears imagePath without calling invoke for a legacy assets/officers path', () => {
    const { sandbox } = makeSandbox();
    const { calls, client } = recorderClient();
    sandbox.supabaseClient = client;
    sandbox.TEAM_OFFICER_BIOS = [{ imagePath: 'assets/officers/kato.jpg' }];
    sandbox.bioRemovePhoto(0);
    expect(calls).toEqual([]);
    expect(sandbox.TEAM_OFFICER_BIOS[0].imagePath).toBe('');
  });
});

describe('guildBioUploadPhoto / guildBioRemovePhoto', () => {
  it('a successful upload sets GUILD_OFFICER_BIOS imagePath', async () => {
    const { sandbox } = makeSandbox();
    const { client } = recorderClient({ data: { success: true, url: BUCKET_PREFIX + 'uid-2/1.jpg' }, error: null });
    sandbox.supabaseClient = client;
    sandbox.GUILD_OFFICER_BIOS = [{ imagePath: '' }];
    const status = makeEl();
    const inputEl = {
      files: [makeFile()],
      value: '',
      disabled: false,
      closest: () => ({ querySelector: () => status })
    };
    sandbox.guildBioUploadPhoto(0, inputEl);
    await flush();
    expect(sandbox.GUILD_OFFICER_BIOS[0].imagePath).toBe(BUCKET_PREFIX + 'uid-2/1.jpg');
  });

  it('remove clears GUILD_OFFICER_BIOS imagePath locally without touching the network', () => {
    const { sandbox } = makeSandbox();
    const { calls, client } = recorderClient({ error: null });
    sandbox.supabaseClient = client;
    sandbox.GUILD_OFFICER_BIOS = [{ imagePath: BUCKET_PREFIX + 'uid-2/1.jpg' }];
    sandbox.guildBioRemovePhoto(0);
    expect(calls).toEqual([]);
    expect(sandbox.GUILD_OFFICER_BIOS[0].imagePath).toBe('');
  });
});

describe('renderBioCards photo controls', () => {
  it('renders a file input for every card, and Remove Photo only when imagePath is set', () => {
    const { sandbox, els } = makeSandbox();
    sandbox.TEAM_OFFICER_BIOS = [
      { name: 'Kat', imagePath: '' },
      { name: 'Rex', imagePath: BUCKET_PREFIX + 'uid-1/1.jpg' }
    ];
    sandbox.renderBioCards();
    const html = els.bioCards.innerHTML;
    expect((html.match(/bio-photo-file-input/g) || []).length).toBe(2);
    expect((html.match(/Remove Photo/g) || []).length).toBe(1);
    expect(html).not.toContain('send Kat the image');
  });
});
