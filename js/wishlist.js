// Raider-facing item wishlist (#515 Phase 1). Raiders tag catalog items with
// a self-reported priority tier (bis/good/ok/catalyst/pass) so officers get
// backup-option signal that bis_items (one officer-curated pick per slot)
// has no way to express. Own file since officer.html (where tab-bis.js's
// officer 16-slot grid lives) and index.html are separate script bundles.
//
// Rendered as a profile-section inside renderProfile() (js/common.js), same
// self-service pattern as js/streamers.js's ownStreamerSectionHTML() -- only
// on the public/self profile view (backTo === 'landing'), and only when the
// logged-in session's own claimed character matches the profile being
// viewed. There's no separate nav tab; a raider's wishlist isn't something a
// visitor browsing the roster should stumble into on someone else's profile.
//
// Depends on: common.js (supabaseClient, DATA, normalise, renderProfile),
// discord.js (getDiscordSession).

var _wishlistPlayerId = null;
var _wishlistPlayerFirstName = null; // kept alongside _wishlistPlayerId so writes can re-render via renderProfile()
var _wishlistPlayerNameRealm = null; // full identity, for the officer-bis-pick lookup (#529) -- firstName alone is ambiguous for two characters sharing a first name
var _wishlistPrefs = null; // array of {id, item_id, status, note, slot} once fetched, else null while loading
var _wishlistSaving = {}; // 'itemId|slot' -> true while a write is in flight, to disable that row's buttons
var _wishlistExpandedSlots = {}; // 'Head' -> true, or '__other__' for the M+/Crafted card -- survives re-renders

var WISHLIST_STATUSES = [
  { value: 'bis', label: 'BiS' },
  { value: 'good', label: 'Good' },
  { value: 'ok', label: 'OK' },
  { value: 'catalyst', label: 'Catalyst Only' },
  { value: 'pass', label: 'Pass' }
];

// Same 5 colors as the officer admin panel's tier-label dots (js/tabs/tab-admin.js's
// WISHLIST_LABEL_DEFAULTS -- own copy here for the same index.html/officer.html
// script-bundle-boundary reason as WISHLIST_SLOTS). `rgb` is the same color's
// plain r,g,b triplet (matching the existing --gold/--heal/--tank/--ranged/--melee
// hex values), used for the low-opacity row tint rgba() can't build from a CSS
// custom property alone.
var WISHLIST_TIER_COLORS = {
  bis: { css: 'var(--gold)', rgb: '214,163,68' },
  good: { css: 'var(--heal)', rgb: '61,220,132' },
  ok: { css: 'var(--tank)', rgb: '74,158,255' },
  catalyst: { css: 'var(--ranged)', rgb: '191,140,255' },
  pass: { css: 'var(--melee)', rgb: '255,124,92' }
};

// Mirrors js/tabs/tab-bis.js's BIS_SLOTS / BIS_CATALOG_SLOT_TO_ROWS. Kept as
// a separate copy rather than a shared import -- officer.html and index.html
// load entirely different script sets, so tab-bis.js isn't available here.
// tab-bis.js is the source of truth; update both if the slot vocabulary ever
// changes.
var WISHLIST_SLOTS = [
  'Head',
  'Neck',
  'Shoulder',
  'Back',
  'Chest',
  'Wrist',
  'Hands',
  'Waist',
  'Legs',
  'Feet',
  'Finger 1',
  'Finger 2',
  'Trinket 1',
  'Trinket 2',
  'Weapon',
  'Off Hand'
];
var WISHLIST_CATALOG_SLOT_TO_ROWS = {
  Head: ['Head'],
  Neck: ['Neck'],
  Shoulder: ['Shoulder'],
  Back: ['Back'],
  Chest: ['Chest'],
  Wrist: ['Wrist'],
  Hands: ['Hands'],
  Waist: ['Waist'],
  Legs: ['Legs'],
  Feet: ['Feet'],
  Finger: ['Finger 1', 'Finger 2'],
  Trinket: ['Trinket 1', 'Trinket 2'],
  'One-Hand': ['Weapon'],
  'Two-Hand': ['Weapon'],
  Ranged: ['Weapon'],
  'Off Hand': ['Off Hand'],
  'Held In Off-hand': ['Off Hand']
};
// The 4 non-tier slots the catalyst produces with fixed stats regardless of
// input item -- see wishlistOtherSourcesSectionHTML's comment.
var CATALYST_SOURCE_SLOTS = ['Back', 'Wrist', 'Waist', 'Feet'];

// Same armor-type scoping as tab-bis.js's search (bisSlotOnInput): rows for
// which armor type doesn't apply (jewelry, cloaks, weapons) skip the filter,
// so a warlock still sees every neck/trinket/weapon option, not just cloth.
var WISHLIST_ARMOR_TYPES = { Plate: true, Mail: true, Leather: true, Cloth: true };
var WISHLIST_UNIVERSAL_ROWS = {
  Neck: true,
  Back: true,
  Wrist: true,
  'Finger 1': true,
  'Finger 2': true,
  'Trinket 1': true,
  'Trinket 2': true,
  Weapon: true,
  'Off Hand': true
};

// Trinket/Weapon/Off Hand carry a main stat (Strength/Agility/Intellect)
// even without an armor_type -- Neck/Back/Wrist/Finger never roll one in
// this expansion's itemization, so they're intentionally left out here and
// stay fully unfiltered (WISHLIST_UNIVERSAL_ROWS above).
var WISHLIST_MAIN_STAT_ROWS = { 'Trinket 1': true, 'Trinket 2': true, Weapon: true, 'Off Hand': true };

// The 5 slots with a real tier-set catalog item (matches
// scripts/fetch-items.js's TOKEN_SLOT_KEYWORDS). Catalyzed gear now keeps its
// original secondary stats and any on-use/cantrip effect, so the tier-token
// piece isn't automatically the best "BiS" pick anymore -- a non-tier item
// with better stats can be catalyzed into the set later. wishlistSectionBodyHTML()
// surfaces a reminder of that on these 5 slots' cards specifically.
var WISHLIST_TIER_SET_SLOTS = ['Head', 'Shoulder', 'Chest', 'Hands', 'Legs'];

// Same shape as fetchSupabaseBisItems (js/common.js) -- guard on client,
// 10s race-timeout, warn+null on any failure. RLS already scopes this to the
// caller's own rows, but filtering client-side keeps the query cheap.
function fetchMyItemPreferences(playerId) {
  if (!supabaseClient) return Promise.resolve(null);
  var query = supabaseClient
    .from('item_preferences')
    .select('id, item_id, status, note, slot, season')
    .eq('player_id', playerId)
    .then(function (result) {
      if (result.error) {
        console.warn('Supabase item_preferences query failed.', result.error.message);
        return null;
      }
      return result.data || [];
    })
    .catch(function (err) {
      console.warn('Supabase item_preferences query failed.', err);
      return null;
    });
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(null);
    }, 10000);
  });
  return Promise.race([query, timeout]);
}

// Called from renderProfile() while building its HTML string -- must return
// synchronously, so a not-yet-loaded fetch shows a loading placeholder and
// re-invokes renderProfile() itself once the data's in (same "re-render the
// same entrypoint after an async load" shape buildWishlistTab used before
// this became a profile section, and the same one bisSlotPickItem's callers
// use for their own local-state patches).
function ownWishlistSectionHTML(player, backTo) {
  if (backTo !== 'landing') return '';
  // Folded into the existing 'bis' flag rather than its own -- a team not
  // using BiS lists isn't using the wishlist either.
  if (typeof featureEnabled === 'function' && !featureEnabled('bis')) return '';
  var session = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
  if (!session || !session.nameRealm || normalise(session.nameRealm) !== normalise(player.nameRealm)) return '';

  if (_wishlistPlayerId !== player.id) {
    _wishlistPlayerId = player.id;
    _wishlistPlayerFirstName = player.firstName;
    _wishlistPlayerNameRealm = player.nameRealm;
    _wishlistPrefs = null;
  }

  if (_wishlistPrefs === null) {
    fetchMyItemPreferences(player.id).then(function (rows) {
      _wishlistPrefs = rows || [];
      if (typeof renderProfile === 'function') renderProfile(player.firstName, 'landing');
    });
    return (
      '<div class="profile-section"><div class="section-label">My Wishlist</div>' +
      '<div style="padding:0.75rem 0;"><div class="spinner"></div></div></div>'
    );
  }

  return wishlistSectionBodyHTML(player);
}

// Read-time merge for the raider's own profile BiS List display -- delegates
// to common.js's bisMergeWishlistPrefs() (shared with renderProfile()'s
// officer-side merge, which sources prefs from tab-priority.js's
// _teamItemPreferences instead since index.html's _wishlistPrefs isn't
// available there).
//
// Requires _wishlistPrefs to already be loaded for this player -- called
// from renderProfile() after ownWishlistSectionHTML() has had a chance to
// populate it this render pass. Falls back to "nothing from wishlist yet"
// (not an error) if it hasn't loaded yet, matching ownWishlistSectionHTML's
// own loading-placeholder-then-rerender pattern.
function wishlistBisMergeGroups(player, officerBisItems) {
  if (_wishlistPlayerId !== player.id || _wishlistPrefs === null) {
    return { fromWishlist: [], officerSet: officerBisItems };
  }
  return bisMergeWishlistPrefs(_wishlistPrefs, officerBisItems, player.id);
}

function wishlistPrefFor(itemId, slot) {
  for (var i = 0; i < _wishlistPrefs.length; i++) {
    var p = _wishlistPrefs[i];
    if (p.item_id === itemId && (p.slot || null) === (slot || null)) return p;
  }
  return null;
}

// Buckets every real (non-placeholder) catalog item into its WISHLIST_SLOTS
// row(s) via WISHLIST_CATALOG_SLOT_TO_ROWS, same fan-out tab-bis.js uses for
// Finger/Trinket. Unlike the officer grid (one item per row, search-to-add),
// every matching catalog item is listed so a raider can tag several options
// per slot. Scoped to the raider's own armor type (#515 follow-up) -- a
// warlock (Cloth) never sees Plate/Mail/Leather armor rows, just the
// universal rows (jewelry/cloaks/weapons) plus their own armor type. Also
// scoped to the raider's main stat on Trinket/Weapon/Off Hand (items.main_stats,
// scripts/fetch-item-stats.js) -- those rows have no armor_type to filter on,
// so a Strength main stat still hid nothing there until this.
function wishlistBucketRealItems(playerArmorType, playerMainStat) {
  var itemSlots = (DATA && DATA.itemSlots) || {};
  var itemPlaceholders = (DATA && DATA.itemPlaceholders) || {};
  var itemIds = (DATA && DATA.itemIds) || {};
  var itemArmorTypes = (DATA && DATA.itemArmorTypes) || {};
  var itemMainStats = (DATA && DATA.itemMainStats) || {};
  var buckets = {};
  WISHLIST_SLOTS.forEach(function (s) {
    buckets[s] = [];
  });

  Object.keys(itemSlots).forEach(function (name) {
    if (itemPlaceholders[name]) return;
    if (typeof isItemInSeasonScope === 'function' && !isItemInSeasonScope(name)) return;
    var catalogSlot = itemSlots[name] || '';
    var rows = WISHLIST_CATALOG_SLOT_TO_ROWS[catalogSlot] || [];
    var armorType = itemArmorTypes[name] || '';
    var mainStats = itemMainStats[name] || [];
    rows.forEach(function (row) {
      if (
        playerArmorType &&
        WISHLIST_ARMOR_TYPES[armorType] &&
        !WISHLIST_UNIVERSAL_ROWS[row] &&
        armorType !== playerArmorType
      )
        return;
      if (
        playerMainStat &&
        WISHLIST_MAIN_STAT_ROWS[row] &&
        mainStats.length &&
        mainStats.indexOf(playerMainStat) === -1
      )
        return;
      buckets[row].push({ name: name, itemId: itemIds[name] });
    });
  });

  Object.keys(buckets).forEach(function (row) {
    buckets[row].sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
  });

  return buckets;
}

function wishlistPlaceholderNames() {
  var itemPlaceholders = (DATA && DATA.itemPlaceholders) || {};
  return Object.keys(itemPlaceholders).sort();
}

function wishlistCurrentStatus(itemId, slot) {
  var pref = wishlistPrefFor(itemId, slot);
  return pref ? pref.status : null;
}

// Rings/trinkets/weapons are the one case where comparing two related slots
// side by side is actually useful (Finger 1 vs Finger 2, Weapon vs Off
// Hand), so they're exempt from the accordion collapse within their own pair.
var WISHLIST_SLOT_GROUPS = [
  ['Finger 1', 'Finger 2'],
  ['Trinket 1', 'Trinket 2'],
  ['Weapon', 'Off Hand']
];

function wishlistGroupFor(key) {
  for (var i = 0; i < WISHLIST_SLOT_GROUPS.length; i++) {
    if (WISHLIST_SLOT_GROUPS[i].indexOf(key) !== -1) return WISHLIST_SLOT_GROUPS[i];
  }
  return [key];
}

// Accordion: opening a card collapses every other open card, except ones in
// the same group (see above) and the Other Sources card ('__other__'), which
// is independent of the gear-slot cards entirely.
function toggleWishlistSlot(key) {
  var opening = !_wishlistExpandedSlots[key];
  _wishlistExpandedSlots[key] = opening;
  if (opening && key !== '__other__') {
    var group = wishlistGroupFor(key);
    Object.keys(_wishlistExpandedSlots).forEach(function (k) {
      if (k === key || k === '__other__' || group.indexOf(k) !== -1) return;
      _wishlistExpandedSlots[k] = false;
    });
  }
  if (typeof renderProfile === 'function' && _wishlistPlayerFirstName) {
    renderProfile(_wishlistPlayerFirstName, 'landing');
  }
}

// Small colored-dot summary for a card's collapsed header -- one dot per
// tagged item, colored by its status, so there's useful info without
// expanding. `items` is an array of {itemId, slot} pairs to check.
function wishlistSlotSummaryDotsHTML(items) {
  var dots = '';
  items.forEach(function (it) {
    var status = wishlistCurrentStatus(it.itemId, it.slot || null);
    if (!status) return;
    var color = WISHLIST_TIER_COLORS[status];
    dots +=
      '<span style="display:inline-block;width:0.5rem;height:0.5rem;border-radius:50%;background:' +
      color.css +
      ';margin-left:2px;" title="' +
      status +
      '"></span>';
  });
  return dots;
}

// Whether the raider currently viewing their own Wishlist can edit it --
// the team-wide wishlistOpen() toggle, OR their own wishlist_allowed
// per-raider exception (same shape as bis_allowed's "Allow BiS Submit",
// #610/#611 follow-up: there was no way to reopen just one raider's
// Wishlist while it's closed team-wide). Every editing gate in this file
// should check this instead of wishlistOpen() directly -- tab-bis.js's own
// wishlistOpen() calls are the team-wide toggle's own display and
// deliberately stay as-is.
function wishlistEditableNow() {
  return wishlistOpen() || (!!_wishlistPlayerNameRealm && wishlistAllowedFor(_wishlistPlayerNameRealm));
}

// lockOnceSet (Other Sources rows only, #515 follow-up): once a status is
// set, every button on that row -- including the active one -- goes
// permanently disabled. Regular gear-slot rows never pass this, and stay
// freely re-taggable.
function wishlistStatusButtonsHTML(itemId, slot, lockOnceSet) {
  var current = wishlistCurrentStatus(itemId, slot);
  var savingKey = itemId + '|' + (slot || '');
  var locked = !!(lockOnceSet && current);
  var disabled = _wishlistSaving[savingKey] || !wishlistEditableNow() || locked ? ' disabled' : '';
  // Officer-overridable per team (#515 Phase 2), stored in
  // team_settings.config.wishlistStatusLabels via the officer admin panel --
  // WISHLIST_STATUSES's own .label stays the default text for teams that
  // haven't set (or have cleared) an override for that tier.
  var labelOverrides = (DATA && DATA.wishlistStatusLabels) || {};

  return WISHLIST_STATUSES.map(function (s) {
    var active = current === s.value;
    var color = WISHLIST_TIER_COLORS[s.value];
    var style = active
      ? 'font-size:0.9rem;padding:2px 8px;font-weight:700;color:' +
        color.css +
        ';background:rgba(' +
        color.rgb +
        ',0.18);border:1px solid ' +
        color.css +
        ';'
      : 'font-size:0.9rem;padding:2px 8px;border:1px solid rgba(' + color.rgb + ',0.4);';
    return (
      '<button type="button" class="btn ' +
      (active ? '' : 'btn-muted') +
      '" style="' +
      style +
      '" ' +
      disabled +
      ' onclick="wishlistSetStatus(' +
      itemId +
      ",'" +
      (slot ? slot.replace(/'/g, "\\'") : '') +
      "','" +
      s.value +
      '\')">' +
      (labelOverrides[s.value] || s.label) +
      '</button>'
    );
  }).join('');
}

function wishlistNoteHTML(itemId, slot) {
  var pref = wishlistPrefFor(itemId, slot);
  var note = (pref && pref.note) || '';
  var noteId = 'wishlistNote_' + itemId + '_' + (slot || 'none').replace(/\s+/g, '');
  return (
    '<input type="text" id="' +
    noteId +
    '" class="self-received-source" style="width:100%;box-sizing:border-box;font-size:0.92rem;margin-top:0.25rem;" ' +
    (wishlistEditableNow() ? '' : 'readonly ') +
    'placeholder="Note (optional)" value="' +
    note.replace(/"/g, '&quot;') +
    '" onchange="wishlistSetNote(' +
    itemId +
    ",'" +
    (slot ? slot.replace(/'/g, "\\'") : '') +
    '\',this.value)">'
  );
}

// Moved to itemNameBlockHtml() in js/common.js (#561) so the Priority tab's
// restyle (icon, Epic-purple name, slot/stat-pills/boss) and this Wishlist
// row share one implementation instead of drifting apart as two near-copies.

// Rank pill mirrors the BiS List's own use of getRank()/rankPillHTML()
// (js/common.js) -- priority_order is item-name-keyed, not BiS-specific, so
// any catalog item officers have generated a priority order for shows here
// too, not just BiS picks (#531). Skipped for Other Sources rows
// (lockOnceSet, e.g. "M+ - Head") since those aren't real raid-drop items
// with a priority order to look up -- same isGen treatment the BiS list
// gives M+/Crafted/Catalyst rows.
function wishlistRowHTML(name, itemId, slot, rowIndex, lockOnceSet) {
  if (itemId == null) return '';
  var current = wishlistCurrentStatus(itemId, slot);
  var color = current && WISHLIST_TIER_COLORS[current];
  var rowBackground = color ? 'rgba(' + color.rgb + ',0.08)' : rowIndex % 2 ? 'var(--bg-elevated)' : 'var(--bg-card)';
  var rowBorder = color ? color.css : 'var(--border)';
  var rank =
    !lockOnceSet && typeof getRank === 'function' && _wishlistPlayerNameRealm
      ? getRank(_wishlistPlayerNameRealm, name)
      : [];
  var rankHTML = lockOnceSet ? '' : typeof rankPillHTML === 'function' ? rankPillHTML(rank) : '';
  // Remove button: only for Other Sources rows (lockOnceSet) -- their status
  // buttons are permanently disabled once set, so this is the only way back
  // out of a mis-tagged slot. Regular gear-slot rows stay freely
  // re-taggable via the status buttons themselves, so they don't need one.
  var removeHTML =
    lockOnceSet && wishlistEditableNow()
      ? '<button type="button" class="btn btn-danger" style="font-size:0.85rem;padding:2px 8px;" ' +
        (_wishlistSaving[itemId + '|' + (slot || '')] ? 'disabled ' : '') +
        'onclick="wishlistRemovePreference(' +
        itemId +
        ",'" +
        (slot ? slot.replace(/'/g, "\\'") : '') +
        '\')">Remove</button>'
      : '';
  return (
    '<div style="padding:0.4rem 0.6rem;border-radius:4px;border:1px solid ' +
    rowBorder +
    ';background:' +
    rowBackground +
    ';margin-bottom:2px;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;">' +
    itemNameBlockHtml(name, slot) +
    '<div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;">' +
    rankHTML +
    '<div style="display:flex;gap:0.3rem;flex-wrap:wrap;">' +
    wishlistStatusButtonsHTML(itemId, slot, lockOnceSet) +
    removeHTML +
    '</div>' +
    '</div>' +
    '</div>' +
    wishlistNoteHTML(itemId, slot) +
    '</div>'
  );
}

// Wraps a slot's (or the Other Sources card's) rows in a collapsible card --
// header shows the label + a colored-dot summary of any tags already set, so
// there's useful info without expanding. `key` is the _wishlistExpandedSlots
// lookup key ('__other__' for the placeholder card, the slot name otherwise).
// `officerCovered` (slot cards only): true when the officer's bis_items grid
// already has a pick for this row (wishlistCompleteness()'s officerBuckets).
// The "N tagged" count and its green/grey styling always reflect the
// raider's own wishlist tags only -- officerCovered just appends a note so a
// slot that reads "0 tagged" here still shows it's actually settled via the
// officer's pick, without the card claiming credit for a tag the raider
// didn't make.
function wishlistCollapsibleCardHTML(key, label, summaryItems, bodyHTML, officerCovered) {
  var expanded = !!_wishlistExpandedSlots[key];
  var dots = wishlistSlotSummaryDotsHTML(summaryItems);
  var taggedCount = summaryItems.filter(function (it) {
    return wishlistCurrentStatus(it.itemId, it.slot || null);
  }).length;
  var allTagged = summaryItems.length > 0 && taggedCount === summaryItems.length;
  var countText = taggedCount + ' tagged' + (officerCovered ? ' -- officer BiS set' : '');
  var countLabel =
    '<span style="font-size:1.02rem;color:' +
    (allTagged ? 'var(--heal)' : 'var(--text-dim)') +
    ';margin-left:0.5rem;">' +
    countText +
    '</span>';
  return (
    '<div style="border:1px solid var(--border);border-radius:4px;margin-bottom:0.5rem;overflow:hidden;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;padding:0.5rem 0.75rem;cursor:pointer;background:var(--bg-elevated);" ' +
    'onclick="toggleWishlistSlot(\'' +
    key +
    '\')">' +
    '<span style="color:var(--text);font-weight:600;">' +
    label +
    countLabel +
    '</span>' +
    '<span>' +
    dots +
    '<span style="font-size:1.02rem;color:var(--text-dim);margin-left:0.5rem;">' +
    (expanded ? 'click to collapse' : 'click to expand') +
    '</span></span>' +
    '</div>' +
    (expanded ? '<div style="padding:0.5rem 0.75rem;">' + bodyHTML + '</div>' : '') +
    '</div>'
  );
}

// Adding a slot saves it as BiS immediately rather than just revealing an
// empty row -- the whole point of tagging an M+/Crafted/Catalyst source for
// a slot is that it's the intended plan, so there's no reason to make the
// raider click BiS separately right after. Still editable afterward like
// any other row if they want a different tier.
function wishlistRevealPlaceholderSlot(name, selectId) {
  var select = document.getElementById(selectId);
  var slot = select && select.value;
  if (!slot) return;
  var itemIds = (DATA && DATA.itemIds) || {};
  var itemId = itemIds[name];
  if (itemId == null) return;
  _wishlistExpandedSlots.__other__ = true;
  wishlistSetStatus(itemId, slot, 'bis');
}

// One M+/Crafted/Catalyst sub-block: rows for slots already tagged for that
// source, plus a "+ Add" control to tag a new slot. M+/Crafted offer every
// slot, since each genuinely can drop/be crafted for anything -- Catalyst
// only offers CATALYST_SOURCE_SLOTS (see wishlistOtherSourcesSectionHTML's
// comment for why). `globallyTaggedSlots` (a slot -> true map across all
// sources) keeps a slot already tagged under one source out of another's
// "+ Add" dropdown -- only one source can cover a given slot at a time.
function wishlistOtherSourceHTML(name, globallyTaggedSlots) {
  var itemIds = (DATA && DATA.itemIds) || {};
  var itemId = itemIds[name];
  if (itemId == null) return '';

  var candidateSlots = name === 'Catalyst' ? CATALYST_SOURCE_SLOTS : WISHLIST_SLOTS;
  var taggedSlots = [];
  _wishlistPrefs.forEach(function (p) {
    if (p.item_id !== itemId || !p.slot) return;
    if (typeof isItemInSeasonScope === 'function' && !isItemInSeasonScope(name, p.season)) return;
    taggedSlots.push(p.slot);
  });
  var shownSlots = candidateSlots.filter(function (s) {
    return taggedSlots.indexOf(s) !== -1;
  });

  var html =
    '<div style="margin-bottom:0.75rem;"><div style="font-weight:600;color:var(--text);margin-bottom:0.3rem;">' +
    name +
    '</div>';

  if (!shownSlots.length) {
    html +=
      '<p style="font-size:0.95rem;color:var(--text-dim);font-style:italic;margin:0 0 0.3rem;">No slots tagged yet.</p>';
  } else {
    shownSlots.forEach(function (slot, i) {
      // The slot is folded into the displayed name (not just passed as the
      // slot param) because these rows no longer live under a per-slot
      // heading now that all of a source's tags are grouped together --
      // without it, several "Catalyst" rows in a row would be indistinguishable.
      // lockOnceSet (true): once a slot's tagged here, it's permanent.
      html += wishlistRowHTML(name + ' - ' + slot, itemId, slot, i, true);
    });
  }

  var availableSlots = candidateSlots.filter(function (s) {
    return shownSlots.indexOf(s) === -1 && !globallyTaggedSlots[s];
  });
  if (availableSlots.length && wishlistEditableNow()) {
    var selectId = 'wishlistAddSlotSelect_' + name.replace(/[^a-zA-Z0-9]/g, '');
    html +=
      '<div style="display:flex;gap:0.4rem;align-items:center;margin-top:0.3rem;">' +
      '<select id="' +
      selectId +
      '" class="self-received-source" style="font-size:0.9rem;padding:0.25rem 0.4rem;max-width:160px;">' +
      availableSlots
        .map(function (s) {
          return '<option value="' + s + '">' + s + '</option>';
        })
        .join('') +
      '</select>' +
      '<button class="btn btn-muted" style="font-size:0.85rem;padding:2px 8px;" onclick="wishlistRevealPlaceholderSlot(\'' +
      name.replace(/'/g, "\\'") +
      "','" +
      selectId +
      '\')">+ Add</button>' +
      '</div>';
  }

  html += '</div>';
  return html;
}

// Catalyst only gets its own sub-block for Back/Wrist/Waist/Feet
// (CATALYST_SOURCE_SLOTS below) -- those 4 non-tier slots come out of the
// catalyst with fixed stats regardless of what was fed in, so "how did you
// get it" is meaningful the same way it is for M+/Crafted. The 5 actual
// tier slots (Head/Shoulder/Chest/Hands/Legs) keep the input item's own
// stats when catalyzed, so tagging a source there stays meaningless -- the
// real item is what should get tagged directly, using the "Catalyst Only"
// status button on it.
function wishlistOtherSourcesSectionHTML() {
  var placeholders = wishlistPlaceholderNames();
  if (!placeholders.length) return '';
  var itemIds = (DATA && DATA.itemIds) || {};
  var placeholderItemIds = {};
  var placeholderNameById = {};
  placeholders.forEach(function (name) {
    placeholderItemIds[itemIds[name]] = true;
    placeholderNameById[itemIds[name]] = name;
  });
  var summaryItems = _wishlistPrefs
    .filter(function (p) {
      if (!placeholderItemIds[p.item_id]) return false;
      if (typeof isItemInSeasonScope !== 'function') return true;
      return isItemInSeasonScope(placeholderNameById[p.item_id], p.season);
    })
    .map(function (p) {
      return { itemId: p.item_id, slot: p.slot };
    });

  var globallyTaggedSlots = {};
  summaryItems.forEach(function (it) {
    if (it.slot) globallyTaggedSlots[it.slot] = true;
  });

  var intro =
    '<p style="font-size:1.04rem;color:var(--text);margin:0 0 0.6rem;">Use this only when a slot\'s actual <strong>BiS</strong> comes from M+, Crafted, or (for Back/Wrist/Waist/Feet) the Catalyst instead of a raid drop. Pick a slot and click + Add -- it saves and locks in as BiS immediately.</p>';
  var body =
    intro +
    placeholders
      .map(function (name) {
        return wishlistOtherSourceHTML(name, globallyTaggedSlots);
      })
      .join('');
  return wishlistCollapsibleCardHTML(
    '__other__',
    'Other Sources -- BiS Not From Raid (M+ / Crafted / Catalyst)',
    summaryItems,
    body
  );
}

function wishlistSectionBodyHTML(player) {
  var playerArmorType = (CLASS_ARMOR_TYPE || {})[player && player.class] || null;
  var playerMainStat = specMainStat(player && player.class, player && player.spec);
  var buckets = wishlistBucketRealItems(playerArmorType, playerMainStat);

  var html =
    '<div class="profile-section"><div class="section-label">My Wishlist ' +
    '<span style="font-weight:400;color:var(--text-muted);font-size:0.85em;">-- your BiS list, expanded</span>' +
    '<button class="help-btn" onclick="toggleHelp(\'help-wishlist-' +
    player.firstName +
    '\')" title="Show help">?</button>' +
    '</div>' +
    '<div id="help-wishlist-' +
    player.firstName +
    '" class="help-tip">Tag every item you\'d want per slot, not just one pick: backups, sidegrades, or drops to pass on. BiS choices marked here save to your BiS List. Slots below are raid drops; use Other Sources for gear you\'ll get elsewhere.' +
    '<br><br>Swap specs per boss fight (e.g. a warlock alternating Aff/Demo/Destro -- not an off-spec you only play in M+ or a different role)? Only one item per slot can be BiS. Tag your other spec\'s item with whichever tier actually fits (Good/OK/Catalyst Only), and use the note to say it\'s really BiS for that spec, e.g. "BiS for Destro". Officers can see wishlist notes.</div>';

  var completeness = wishlistCompleteness();
  html += completeness.missingRows.length
    ? '<p style="font-size:1.02rem;color:var(--melee);margin:0.25rem 0 0.75rem;">' +
      completeness.taggedCount +
      '/' +
      completeness.totalRequired +
      ' slots tagged -- missing: ' +
      completeness.missingRows.join(', ') +
      '</p>'
    : '<p style="font-size:1.02rem;color:var(--heal);margin:0.25rem 0 0.75rem;">' +
      completeness.taggedCount +
      '/' +
      completeness.totalRequired +
      ' slots tagged.</p>';

  html += wishlistEditableNow()
    ? ''
    : '<p style="font-size:1.04rem;color:var(--melee);margin:0.25rem 0 0.75rem;">Wishlist editing is currently closed -- your tags below are read-only. Contact an officer if something needs to change.</p>';

  // Same "My BiS Changed (Same Link)" flag as the BiS tab (js/common.js's
  // bisFlagButtonHTML()) -- surfaced here too so a raider whose considered-
  // BiS changed doesn't have to switch tabs to flag it, whether they're
  // stuck read-only above or just prefer using this flow. '-wishlist' id
  // suffix keeps this copy's form/textarea ids distinct from the BiS tab's,
  // since both tabs stay in the DOM at once (display:none, not removed).
  if (player.bisLink && typeof bisFlagButtonHTML === 'function') {
    html += '<div style="margin-bottom:0.75rem;">' + bisFlagButtonHTML(player, '-wishlist') + '</div>';
  }

  html += wishlistOtherSourcesSectionHTML();

  var slotCards = '';
  for (var s = 0; s < WISHLIST_SLOTS.length; s++) {
    var slotName = WISHLIST_SLOTS[s];
    var items = buckets[slotName] || [];
    if (!items.length) continue;

    var tierNote =
      WISHLIST_TIER_SET_SLOTS.indexOf(slotName) !== -1
        ? '<p style="font-size:1.04rem;color:var(--text);margin:0 0 0.5rem;">Catalyzing keeps an item\'s stats/cantrip -- tag whichever piece you actually want as BiS, tier or not.</p>'
        : '';
    var body =
      tierNote +
      items
        .map(function (item, i) {
          return wishlistRowHTML(item.name, item.itemId, null, i);
        })
        .join('');
    var summaryItems = items.map(function (item) {
      return { itemId: item.itemId, slot: null };
    });
    var officerCovered = !!completeness.officerBuckets[slotName];
    slotCards += wishlistCollapsibleCardHTML(slotName, slotName, summaryItems, body, officerCovered);
  }
  html += slotCards;

  html +=
    '<div id="wishlistSaveMsg-' +
    player.firstName +
    '" style="font-size:0.95rem;color:var(--text-muted);margin-top:0.5rem;"></div>';
  html += '</div>';
  return html;
}

// Insert-or-update, not .upsert() -- the unique index is on the expression
// coalesce(slot,''), not the raw slot column, so onConflict:'player_id,
// item_id,slot' can't match it (same reason tab-bis.js's bisSlotPickItem
// does a plain insert rather than upserting). Filters an update the same way
// bisSlotFilter() does: .eq('slot', slot) when set, .is('slot', null) when not.
function wishlistUpsert(itemId, slot, patch) {
  if (!_wishlistPlayerId || !wishlistEditableNow()) return;
  var savingKey = itemId + '|' + (slot || '');
  _wishlistSaving[savingKey] = true;
  var msgEl = document.getElementById('wishlistSaveMsg-' + _wishlistPlayerFirstName);
  if (msgEl) msgEl.textContent = 'Saving...';

  var existing = wishlistPrefFor(itemId, slot);

  var request;
  if (existing) {
    var updateQuery = supabaseClient
      .from('item_preferences')
      .update(patch)
      .eq('player_id', _wishlistPlayerId)
      .eq('item_id', itemId);
    updateQuery = slot ? updateQuery.eq('slot', slot) : updateQuery.is('slot', null);
    request = updateQuery.select('id, item_id, status, note, slot, season');
  } else {
    var row = {
      team_id: _teamCfg.supabaseTeamId,
      player_id: _wishlistPlayerId,
      item_id: itemId,
      slot: slot || null,
      status: 'good',
      note: null,
      season: typeof resolveSeasonView === 'function' ? resolveSeasonView() : null
    };
    Object.keys(patch).forEach(function (k) {
      row[k] = patch[k];
    });
    request = supabaseClient.from('item_preferences').insert(row).select('id, item_id, status, note, slot, season');
  }

  request
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      var saved = result.data && result.data[0];
      if (saved) {
        if (existing) {
          existing.status = saved.status;
          existing.note = saved.note;
        } else {
          _wishlistPrefs.push(saved);
        }
      }
      delete _wishlistSaving[savingKey];
      if (typeof renderProfile === 'function' && _wishlistPlayerFirstName) {
        renderProfile(_wishlistPlayerFirstName, 'landing');
      }
    })
    .catch(function (err) {
      delete _wishlistSaving[savingKey];
      var msg = document.getElementById('wishlistSaveMsg-' + _wishlistPlayerFirstName);
      if (msg) msg.textContent = 'Failed: ' + err.message;
    });
}

// Slot row(s) a given item_preferences row occupies, for BiS-conflict
// detection below. Placeholders (Other Sources) carry an explicit slot
// override; real catalog items don't (slot is always null for them), so
// their row(s) come from the item's own catalog slot via
// WISHLIST_CATALOG_SLOT_TO_ROWS instead -- same fan-out wishlistBucketRealItems
// uses, which is also why a Finger/Trinket item's rows are both numbered
// rows at once (the DB has no way to say "this ring is my Finger 1 pick
// specifically", so only one ring can be BiS at a time today).
function wishlistItemRows(itemId, slot) {
  if (slot) return [slot];
  var itemSlots = (DATA && DATA.itemSlots) || {};
  var itemIds = (DATA && DATA.itemIds) || {};
  var name = null;
  Object.keys(itemIds).forEach(function (n) {
    if (itemIds[n] === itemId) name = n;
  });
  if (!name) return [];
  return WISHLIST_CATALOG_SLOT_TO_ROWS[itemSlots[name] || ''] || [];
}

// Own copy of tab-bis.js's bisSlotBuckets() row-assignment algorithm (index.html
// doesn't load tab-bis.js) -- used so a raider whose officer already filled
// out their bis_items grid doesn't show as "wishlist incomplete" for slots
// the officer already covers. New bis_items rows carry an explicit dbSlot;
// legacy rows fall back to their item's catalog slot, same best-effort
// placement tab-bis.js's own editor uses.
function wishlistOfficerRowBuckets(officerBisItems) {
  var itemSlots = (DATA && DATA.itemSlots) || {};
  var buckets = {};
  var unassigned = [];
  officerBisItems.forEach(function (entry) {
    var dbSlot = entry.dbSlot || entry.slot || '';
    if (dbSlot && WISHLIST_SLOTS.indexOf(dbSlot) !== -1 && !buckets[dbSlot]) {
      buckets[dbSlot] = entry;
    } else {
      unassigned.push(entry);
    }
  });
  unassigned.forEach(function (entry) {
    var catalogSlot = itemSlots[entry.item] || '';
    var candidates = WISHLIST_CATALOG_SLOT_TO_ROWS[catalogSlot] || [];
    for (var c = 0; c < candidates.length; c++) {
      if (!buckets[candidates[c]]) {
        buckets[candidates[c]] = entry;
        return;
      }
    }
  });
  return buckets;
}

// Completeness (#515): a wishlist is "complete" once every required
// WISHLIST_SLOTS row is covered -- either the raider tagged something there
// themselves (any status), or the officer's bis_items grid already has a
// pick for it. Off Hand is only required when the current BiS/officer
// Weapon pick is a real One-Hand item; a Two-Hand/Ranged pick, an untagged
// Weapon slot, or a placeholder (Other Sources) BiS pick for Weapon (no
// catalog slot to check) all leave Off Hand optional.
function wishlistCompleteness() {
  var itemSlots = (DATA && DATA.itemSlots) || {};
  var itemIds = (DATA && DATA.itemIds) || {};
  var idToName = {};
  Object.keys(itemIds).forEach(function (name) {
    idToName[itemIds[name]] = name;
  });

  var taggedRows = {};
  var offHandRequired = false;
  _wishlistPrefs.forEach(function (p) {
    wishlistItemRows(p.item_id, p.slot || null).forEach(function (row) {
      taggedRows[row] = true;
    });
    if (p.status === 'bis' && !p.slot) {
      var name = idToName[p.item_id];
      if (name && itemSlots[name] === 'One-Hand') offHandRequired = true;
    }
  });

  var officerBisItems =
    typeof getBisItems === 'function' && _wishlistPlayerFirstName
      ? getBisItems(_wishlistPlayerNameRealm || _wishlistPlayerFirstName)
      : [];
  if (typeof isItemInSeasonScope === 'function') {
    officerBisItems = officerBisItems.filter(function (entry) {
      return isItemInSeasonScope(entry.item, entry.season);
    });
  }
  var officerBuckets = wishlistOfficerRowBuckets(officerBisItems);
  if (!taggedRows.Weapon && officerBuckets.Weapon && itemSlots[officerBuckets.Weapon.item] === 'One-Hand') {
    offHandRequired = true;
  }

  var requiredRows = WISHLIST_SLOTS.filter(function (row) {
    return row !== 'Off Hand' || offHandRequired;
  });
  var missingRows = requiredRows.filter(function (row) {
    return !taggedRows[row] && !officerBuckets[row];
  });

  return {
    requiredRows: requiredRows,
    missingRows: missingRows,
    taggedCount: requiredRows.length - missingRows.length,
    totalRequired: requiredRows.length,
    officerBuckets: officerBuckets
  };
}

// Only one item can be BiS per slot at a time: tagging a new one
// auto-demotes whatever was previously BiS in an overlapping row to Good,
// so it stays tracked as a backup instead of two items both claiming BiS.
// Other Sources placeholders (M+/Crafted/Catalyst, identified by their
// explicit p.slot -- real catalog items always carry slot: null) don't get
// demoted like that: they're not a real backup item, just a stand-in for
// "something not from raid," so once a real raid drop claims the slot as
// BiS the placeholder is removed outright rather than left behind as a
// locked, un-editable "Good" row.
function wishlistSetStatus(itemId, slot, status) {
  if (status === 'bis') {
    var rows = wishlistItemRows(itemId, slot || null);
    if (rows.length) {
      _wishlistPrefs.slice().forEach(function (p) {
        if (p.item_id === itemId && (p.slot || null) === (slot || null)) return;
        if (p.status !== 'bis') return;
        var otherRows = wishlistItemRows(p.item_id, p.slot || null);
        var overlaps = otherRows.some(function (r) {
          return rows.indexOf(r) !== -1;
        });
        if (!overlaps) return;
        if (p.slot) {
          wishlistRemovePreference(p.item_id, p.slot);
        } else {
          wishlistUpsert(p.item_id, p.slot || null, { status: 'good' });
        }
      });
    }
  }
  wishlistUpsert(itemId, slot || null, { status: status });
}

function wishlistSetNote(itemId, slot, note) {
  wishlistUpsert(itemId, slot || null, { note: note || null });
}

// Other Sources rows lock once tagged (wishlistStatusButtonsHTML's
// lockOnceSet) so a raider can't casually retag M+/Crafted/Catalyst picks --
// but a mis-click on the wrong slot had no way back short of an officer
// fixing it in the DB. This deletes the row outright (not just clearing
// status) so the slot's "+ Add" dropdown offers it again.
function wishlistRemovePreference(itemId, slot) {
  if (!_wishlistPlayerId || !wishlistEditableNow()) return;
  var pref = wishlistPrefFor(itemId, slot || null);
  if (!pref) return;
  var savingKey = itemId + '|' + (slot || '');
  _wishlistSaving[savingKey] = true;
  var msgEl = document.getElementById('wishlistSaveMsg-' + _wishlistPlayerFirstName);
  if (msgEl) msgEl.textContent = 'Removing...';

  var deleteQuery = supabaseClient
    .from('item_preferences')
    .delete()
    .eq('player_id', _wishlistPlayerId)
    .eq('item_id', itemId);
  deleteQuery = slot ? deleteQuery.eq('slot', slot) : deleteQuery.is('slot', null);

  deleteQuery.then(function (result) {
    delete _wishlistSaving[savingKey];
    if (result.error) {
      var msg = document.getElementById('wishlistSaveMsg-' + _wishlistPlayerFirstName);
      if (msg) msg.textContent = 'Failed: ' + result.error.message;
      return;
    }
    var idx = _wishlistPrefs.indexOf(pref);
    if (idx !== -1) _wishlistPrefs.splice(idx, 1);
    if (typeof renderProfile === 'function' && _wishlistPlayerFirstName) {
      renderProfile(_wishlistPlayerFirstName, 'landing');
    }
  });
}
