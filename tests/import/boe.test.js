import { describe, it, expect } from 'vitest';
import {
  TEAM_MAP,
  SKIP_FORM_TIMESTAMPS,
  teamIdFor,
  splitTrack,
  splitItemCell,
  normItem,
  finderKey,
  osaDistance,
  titleCaseIfLower,
  parseFound,
  parseSold,
  matchSales,
  checkCut,
  boeSql,
  classifyInputs
} from '../../scripts/import/tables/boe.js';

// Synthetic rows only. The real exports pair finder names with payout
// amounts and live in the gitignored data/boe/ directory; the shapes below
// mirror every variant seen in them without carrying any of the values.

const FOUND_HEADER = ['Timestamp', 'Character Name-Realm', 'Team', 'Item', 'Note'];
const SOLD_HEADER = [
  'Date Submitted',
  'Finder',
  'Team',
  'Item Name',
  'Quality (Myth, Hero, etc)',
  'Sold',
  'Sale Date',
  'Sale Price',
  'Finder Cut',
  'Guild Cut',
  'Notes',
  'Discord Name',
  '',
  ''
];

function foundRows(extra = []) {
  return [
    FOUND_HEADER,
    ['3/21/2026 19:09:36', 'Testfinder-Thrall', '', 'Heroic Widget of Testing ', ''],
    ['3/24/2026 22:14:16', 'Barename', '', 'champ   belt of examples', ''],
    ['4/13/2026 22:10:23', 'Another - Dalaran', 'Phoenix', 'Widget of Testing - Hero 3/6', 'rolled crit'],
    ...extra
  ];
}

function soldRows(extra = []) {
  return [
    SOLD_HEADER,
    [
      '3/21/2026',
      'Testfinder-Thrall',
      'Phoenix',
      'Widget of Testing',
      'Hero',
      'TRUE',
      '3/23/26',
      '617,518',
      '123,504',
      '494,014',
      'Gold traded on 3/23/26',
      '',
      'Finder Cut=Floor x (Sale/Pivot)',
      ''
    ],
    [
      '3/24/2026',
      'Barename-MalGanis',
      'Ashrend',
      'Belt of Examples',
      'Champ',
      'TRUE',
      '3/25/26',
      '95,000',
      '20,000',
      '75,000',
      '',
      '',
      'Current Floor',
      '20000'
    ],
    ...extra,
    ['', '', '', '', '', 'FALSE', '', '', '', '0', '', '', '', ''],
    ['', '', '', '', '', 'FALSE', '', 'Total', '', '', '', '', '', ''],
    ['', '', '', '', '', 'FALSE', '', '712,518', '143,504', '569,014', '', '', '', ''],
    ['', '', '', '', '', 'FALSE', '', '', '', '0', '', '', '', '']
  ];
}

const SEASONS = [
  { name: 'Midnight Season 1', start: '2026-03-17', end: '2026-08-10' },
  { name: 'Midnight Season 2', start: '2026-08-11' }
];
const OPTS = { tz: 'America/New_York', seasons: SEASONS, floor: 20000, pivot: 100000 };

describe('teamIdFor + TEAM_MAP', () => {
  it('maps every legacy team string, including the old Hellfire name and both Wrathless forms', () => {
    expect(teamIdFor('Phoenix')).toBe(1);
    expect(teamIdFor('Ashrend')).toBe(2);
    expect(teamIdFor('Hellfire Rollers')).toBe(2);
    expect(teamIdFor('Hellfire')).toBe(2);
    expect(teamIdFor('Immolation')).toBe(3);
    expect(teamIdFor('Wrathless')).toBe(4);
    expect(teamIdFor('Team  Wrathless ')).toBe(4);
    expect(TEAM_MAP.ashrend).toBe(2);
  });
  it('returns null for blank and unknown strings', () => {
    expect(teamIdFor('')).toBeNull();
    expect(teamIdFor(undefined)).toBeNull();
    expect(teamIdFor('Team Nobody')).toBeNull();
  });
});

describe('splitTrack', () => {
  it('reads the track from a leading word in any casing or spelling', () => {
    expect(splitTrack('Heroic Widget of Testing ')).toEqual({ track: 'Hero', itemName: 'Widget of Testing' });
    expect(splitTrack('hero widget of testing')).toEqual({ track: 'Hero', itemName: 'widget of testing' });
    expect(splitTrack('champ   belt of examples')).toEqual({ track: 'Champion', itemName: 'belt of examples' });
    expect(splitTrack('Champion Belt of Examples')).toEqual({ track: 'Champion', itemName: 'Belt of Examples' });
    expect(splitTrack('Champion: Belt of Examples')).toEqual({ track: 'Champion', itemName: 'Belt of Examples' });
    expect(splitTrack('Myth Belt of Examples')).toEqual({ track: 'Myth', itemName: 'Belt of Examples' });
    expect(splitTrack('Mythic Belt of Examples')).toEqual({ track: 'Myth', itemName: 'Belt of Examples' });
    expect(splitTrack('Normal Belt of Examples')).toEqual({ track: 'Champion', itemName: 'Belt of Examples' });
    expect(splitTrack('Hero- Belt of Examples')).toEqual({ track: 'Hero', itemName: 'Belt of Examples' });
    expect(splitTrack('Hero - Belt of Examples')).toEqual({ track: 'Hero', itemName: 'Belt of Examples' });
  });
  it('reads the track from a bracket group and drops the whole group', () => {
    expect(splitTrack('(Hero) Belt of Examples')).toEqual({ track: 'Hero', itemName: 'Belt of Examples' });
    expect(splitTrack('[Heroic] Belt of Examples')).toEqual({ track: 'Hero', itemName: 'Belt of Examples' });
    expect(splitTrack('(Mythic 279) Belt of Examples ')).toEqual({ track: 'Myth', itemName: 'Belt of Examples' });
    expect(splitTrack('Belt of Examples (Champ)')).toEqual({ track: 'Champion', itemName: 'Belt of Examples' });
    expect(splitTrack('Belt of Examples [Heroic]')).toEqual({ track: 'Hero', itemName: 'Belt of Examples' });
  });
  it('reads a trailing track word with or without a separator', () => {
    expect(splitTrack('Belt of Examples Hero')).toEqual({ track: 'Hero', itemName: 'Belt of Examples' });
    expect(splitTrack('Belt of Examples Mythic')).toEqual({ track: 'Myth', itemName: 'Belt of Examples' });
    expect(splitTrack('Belt of Examples-Champ')).toEqual({ track: 'Champion', itemName: 'Belt of Examples' });
    expect(splitTrack('Belt of Examples - Champ')).toEqual({ track: 'Champion', itemName: 'Belt of Examples' });
  });
  it('drops N/6 upgrade fragments wherever they sit', () => {
    expect(splitTrack('Widget of Testing - Hero 3/6')).toEqual({ track: 'Hero', itemName: 'Widget of Testing' });
    expect(splitTrack('heroic 2/6 widget of testing')).toEqual({ track: 'Hero', itemName: 'widget of testing' });
    expect(splitTrack('Widget of Testing - hero 4/6')).toEqual({ track: 'Hero', itemName: 'Widget of Testing' });
  });
  it('gives null track and the whole text when no track word is present', () => {
    expect(splitTrack('Belt of Examples')).toEqual({ track: null, itemName: 'Belt of Examples' });
    expect(splitTrack("Nullstrider's Boots")).toEqual({ track: null, itemName: "Nullstrider's Boots" });
    expect(splitTrack('bot test')).toEqual({ track: null, itemName: 'bot test' });
  });
  it('gives an empty name when the cell is only a track word, and null/empty for blank', () => {
    expect(splitTrack('Hero')).toEqual({ track: 'Hero', itemName: '' });
    expect(splitTrack('')).toEqual({ track: null, itemName: '' });
  });
  it('does not treat a track word inside another word as a track', () => {
    expect(splitTrack('Heron Feather Cloak')).toEqual({ track: null, itemName: 'Heron Feather Cloak' });
  });
});

describe('normItem', () => {
  it('lowercases, folds diacritics, drops bracket groups, upgrade fragments and punctuation', () => {
    expect(normItem("Nullstrider's Boots")).toBe('nullstridersboots');
    expect(normItem('Infernal Greatlock Girdle (Socket)')).toBe('infernalgreatlockgirdle');
    expect(normItem('Widget of Testing 3/6')).toBe('widgetoftesting');
    expect(normItem('Wídget of Testing')).toBe('widgetoftesting');
    expect(normItem('')).toBe('');
  });
});

describe('finderKey', () => {
  it('splits first name and realm, folding case, spacing, punctuation and diacritics', () => {
    expect(finderKey('Testfinder-Thrall')).toEqual({
      full: 'testfinderthrall',
      first: 'testfinder',
      hasRealm: true,
      sqlKey: 'testfinderthrall'
    });
    expect(finderKey('Another - Dalaran')).toEqual({
      full: 'anotherdalaran',
      first: 'another',
      hasRealm: true,
      sqlKey: 'anotherdalaran'
    });
    expect(finderKey("Zartunie-Mal'Ganis").full).toBe('zartuniemalganis');
    expect(finderKey('Corvaan-Argent Dawn').full).toBe('corvaanargentdawn');
  });
  it('folds diacritics for sheet matching but drops them for the SQL key, matching the regexp the subselect uses', () => {
    expect(finderKey('Psyçh-Realm').full).toBe('psychrealm');
    expect(finderKey('Psyçh-Realm').sqlKey).toBe('psyhrealm');
  });
  it('marks bare names as having no realm', () => {
    expect(finderKey('Barename')).toEqual({ full: 'barename', first: 'barename', hasRealm: false, sqlKey: 'barename' });
    expect(finderKey('')).toEqual({ full: '', first: '', hasRealm: false, sqlKey: '' });
  });
});

describe('osaDistance', () => {
  it('counts substitutions, insertions, deletions and adjacent transpositions as one edit each', () => {
    expect(osaDistance('breeches', 'breeches')).toBe(0);
    expect(osaDistance('breaches', 'breeches')).toBe(1);
    expect(osaDistance('gridle', 'girdle')).toBe(1);
    expect(osaDistance('crushin', 'crushing')).toBe(1);
    expect(osaDistance('thorncroftt', 'thorncrofft')).toBe(1);
    expect(osaDistance('abc', 'xyz')).toBe(3);
    expect(osaDistance('', 'abc')).toBe(3);
  });
});

describe('titleCaseIfLower', () => {
  it('title-cases only text that is entirely lowercase', () => {
    expect(titleCaseIfLower('crushing coiler coif')).toBe('Crushing Coiler Coif');
    expect(titleCaseIfLower('Crushing coiler Coif')).toBe('Crushing coiler Coif');
    expect(titleCaseIfLower("nullstrider's boots")).toBe("Nullstrider's Boots");
  });
});

describe('parseFound', () => {
  it('names the missing column when the header is wrong', () => {
    const rows = foundRows();
    rows[0] = ['Timestamp', 'Name', 'Team', 'Item', 'Note'];
    expect(() => parseFound(rows, 'Form')).toThrow(/col 2.*character/i);
  });
  it('parses rows with the track split out, blank teams as null, and no warnings on clean input', () => {
    const { entries, warnings } = parseFound(foundRows(), 'Form');
    expect(warnings).toHaveLength(0);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      rowNo: 2,
      timestamp: '3/21/2026 19:09:36',
      finderRaw: 'Testfinder-Thrall',
      teamRaw: '',
      teamId: null,
      track: 'Hero',
      itemName: 'Widget of Testing',
      note: ''
    });
    expect(entries[1]).toMatchObject({ track: 'Champion', itemName: 'belt of examples', teamId: null });
    expect(entries[2]).toMatchObject({ teamId: 1, track: 'Hero', itemName: 'Widget of Testing', note: 'rolled crit' });
  });
  it('carries the upgrade rank out of the item cell, and moves a note that is only a rank into it (#865)', () => {
    const { entries, warnings } = parseFound(
      foundRows([
        ['8/31/2026 21:40:34', 'Glizzy-Dalaran', 'Wrathless', 'Champ Slitherscale Girdle', '2/6'],
        ['4/13/2026 22:10:23', 'Xy-Thrall', 'Phoenix', 'Breastplate of the Final Defense - Hero 3/6', 'rolled crit']
      ]),
      'Form'
    );
    expect(warnings).toHaveLength(0);
    expect(entries[3]).toMatchObject({
      track: 'Champion',
      itemName: 'Slitherscale Girdle',
      upgradeRank: '2/6',
      note: ''
    });
    expect(entries[4]).toMatchObject({
      track: 'Hero',
      itemName: 'Breastplate of the Final Defense',
      upgradeRank: '3/6',
      note: 'rolled crit'
    });
    expect(entries[0].upgradeRank).toBe(null);
  });
  it('keeps a bracketed item level in the note rather than dropping it (#865)', () => {
    const { entries } = parseFound(
      foundRows([
        ['5/1/2026 0:07:05', 'Humble-Tichondrius', 'Phoenix', '(Mythic 279) Breastplate of the Final Defense ', '']
      ]),
      'Form'
    );
    expect(entries[3]).toMatchObject({
      track: 'Myth',
      itemName: 'Breastplate of the Final Defense',
      upgradeRank: null,
      note: 'ilvl 279'
    });
  });
  it('skips fully blank rows silently', () => {
    const { entries, warnings } = parseFound(foundRows([['', '', '', '', '']]), 'Form');
    expect(entries).toHaveLength(3);
    expect(warnings).toHaveLength(0);
  });
  it('skips the recorded bot-test timestamp with a warning naming the reason', () => {
    const ts = Object.keys(SKIP_FORM_TIMESTAMPS)[0];
    const { entries, warnings } = parseFound(foundRows([[ts, 'bot test', 'Phoenix', 'bot test', 'bot test']]), 'Form');
    expect(entries).toHaveLength(3);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(ts);
    expect(warnings[0]).toContain(SKIP_FORM_TIMESTAMPS[ts]);
  });
  it('skips a row whose item cell is only a track word, with a warning', () => {
    const { entries, warnings } = parseFound(
      foundRows([['4/13/2026 22:12:00', 'Someone', 'Phoenix', 'Hero', '']]),
      'Form'
    );
    expect(entries).toHaveLength(3);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/row 5.*no item name/i);
  });
  it('warns on an unknown team but keeps the row with teamId null', () => {
    const { entries, warnings } = parseFound(
      foundRows([['4/14/2026 20:00:00', 'Someone-Realm', 'Team Nobody', 'Hero Belt of Examples', '']]),
      'Form'
    );
    expect(entries).toHaveLength(4);
    expect(entries[3].teamId).toBeNull();
    expect(warnings.join('\n')).toMatch(/Team Nobody/);
  });
});

describe('parseSold', () => {
  it('names the missing column when the header is wrong', () => {
    const rows = soldRows();
    rows[0] = [...SOLD_HEADER];
    rows[0][7] = 'Price';
    expect(() => parseSold(rows, 'S1')).toThrow(/col 8.*sale price/i);
  });
  it('parses sold rows with comma numbers, two-digit sale years and the track from Quality', () => {
    const { entries, warnings } = parseSold(soldRows(), 'S1');
    expect(warnings).toHaveLength(0);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      rowNo: 2,
      dateSubmitted: '3/21/2026',
      finderRaw: 'Testfinder-Thrall',
      teamId: 1,
      itemName: 'Widget of Testing',
      track: 'Hero',
      saleDate: '3/23/26',
      salePrice: 617518,
      finderCut: 123504,
      guildCut: 494014,
      notes: 'Gold traded on 3/23/26'
    });
    expect(entries[1]).toMatchObject({
      teamId: 2,
      track: 'Champion',
      salePrice: 95000,
      finderCut: 20000,
      guildCut: 75000
    });
  });
  it('skips the trailer, Total and sidebar rows silently', () => {
    const { entries, warnings } = parseSold(soldRows(), 'S1');
    expect(entries).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });
  it('accepts a four-digit sale year (the S2 export shape)', () => {
    const extra = [
      [
        '8/20/2026',
        'Someone-Realm',
        'Immolation',
        'Widget of Testing',
        'Champ',
        'TRUE',
        '8/25/2026',
        '74,000',
        '20,000',
        '54,000',
        '',
        '',
        '',
        ''
      ]
    ];
    const { entries } = parseSold(soldRows(extra), 'S2');
    expect(entries[2]).toMatchObject({ teamId: 3, saleDate: '8/25/2026', salePrice: 74000 });
  });
  it('warns and skips a data row that is not marked sold', () => {
    const extra = [
      [
        '8/20/2026',
        'Someone-Realm',
        'Immolation',
        'Widget of Testing',
        'Champ',
        'FALSE',
        '',
        '',
        '',
        '0',
        '',
        '',
        '',
        ''
      ]
    ];
    const { entries, warnings } = parseSold(soldRows(extra), 'S2');
    expect(entries).toHaveLength(2);
    expect(warnings.join('\n')).toMatch(/row 4.*not marked sold/i);
  });
  it('warns and skips a sold row missing its sale date or price', () => {
    const noDate = [
      [
        '8/20/2026',
        'Someone-Realm',
        'Immolation',
        'Widget of Testing',
        'Champ',
        'TRUE',
        '',
        '74,000',
        '20,000',
        '54,000',
        '',
        '',
        '',
        ''
      ]
    ];
    const noPrice = [
      [
        '8/20/2026',
        'Someone-Realm',
        'Immolation',
        'Widget of Testing',
        'Champ',
        'TRUE',
        '8/25/2026',
        '',
        '',
        '',
        '',
        '',
        '',
        ''
      ]
    ];
    expect(parseSold(soldRows(noDate), 'S2').entries).toHaveLength(2);
    expect(parseSold(soldRows(noDate), 'S2').warnings.join('\n')).toMatch(/sale date/i);
    expect(parseSold(soldRows(noPrice), 'S2').entries).toHaveLength(2);
    expect(parseSold(soldRows(noPrice), 'S2').warnings.join('\n')).toMatch(/sale price/i);
  });
  it('warns on an unknown Quality and imports the row with a null track', () => {
    const extra = [
      [
        '8/20/2026',
        'Someone-Realm',
        'Immolation',
        'Widget of Testing',
        'Legendary',
        'TRUE',
        '8/25/2026',
        '74,000',
        '20,000',
        '54,000',
        '',
        '',
        '',
        ''
      ]
    ];
    const { entries, warnings } = parseSold(soldRows(extra), 'S2');
    expect(entries[2].track).toBeNull();
    expect(warnings.join('\n')).toMatch(/Legendary/);
  });
  it('warns and skips a row whose team is unknown, since team_id is required', () => {
    const extra = [
      [
        '8/20/2026',
        'Someone-Realm',
        'Team Nobody',
        'Widget of Testing',
        'Champ',
        'TRUE',
        '8/25/2026',
        '74,000',
        '20,000',
        '54,000',
        '',
        '',
        '',
        ''
      ]
    ];
    const { entries, warnings } = parseSold(soldRows(extra), 'S2');
    expect(entries).toHaveLength(2);
    expect(warnings.join('\n')).toMatch(/Team Nobody/);
  });
});

describe('matchSales', () => {
  function run(foundExtra = [], soldExtra = []) {
    const found = parseFound(foundRows(foundExtra), 'Form').entries;
    const sold = parseSold(soldRows(soldExtra), 'S1').entries;
    return matchSales(found, sold);
  }

  it('pairs exact matches, fills a blank found team from the sold row, and leaves the rest open', () => {
    const { rows, warnings } = run();
    expect(warnings).toHaveLength(0);
    const paid = rows.filter((r) => r.status === 'paid');
    const open = rows.filter((r) => r.status === 'found');
    expect(paid).toHaveLength(2);
    expect(open).toHaveLength(1);
    expect(paid[0]).toMatchObject({
      teamId: 1,
      finderName: 'Testfinder-Thrall',
      itemName: 'Widget of Testing',
      track: 'Hero',
      foundAt: '3/21/2026 19:09:36',
      soldAt: '3/23/26',
      salePrice: 617518,
      finderCut: 123504,
      guildCut: 494014,
      note: 'Gold traded on 3/23/26'
    });
    expect(open[0]).toMatchObject({
      teamId: 1,
      finderName: 'Another-Dalaran',
      itemName: 'Widget of Testing',
      foundAt: '4/13/2026 22:10:23',
      note: 'rolled crit'
    });
  });
  it('matches a bare form name against a Name-Realm sold name and takes the sold spelling for finder and item', () => {
    const { rows, warnings } = run();
    const belt = rows.find((r) => r.salePrice === 95000);
    expect(warnings).toHaveLength(0);
    expect(belt).toMatchObject({
      teamId: 2,
      finderName: 'Barename-MalGanis',
      itemName: 'Belt of Examples',
      track: 'Champion',
      status: 'paid'
    });
  });
  it('accepts a one-edit typo on the item with a warning naming both spellings', () => {
    const { rows, warnings } = run(
      [['4/14/2026 22:48:37', 'Typist - Thrall', 'Ashrend', 'Hero power stance breaches', '']],
      [
        [
          '4/14/2026',
          'Typist-Thrall',
          'Ashrend',
          'Power Stance Breeches',
          'Hero',
          'TRUE',
          '4/17/26',
          '137,785',
          '27,557',
          '110,228',
          '',
          '',
          '',
          ''
        ]
      ]
    );
    const row = rows.find((r) => r.salePrice === 137785);
    expect(row).toMatchObject({ status: 'paid', itemName: 'Power Stance Breeches', foundAt: '4/14/2026 22:48:37' });
    expect(warnings.join('\n')).toMatch(/breaches.*Breeches|Breeches.*breaches/);
  });
  it('accepts a one-edit difference on the finder with a warning', () => {
    const { rows, warnings } = run(
      [['4/8/2026 0:16:46', 'Thorncroftt', 'Immolation', 'Hero Belt of Examples', '']],
      [
        [
          '4/8/2026',
          'Thorncrofft-Illidan',
          'Immolation',
          'Belt of Examples',
          'Hero',
          'TRUE',
          '4/10/26',
          '66,500',
          '20,000',
          '46,500',
          '',
          '',
          '',
          ''
        ]
      ]
    );
    expect(rows.find((r) => r.salePrice === 66500)).toMatchObject({ status: 'paid', foundAt: '4/8/2026 0:16:46' });
    expect(warnings.join('\n')).toMatch(/Thorncroftt.*Thorncrofft/);
  });
  it('matches through diacritics and case differences without a warning', () => {
    const { rows, warnings } = run(
      [['4/9/2026 23:31:53', 'püffd-thrall', 'Ashrend', 'hero belt of examples', '']],
      [
        [
          '4/9/2026',
          'Puffd-Thrall',
          'Ashrend',
          'Belt of Examples',
          'Hero',
          'TRUE',
          '4/10/26',
          '161,500',
          '32,300',
          '129,200',
          '',
          '',
          '',
          ''
        ]
      ]
    );
    expect(rows.find((r) => r.salePrice === 161500)).toMatchObject({ status: 'paid', finderName: 'Puffd-Thrall' });
    expect(warnings).toHaveLength(0);
  });
  it('prefers an exact candidate over a fuzzy one and takes the earliest on a tie', () => {
    const { rows } = run(
      [
        ['4/23/2026 21:30:39', 'Nuggs - Tichondrius', 'Ashrend', '(Myth) Belt of Examples', ''],
        ['4/24/2026 11:14:22', 'Nuggs', 'Ashrend', 'Belt of Exampels Myth', '']
      ],
      [
        [
          '4/23/2026',
          'Nuggs-Tichondrius',
          'Ashrend',
          'Belt of Examples',
          'Myth',
          'TRUE',
          '4/25/26',
          '1,187,535',
          '237,507',
          '950,028',
          '',
          '',
          '',
          ''
        ]
      ]
    );
    const paid = rows.find((r) => r.salePrice === 1187535);
    expect(paid.foundAt).toBe('4/23/2026 21:30:39');
    const open = rows.filter((r) => r.status === 'found' && r.foundAt === '4/24/2026 11:14:22');
    expect(open).toHaveLength(1);
  });
  it('takes the earlier of two identical open rows (FIFO)', () => {
    const { rows } = run(
      [
        ['5/1/2026 20:00:00', 'Twice-Realm', 'Phoenix', 'Hero Belt of Examples', ''],
        ['5/2/2026 20:00:00', 'Twice-Realm', 'Phoenix', 'Hero Belt of Examples', '']
      ],
      [
        [
          '5/1/2026',
          'Twice-Realm',
          'Phoenix',
          'Belt of Examples',
          'Hero',
          'TRUE',
          '5/3/26',
          '50,000',
          '20,000',
          '30,000',
          '',
          '',
          '',
          ''
        ]
      ]
    );
    expect(rows.find((r) => r.salePrice === 50000).foundAt).toBe('5/1/2026 20:00:00');
    expect(rows.find((r) => r.foundAt === '5/2/2026 20:00:00').status).toBe('found');
  });
  it('flags two candidates that cannot be ordered as ambiguous and leaves everything unmatched', () => {
    const { rows, warnings } = run(
      [
        ['5/1/2026 20:00:00', 'Twice-Realm', 'Phoenix', 'Hero Belt of Examples', ''],
        ['5/1/2026 20:00:00', 'Twice-Realm', 'Phoenix', 'Hero Belt of Examples', '']
      ],
      [
        [
          '5/1/2026',
          'Twice-Realm',
          'Phoenix',
          'Belt of Examples',
          'Hero',
          'TRUE',
          '5/3/26',
          '50,000',
          '20,000',
          '30,000',
          '',
          '',
          '',
          ''
        ]
      ]
    );
    expect(rows.filter((r) => r.salePrice === 50000)).toHaveLength(1);
    expect(rows.find((r) => r.salePrice === 50000).standalone).toBe(true);
    expect(rows.filter((r) => r.status === 'found' && r.finderName === 'Twice-Realm')).toHaveLength(2);
    expect(warnings.join('\n')).toMatch(/ambiguous/i);
  });
  it('turns an unmatched sold row into a standalone paid row dated by Date Submitted, with a warning', () => {
    const { rows, warnings } = run(
      [],
      [
        [
          '5/12/2026',
          'Lonely-Realm',
          'Immolation',
          'Belt of Examples',
          'Hero',
          'TRUE',
          '5/16/26',
          '35,000',
          '20,000',
          '15,000',
          'Gold donated to guild',
          '',
          '',
          ''
        ]
      ]
    );
    const row = rows.find((r) => r.salePrice === 35000);
    expect(row).toMatchObject({
      status: 'paid',
      standalone: true,
      teamId: 3,
      foundAt: '5/12/2026',
      soldAt: '5/16/26',
      note: 'Gold donated to guild'
    });
    expect(warnings.join('\n')).toMatch(/no form submission/i);
  });
  it('fills a null found track from the sold row silently, but warns when both are set and differ', () => {
    const { rows, warnings } = run(
      [
        ['5/3/2026 22:38:14', 'Fill-Realm', 'Wrathless', 'Belt of Examples', ''],
        ['5/4/2026 22:38:14', 'Clash-Realm', 'Wrathless', 'Myth Widget of Testing', '']
      ],
      [
        [
          '5/3/2026',
          'Fill-Realm',
          'Wrathless',
          'Belt of Examples (Socket)',
          'Hero',
          'TRUE',
          '5/5/26',
          '57,000',
          '20,000',
          '37,000',
          '',
          '',
          '',
          ''
        ],
        [
          '5/4/2026',
          'Clash-Realm',
          'Wrathless',
          'Widget of Testing',
          'Hero',
          'TRUE',
          '5/6/26',
          '57,000',
          '20,000',
          '37,000',
          '',
          '',
          '',
          ''
        ]
      ]
    );
    expect(rows.find((r) => r.finderName === 'Fill-Realm')).toMatchObject({
      status: 'paid',
      track: 'Hero',
      itemName: 'Belt of Examples (Socket)'
    });
    expect(rows.find((r) => r.finderName === 'Clash-Realm')).toMatchObject({ status: 'paid', track: 'Hero' });
    expect(warnings.filter((w) => /track/i.test(w))).toHaveLength(1);
    expect(warnings.join('\n')).toMatch(/Clash-Realm/);
  });
  it('warns when the form and sold teams disagree and keeps the sold team', () => {
    const { rows, warnings } = run(
      [['5/3/2026 22:38:14', 'Moved-Realm', 'Phoenix', 'Hero Belt of Examples', '']],
      [
        [
          '5/3/2026',
          'Moved-Realm',
          'Wrathless',
          'Belt of Examples',
          'Hero',
          'TRUE',
          '5/5/26',
          '57,000',
          '20,000',
          '37,000',
          '',
          '',
          '',
          ''
        ]
      ]
    );
    expect(rows.find((r) => r.finderName === 'Moved-Realm').teamId).toBe(4);
    expect(warnings.join('\n')).toMatch(/team/i);
  });
  it('joins the form note and the sold notes', () => {
    const { rows } = run(
      [['5/3/2026 22:38:14', 'Noted-Realm', 'Phoenix', 'Hero Belt of Examples', 'Donate']],
      [
        [
          '5/3/2026',
          'Noted-Realm',
          'Phoenix',
          'Belt of Examples',
          'Hero',
          'TRUE',
          '5/5/26',
          '57,000',
          '20,000',
          '37,000',
          'Gold donated to guild',
          '',
          '',
          ''
        ]
      ]
    );
    expect(rows.find((r) => r.finderName === 'Noted-Realm').note).toBe('Donate | Gold donated to guild');
  });
  it('drops an open row with no team at all, with a warning, since team_id is required', () => {
    const { rows, warnings } = run([['6/1/2026 20:00:00', 'Teamless-Realm', '', 'Hero Belt of Examples', '']]);
    expect(rows.find((r) => r.finderName === 'Teamless-Realm')).toBeUndefined();
    expect(warnings.join('\n')).toMatch(/Teamless-Realm.*no team/i);
  });
  it('stays quiet about two same-item finds a minute apart at different ranks, which are two items (#865)', () => {
    const { rows, warnings } = run([
      ['8/31/2026 21:40:34', 'Repeat-Dalaran', 'Wrathless', 'Champ Belt of Examples', '2/6'],
      ['8/31/2026 21:41:09', 'Repeat-Dalaran', 'Wrathless', 'Champ Belt of Examples', '3/6']
    ]);
    const pair = rows.filter((r) => r.finderName === 'Repeat-Dalaran');
    expect(pair.map((r) => r.upgradeRank)).toEqual(['2/6', '3/6']);
    expect(warnings.join(' ')).not.toMatch(/possible duplicate/i);
  });
  it('flags a suspected duplicate submission (same finder, item, track and rank within 48h) but imports it', () => {
    const { rows, warnings } = run([
      ['8/31/2026 21:40:34', 'Repeat-Dalaran', 'Wrathless', 'Champ Belt of Examples', '2/6'],
      ['8/31/2026 21:41:09', 'Repeat-Dalaran', 'Wrathless', 'Champ Belt of Examples', '2/6']
    ]);
    expect(rows.filter((r) => r.finderName === 'Repeat-Dalaran')).toHaveLength(2);
    expect(warnings.join('\n')).toMatch(/possible duplicate/i);
  });
  it('title-cases an open row whose cleaned name is entirely lowercase, and keeps mixed case as typed', () => {
    const { rows } = run([
      ['9/1/2026 23:14:48', 'lower - realm', 'Phoenix', 'heroic 2/6 crushing coiler coif', ''],
      ['9/1/2026 23:15:48', 'Typo-Realm', 'Phoenix', 'Champion Pauldrons of forgotten Sacrifice', '']
    ]);
    expect(rows.find((r) => r.foundAt === '9/1/2026 23:14:48').itemName).toBe('Crushing Coiler Coif');
    expect(rows.find((r) => r.foundAt === '9/1/2026 23:15:48').itemName).toBe('Pauldrons of forgotten Sacrifice');
  });
});

describe('checkCut', () => {
  it('agrees with the sheet on a percentage row and on a floor row', () => {
    expect(checkCut(617518, 123504, 494014, 20000, 100000)).toEqual([]);
    expect(checkCut(95000, 20000, 75000, 20000, 100000)).toEqual([]);
    expect(checkCut(46576, 20000, 26576, 20000, 100000)).toEqual([]);
  });
  it('warns when the sheet cut differs from the policy formula, and when the cuts do not sum to the sale', () => {
    expect(checkCut(617518, 120000, 497518, 20000, 100000).join('\n')).toMatch(/123504/);
    expect(checkCut(617518, 123504, 400000, 20000, 100000).join('\n')).toMatch(/sum/i);
  });
});

describe('boeSql', () => {
  function rowsFor(foundExtra = [], soldExtra = []) {
    const found = parseFound(foundRows(foundExtra), 'Form').entries;
    const sold = parseSold(soldRows(soldExtra), 'S1').entries;
    return matchSales(found, sold).rows;
  }

  it('emits one idempotent insert keyed on team and found_at, with paid rows carrying complete money columns', () => {
    const { sql, counts, warnings } = boeSql(rowsFor(), OPTS);
    expect(warnings).toHaveLength(0);
    expect(counts).toMatchObject({
      open: 1,
      paid: 2,
      total: 3,
      salePrice: 712518,
      finderPayout: 143504,
      guildCut: 569014,
      byTeam: { 1: 2, 2: 1 }
    });
    expect(sql).toContain('insert into boe_items (');
    expect(sql).toContain(
      'team_id, player_id, finder_name, item_id, item_name, track, upgrade_rank, season, note, status, found_at, sold_at, payout_paid_at, sale_price, finder_payout, guild_cut, payout_floor, payout_pivot'
    );
    expect(sql).toContain('where not exists');
    expect(sql).toContain('t.team_id = v.team_id and t.found_at = v.found_at');
    expect(sql).not.toContain('t.item_name');
    expect(sql).toContain("'paid'");
    expect(sql).toContain("('2026-03-21 19:09:36'::timestamp at time zone 'America/New_York')");
    expect(sql).toContain("('2026-03-23 00:00:00'::timestamp at time zone 'America/New_York')");
    expect(sql).toContain('617518, 123504, 494014, 20000, 100000');
  });
  it('emits the upgrade rank after the track, as text or a typed null (#865)', () => {
    const { sql } = boeSql(
      rowsFor([['6/1/2026 20:00:00', 'Ranked-Thrall', 'Phoenix', 'Hero 2/6 Belt of Examples', '']]),
      OPTS
    );
    const ranked = sql.split('\n').find((l) => l.includes("'Ranked-Thrall'"));
    expect(ranked).toContain("'Hero', '2/6',");
    const openLine = sql.split('\n').find((l) => l.includes("'found'") && !l.includes('Ranked-Thrall'));
    expect(openLine).toContain('null::text,');
  });
  it('uses the sale timestamp for payout_paid_at on paid rows', () => {
    const { sql } = boeSql(rowsFor(), OPTS);
    const paidLine = sql.split('\n').find((l) => l.includes('617518'));
    expect(paidLine.match(/'2026-03-23 00:00:00'::timestamp/g)).toHaveLength(2);
  });
  it('emits typed nulls on open rows so an all-null column still types correctly', () => {
    const { sql } = boeSql(rowsFor(), OPTS);
    const openLine = sql.split('\n').find((l) => l.includes("'found'"));
    expect(openLine).toContain(
      'null::timestamptz, null::timestamptz, null::bigint, null::bigint, null::bigint, null::bigint, null::bigint'
    );
  });
  it('links the finder by a normalized name-realm subselect, and emits a typed null for bare names', () => {
    const { sql, counts } = boeSql(
      rowsFor([['6/1/2026 20:00:00', 'Barename', 'Phoenix', 'Hero Belt of Examples', '']]),
      OPTS
    );
    expect(sql).toContain(
      "(select p.id from players p where p.team_id = 1 and lower(regexp_replace(p.name_realm, '[^A-Za-z0-9]', '', 'g')) = 'testfinderthrall' order by p.archived_at nulls first limit 1)"
    );
    const bareLine = sql.split('\n').find((l) => l.includes('6/1/2026') || l.includes('2026-06-01 20:00:00'));
    expect(bareLine).toContain('1, null::integer,');
    expect(counts.playerLinks).toBe(3);
  });
  it('resolves the item by the case-insensitive items key and derives the season from the ranges', () => {
    const { sql } = boeSql(
      rowsFor([['8/20/2026 21:27:01', 'Later-Realm', 'Immolation', '(Champ) Widget of Testing ', '']]),
      OPTS
    );
    expect(sql).toContain("(select id from items where lower(name) = lower('Widget of Testing'))");
    expect(sql).toContain("'Midnight Season 1'");
    expect(sql).toContain("'Midnight Season 2'");
  });
  it('emits a null season with a warning when no ranges are supplied', () => {
    const { sql, warnings } = boeSql(rowsFor(), { ...OPTS, seasons: null });
    expect(sql).not.toContain('Midnight');
    expect(warnings.join('\n')).toMatch(/season/i);
  });
  it('throws on two rows sharing team and found_at, because NOT EXISTS cannot see the batch', () => {
    const rows = rowsFor([
      ['6/1/2026 20:00:00', 'One-Realm', 'Phoenix', 'Hero Belt of Examples', ''],
      ['6/1/2026 20:00:00', 'Two-Realm', 'Phoenix', 'Hero Widget of Testing', '']
    ]);
    expect(() => boeSql(rows, OPTS)).toThrow(/duplicate.*2026-06-01 20:00:00/i);
  });
  it('carries cut-check warnings through', () => {
    const rows = rowsFor(
      [],
      [
        [
          '5/12/2026',
          'Lonely-Realm',
          'Immolation',
          'Belt of Examples',
          'Hero',
          'TRUE',
          '5/16/26',
          '35,000',
          '25,000',
          '10,000',
          '',
          '',
          '',
          ''
        ]
      ]
    );
    const { warnings } = boeSql(rows, OPTS);
    expect(warnings.join('\n')).toMatch(/20000/);
  });
  it('escapes quotes in names and notes through the shared literal builder', () => {
    const rows = rowsFor([['6/1/2026 20:00:00', "O'Quote-Realm", 'Phoenix', "Hero Nullstrider's Boots", "it's fine"]]);
    const { sql } = boeSql(rows, OPTS);
    expect(sql).toContain("'O''Quote-Realm'");
    expect(sql).toContain("'Nullstrider''s Boots'");
    expect(sql).toContain("'it''s fine'");
  });
});

describe('classifyInputs', () => {
  it('picks the Form Responses export as the found sheet and every other CSV as a sold sheet', () => {
    expect(
      classifyInputs([
        'BOE Tracking - Midnight S1.csv',
        'BOE Tracking - Form Responses 1.csv',
        'BOE Tracking - Midnight S2.csv',
        'notes.txt'
      ])
    ).toEqual({
      found: 'BOE Tracking - Form Responses 1.csv',
      sold: ['BOE Tracking - Midnight S1.csv', 'BOE Tracking - Midnight S2.csv']
    });
  });
  it('throws when there is no found sheet or more than one', () => {
    expect(() => classifyInputs(['BOE Tracking - Midnight S1.csv'])).toThrow(/Form Responses/);
    expect(() => classifyInputs(['a - Form Responses 1.csv', 'b - Form Responses 2.csv'])).toThrow(/Form Responses/);
  });
});

describe('splitItemCell', () => {
  it('captures the rank and a bracketed level beside the track, and hands the rest to splitTrack', () => {
    expect(splitItemCell('Widget of Testing - Hero 3/6')).toEqual({
      track: 'Hero',
      itemName: 'Widget of Testing',
      upgradeRank: '3/6',
      itemLevel: null
    });
    expect(splitItemCell('heroic 2/6 widget of testing')).toEqual({
      track: 'Hero',
      itemName: 'widget of testing',
      upgradeRank: '2/6',
      itemLevel: null
    });
    expect(splitItemCell('(Mythic 279) Belt of Examples ')).toEqual({
      track: 'Myth',
      itemName: 'Belt of Examples',
      upgradeRank: null,
      itemLevel: 279
    });
    expect(splitItemCell('Champ Belt of Examples')).toEqual({
      track: 'Champion',
      itemName: 'Belt of Examples',
      upgradeRank: null,
      itemLevel: null
    });
    expect(splitItemCell('')).toEqual({ track: null, itemName: '', upgradeRank: null, itemLevel: null });
  });
});
