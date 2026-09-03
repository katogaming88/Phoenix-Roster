import { describe, it, expect } from 'vitest';
import { parseNamesFile, parseAliasesFile, pickSuggestion, catalogSql } from '../../scripts/fetch-boe-items.js';

// scripts/fetch-boe-items.js (#875) resolves the season's BoE names through
// Wowhead's search-suggestion endpoint and writes data/sql/boe-catalog.sql.
// The network path runs once by hand; the parsers and the SQL emitter are
// pure and covered here from fixture JSON captured off the real endpoint.

// Verbatim from /search/suggestions-template?q=Crushing%20Coiler%20Coif on
// 2026-09-02, trimmed to the fields the script reads.
const COIF = {
  search: 'Crushing Coiler Coif',
  results: [
    {
      type: 3,
      id: 271441,
      name: 'Crushing Coiler Coif',
      typeName: 'Item',
      icon: 'inv_helm_mail_raidhunterulatek_d_01',
      quality: 4,
      pinFooterText: 'Mail Armor',
      pinDescription: 'This epic mail armor of item level 219 goes in the "Head" slot.'
    }
  ]
};
const NECK = {
  results: [
    {
      type: 3,
      id: 271638,
      name: "Bound Serpent's Jade Eye",
      typeName: 'Item',
      icon: 'inv_121_jewelry_neck01_green',
      pinFooterText: 'Amulet',
      pinDescription: 'This epic amulet of item level 219 goes in the "Neck" slot.'
    }
  ]
};

describe('parseNamesFile', () => {
  it('reads the zone id from the first data line and one name per line, skipping blanks and comments', () => {
    const parsed = parseNamesFile(
      "# March on Quel'Danas\n46\n\nVisage of Unseen Truths\n  Infernal Greatlock Girdle  \n"
    );
    expect(parsed).toEqual({ wclZoneId: 46, names: ['Visage of Unseen Truths', 'Infernal Greatlock Girdle'] });
  });

  it('rejects a file whose first data line is not a zone id', () => {
    expect(() => parseNamesFile('Visage of Unseen Truths\n')).toThrow(/zone id/);
  });
});

describe('parseAliasesFile', () => {
  it('maps each known misspelling to its catalog name', () => {
    const text =
      '# known misspellings\nCrushin Coiler Coif => Crushing Coiler Coif\nPower Stance Breechs => Power Stance Breeches\n';
    expect(parseAliasesFile(text)).toEqual([
      { from: 'Crushin Coiler Coif', to: 'Crushing Coiler Coif' },
      { from: 'Power Stance Breechs', to: 'Power Stance Breeches' }
    ]);
  });

  it('rejects a line without the arrow', () => {
    expect(() => parseAliasesFile('Crushin Coiler Coif\n')).toThrow(/=>/);
  });
});

describe('pickSuggestion', () => {
  it('takes the single item hit: id, icon, armor type from the footer and slot from the description', () => {
    expect(pickSuggestion(COIF, 'crushing coiler coif')).toEqual({
      wowItemId: 271441,
      name: 'Crushing Coiler Coif',
      icon: 'inv_helm_mail_raidhunterulatek_d_01',
      armorType: 'Mail',
      slot: 'Head'
    });
  });

  it('an accessory has no armor type', () => {
    expect(pickSuggestion(NECK, "Bound Serpent's Jade Eye")).toMatchObject({ armorType: null, slot: 'Neck' });
  });

  it('returns null with no item hit, a hit under another name, or two hits under the same name', () => {
    expect(pickSuggestion({ results: [] }, 'x')).toBeNull();
    expect(
      pickSuggestion({ results: [{ type: 6, id: 1, name: 'Crushing Coiler Coif' }] }, 'Crushing Coiler Coif')
    ).toBeNull();
    expect(pickSuggestion(COIF, 'Crushing Coiler')).toBeNull();
    const twin = Object.assign({}, COIF.results[0], { id: 999 });
    expect(pickSuggestion({ results: [COIF.results[0], twin] }, 'Crushing Coiler Coif')).toBeNull();
  });

  it('a hit under a longer name beside the exact one does not block the exact one', () => {
    const longer = Object.assign({}, COIF.results[0], { id: 999, name: 'Crushing Coiler Coif of the Deep' });
    expect(pickSuggestion({ results: [longer, COIF.results[0]] }, 'Crushing Coiler Coif')).toMatchObject({
      wowItemId: 271441
    });
  });
});

describe('catalogSql', () => {
  const entries = [
    {
      wowItemId: 271441,
      name: 'Crushing Coiler Coif',
      icon: 'inv_helm',
      armorType: 'Mail',
      slot: 'Head',
      wclZoneId: 53
    },
    {
      wowItemId: 271638,
      name: "Bound Serpent's Jade Eye",
      icon: 'inv_neck',
      armorType: null,
      slot: 'Neck',
      wclZoneId: 53
    }
  ];
  const aliases = [{ from: 'Crushin Coiler Coif', to: 'Crushing Coiler Coif' }];
  const sql = catalogSql(entries, aliases, new Date('2026-09-02T00:00:00Z'));

  it('is one transaction inserting flagged rows that skip an existing spelling', () => {
    expect(sql.startsWith('-- ')).toBe(true);
    expect(sql).toContain('2026-09-02');
    expect(sql).toContain('\nbegin;\n');
    expect(sql.trim().endsWith('commit;')).toBe(true);
    expect(sql).toContain("(271441, 'Crushing Coiler Coif', 'Head', 'Mail', 'inv_helm', 53, true)");
    expect(sql).toContain("(271638, 'Bound Serpent''s Jade Eye', 'Neck', null, 'inv_neck', 53, true)");
    expect(sql).toContain('on conflict ((lower(name))) do nothing');
  });

  it('reports a listed name that exists unflagged rather than flagging it', () => {
    expect(sql).toContain('and not i.is_boe');
    expect(sql).toContain('raise notice');
    expect(sql).not.toMatch(/set is_boe = true/);
  });

  it('links rows by name, then by alias keeping the submitted spelling in the note', () => {
    expect(sql).toContain('lower(b.item_name) = lower(i.name) and b.item_id is null');
    expect(sql).toContain("lower(b.item_name) = lower('Crushin Coiler Coif')");
    expect(sql).toContain("lower(i.name) = lower('Crushing Coiler Coif')");
    expect(sql).toContain('submitted as');
  });

  it('emits balanced dollar-quoted blocks (the $ halving trap of 2026-08-26)', () => {
    const count = (sql.match(/\$\$/g) || []).length;
    expect(count).toBe(2);
  });

  it('rejects an alias whose target is not in the catalog', () => {
    expect(() => catalogSql(entries, [{ from: 'x', to: 'Not Listed' }], new Date())).toThrow(/Not Listed/);
  });
});
