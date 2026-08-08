// @ts-check
// gasUrl is kept on every team as a historical record of which Apps Script
// deployment served it -- Kat's call when retiring GAS (#225) was to hold
// onto that (and the gs/ source itself) for a while rather than delete it
// outright, until there's no doubt it's never needed again. No code reads
// gasUrl anymore: loadData() and every officer write path are Supabase-only.
var TEAMS = {
  phoenix: {
    gasUrl:
      'https://script.google.com/macros/s/AKfycbxrQdQGqbBTELWm7huWChdbES0ry7WFZetlELWuEdI0T6lfbXEzrqx9Vo5yA-b9dW4y7A/exec',
    name: 'Phoenix',
    supabaseTeamId: 1
  },
  hellfire: {
    gasUrl:
      'https://script.google.com/macros/s/AKfycbwIpnJyZDwWr5MmWIv7iyaDZ0OajPTFePMTYfIy8WG7jhg7pakQTvTVSM3SLihrKxBb/exec',
    name: 'Hellfire Rollers',
    supabaseTeamId: 2
  },
  // Never had a GAS deployment -- Immolation was created directly in
  // Supabase, unlike Phoenix/Hellfire's pre-migration Sheets.
  immolation: {
    gasUrl: '',
    name: 'Immolation',
    supabaseTeamId: 3
  }
};

// Guild-wide external links (#288) -- Raider.IO and Armory only ever track the
// whole guild roster (no per-team split like WarcraftLogs below), and never
// change, so these are static constants rather than officer-editable config.
var GUILD_LINKS = {
  raiderIoUrl: 'https://raider.io/guilds/us/tichondrius/We%20Go%20Again',
  armoryUrl: 'https://worldofwarcraft.com/en-us/guild/us/tichondrius/we-go-again'
};

var _teamParam = (location.search.match(/[?&]team=([^&]+)/) || [])[1];
var _hadExplicitTeam = !!(_teamParam && _teamParam in TEAMS);
// A "cold landing" is a visit with no explicit ?team= and no prior team choice
// this session -- index.html uses this to show a team picker / try a claim-based
// auto-redirect instead of silently defaulting to Phoenix (raised by raiders on
// other teams landing on the wrong roster).
var IS_COLD_LANDING = !_hadExplicitTeam && !sessionStorage.getItem('wga_team');
if (_hadExplicitTeam) {
  sessionStorage.setItem('wga_team', _teamParam);
} else {
  _teamParam = sessionStorage.getItem('wga_team') || 'phoenix';
}
var _teamCfg = TEAMS[_teamParam] || TEAMS.phoenix;
var TEAM_SLUG = _teamParam in TEAMS ? _teamParam : 'phoenix';
var TEAM_NAME = _teamCfg.name;
var VERSION = '3.55.0';

// Single source of truth for the top nav's item list/order/labels, shared by
// index.html (public, JS-driven showView() buttons) and officer.html (a
// read-only set of links back to index.html's views, since those tabs only
// exist there) -- previously each page hardcoded its own copy of this list,
// which is exactly how officer.html's copy drifted out of sync (still said
// "Bios" and was missing "News" after both shipped on the public page).
// `hash` is null for Home (plain index.html, no fragment); every other
// item's hash matches js/roster.js's showView()'s deep-link map (#354).
var SITE_NAV_ITEMS = [
  { id: 'navHome', label: 'Home', tooltip: 'Back to the roster overview', view: 'landing', hash: null },
  { id: 'navRoster', label: 'Roster', tooltip: "See who's currently on the roster", view: 'roster', hash: 'roster' },
  {
    id: 'navStreamers',
    label: 'Streams',
    tooltip: 'Watch raiders streaming live on Twitch',
    view: 'streamers',
    hash: 'streams'
  },
  {
    id: 'navSignup',
    label: 'Sign Up',
    tooltip: 'Apply to join the raid team for next season',
    view: 'signup',
    hash: 'signup',
    onclick: 'showSignupView()'
  },
  {
    id: 'navHistory',
    label: 'History',
    tooltip: 'Past seasons -- progression and dates',
    view: 'history',
    hash: 'history'
  },
  { id: 'navAbout', label: 'About', tooltip: 'Meet the team and guild leadership', view: 'about', hash: 'about' },
  {
    id: 'navNews',
    label: 'News',
    tooltip: "What's new on the site",
    view: 'news',
    hash: 'news',
    extraHtml: '<span id="navNewsDot" class="nav-notif nav-notif-dot" style="display:none"></span>'
  },
  {
    id: 'navHelp',
    label: 'Help',
    tooltip: 'How to claim your character, submit BiS, sign up, and more',
    view: 'help',
    hash: 'help'
  }
];

// Renders SITE_NAV_ITEMS into #siteNavItems -- 'public' mode (index.html)
// builds the real onclick="showView(...)" buttons; 'officer' mode
// (officer.html) builds plain links back to index.html's views, with the
// team query param baked in directly (rather than relying on the page's
// separate `a[href="index.html"]` team-switch rewrite, which only ever
// matched the exact bare href -- Home -- not these hash-suffixed ones).
function renderSiteNav(mode) {
  var mount = document.getElementById('siteNavItems');
  if (!mount) return;
  var html = '';
  SITE_NAV_ITEMS.forEach(function (item, i) {
    if (mode === 'officer') {
      var href = 'index.html';
      if (TEAM_SLUG !== 'phoenix') href += '?team=' + TEAM_SLUG;
      if (item.hash) href += '#' + item.hash;
      html +=
        '<a href="' +
        href +
        '" class="site-nav-item" id="' +
        item.id +
        '" data-tooltip="' +
        item.tooltip +
        '">' +
        item.label +
        '</a>';
    } else {
      var onclick = item.onclick || "showView('" + item.view + "')";
      html +=
        '<button class="site-nav-item' +
        (i === 0 ? ' active' : '') +
        '" id="' +
        item.id +
        '" onclick="' +
        onclick +
        '" data-tooltip="' +
        item.tooltip +
        '">' +
        item.label +
        (item.extraHtml || '') +
        '</button>';
    }
  });
  mount.innerHTML = html;
}

// Shared by the officer.html Help tab and index.html's raider Help tab/tips.
function toggleHelp(id) {
  var el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}

// Supabase client. The publishable key is public by design (it maps to the
// anon role); RLS is the security boundary, see docs/RLS.md. The guard keeps
// the JSONP site fully working if the CDN script fails to load.
var SUPABASE_URL = 'https://kxgjqnpwfklbgrxdgmmv.supabase.co';
var SUPABASE_ANON_KEY = 'sb_publishable_OdTUOR0Do1ThdKUPBh5inA_OWq78POC';
var supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// Two-statement pattern for officer writes: the caller performs its own
// insert/update against a table RLS already permits, then calls this to log
// it, since audit_log has no direct client write path (write_audit_log(),
// #214). Failing to log doesn't undo the write; surfaced via console.warn.
function writeAuditLog(action, targetType, targetId, detail) {
  if (!supabaseClient) return Promise.resolve();
  return supabaseClient
    .rpc('write_audit_log', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_action: action,
      p_target_type: targetType || null,
      p_target_id: targetId == null ? null : targetId,
      p_detail: detail == null ? null : String(detail)
    })
    .then(function (result) {
      if (result.error) console.warn('Failed to write audit log entry.', result.error.message);
    });
}

// In-app notification bell (#151). notify_player() is the only insert path
// onto notifications (tests/rls/notifications.test.js asserts a raw insert is
// denied to every role, mirroring write_audit_log()) -- called from the
// officer-side approve/reject handlers for BiS/self-received/M+ requests
// after their own write succeeds. Failing to notify doesn't undo the
// approval/rejection; surfaced via console.warn like writeAuditLog().
function notifyPlayer(playerId, message) {
  if (!supabaseClient || playerId == null) return Promise.resolve();
  return supabaseClient.rpc('notify_player', { p_player_id: playerId, p_message: message }).then(function (result) {
    if (result.error) console.warn('Failed to write notification.', result.error.message);
  });
}

// Raiders read/mark-read their own rows directly (RLS: is_own_player(player_id)),
// no RPC needed -- same self-service shape as streamers.
function fetchOwnNotifications() {
  if (!supabaseClient) return Promise.resolve([]);
  return supabaseClient
    .from('notifications')
    .select('id, message, read, created_at')
    .order('created_at', { ascending: false })
    .limit(20)
    .then(function (result) {
      if (result.error) {
        console.warn('Failed to fetch notifications.', result.error.message);
        return [];
      }
      return result.data || [];
    });
}

function markNotificationsRead(ids) {
  if (!supabaseClient || !ids || !ids.length) return Promise.resolve();
  return supabaseClient
    .from('notifications')
    .update({ read: true })
    .in('id', ids)
    .then(function (result) {
      if (result.error) console.warn('Failed to mark notifications read.', result.error.message);
    });
}

// Bell UI: shown only once a Discord session resolves to a linked character
// (session.nameRealm) -- an unclaimed account has no player_id, so there's
// nothing for RLS to scope notifications to. Called from renderDiscordNav()
// (js/discord.js) on every session state change, so it covers login,
// restored-session, logout, and claim on both index.html and officer.html.
var _notifCache = [];
var _notifNameRealm = null; // current session's linked character, for the cleared-threshold storage key

// "Clear read" (below) never deletes/mutates notifications rows -- it only
// remembers, per browser and per linked character, the highest id that was
// cleared so already-read rows below that id stay hidden across refreshes.
// Keyed like DISCORD_SESSION_KEY (js/discord.js): one browser is assumed to
// be one raider at a time per team, plus the character name so a later claim
// of a different alt on the same browser doesn't inherit an unrelated clear.
function _notifClearedStorageKey(nameRealm) {
  return 'wga_notif_cleared_' + TEAM_SLUG + '_' + nameRealm;
}

function _getNotifClearedThreshold() {
  if (!_notifNameRealm) return 0;
  try {
    return parseInt(localStorage.getItem(_notifClearedStorageKey(_notifNameRealm)), 10) || 0;
  } catch (_) {
    return 0;
  }
}

function _setNotifClearedThreshold(id) {
  if (!_notifNameRealm) return;
  try {
    localStorage.setItem(_notifClearedStorageKey(_notifNameRealm), String(id));
  } catch (_) {}
}

function renderNotifBell(session) {
  var btn = document.getElementById('navBell');
  if (!btn) return;
  if (!session || !session.nameRealm) {
    btn.style.display = 'none';
    _notifNameRealm = null;
    closeNotifDropdown();
    return;
  }
  _notifNameRealm = session.nameRealm;
  btn.style.display = '';
  refreshNotifBell();
}

function refreshNotifBell() {
  var badge = document.getElementById('navBellBadge');
  return fetchOwnNotifications().then(function (rows) {
    _notifCache = rows;
    var unread = rows.filter(function (r) {
      return !r.read;
    }).length;
    if (badge) {
      badge.textContent = unread;
      badge.style.display = unread > 0 ? '' : 'none';
    }
    var dd = document.getElementById('notifDropdown');
    if (dd && dd.style.display !== 'none') renderNotifDropdown();
  });
}

function toggleNotifDropdown(ev) {
  if (ev) ev.stopPropagation();
  var dd = document.getElementById('notifDropdown');
  if (!dd) return;
  var opening = dd.style.display === 'none';
  if (!opening) {
    closeNotifDropdown();
    return;
  }
  renderNotifDropdown();
  dd.style.display = '';
  document.addEventListener('click', _closeNotifDropdownOnOutsideClick);

  var unreadIds = _notifCache
    .filter(function (r) {
      return !r.read;
    })
    .map(function (r) {
      return r.id;
    });
  if (unreadIds.length) {
    markNotificationsRead(unreadIds).then(function () {
      _notifCache.forEach(function (r) {
        r.read = true;
      });
      var badge = document.getElementById('navBellBadge');
      if (badge) badge.style.display = 'none';
    });
  }
}

function _closeNotifDropdownOnOutsideClick(ev) {
  var dd = document.getElementById('notifDropdown');
  var btn = document.getElementById('navBell');
  if (dd && !dd.contains(ev.target) && btn && !btn.contains(ev.target)) closeNotifDropdown();
}

function closeNotifDropdown() {
  var dd = document.getElementById('notifDropdown');
  if (dd) dd.style.display = 'none';
  document.removeEventListener('click', _closeNotifDropdownOnOutsideClick);
}

// "Clear read" doesn't delete or mutate any notifications row -- it raises
// the cleared-threshold (persisted in localStorage) to the highest id
// currently in view, so every already-read row hides on this and future
// renders (including after a refresh) without touching the DB. A
// notification that arrives later and gets read still shows normally, since
// its id is above the threshold.
function clearReadNotifications(ev) {
  if (ev) ev.stopPropagation();
  var maxReadId = 0;
  _notifCache.forEach(function (n) {
    if (n.read && n.id > maxReadId) maxReadId = n.id;
  });
  if (maxReadId > 0) _setNotifClearedThreshold(maxReadId);
  renderNotifDropdown();
}

function _visibleNotifRows() {
  var threshold = _getNotifClearedThreshold();
  return _notifCache.filter(function (n) {
    return !n.read || n.id > threshold;
  });
}

function renderNotifDropdown() {
  var dd = document.getElementById('notifDropdown');
  if (!dd) return;
  var rows = _visibleNotifRows();
  if (!rows.length) {
    dd.innerHTML = '<div class="notif-empty">No notifications yet.</div>';
    return;
  }
  var hasRead = rows.some(function (n) {
    return n.read;
  });
  var html = hasRead
    ? '<div class="notif-header"><button class="notif-clear-btn" onclick="clearReadNotifications(event)">Clear read</button></div>'
    : '';
  rows.forEach(function (n) {
    html +=
      '<div class="notif-row' +
      (n.read ? '' : ' notif-unread') +
      '"><div class="notif-message">' +
      _esc(n.message) +
      '</div><div class="notif-time">' +
      new Date(n.created_at).toLocaleString() +
      '</div></div>';
  });
  dd.innerHTML = html;
}

// Shared by the Priority tab's export box (js/tabs/tab-priority.js) and
// index.html's Quick Actions "Copy Priority Export" button
// (js/officer-quick-actions.js) -- both build the same RCLC-import string
// from build_rclc_export(), so the base64 step lives here once (#408).
// btoa() only accepts a binary string of code units 0-255; converting UTF-8
// bytes to that form first matches Utilities.base64Encode(str, UTF_8)'s
// behavior for non-ASCII player names (#360).
function _utf8ToBase64(str) {
  var bytes = new TextEncoder().encode(str);
  var binary = '';
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

var DATA = null;
var ACTIVE_SEASON = null; // null = All Seasons; set by officer.js when a season is selected

function switchTeam(slug) {
  if (!(slug in TEAMS)) return;
  // Copy Discord session to the destination team's key so login persists across the switch.
  // Sessions are keyed per-team in localStorage but the token is valid globally server-side.
  try {
    var srcKey = 'wga_discord_' + TEAM_SLUG;
    var dstKey = 'wga_discord_' + slug;
    if (srcKey !== dstKey) {
      var raw = localStorage.getItem(srcKey);
      if (raw) localStorage.setItem(dstKey, raw);
    }
  } catch (_) {}
  sessionStorage.setItem('wga_team', slug);
  // Always include ?team= so the URL genuinely changes even when there was no
  // query string to begin with (e.g. switching away from the default team) --
  // assigning location.href the exact same URL the page is already on can be
  // treated as a soft reload that reuses cached/in-memory resources (fonts
  // included) instead of a real fresh navigation.
  location.href = location.pathname + '?team=' + slug;
}

function initTeamUI() {
  var suffix = document.title.split(' -- ')[1] || '';
  document.title = TEAM_NAME + (suffix ? ' -- ' + suffix : '');
  var nameEl = document.getElementById('headerTeamName');
  if (nameEl) nameEl.textContent = TEAM_NAME;
  ['teamSwitcherSelect', 'officerPromptTeamSelect', 'claimModalTeamSelect'].forEach(function (id) {
    var sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '';
    Object.keys(TEAMS).forEach(function (slug) {
      var opt = document.createElement('option');
      opt.value = slug;
      opt.textContent = TEAMS[slug].name;
      if (slug === TEAM_SLUG) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.onchange = /** @this {HTMLSelectElement} */ function () {
      switchTeam(this.value);
    };
  });
  var rioEl = /** @type {HTMLAnchorElement} */ (document.getElementById('headerRioLink'));
  if (rioEl) rioEl.href = GUILD_LINKS.raiderIoUrl;
  var armoryEl = /** @type {HTMLAnchorElement} */ (document.getElementById('headerArmoryLink'));
  if (armoryEl) armoryEl.href = GUILD_LINKS.armoryUrl;
}

// WarcraftLogs is per-team (#288), unlike the guild-wide links above -- set
// from team_settings.config once DATA is available, hidden entirely when the
// current team hasn't had one configured yet.
function renderExternalWclLink() {
  var el = /** @type {HTMLAnchorElement} */ (document.getElementById('headerWclLink'));
  if (!el) return;
  var url = DATA && DATA.externalLinks && DATA.externalLinks.warcraftLogsUrl;
  if (url) {
    el.href = url;
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}

// Blizzard/Raider.IO/WCL realm slugs: lowercase, apostrophes dropped, spaces
// to hyphens (e.g. "Area 52" -> "area-52"). Already-hyphenated realms
// (player.realm reconstructed via split('-').slice(1).join('-'), see
// mapSupabaseRoster) pass through unchanged.
function _wowRealmSlug(realm) {
  return String(realm || '')
    .toLowerCase()
    .replace(/'/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

// Per-character Armory/Raider.IO/WCL profile links (#289), a follow-up to
// #288's guild-wide links above. All three services use predictable
// region+realm+name URLs -- no API call or raider submission needed, unlike
// the M+ exclusion form's Raider.IO URL field this replaces. Region is
// hardcoded 'us', matching GUILD_LINKS and every roster realm today.
// @param {string} firstName
// @param {string} realm
// @returns {{raiderIo: string, armory: string, warcraftLogs: string}|null}
function characterProfileLinks(firstName, realm) {
  if (!firstName || !realm) return null;
  var realmSlug = _wowRealmSlug(realm);
  var nameEnc = encodeURIComponent(firstName);
  return {
    raiderIo: 'https://raider.io/characters/us/' + realmSlug + '/' + nameEnc,
    armory: 'https://worldofwarcraft.com/en-us/character/us/' + realmSlug + '/' + nameEnc,
    warcraftLogs: 'https://www.warcraftlogs.com/character/us/' + realmSlug + '/' + nameEnc
  };
}

// Raider.IO's character-profile endpoint (#651) -- public, keyless, and
// CORS-friendly, so this calls it straight from the browser rather than
// through a Supabase Edge Function (a bulk "sync whole roster" action would
// want a server-side batcher to respect rate limits, but a single raider's
// own sync doesn't need one). Region hardcoded 'us', matching
// characterProfileLinks() above -- every roster realm today is US. Returns
// gear.items keyed by lowercase slot name (head, shoulder, chest, hands,
// legs, ...), each carrying the raider's *equipped*, already-resolved
// item_id -- e.g. the id for "Damned Necrolyte's Charred Grasps", never the
// generic token that actually dropped in raid. That's exactly the id side
// DATA.itemWowIds maps class tier items to, so no token/bonus-ID resolution
// is needed here; see applyRaiderIoTierSync below.
function fetchRaiderIoGear(firstName, realm) {
  var realmSlug = _wowRealmSlug(realm);
  var url =
    'https://raider.io/api/v1/characters/profile?region=us&realm=' +
    encodeURIComponent(realmSlug) +
    '&name=' +
    encodeURIComponent(firstName) +
    '&fields=gear';
  return fetch(url)
    .then(function (res) {
      if (!res.ok) throw new Error('Raider.IO lookup failed (HTTP ' + res.status + ')');
      return res.json();
    })
    .then(function (data) {
      if (!data || !data.gear || !data.gear.items) throw new Error('Raider.IO has no gear data for this character');
      return data.gear.items;
    });
}

// ── Raider.IO tier sync (#651) ───────────────────────────────────────────────
//
// Only ever auto-marks the 5 deterministic per-slot tier rows, and only when
// the player already has a tagged BiS pick sitting in that row -- this never
// adds a pick on anyone's behalf, just confirms one that's already there. The
// Omni-Curio is out of scope by design (see the tier_token_map migration's
// header comment): it can become any of a class's 5 slots at the raider's own
// choice, so there's no deterministic slot to compare it against here.
//
// Shared by both write paths bis_items now supports (#651's
// bis_items_self_obtained migration): the officer's BiS editor
// (js/tabs/tab-bis.js's syncBisFromRaiderIo, any raider's row) and a raider's
// own profile (renderProfile below, gated on isOwnWishlistView) -- RLS decides
// which UPDATE actually succeeds ("Officers write bis_items" vs "Raiders
// update own bis_items obtained"), this just finds the same 5 rows either way.
var RAIDERIO_TIER_BIS_SLOTS = {
  Head: 'head',
  Shoulder: 'shoulder',
  Chest: 'chest',
  Hands: 'hands',
  Legs: 'legs'
};

// Tier tokens' catalog slot (items.slot) is always exactly their BIS_SLOTS row
// name 1:1 -- unlike Finger/Trinket, a Head/Shoulder/Chest/Hands/Legs item
// never fans out to more than one row, so this doesn't need tab-bis.js's full
// bisSlotBuckets() (officer-editor-only, not loaded on index.html) to find the
// row a raw bis_items entry belongs to.
function bisTierEntryForCatalogSlot(items, slotName) {
  var itemSlots = (DATA && DATA.itemSlots) || {};
  for (var i = 0; i < items.length; i++) {
    var entry = items[i];
    var catalogSlot = entry.dbSlot || itemSlots[entry.item] || '';
    if (catalogSlot === slotName) return entry;
  }
  return null;
}

// Compares each tier row's tagged BiS pick (stored on the token, matching
// item_preferences/bis_items' existing convention) against Raider.IO's
// equipped, already-resolved item_id for that slot -- matching purely on
// DATA.itemWowIds, no bonus-ID or catalyst-token guessing needed (settled in
// #650/#651). Rows with no tagged pick, an unresolvable class, or already
// marked obtained are left alone. Returns a promise of how many rows were
// newly marked.
function applyRaiderIoTierSync(player, gearItems) {
  var items = getBisItems(player.nameRealm);
  var tierTokenMap = (DATA && DATA.tierTokenMap) || {};
  var itemWowIds = (DATA && DATA.itemWowIds) || {};
  var playerClass = player.class;

  var toUpdate = [];
  Object.keys(RAIDERIO_TIER_BIS_SLOTS).forEach(function (bisSlot) {
    var entry = bisTierEntryForCatalogSlot(items, bisSlot);
    if (!entry || entry.obtained || entry.itemId == null) return;
    var tokenName = entry.item;
    var resolvedName = playerClass && tierTokenMap[tokenName] && tierTokenMap[tokenName][playerClass];
    if (!resolvedName) return;
    var resolvedWowId = itemWowIds[resolvedName];
    if (resolvedWowId == null) return;
    var equipped = gearItems[RAIDERIO_TIER_BIS_SLOTS[bisSlot]];
    if (!equipped || equipped.item_id !== resolvedWowId) return;
    toUpdate.push({ entry: entry, resolvedName: resolvedName });
  });

  if (!toUpdate.length) return Promise.resolve(0);

  return Promise.all(
    toUpdate.map(function (u) {
      var entry = u.entry;
      var query = supabaseClient
        .from('bis_items')
        .update({ obtained: true })
        .eq('player_id', player.id)
        .eq('item_id', entry.itemId);
      query = entry.dbSlot ? query.eq('slot', entry.dbSlot) : query.is('slot', null);
      return query.then(function (result) {
        if (result.error) throw new Error(result.error.message);
        entry.obtained = true;
        return writeAuditLog(
          'BiS Item Obtained Changed',
          'players',
          player.id,
          'Marked obtained (Raider.IO sync): ' + [entry.slot, u.resolvedName].filter(Boolean).join(' ')
        );
      });
    })
  ).then(function () {
    return toUpdate.length;
  });
}

// Inverts DATA.tierTokenMap ({tokenName: {class: resolvedName}}) into
// {slotName: resolvedName} for one class -- exactly 5 entries (Head/
// Shoulder/Chest/Hands/Legs), one per tier token. tier_token_map's existing
// shape already carries "what is this class's resolved piece for slot X",
// just keyed the other way around (by token, then class) -- no second
// lookup table needed.
function classTierResolvedItemsBySlot(playerClass) {
  var tierTokenMap = (DATA && DATA.tierTokenMap) || {};
  var itemSlots = (DATA && DATA.itemSlots) || {};
  var bySlot = {};
  if (!playerClass) return bySlot;
  Object.keys(tierTokenMap).forEach(function (tokenName) {
    var resolvedName = tierTokenMap[tokenName][playerClass];
    if (!resolvedName) return;
    var slot = itemSlots[resolvedName] || itemSlots[tokenName];
    if (slot) bySlot[slot] = resolvedName;
  });
  return bySlot;
}

// Raw "how many of this class's 5 tier pieces are currently equipped" count
// (0-5) -- unlike applyRaiderIoTierSync above, this is NOT gated on the
// player having a tagged BiS pick at all. This is the tier-set-progress
// number #651 asked for: it feeds generate_priority_order()'s tier-token
// weighting (see the tier_pieces_priority_weighting migration) via
// players.tier_pieces_equipped, and shows on a raider's own profile.
function countEquippedTierPieces(player, gearItems) {
  var bySlot = classTierResolvedItemsBySlot(player.class);
  var itemWowIds = (DATA && DATA.itemWowIds) || {};
  var count = 0;
  Object.keys(RAIDERIO_TIER_BIS_SLOTS).forEach(function (bisSlot) {
    var resolvedName = bySlot[bisSlot];
    if (!resolvedName) return;
    var wowId = itemWowIds[resolvedName];
    var equipped = gearItems[RAIDERIO_TIER_BIS_SLOTS[bisSlot]];
    if (wowId != null && equipped && equipped.item_id === wowId) count++;
  });
  return count;
}

// Shared write path for both the bulk roster sync (js/tabs/tab-priority.js's
// syncRosterTierCounts) and every individual Raider.IO sync below -- also
// patches the in-memory player/roster object so an immediate re-render
// (profile badge, priority tab) reflects the new count without a full
// DATA reload. No new RLS needed: "Officers write players" already covers
// this (officers are the only role that ever calls this).
function writeTierPiecesEquipped(player, count) {
  var syncedAt = new Date().toISOString();
  return supabaseClient
    .from('players')
    .update({ tier_pieces_equipped: count, tier_pieces_synced_at: syncedAt })
    .eq('id', player.id)
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      player.tierPiecesEquipped = count;
      player.tierPiecesSyncedAt = syncedAt;
    });
}

// UI-agnostic driver: looks up the player, fetches their gear, applies the
// sync, and updates whichever button/message elements the caller points it
// at -- reused as-is by both call sites (see the block comment above).
function runRaiderIoTierSync(nameRealm, btnId, msgId, onDone) {
  var player = findRosterPlayerByNameRealm(nameRealm);
  if (!player || !player.firstName || !player.realm) return;
  var btn = /** @type {HTMLButtonElement} */ (document.getElementById(btnId));
  var msgEl = document.getElementById(msgId);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Syncing...';
  }
  if (msgEl) msgEl.textContent = '';

  var fetchedGear = null;
  fetchRaiderIoGear(player.firstName, player.realm)
    .then(function (gearItems) {
      fetchedGear = gearItems;
      return applyRaiderIoTierSync(player, gearItems);
    })
    .then(function (updatedCount) {
      // Keep the raw tier-piece count fresh from every individual sync too,
      // not just the bulk roster action -- same gear fetch already in hand,
      // one more cheap write. Failing this write shouldn't fail the whole
      // sync -- the obtained-flag update above already succeeded and is
      // what the user waiting on this button actually asked for.
      return writeTierPiecesEquipped(player, countEquippedTierPieces(player, fetchedGear)).then(
        function () {
          return updatedCount;
        },
        function () {
          return updatedCount;
        }
      );
    })
    .then(function (updatedCount) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Sync from Raider.IO';
      }
      if (msgEl) {
        msgEl.textContent = updatedCount
          ? 'Synced -- ' + updatedCount + ' tier piece' + (updatedCount === 1 ? '' : 's') + ' marked obtained.'
          : 'Synced -- no new tier pieces to mark.';
      }
      if (onDone) onDone();
    })
    .catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Sync from Raider.IO';
      }
      if (msgEl) msgEl.textContent = 'Raider.IO sync failed: ' + err.message;
    });
}

// Thin wrapper for the raider's own profile button (renderProfile below) --
// re-renders the whole profile on success so the BiS List's obtained
// badges/completion % pick up the change immediately.
function syncOwnBisFromRaiderIo(firstName, nameRealm) {
  runRaiderIoTierSync(nameRealm, 'bisRaiderIoSyncBtn-' + firstName, 'bisRaiderIoMsg-' + firstName, function () {
    if (typeof renderProfile === 'function') renderProfile(firstName, 'landing');
  });
}

// Maintenance mode (#245). Checked at the earliest point each page's boot
// sequence branches (js/roster.js, js/officer.js), before loadData() or any
// login prompt -- degrades to "not in maintenance" on any error/no-row
// rather than blocking the whole site over a transient Supabase hiccup.
function checkMaintenanceMode() {
  if (!supabaseClient) return Promise.resolve({ enabled: false });
  // supabase-js query builders are PromiseLike, not real Promises -- their
  // own .then() is typed to return PromiseLike too, which has no .catch().
  // Passing the error handler as .then()'s second argument sidesteps that
  // (same runtime behavior here since none of these onFulfilled callbacks
  // can throw) instead of every call site needing a Promise.resolve() wrap.
  return supabaseClient
    .from('site_settings')
    .select('maintenance_mode, maintenance_message')
    .eq('id', 1)
    .maybeSingle()
    .then(
      function (result) {
        if (result.error || !result.data) return { enabled: false };
        return { enabled: !!result.data.maintenance_mode, message: result.data.maintenance_message };
      },
      function () {
        return { enabled: false };
      }
    );
}

// Full-page takeover: hides the loading spinner, nav, and any officer login
// prompt, and shows the banner instead. admin.html doesn't include this file
// at all (js/admin.js is deliberately standalone, see its own header
// comment), so the dashboard that turns maintenance mode back off is never
// itself blocked by it.
function showMaintenanceBanner(message) {
  document.querySelectorAll('.view, #loadingMsg, #officerPrompt, .site-nav').forEach(function (el) {
    /** @type {HTMLElement} */ (el).style.display = 'none';
  });
  var banner = document.getElementById('maintenanceBanner');
  if (!banner) return;
  banner.style.display = '';
  var msgEl = document.getElementById('maintenanceBannerMessage');
  if (msgEl) msgEl.textContent = message || 'The site is temporarily down for maintenance. Please check back soon.';
}

var WOW_REALMS = [
  // NA
  'Aegwynn',
  'Aggramar',
  'Akama',
  'Alexstrasza',
  'Alleria',
  'Altar of Storms',
  'Alterac Mountains',
  'Andorhal',
  'Anetheron',
  'Antonidas',
  "Anub'arak",
  'Anvilmar',
  'Arathor',
  'Archimonde',
  'Area 52',
  'Argent Dawn',
  'Arthas',
  'Arygos',
  'Auchindoun',
  'Azgalor',
  'Azjol-Nerub',
  'Azralon',
  'Azshara',
  'Azuremyst',
  'Baelgun',
  'Black Dragonflight',
  'Blackhand',
  'Blackrock',
  'Blackwater Raiders',
  'Blackwing Lair',
  "Blade's Edge",
  'Bladefist',
  'Bleeding Hollow',
  'Blood Furnace',
  'Bloodhoof',
  'Bloodscalp',
  'Bonechewer',
  'Borean Tundra',
  'Boulderfist',
  'Bronze Dragonflight',
  'Bronzebeard',
  'Burning Blade',
  'Burning Legion',
  'Cairne',
  'Cenarion Circle',
  'Cenarius',
  "Cho'gall",
  'Chromaggus',
  'Crushridge',
  'Daggerspine',
  'Dalaran',
  'Dalvengyr',
  'Dark Iron',
  'Darrowmere',
  'Dawnbringer',
  'Deathwing',
  'Demon Soul',
  'Destromath',
  'Detheroc',
  'Doomhammer',
  'Dragonblight',
  'Dragonmaw',
  "Drak'Tharon",
  "Drak'thul",
  'Drenden',
  'Dunemaul',
  'Durotan',
  'Duskwood',
  'Earthen Ring',
  'Echo Isles',
  'Eitrigg',
  "Eldre'Thalas",
  'Elune',
  'Emerald Dream',
  'Eonar',
  'Eredar',
  'Executus',
  'Exodar',
  'Farstriders',
  'Feathermoon',
  'Fenris',
  'Fizzcrank',
  'Frostmane',
  'Frostwolf',
  'Garithos',
  'Garona',
  'Garrosh',
  'Ghostlands',
  'Gilneas',
  'Gnomeregan',
  'Gorefiend',
  'Greymane',
  'Grizzly Hills',
  "Gul'dan",
  'Gurubashi',
  'Hakkar',
  'Haomarush',
  'Hellscream',
  'Hydraxis',
  'Hyjal',
  'Icecrown',
  'Illidan',
  'Jaedenar',
  "Kael'thas",
  'Kalecgos',
  'Kargath',
  "Kel'Thuzad",
  'Khaz Modan',
  "Kil'jaeden",
  'Kilrogg',
  'Kirin Tor',
  'Korgath',
  'Korialstrasz',
  'Kul Tiras',
  'Laughing Skull',
  'Lethon',
  'Lightbringer',
  "Lightning's Blade",
  'Lightninghoof',
  'Llane',
  'Lothar',
  'Madoran',
  'Maelstrom',
  'Magtheridon',
  'Maiev',
  "Mal'Ganis",
  'Malorne',
  'Malygos',
  'Mannoroth',
  'Medivh',
  'Misha',
  "Mok'Nathal",
  'Moon Guard',
  'Moonrunner',
  "Mug'thol",
  'Muradin',
  'Nathrezim',
  'Nazgrel',
  'Nazjatar',
  'Nesingwary',
  'Norgannon',
  'Nordrassil',
  'Onyxia',
  'Perenolde',
  'Proudmoore',
  "Quel'dorei",
  'Ravenholdt',
  'Rexxar',
  'Rivendare',
  'Runetotem',
  'Scarlet Crusade',
  'Scilla',
  "Sen'jin",
  'Sentinels',
  'Shadow Council',
  'Shadowmoon',
  'Shadowsong',
  'Shattered Halls',
  'Shattered Hand',
  "Shu'halo",
  'Silver Hand',
  'Silvermoon',
  'Sisters of Elune',
  'Skullcrusher',
  'Skywall',
  'Smolderthorn',
  'Spinebreaker',
  'Spirestone',
  'Staghelm',
  'Steamwheedle Cartel',
  'Stonemaul',
  'Stormrage',
  'Stormreaver',
  'Stormscale',
  'Sulfuras',
  'Tanaris',
  'Terenas',
  'Terokkar',
  'Thorium Brotherhood',
  'Thrall',
  'Thunderhorn',
  'Thunderlord',
  'Tichondrius',
  'Tirion',
  'Tortheldrin',
  'Trollbane',
  'Turalyon',
  'Twisting Nether',
  'Uther',
  'Vashj',
  'Velen',
  'Venture Co',
  'Whisperwind',
  'Wildhammer',
  'Windrunner',
  'Winterhoof',
  'Wyrmrest Accord',
  'Ysera',
  'Ysondre',
  'Zangarmarsh',
  "Zul'jin",
  'Zuluhed',
  // OCE
  "Aman'Thul",
  'Barthilas',
  'Caelestrasz',
  "Dath'Remar",
  'Dreadmaul',
  'Frostmourne',
  'Gundrak',
  "Jubei'Thos",
  "Khaz'goroth",
  'Nagrand',
  'Saurfang',
  'Thaurissan'
].sort();

var CLASS_SPECS = {
  'Death Knight': { specs: ['Blood', 'Frost', 'Unholy'], roles: ['Tank', 'DPS'] },
  'Demon Hunter': { specs: ['Havoc', 'Vengeance', 'Devourer'], roles: ['Tank', 'DPS'] },
  Druid: { specs: ['Balance', 'Feral', 'Guardian', 'Restoration'], roles: ['Tank', 'Healer', 'DPS'] },
  Evoker: { specs: ['Augmentation', 'Devastation', 'Preservation'], roles: ['Healer', 'DPS'] },
  Hunter: { specs: ['Beast Mastery', 'Marksmanship', 'Survival'], roles: ['Melee', 'Ranged'] },
  Mage: { specs: ['Arcane', 'Fire', 'Frost'], roles: null, role: 'Ranged' },
  Monk: { specs: ['Brewmaster', 'Mistweaver', 'Windwalker'], roles: ['Tank', 'Healer', 'DPS'] },
  Paladin: { specs: ['Holy', 'Protection', 'Retribution'], roles: ['Tank', 'Healer', 'DPS'] },
  Priest: { specs: ['Discipline', 'Holy', 'Shadow'], roles: ['Healer', 'DPS'] },
  Rogue: { specs: ['Assassination', 'Outlaw', 'Subtlety'], roles: null, role: 'Melee' },
  Shaman: { specs: ['Elemental', 'Enhancement', 'Restoration'], roles: ['Healer', 'DPS'] },
  Warlock: { specs: ['Affliction', 'Demonology', 'Destruction'], roles: null, role: 'Ranged' },
  Warrior: { specs: ['Arms', 'Fury', 'Protection'], roles: ['Tank', 'DPS'] }
};

// Returns an error string if the character name is invalid, otherwise null.
function validateCharName(name) {
  if (!name) return 'Please enter your character name.';
  if (name.length < 2 || name.length > 12) return 'Character name must be 2-12 characters.';
  if (!/^[A-Z]/.test(name)) return 'Character name must start with a capital letter (e.g. Katorri).';
  if (/[A-Z]/.test(name.slice(1)))
    return (
      'Character name can only have one capital letter (the first). Did you mean ' +
      name[0] +
      name.slice(1).toLowerCase() +
      '?'
    );
  return null;
}

// Maps each spec to its raid role. Used to resolve 'DPS' -> 'Melee'/'Ranged'.
var SPEC_ROLE = {
  Arcane: 'Ranged',
  Fire: 'Ranged',
  Affliction: 'Ranged',
  Demonology: 'Ranged',
  Destruction: 'Ranged',
  'Beast Mastery': 'Ranged',
  Marksmanship: 'Ranged',
  Survival: 'Melee',
  Balance: 'Ranged',
  Shadow: 'Ranged',
  Elemental: 'Ranged',
  Augmentation: 'Ranged',
  Devastation: 'Ranged',
  Devourer: 'Ranged',
  Assassination: 'Melee',
  Outlaw: 'Melee',
  Subtlety: 'Melee',
  Feral: 'Melee',
  Windwalker: 'Melee',
  Retribution: 'Melee',
  Enhancement: 'Melee',
  Havoc: 'Melee',
  Arms: 'Melee',
  Fury: 'Melee',
  Frost: 'Melee',
  Unholy: 'Melee',
  Blood: 'Tank',
  Guardian: 'Tank',
  Brewmaster: 'Tank',
  Protection: 'Tank',
  Vengeance: 'Tank',
  Restoration: 'Heal',
  Mistweaver: 'Heal',
  Holy: 'Heal',
  Discipline: 'Heal',
  Preservation: 'Heal'
};

var CLASS_ARMOR_TYPE = {
  'Death Knight': 'Plate',
  'Demon Hunter': 'Leather',
  Druid: 'Leather',
  Evoker: 'Mail',
  Hunter: 'Mail',
  Mage: 'Cloth',
  Monk: 'Leather',
  Paladin: 'Plate',
  Priest: 'Cloth',
  Rogue: 'Leather',
  Shaman: 'Mail',
  Warlock: 'Cloth',
  Warrior: 'Plate'
};

// Every spec of these classes shares one main stat. Used by specMainStat()
// below as the fallback for any spec not listed in SPEC_MAIN_STAT_OVERRIDE.
var CLASS_MAIN_STAT = {
  'Death Knight': 'STRENGTH',
  'Demon Hunter': 'AGILITY',
  Evoker: 'INTELLECT',
  Hunter: 'AGILITY',
  Mage: 'INTELLECT',
  Priest: 'INTELLECT',
  Rogue: 'AGILITY',
  Warlock: 'INTELLECT',
  Warrior: 'STRENGTH'
};

// The classes whose main stat actually varies by spec (Druid, Monk, Paladin,
// Shaman, and Demon Hunter's Devourer tank spec) -- everything else comes
// from CLASS_MAIN_STAT above. Keyed by spec name alone, not class+spec: none
// of these spec names carry a different meaning for another class
// (Restoration/Protection/Holy also appear on Shaman/Warrior/Priest
// respectively, but resolve to the same stat there too, and those classes
// don't need an override entry at all). Note this can't be a flat
// spec->stat map covering every class, though -- "Frost" is a spec name for
// both Death Knight (Strength) and Mage (Intellect), so single-stat classes
// must resolve via CLASS_MAIN_STAT, not a shared spec-keyed table.
var SPEC_MAIN_STAT_OVERRIDE = {
  Balance: 'INTELLECT',
  Feral: 'AGILITY',
  Guardian: 'AGILITY',
  Restoration: 'INTELLECT',
  Brewmaster: 'AGILITY',
  Mistweaver: 'INTELLECT',
  Windwalker: 'AGILITY',
  Holy: 'INTELLECT',
  Protection: 'STRENGTH',
  Retribution: 'STRENGTH',
  Elemental: 'INTELLECT',
  Enhancement: 'AGILITY',
  Devourer: 'INTELLECT'
};

function specMainStat(className, specName) {
  return SPEC_MAIN_STAT_OVERRIDE[specName] || CLASS_MAIN_STAT[className] || null;
}

// Which weapon subtypes (items.weapon_subtype -- Wowhead/Blizzard's item
// subclass name, e.g. 'Axe'/'Dagger'/'Staff') each class can actually equip,
// keyed by handedness (#609). Handedness matters because the subtype name
// alone doesn't distinguish it -- a One-Hand Sword and a Two-Hand Sword both
// report weapon_subtype 'Sword', but plenty of classes get one handedness of
// a type and not the other (e.g. Mage gets One-Hand Sword but no Two-Hand
// Sword, while still getting Two-Hand Staff). Wand is listed under One-Hand:
// it occupies the Weapon slot like any other one-hander and pairs with a
// separate Off Hand item, mutually exclusive with a Staff by construction
// (a Staff already fills both hands). Ranged (Bow/Gun/Crossbow) is only
// listed for Hunter -- Warrior/Rogue are technically able to equip a ranged
// weapon, but neither ever receives one as loot in current itemization, so
// listing it would just be dead code (Kat-confirmed, #609).
var CLASS_WEAPON_TYPES = {
  'Death Knight': { 'One-Hand': ['Axe', 'Mace', 'Sword'], 'Two-Hand': ['Axe', 'Mace', 'Sword', 'Polearm'] },
  'Demon Hunter': { 'One-Hand': ['Axe', 'Sword', 'Fist Weapon', 'Warglaive'] },
  Druid: { 'One-Hand': ['Mace', 'Dagger', 'Fist Weapon'], 'Two-Hand': ['Mace', 'Staff', 'Polearm'] },
  Evoker: {
    'One-Hand': ['Axe', 'Mace', 'Sword', 'Dagger', 'Fist Weapon'],
    'Two-Hand': ['Axe', 'Mace', 'Sword', 'Staff']
  },
  Hunter: {
    'One-Hand': ['Axe', 'Sword', 'Fist Weapon'],
    'Two-Hand': ['Axe', 'Sword', 'Polearm'],
    Ranged: ['Bow', 'Gun', 'Crossbow']
  },
  Mage: { 'One-Hand': ['Sword', 'Dagger', 'Wand'], 'Two-Hand': ['Staff'] },
  Monk: { 'One-Hand': ['Axe', 'Mace', 'Sword', 'Fist Weapon'], 'Two-Hand': ['Staff', 'Polearm'] },
  Paladin: { 'One-Hand': ['Axe', 'Mace', 'Sword'], 'Two-Hand': ['Axe', 'Mace', 'Sword', 'Polearm'] },
  Priest: { 'One-Hand': ['Mace', 'Dagger', 'Wand'], 'Two-Hand': ['Staff'] },
  Rogue: { 'One-Hand': ['Axe', 'Sword', 'Dagger', 'Fist Weapon'] },
  Shaman: { 'One-Hand': ['Axe', 'Mace', 'Dagger', 'Fist Weapon'], 'Two-Hand': ['Staff'] },
  Warlock: { 'One-Hand': ['Sword', 'Dagger', 'Wand'], 'Two-Hand': ['Staff'] },
  Warrior: {
    'One-Hand': ['Axe', 'Mace', 'Sword', 'Dagger', 'Fist Weapon'],
    'Two-Hand': ['Axe', 'Mace', 'Sword', 'Polearm', 'Staff']
  }
};

// Only these 3 classes can equip a Shield (items.weapon_subtype 'Shield',
// items.slot 'Off Hand') -- Kat-confirmed, #609. Every other class's Off
// Hand row stays filtered by main-stat only, same as before.
var CLASS_SHIELD_USERS = { Warrior: true, Paladin: true, Shaman: true };

// Some trinkets' equip/on-use effect is entirely about healing or
// protecting allies -- no damage, no self-buff a DPS spec could use -- so
// they're dead weight for a DPS spec even though nothing in the catalog's
// stat data (armor_type/main_stats) rules them out (#636); some aren't even
// Int-restricted (Preternatural Antivenom carries no main_stats at all, so
// today it shows to literally every spec with no filter catching it). No
// such signal exists in the item catalog -- Kat-curated here by item name,
// same manual-per-tier-edit workflow as CURRENT_SEASON/TOKEN_SLOT_KEYWORDS.
// Not a mechanical rule (e.g. "must trigger off the word healing") --
// Soulcoiler Ritual Vessel is a plain on-use ability, not gated behind a
// healing-spell trigger, and still belongs here because its only effect
// (shielding allies) has zero value for a DPS raider. Judgment call each
// time a new one shows up; Kat confirms before it's added. Checked against
// SPEC_ROLE's 'Heal' role, not class, so e.g. a Discipline Priest still sees
// it while Shadow doesn't.
var HEALER_ONLY_TRINKETS = {
  'Light of the Cosmic Crescendo': true, // Equip triggers off "Your healing..."
  'Volatile Void Suffuser': true, // Equip triggers off "Your healing spells and abilities..."
  'Soulcoiler Ritual Vessel': true, // Use: shields 5 allies -- no damage/self-buff value for DPS
  'Preternatural Antivenom': true // Equip triggers off "Your healing..."; not even Int-restricted
};

// Same idea as HEALER_ONLY_TRINKETS, mirrored for the opposite direction:
// some Strength/Agility (or stat-less) trinkets' entire effect is reducing
// damage the wearer takes, or shielding the wearer -- no throughput value,
// so they're dead weight outside a tank spec. Same Kat-curated,
// judgment-call-per-item workflow; checked against SPEC_ROLE's 'Tank' role.
var TANK_ONLY_TRINKETS = {
  "First Mate's Shellward": true, // Use: pure self-shield, deals damage only to melee attackers while it holds
  'Idol of the Howling Nexus': true // Equip triggers off dodge/parry/block -- tank avoidance stats
};

var CLASS_COLORS = {
  'Death Knight': '#C41E3A',
  'Demon Hunter': '#A330C9',
  Druid: '#FF7C0A',
  Evoker: '#33937F',
  Hunter: '#AAD372',
  Mage: '#3FC7EB',
  Monk: '#00FF98',
  Paladin: '#F48CBA',
  Priest: '#FFFFFF',
  Rogue: '#FFF468',
  Shaman: '#0070DD',
  Warlock: '#8788EE',
  Warrior: '#C69B3A'
};

// MN buff/debuff/utility map -- update here when class abilities change.
// spellId is the current-retail Wowhead spell id, used to link each name to
// its tooltip (js/tabs/tab-roster.js buildRosterBuffCoverage() and
// js/tabs/tab-pending-roster.js buildPendingBuffCoverageHtml(), #491). Where a
// row covers multiple classes' versions of the same effect (e.g. "Heroism /
// Bloodlust", "Combat Res"), spellId points at one representative spell, not
// every variant.
var RAID_BUFFS = [
  { name: 'Mark of the Wild', classes: ['Druid'], spellId: 1126 },
  { name: 'Arcane Intellect', classes: ['Mage'], spellId: 1459 },
  { name: 'Battle Shout', classes: ['Warrior'], spellId: 6673 },
  { name: 'Power Word: Fortitude', classes: ['Priest'], spellId: 21562 },
  { name: 'Blessing of the Bronze', classes: ['Evoker'], spellId: 364342 },
  { name: 'Skyfury', classes: ['Shaman'], spellId: 462854 },
  { name: 'Devotion Aura', classes: ['Paladin'], spellId: 465 }
];

// Hunter's Mark is applied to the boss, not the raid -- it belongs here, not
// in RAID_BUFFS (#491 follow-up).
var BOSS_DEBUFFS = [
  { name: "Hunter's Mark", classes: ['Hunter'], spellId: 257284 },
  { name: 'Mystic Touch', classes: ['Monk'], spellId: 8647 },
  { name: 'Chaos Brand', classes: ['Demon Hunter'], spellId: 255260 },
  { name: 'Atrophic Poison', classes: ['Rogue'], spellId: 381637 }
];

var RAID_UTILITY = [
  { name: 'Heroism / Bloodlust', classes: ['Shaman', 'Mage', 'Hunter', 'Evoker'], spellId: 2825 },
  { name: 'Combat Res', classes: ['Druid', 'Warlock', 'Paladin', 'Death Knight'], spellId: 20484 },
  { name: 'Healthstone', classes: ['Warlock'], spellId: 6201 },
  { name: 'Gateway', classes: ['Warlock'], spellId: 111771 },
  { name: 'Death Grip', classes: ['Death Knight'], spellId: 49576 },
  { name: 'Mass Grip', classes: ['Death Knight'], specs: ['Blood'], spellId: 108199 },
  { name: 'Life Grip / Rescue', classes: ['Priest', 'Evoker'], spellId: 73325 },
  { name: 'Blessing of Protection', classes: ['Paladin'], spellId: 1022 },
  { name: 'Darkness', classes: ['Demon Hunter'], spellId: 196718 },
  { name: 'Zephyr', classes: ['Evoker'], spellId: 374229 }
];

// Wraps a buff's display name in a Wowhead tooltip link (#491). Relies on
// officer.html loading https://wow.zamimg.com/widgets/power.js, which
// auto-attaches the hover tooltip to any <a class="wowhead"> whose href
// points at a wowhead.com spell page -- no per-link init call needed.
function buffNameLinkHtml(buff, colorStyle) {
  if (!buff.spellId) return '<span style="' + colorStyle + '">' + buff.name + '</span>';
  return (
    '<a href="https://www.wowhead.com/spell=' +
    buff.spellId +
    '" class="wowhead" target="_blank" rel="noopener" style="' +
    colorStyle +
    ';text-decoration:none;">' +
    buff.name +
    '</a>'
  );
}

// players: array of objects; classField/specField/nameField: key names on each object
function computeBuffCoverage(players, classField, specField, nameField) {
  var allBuffs = RAID_BUFFS.concat(BOSS_DEBUFFS).concat(RAID_UTILITY);
  var result = {};
  allBuffs.forEach(function (buff) {
    result[buff.name] = { count: 0, providers: [] };
    players.forEach(function (p) {
      var cls = p[classField] || '';
      var spec = p[specField] || '';
      if (buff.classes.indexOf(cls) === -1) return;
      if (buff.specs && buff.specs.indexOf(spec) === -1) return;
      result[buff.name].count++;
      result[buff.name].providers.push(p[nameField] || cls);
    });
  });
  return result;
}

function classColor(cls) {
  return CLASS_COLORS[cls] || 'var(--text)';
}

function classHexToRgba(hex, a) {
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

function classBadgeStyle(cls) {
  var hex = CLASS_COLORS[cls];
  if (!hex) return '';
  return (
    'color:' + hex + ';background:' + classHexToRgba(hex, 0.1) + ';border-color:' + classHexToRgba(hex, 0.25) + ';'
  );
}

function normalise(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// Reflects the current view into the URL hash (index.html only -- #517) via
// replaceState rather than location.hash= so navigating tabs/profiles doesn't
// spam browser history with an entry per switch. Read back once at boot by
// bootRosterApp() (js/roster.js) to restore the view across a reload.
function setViewHash(fragment) {
  var newHash = fragment ? '#' + fragment : '';
  if ((location.hash || '') === newHash) return;
  history.replaceState(null, '', location.pathname + location.search + newHash);
}

// -- Data loading -----------------------------------------------------------

// Public roster reads come from Supabase (#208); Apps Script keeps computing
// attendance from the Attendance sheet (scoring.attendance_pct stays empty
// until the WCL sync lands) and all four M+ fields (they derive from the
// requests flow, which is officer-gated to anon and migrates at Phase 5),
// so those merge in from the JSONP core payload. Resolves to the players
// rows, or null on any failure so the caller falls back to the JSONP roster.
function fetchSupabaseRoster() {
  if (!supabaseClient) return Promise.resolve(null);
  var query = supabaseClient
    .from('players')
    .select(
      'id, name_realm, nickname, is_trial, is_bench, is_backup_tank, is_backup_healer, bis_link, bis_allowed, wishlist_allowed, m_plus_excluded, m_plus_note, join_date, officer_notes, tier_pieces_equipped, tier_pieces_synced_at, classes_specs(class, spec, role)'
    )
    .eq('team_id', _teamCfg.supabaseTeamId)
    .is('archived_at', null)
    .order('name_realm')
    .then(
      function (result) {
        if (result.error) {
          console.warn('Supabase roster query failed.', result.error.message);
          return null;
        }
        return result.data && result.data.length ? result.data : null;
      },
      function (err) {
        console.warn('Supabase roster query failed.', err);
        return null;
      }
    );
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(null);
    }, 10000);
  });
  return Promise.race([query, timeout]);
}

// Most recent rejected mplus_exclusion_requests row per player (#405).
// players has no rejected/rejection-note columns of its own -- a rejection is
// only ever a request-table event, so "is this player currently showing a
// rejection badge" is derived live from the latest request instead of a
// persisted flag. Resolves to a plain object keyed by player_id, or {} on any
// failure so a player simply shows no rejection badge rather than blocking
// the roster load.
function fetchSupabaseMPlusRejections() {
  if (!supabaseClient) return Promise.resolve({});
  return supabaseClient
    .from('mplus_exclusion_requests')
    .select('player_id, officer_notes, submitted_at')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('status', 'rejected')
    .order('submitted_at', { ascending: false })
    .then(
      function (result) {
        if (result.error) return {};
        var byPlayer = {};
        (result.data || []).forEach(function (row) {
          // Ordered newest-first: keep only the first (most recent) row seen per player.
          if (row.player_id != null && !(row.player_id in byPlayer)) {
            byPlayer[row.player_id] = row.officer_notes || '';
          }
        });
        return byPlayer;
      },
      function () {
        return {};
      }
    );
}

// Incoming-roster reads come from Supabase (#499): a public view over
// approved-but-unpromoted season_signups, scoped server-side to the team's
// active signup season. Raider-facing only (name + class/spec), unlike
// pending_roster which is officer-only and full-detail. Resolves to the
// view's rows, or null on any failure so the caller renders nothing rather
// than blocking the Roster tab.
function fetchSupabaseIncomingRoster() {
  if (!supabaseClient) return Promise.resolve(null);
  var query = supabaseClient
    .from('incoming_roster')
    .select('signup_id, signup_name_realm, swap_from_name_realm, class, spec, role')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(
      function (result) {
        if (result.error) {
          console.warn('Supabase incoming_roster query failed.', result.error.message);
          return null;
        }
        return result.data && result.data.length ? result.data : null;
      },
      function (err) {
        console.warn('Supabase incoming_roster query failed.', err);
        return null;
      }
    );
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(null);
    }, 10000);
  });
  return Promise.race([query, timeout]);
}

// Guild Officer Bios are guild-wide, not per-team (fixed after #586 shipped
// them into team_settings.config, which is scoped per team_id) -- sourced
// from site_settings' singleton id=1 row, same as maintenance_mode.
function fetchSupabaseGuildOfficerBios() {
  if (!supabaseClient) return Promise.resolve(null);
  var query = supabaseClient
    .from('site_settings')
    .select('guild_officer_bios')
    .eq('id', 1)
    .maybeSingle()
    .then(
      function (result) {
        if (result.error || !result.data) return null;
        return result.data.guild_officer_bios || [];
      },
      function () {
        return null;
      }
    );
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(null);
    }, 10000);
  });
  return Promise.race([query, timeout]);
}

// Saves Guild Officer Bios via the set_guild_officer_bios RPC (SECURITY
// DEFINER, is_site_admin()-gated) -- NOT saveTeamSetting(), since this isn't
// per-team data. Mirrors saveTeamSetting()'s shape.
function saveGuildOfficerBios(bios) {
  return supabaseClient.rpc('set_guild_officer_bios', { p_bios: bios }).then(function (result) {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  });
}

/**
 * Maps Supabase players rows to the roster shape the Apps Script core payload
 * emits (see getRoster() in gs/wgaWebApp.gs), so no render code changes.
 * @param {any[]} rows - players rows with embedded classes_specs
 * @param {any[]} [jsonpRoster] - the Apps Script roster from the core payload
 * @param {Object} [mplusRejections] - player_id -> rejection note, from fetchSupabaseMPlusRejections()
 * @returns {any[]}
 */
function mapSupabaseRoster(rows, jsonpRoster, mplusRejections) {
  var jsonpByName = {};
  (jsonpRoster || []).forEach(function (p) {
    if (p && p.nameRealm) jsonpByName[String(p.nameRealm).toLowerCase()] = p;
  });
  mplusRejections = mplusRejections || {};
  var players = [];
  (rows || []).forEach(function (row) {
    var nameRealm = String(row.name_realm || '').trim();
    if (!nameRealm) return;
    var cs = row.classes_specs || {};
    // Mirror getRoster(): a row without a role is not a roster entry.
    if (!cs.role) return;
    var parts = nameRealm.split('-');
    var jsonpRow = jsonpByName[nameRealm.toLowerCase()] || {};
    var mPlusExcluded = !!row.m_plus_excluded;
    var mPlusRejected = !mPlusExcluded && row.id in mplusRejections;
    players.push({
      id: row.id,
      nameRealm: nameRealm,
      firstName: parts[0].trim(),
      realm: parts.slice(1).join('-').trim(),
      isTrial: !!row.is_trial,
      isBench: !!row.is_bench,
      isBackupTank: !!row.is_backup_tank,
      isBackupHealer: !!row.is_backup_healer,
      attendance: jsonpRow.attendance || '',
      nick: row.nickname || '',
      class: cs.class || '',
      spec: cs.spec || '',
      role: cs.role,
      bisLink: row.bis_link || '',
      bisAllowed: !!row.bis_allowed,
      wishlistAllowed: !!row.wishlist_allowed,
      joinDate: row.join_date || '',
      mPlusExcluded: mPlusExcluded,
      mPlusNote: row.m_plus_note || '',
      mPlusRejected: mPlusRejected,
      mPlusRejectionNote: mPlusRejected ? mplusRejections[row.id] : '',
      officerNote: row.officer_notes || '',
      tierPiecesEquipped: row.tier_pieces_equipped,
      tierPiecesSyncedAt: row.tier_pieces_synced_at || ''
    });
  });
  return players;
}

/**
 * Maps incoming_roster rows to the shape buildIncomingRosterSection()
 * (js/roster.js) expects. nick is always '' -- a signup has no nickname
 * field, that's a players-table concept set after promotion -- so display
 * always falls back to firstName, matching how buildPublicRosterTab()
 * already handles player.nick || player.firstName.
 * @param {any[]} rows - incoming_roster rows
 * @returns {any[]}
 */
function mapSupabaseIncomingRoster(rows) {
  var players = [];
  (rows || []).forEach(function (row) {
    var nameRealm = String(row.signup_name_realm || '').trim();
    if (!nameRealm) return;
    if (!row.role) return;
    var parts = nameRealm.split('-');
    players.push({
      signupId: row.signup_id,
      firstName: parts[0].trim(),
      realm: parts.slice(1).join('-').trim(),
      nick: '',
      class: row.class || '',
      spec: row.spec || '',
      role: row.role,
      swapFromNameRealm: row.swap_from_name_realm || ''
    });
  });
  return players;
}

// Season code -> display-name translation (#209, formalized as the
// permanent mechanism on #341): scoring.season/priority_order.season/
// rclc_loot.season store the compact code ('MID1', decided on #320) as a
// stable join/filter key, while officers see and type the free-text
// display name (DATA.seasonName, Season Settings tab -> team_settings.config
// via saveTeamSetting(), #221) -- translate on read/write.
//
// Three layers, checked in order:
//  1. SEASON_LABELS -- an explicit override map for anything that doesn't
//     fit the pattern below (a renamed season, a one-off historical name).
//     Empty by design: every season so far matches the pattern layer.
//  2. The pattern, '<codePrefix><N>' <-> '<displayPrefix> <N>', both
//     directions -- MID2, MID3, etc. translate automatically the moment
//     they show up in data, no code change required at each season
//     boundary (the earlier version of this mechanism, a single hardcoded
//     MID1 entry, would have silently mis-translated every season after
//     the first until someone remembered to add it).
//  3. The prefixes themselves are hardcoded constants (SEASON_CODE_PREFIX/
//     SEASON_DISPLAY_PREFIX below), Kat-updated in the same commit as
//     CURRENT_SEASON at an expansion boundary -- previously an
//     officer-editable per-team setting, but every team plays the same
//     real-world expansion timeline, so a per-team value only risked two
//     teams drifting to different prefixes for what's actually the same
//     expansion.
// Falls through to the input unchanged if nothing matches.
/** @type {Object<string, string>} */
var SEASON_LABELS = {};

// Kat-updated in the same commit as CURRENT_SEASON below, at an expansion
// boundary -- not for a routine new season within the same expansion (#341).
var SEASON_CODE_PREFIX = 'MID';
var SEASON_DISPLAY_PREFIX = 'Midnight Season';

// The single source of truth for "what's the next season," Kat-updated once
// per real-world tier (#537) -- same manual-per-tier-edit workflow already
// used for scripts/fetch-items.js's ZONE_ID/WCL_ZONE_ID. Drives the "Start
// New Season" button (js/tabs/tab-season.js) so every team applies the same
// name instead of each officer retyping their own. Deliberately no
// wclZoneId field here -- #549 supersedes that part of #537's original
// decision; item/boss season scoping reads DATA.seasonView/raid_zones
// instead of a JS constant.
var CURRENT_SEASON = { code: 'MID2', displayName: 'Midnight Season 2' };
if (seasonCodeForDisplay(CURRENT_SEASON.displayName) !== CURRENT_SEASON.code) {
  console.warn(
    'CURRENT_SEASON.code does not match seasonCodeForDisplay(CURRENT_SEASON.displayName) -- check SEASON_CODE_PREFIX/SEASON_DISPLAY_PREFIX against the new season name.'
  );
}

function _seasonCodePrefix() {
  return SEASON_CODE_PREFIX;
}

function _seasonDisplayPrefix() {
  return SEASON_DISPLAY_PREFIX;
}

function _escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Escapes HTML-significant characters before interpolating raider-supplied
// free text into a raw HTML string built by concatenation (an attribute
// value or text node) rather than DOM APIs. #286's own self-service streamer
// editor (js/streamers.js) called this without it ever being defined here --
// a real bug (ReferenceError the moment the section rendered) as well as a
// real gap: a schedule note is the kind of free-text field a raider fully
// controls, and most of this codebase's other string-built render functions
// don't escape their inputs at all, so this exists specifically for new
// call sites like that one rather than a blanket retrofit.
function _esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function seasonDisplayName(code) {
  if (SEASON_LABELS[code]) return SEASON_LABELS[code];
  var displayPrefix = _seasonDisplayPrefix();
  var re = new RegExp('^' + _escapeRegExp(_seasonCodePrefix()) + '(\\d+)$');
  var m = re.exec(code || '');
  return m ? displayPrefix + ' ' + m[1] : code;
}

function seasonCodeForDisplay(displayName) {
  for (var code in SEASON_LABELS) {
    if (SEASON_LABELS[code] === displayName) return code;
  }
  var codePrefix = _seasonCodePrefix();
  var re = new RegExp('^' + _escapeRegExp(_seasonDisplayPrefix()) + ' (\\d+)$');
  var m = re.exec(displayName || '');
  return m ? codePrefix + m[1] : displayName;
}

// Public loot reads come from Supabase (#209): all seasons for the team,
// newest first, paged past PostgREST's 1000-row cap. Resolves to the combined
// rows, or null on any failure/empty -- the Apps Script no longer serves
// lootCounts (retired #358, redeployed #210), so a failure here means an
// empty loot feed, not a fallback to the old source.
function fetchSupabaseLoot() {
  if (!supabaseClient) return Promise.resolve(null);
  var PAGE = 1000;
  /**
   * @param {number} from
   * @param {any[]} acc
   * @returns {Promise<any[]|null>}
   */
  function fetchPage(from, acc) {
    // Promise.resolve() unwraps the query builder's PromiseLike into a real
    // Promise (same resolution, no behavior change) -- needed here since
    // this return type is declared Promise<any[]|null> above and the call
    // site chains .catch() on it.
    return Promise.resolve(
      supabaseClient
        .from('rclc_loot')
        .select('track, season, awarded_at, items(name), players(name_realm)')
        .eq('team_id', _teamCfg.supabaseTeamId)
        .order('awarded_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + PAGE - 1)
        .then(function (/** @type {{data: any[]|null, error: {message: string}|null}} */ result) {
          if (result.error) {
            console.warn('Supabase loot query failed.', result.error.message);
            return null;
          }
          var rows = result.data || [];
          var all = acc.concat(rows);
          if (rows.length < PAGE) return all.length ? all : null;
          return fetchPage(from + PAGE, all);
        })
    );
  }
  var query = fetchPage(0, []).catch(function (err) {
    console.warn('Supabase loot query failed.', err);
    return null;
  });
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(null);
    }, 10000);
  });
  return Promise.race([query, timeout]);
}

/**
 * Rebuilds the Apps Script getLootCounts() shape from rclc_loot rows so most
 * render code needs no changes, keyed by diacritic-stripped lowercase
 * character identity (normalise(name_realm), unique per team -- #359) rather
 * than first name alone, so two characters sharing a first name (the Snarge
 * case, or two Katorri characters on different realms) no longer merge into
 * one entry.
 * Entries carry count/heroicCount/mythicCount and per-item difficulty labels
 * ('Heroic'/'Mythic'/'Other' -- the UI vocabulary for the Hero/Myth/Champion
 * tracks), display dates formatted in the sheet's timezone, and seasons shown
 * under their display names. Rows without a linked player are skipped; the
 * import stubs departed characters, so every historical row stays attributed
 * (docs/database-decisions.md, 2026-07-08).
 * @param {any[]} rows - rclc_loot rows with embedded items and players
 * @returns {Object<string, {count: number, heroicCount: number, mythicCount: number, items: any[]}>}
 */
function mapSupabaseLoot(rows) {
  /** @type {Object<string, {count: number, heroicCount: number, mythicCount: number, items: any[]}>} */
  var result = {};
  var dateFormat = new Intl.DateTimeFormat('en-US', {
    // The Apps Script feed formatted award dates in the sheet's timezone;
    // browser-local formatting would shift dates across midnight elsewhere.
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  (rows || []).forEach(function (row) {
    var nameRealm = row.players && row.players.name_realm ? String(row.players.name_realm) : '';
    if (!nameRealm) return;
    var key = normalise(nameRealm);
    if (!key) return;
    var difficulty = row.track === 'Hero' ? 'Heroic' : row.track === 'Myth' ? 'Mythic' : 'Other';
    var date = '';
    if (row.awarded_at) {
      var d = new Date(row.awarded_at);
      if (!isNaN(d.getTime())) date = dateFormat.format(d);
    }
    if (!result[key]) result[key] = { count: 0, heroicCount: 0, mythicCount: 0, items: [] };
    var entry = result[key];
    entry.count++;
    if (difficulty === 'Heroic') entry.heroicCount++;
    else if (difficulty === 'Mythic') entry.mythicCount++;
    entry.items.push({
      name: row.items && row.items.name ? row.items.name : 'Unknown Item',
      difficulty: difficulty,
      date: date,
      season: seasonDisplayName(row.season) || ''
    });
  });
  return result;
}

// BiS list reads come from Supabase (#217): bis_items has no team_id column
// of its own (derives team through the player_id FK, docs/database-decisions.md),
// so filtering by team requires an inner join through players. Resolves to
// the raw rows, or null on any failure so the caller falls back to the Apps
// Script heavy chunk's bisList.
function fetchSupabaseBisItems() {
  if (!supabaseClient) return Promise.resolve(null);
  var query = supabaseClient
    .from('bis_items')
    .select(
      'player_id, item_id, obtained, slot, season, items(name, slot, is_placeholder), players!inner(name_realm, team_id)'
    )
    .eq('players.team_id', _teamCfg.supabaseTeamId)
    .then(
      function (result) {
        if (result.error) {
          console.warn('Supabase BiS items query failed.', result.error.message);
          return null;
        }
        return result.data && result.data.length ? result.data : null;
      },
      function (err) {
        console.warn('Supabase BiS items query failed.', err);
        return null;
      }
    );
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(null);
    }, 10000);
  });
  return Promise.race([query, timeout]);
}

/**
 * Maps bis_items rows to the DATA.bisList shape the Apps Script heavy chunk
 * emits (character identity -> array of {item, slot} entries), so most
 * render code needs no changes. Keyed by the full name_realm identity (#529,
 * companion to #359's loot re-keying) rather than first name alone, so two
 * characters sharing a first name no longer merge under one key --
 * tab-conflicts.js/tab-priority.js/tab-bis.js index DATA.bisList by identity
 * (or fall back through getBisItems()'s normalised lookup for any remaining
 * bare-first-name caller). Carries obtained/playerId/itemId so the BiS Lists
 * editor (tab-bis.js) can write back without a second lookup.
 * @param {any[]} rows - bis_items rows with embedded items and players
 * @returns {Object<string, {item: string, slot: string, dbSlot: string|null, obtained: boolean, playerId: number, itemId: number, season: string|null}[]>}
 */
function mapSupabaseBisItems(rows) {
  /** @type {Object<string, {item: string, slot: string, dbSlot: string|null, obtained: boolean, playerId: number, itemId: number, season: string|null}[]>} */
  var map = {};
  (rows || []).forEach(function (row) {
    var players = row.players || {};
    var nameRealm = String(players.name_realm || '').trim();
    if (!nameRealm) return;
    var itemRow = row.items || {};
    if (!itemRow.name) return;
    if (!map[nameRealm]) map[nameRealm] = [];
    map[nameRealm].push({
      item: itemRow.name,
      // bis_items.slot is the canonical BIS_SLOTS row an officer assigned
      // this entry to (js/tabs/tab-bis.js, #393 follow-up) -- every row added
      // through that editor carries one now, real items included, since
      // "Finger"/"Trinket" alone can't say which of the two numbered slots an
      // item is for. Falls back to the item's own catalog slot only for
      // legacy real-item rows added before this existed; placeholder rows
      // (M+/Crafted/Catalyst) never fall back, since items.slot is the
      // literal 'Placeholder' sentinel for those (items.slot is NOT NULL).
      slot: row.slot || (itemRow.is_placeholder ? '' : itemRow.slot || ''),
      // The raw bis_items.slot column value -- tab-bis.js needs this, not the
      // display slot above, to target the exact row on delete/update now that
      // more than one row can share an item_id (distinguished by slot).
      dbSlot: row.slot || null,
      obtained: !!row.obtained,
      playerId: row.player_id,
      itemId: row.item_id,
      season: row.season || null
    });
  });
  return map;
}

// Self-received reads come from Supabase (#406): self_received_requests
// carries its own team_id (unlike bis_items), so no join-through-players
// filter is needed. Only 'approved' rows are pulled -- pending/rejected
// requests are officer-queue-only (js/tabs/tab-requests.js), not shown on a
// player's profile. Resolves to the raw rows, or null on any failure so the
// caller falls back to the Apps Script heavy chunk's selfReceived.
function fetchSupabaseSelfReceived() {
  if (!supabaseClient) return Promise.resolve(null);
  var query = supabaseClient
    .from('self_received_requests')
    .select('track, source, players(name_realm), items(name, slot)')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('status', 'approved')
    .then(
      function (result) {
        if (result.error) {
          console.warn('Supabase self-received query failed.', result.error.message);
          return null;
        }
        return result.data && result.data.length ? result.data : null;
      },
      function (err) {
        console.warn('Supabase self-received query failed.', err);
        return null;
      }
    );
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(null);
    }, 10000);
  });
  return Promise.race([query, timeout]);
}

// Streamers reads are guild-wide (#286): every team's rows, not scoped to
// _teamCfg.supabaseTeamId like every other fetchSupabaseX() here -- seeing
// across teams is the actual reason this feature needs Supabase instead of
// the old per-team GAS silos. Joins players (name_realm/nickname) directly
// rather than resolving through DATA.roster, since DATA.roster is single-
// team-scoped and has no entry for a streamer on the other team.
function fetchSupabaseStreamers() {
  if (!supabaseClient) return Promise.resolve(null);
  var query = supabaseClient
    .from('streamers')
    .select(
      'id, team_id, player_id, twitch_channel, schedule_note, guild_wide_opt_out, is_live, players(name_realm, nickname)'
    )
    .then(
      function (result) {
        if (result.error) {
          console.warn('Supabase streamers query failed.', result.error.message);
          return null;
        }
        return result.data && result.data.length ? result.data : null;
      },
      function (err) {
        console.warn('Supabase streamers query failed.', err);
        return null;
      }
    );
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(null);
    }, 10000);
  });
  return Promise.race([query, timeout]);
}

// Maps streamers rows (joined through players) to the shape js/streamers.js's
// render code already expects (team_slug, not team_id, so its existing
// team-comparison logic needs no changes). display_name/player_first_name
// come from the joined player row, not DATA.roster -- DATA.roster is
// single-team-scoped and has no entry for a streamer on the other team.
// There is no separate "stream persona" column; the self-service editor has
// never had a field for one, so this reuses the same nickname-or-first-name
// every other view in the app displays a player by.
function mapSupabaseStreamers(rows) {
  var idToSlug = {};
  Object.keys(TEAMS).forEach(function (slug) {
    idToSlug[TEAMS[slug].supabaseTeamId] = slug;
  });
  var mapped = [];
  (rows || []).forEach(function (row) {
    var player = row.players || {};
    var nameRealm = String(player.name_realm || '').trim();
    if (!nameRealm) return;
    var firstName = nameRealm.split('-')[0].trim();
    mapped.push({
      id: row.id,
      team_slug: idToSlug[row.team_id] || '',
      player_first_name: firstName,
      display_name: player.nickname || firstName,
      twitch_channel: row.twitch_channel,
      schedule_note: row.schedule_note || '',
      guild_wide_opt_out: !!row.guild_wide_opt_out,
      is_live: !!row.is_live
    });
  });
  return mapped;
}

// Current-team mythic/heroic pull count/best % (#285, extended to Heroic in
// #629), synced by the wcl-progression-sync Edge Function (cron, see
// .github/workflows/wcl-progression-sync.yml). Joins through
// raid_encounters/raid_zones since team_raid_progress only stores
// encounter_id -- the boss-name join key buildProgression() actually needs
// comes from the embedded encounter row.
function fetchSupabaseRaidProgress() {
  if (!supabaseClient) return Promise.resolve(null);
  var query = supabaseClient
    .from('team_raid_progress')
    .select(
      'mythic_pulls, mythic_best_pct, mythic_report_code, mythic_fight_id, ' +
        'heroic_date, heroic_pulls, heroic_best_pct, heroic_report_code, heroic_fight_id, ' +
        'raid_encounters(name, wcl_encounter_id, raid_zones(wcl_zone_id))'
    )
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(
      function (result) {
        if (result.error) {
          console.warn('Supabase team_raid_progress query failed.', result.error.message);
          return null;
        }
        return result.data && result.data.length ? result.data : null;
      },
      function (err) {
        console.warn('Supabase team_raid_progress query failed.', err);
        return null;
      }
    );
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(null);
    }, 10000);
  });
  return Promise.race([query, timeout]);
}

// Keyed two ways so _raidProgressFor() (js/roster.js) can look a boss up by
// whichever identity it has: "<wclZoneId>|id|<wclEncounterId>" when the
// saved boss carries one (Season Settings' "Fetch from WCL" button), falling
// back to "<wclZoneId>|<normalised boss name>" for
// manually-added bosses and rows saved before that field existed. The
// name-only key used to be the sole lookup, which meant renaming a boss's
// display name in Season Settings (without also renaming it identically on
// WCL) silently broke the join to team_raid_progress -- the id key doesn't
// have that problem since it can't drift when only the label changes.
function mapSupabaseRaidProgress(rows) {
  var map = {};
  (rows || []).forEach(function (row) {
    var encounter = row.raid_encounters || {};
    var zone = encounter.raid_zones || {};
    var name = normalise(encounter.name || '');
    if (!zone.wcl_zone_id) return;
    var progress = {
      pulls: row.mythic_pulls,
      bestPct: row.mythic_best_pct,
      reportCode: row.mythic_report_code,
      fightId: row.mythic_fight_id,
      heroicDate: row.heroic_date,
      heroicPulls: row.heroic_pulls,
      heroicBestPct: row.heroic_best_pct,
      heroicReportCode: row.heroic_report_code,
      heroicFightId: row.heroic_fight_id
    };
    if (encounter.wcl_encounter_id != null) {
      map[zone.wcl_zone_id + '|id|' + encounter.wcl_encounter_id] = progress;
    }
    if (name) map[zone.wcl_zone_id + '|' + name] = progress;
  });
  return map;
}

// Maps self_received_requests rows to the DATA.selfReceived shape the Apps
// Script heavy chunk emits (firstName -> array of {item, slot, source}), so
// no render code changes. source is rebuilt as "Track: source" to match the
// combined string submitSelfReceivedRequest/submitDirectMarkReceived used to
// send GAS as one field, since getSelfReceivedItems()'s callers display it
// as a single badge.
function mapSupabaseSelfReceived(rows) {
  var map = {};
  (rows || []).forEach(function (row) {
    var players = row.players || {};
    var nameRealm = String(players.name_realm || '').trim();
    if (!nameRealm) return;
    var firstName = nameRealm.split('-')[0].trim();
    var itemRow = row.items || {};
    if (!itemRow.name) return;
    var diff = row.track === 'Myth' ? 'Mythic' : row.track === 'Hero' ? 'Heroic' : row.track || '';
    if (!map[firstName]) map[firstName] = [];
    map[firstName].push({
      item: itemRow.name,
      slot: itemRow.slot || '',
      source: (diff ? diff + ': ' : '') + (row.source || '')
    });
  });
  return map;
}

// Priority order reads come from Supabase (#220). priority_order carries its
// own team_id (unlike bis_items), so no join-through-players filter is
// needed. Not season-filtered here -- same reason fetchSupabaseLoot() isn't:
// this promise fires before DATA.seasonName is known (in parallel with the
// core chunk), so the season filter is applied downstream in
// mapSupabasePriorityOrder() once DATA is populated. Resolves to the raw
// rows, or null on any failure/empty so the caller falls back to the Apps
// Script heavy chunk's priorityOrder.
// Team-wide "may be stale" check: a saved Mythic #1 whose player has
// already been awarded the Heroic version of that exact item (see
// priority_order_stale_after_heroic in
// 20260713150512_priority_order_fairness_warnings.sql). Not season-filtered
// here for the same reason fetchSupabasePriorityOrder() isn't -- this
// promise fires before DATA.seasonName is known, so the season filter is
// applied downstream in applyHeavyData() once DATA is populated. Resolves
// to raw rows, or [] on any failure so the nav badge just shows nothing
// rather than erroring.
function fetchSupabasePriorityStaleAfterHeroic() {
  if (!supabaseClient) return Promise.resolve([]);
  return supabaseClient
    .from('priority_order_stale_after_heroic')
    .select('*')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(
      function (result) {
        if (result.error) {
          console.warn('Supabase priority_order_stale_after_heroic query failed.', result.error.message);
          return [];
        }
        return result.data || [];
      },
      function (err) {
        console.warn('Supabase priority_order_stale_after_heroic query failed.', err);
        return [];
      }
    );
}

// Team-wide "who currently holds a live #1" rows -- the same source the
// Priority Edit modal's fairness warning queries per-item (see
// prioEditFetchFairnessWarnings and 20260713150512_priority_order_fairness_
// warnings.sql). Fetched with item_name/boss already joined so the Priority
// List conflict banner can name the actual items/players involved instead of
// just a count from priority_order_same_boss_conflicts /
// priority_order_first_prio_counts. Not season-filtered here for the same
// reason fetchSupabasePriorityStaleAfterHeroic() isn't -- filtered downstream
// in applyHeavyData() instead. Resolves to raw rows, or [] on any failure so
// the badge just shows nothing rather than erroring.
function fetchSupabasePriorityLiveFirstPrios() {
  if (!supabaseClient) return Promise.resolve([]);
  return supabaseClient
    .from('priority_order_live_first_prios')
    .select('season, player_id, name_realm, item_id, item_name, track, boss')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(
      function (result) {
        if (result.error) {
          console.warn('Supabase priority_order_live_first_prios query failed.', result.error.message);
          return [];
        }
        return result.data || [];
      },
      function (err) {
        console.warn('Supabase priority_order_live_first_prios query failed.', err);
        return [];
      }
    );
}

function fetchSupabasePriorityOrder() {
  if (!supabaseClient) return Promise.resolve(null);
  var query = supabaseClient
    .from('priority_order')
    .select('item_id, track, rank, season, items(name), players(name_realm)')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(
      function (result) {
        if (result.error) {
          console.warn('Supabase priority_order query failed.', result.error.message);
          return null;
        }
        return result.data && result.data.length ? result.data : null;
      },
      function (err) {
        console.warn('Supabase priority_order query failed.', err);
        return null;
      }
    );
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(null);
    }, 10000);
  });
  return Promise.race([query, timeout]);
}

// Top-3 saved-vs-current mismatches after a scoring change, so a saved
// priority order doesn't silently go stale once a player's performance
// moves. Unlike the other
// priority_* fetches above, this isn't part of the initial parallel DATA
// load -- it's officer-only, only relevant once a scoring commit has
// happened, and needs an explicit season (the RPC has no unfiltered "give
// me everything" mode the way the plain-table/view fetches do). Called from
// tab-priority.js's refreshPriorityDriftBadge(), same lazy-fetch-then-cache
// shape as fetchTeamItemPreferences(). Resolves to [] on any failure so the
// badge just shows nothing rather than erroring.
function fetchSupabasePriorityDrift(teamId, season) {
  if (!supabaseClient) return Promise.resolve([]);
  return supabaseClient.rpc('check_priority_order_drift', { p_team_id: teamId, p_season: season }).then(
    function (result) {
      if (result.error) {
        console.warn('Supabase check_priority_order_drift query failed.', result.error.message);
        return [];
      }
      return result.data || [];
    },
    function (err) {
      console.warn('Supabase check_priority_order_drift query failed.', err);
      return [];
    }
  );
}

/**
 * Maps priority_order rows (filtered to the current season) to the
 * DATA.priorityOrder shape the Apps Script heavy chunk emits:
 * {itemName: {heroic: [identity...], mythic: [identity...]}}, ordered by
 * rank. Each identity is the full name_realm (#529, companion to #359's loot
 * re-keying) rather than first name alone -- the underlying
 * generate_priority_order()/priority_order table are already player_id-keyed
 * and collision-free; this is what makes the frontend's bridge to them
 * (tab-priority.js's ranked list, pool, and save path) collision-free too.
 * @param {any[]} rows - priority_order rows with embedded items and players
 * @param {string} seasonCode - current season's shorthand code (e.g. 'MID1') to filter rows to --
 *   NOT DATA.seasonName directly, which is Apps Script's free-text display label; pass it through
 *   seasonCodeForDisplay() first, same as priority_order.season/scoring.season/rclc_loot.season all store.
 * @returns {Object<string, {heroic?: string[], mythic?: string[]}>}
 */
function mapSupabasePriorityOrder(rows, seasonCode) {
  /** @type {Object<string, {heroic?: string[], mythic?: string[]}>} */
  var result = {};
  (rows || [])
    .filter(function (row) {
      return row.season === seasonCode;
    })
    .sort(function (a, b) {
      return a.rank - b.rank;
    })
    .forEach(function (row) {
      var itemName = row.items && row.items.name ? String(row.items.name).trim() : '';
      var nameRealm = row.players && row.players.name_realm ? String(row.players.name_realm).trim() : '';
      if (!itemName || !nameRealm) return;
      var diff = row.track === 'Myth' ? 'mythic' : row.track === 'Hero' ? 'heroic' : null;
      if (!diff) return;
      if (!result[itemName]) result[itemName] = {};
      if (!result[itemName][diff]) result[itemName][diff] = [];
      result[itemName][diff].push(nameRealm);
    });
  return result;
}

// Season config reads come from Supabase (#221): team_settings.config is the
// one jsonb blob holding everything that used to be Script Properties keys
// (season name/dates/history, raid progression, trial thresholds, the
// signup/BiS/M+ toggles, the active signup season). Fires in parallel with
// the core chunk, same as fetchSupabaseRoster(); applyTeamSettingsToData()
// overlays it onto DATA once both are in, falling back to whatever the Apps
// Script core payload already put there (still Script Properties, until the
// live rows are backfilled) if the row is missing or a key isn't set yet.
function fetchSupabaseSettings() {
  if (!supabaseClient) return Promise.resolve(null);
  var query = supabaseClient
    .from('team_settings')
    .select('config')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .maybeSingle()
    .then(
      function (result) {
        if (result.error) {
          console.warn('Supabase team_settings query failed.', result.error.message);
          return null;
        }
        return result.data ? result.data.config : null;
      },
      function (err) {
        console.warn('Supabase team_settings query failed.', err);
        return null;
      }
    );
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(null);
    }, 10000);
  });
  return Promise.race([query, timeout]);
}

var SEASON_CONFIG_KEYS = [
  'seasonName',
  'seasonStart',
  'seasonEnd',
  'seasonHistory',
  'raidProgression',
  'trialWeeks',
  'trialAttend',
  'signupsOpen',
  'bisSubmissionsOpen',
  'mPlusExclusionsOpen',
  'wishlistOpen',
  // The season an officer is actively planning/prepping item catalog/BiS/
  // wishlist scope for (#549), separate from seasonName (the live raiding
  // season) and deliberately NOT shared with signups -- signup lead time and
  // item-catalog-prep lead time don't move together in practice (signups for
  // the next tier routinely open while the current tier is still being
  // raided; #549 originally bundled the two under one setting, but that
  // meant opening next-season signups also flipped every raider's Priority
  // tab/BiS/Wishlist to next season's still-incomplete catalog mid-raid --
  // corrected same day, see docs/database-decisions.md). Nullable, resolved
  // via resolveSeasonView() below.
  'seasonView',
  // Officer-set target roster sizes, shown as a signup-time advisory
  // (js/signup.js's buildSignupRoleAdvisoryHtml()) once the confirmed
  // roster + already-approved incoming roster meets or exceeds either
  // count. Unset/0 means no target configured -- the advisory just shows
  // the plain count with no "we have enough" nudge.
  'targetTankCount',
  'targetHealCount'
];

/**
 * Overlays team_settings.config onto DATA, key by key, so a config missing a
 * given key (not backfilled yet, or a brand-new team) keeps whatever the Apps
 * Script core payload already set for it instead of clobbering it with
 * undefined. activeSignupSeason maps to DATA.signupSeason, matching the Apps
 * Script field name tab-season.js already reads/writes.
 * @param {any} data - the DATA object being built from the core chunk
 * @param {Object|null} config - team_settings.config, or null if the query failed/found nothing
 */
function applyTeamSettingsToData(data, config) {
  if (!config) return;
  SEASON_CONFIG_KEYS.forEach(function (key) {
    if (config[key] !== undefined) data[key] = config[key];
  });
  if (config.activeSignupSeason !== undefined) data.signupSeason = config.activeSignupSeason;
  data.features = config.features || {};
  data.externalLinks = config.externalLinks || {};
  data.teamOfficerBios = config.teamOfficerBios || [];
  // guildOfficerBios is guild-wide (site_settings, heavy-loaded in loadData()),
  // not sourced from any one team's config -- see fetchSupabaseGuildOfficerBios().
  data.wishlistStatusLabels = config.wishlistStatusLabels || {};
}

// Per-team feature flags (#231). Missing key -- either DATA.features itself
// (no team has ever saved any) or one flag within it -- reads as enabled;
// unset has to mean "on" or every existing team goes dark the moment this
// ships, since no team has ever had occasion to set these before now. Same
// fallback js/admin.js's site-admin panel already uses.
function featureEnabled(key) {
  var features = DATA && DATA.features;
  if (!features || !(key in features)) return true;
  return !!features[key];
}

/**
 * Merges p_updates into team_settings.config for the current team and
 * returns the new config, mirroring the old jsonpRequest(...&action=set...)
 * callback pattern but via the set_team_setting RPC (#221). Restricted to
 * team_leader/site_admin by the "Team leaders write settings" RLS policy.
 * set_team_setting logs its own generic 'team_setting_updated' audit_log
 * entry for every call by default -- pass skipAudit: true when the caller is
 * about to write its own friendlier-named entry for this same save (e.g.
 * "M+ Exclusions Closed"), so the Audit Log tab doesn't show both for one
 * user action. Leave it false for anything with no friendly entry of its own
 * (feature flags, seasonView, etc.) so it keeps its only audit trail.
 * @param {Object} updates
 * @param {boolean} [skipAudit]
 * @returns {Promise<Object>}
 */
function saveTeamSetting(updates, skipAudit) {
  // #607: team_settings (season settings, per-team bios, and every
  // open/close toggle that rides this same path) stays excluded for a
  // guild-officer-only visitor -- the "Team leaders write settings" RLS
  // policy deliberately never gets is_guild_officer() OR'd in, so this
  // would fail server-side ('Not authorized') regardless; this is just a
  // clean client-side no-op instead of a round trip that's guaranteed to
  // error, and it's a single choke point for every caller of this function.
  if (window._guildOfficerAccessLevel === 'guild') {
    return Promise.reject(new Error('Not authorized'));
  }
  // Promise.resolve() unwraps the builder's PromiseLike into a real Promise
  // (same resolution, no behavior change) -- needed since callers across
  // js/tabs/ chain .catch() onto this.
  return Promise.resolve(
    supabaseClient
      .rpc('set_team_setting', {
        p_team_id: _teamCfg.supabaseTeamId,
        p_updates: updates,
        p_skip_audit: !!skipAudit
      })
      .then(function (result) {
        if (result.error) throw new Error(result.error.message);
        return result.data;
      })
  );
}

// raid_zones.wcl_zone_id <-> season mapping (#285, #549) -- the same
// team-agnostic table #285's WCL progress sync writes to, reused here as the
// source of truth for isItemInSeasonScope()/currentZoneIdsForSeason() and
// for the Season View dropdown's option list, instead of a team's own
// (WCL-tracking-only) raidProgression. Resolves to [] on any failure/empty.
function fetchSupabaseRaidZones() {
  if (!supabaseClient) return Promise.resolve([]);
  return supabaseClient
    .from('raid_zones')
    .select('wcl_zone_id, season')
    .then(
      function (result) {
        if (result.error) {
          console.warn('Supabase raid_zones query failed.', result.error.message);
          return [];
        }
        return (result.data || []).map(function (row) {
          return { wclZoneId: row.wcl_zone_id, season: row.season };
        });
      },
      function (err) {
        console.warn('Supabase raid_zones query failed.', err);
        return [];
      }
    );
}

// Item catalog reads come exclusively from Supabase (#391): the GAS "Item
// Lookup" sheet is retired as a data source for the web app now that
// scripts/fetch-items.js seeds items/item_bosses from Wowhead every tier
// (docs/updating-fetch-items-for-new-tier.md). items is a global,
// un-team-scoped reference table -- no auth needed, RLS already permits
// public read. Resolves to the raw rows, or null on any failure/empty so
// the caller renders an empty catalog rather than silently serving stale
// GAS data.
function fetchSupabaseItems() {
  if (!supabaseClient) return Promise.resolve(null);
  var query = supabaseClient
    .from('items')
    .select(
      'id, wow_item_id, name, slot, armor_type, is_placeholder, icon, wcl_zone_id, secondary_stats, main_stats, weapon_subtype, is_ptr'
    )
    .then(
      function (result) {
        if (result.error) {
          console.warn('Supabase items query failed.', result.error.message);
          return null;
        }
        return result.data && result.data.length ? result.data : null;
      },
      function (err) {
        console.warn('Supabase items query failed.', err);
        return null;
      }
    );
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(null);
    }, 10000);
  });
  return Promise.race([query, timeout]);
}

// item_bosses shares the same retirement (#391): joined through items for
// the item name, since tab-priority.js's boss filter indexes DATA.itemBosses
// by item name. Resolves to the raw rows, or null on any failure/empty.
function fetchSupabaseItemBosses() {
  if (!supabaseClient) return Promise.resolve(null);
  var query = supabaseClient
    .from('item_bosses')
    .select('boss, items(name)')
    .then(
      function (result) {
        if (result.error) {
          console.warn('Supabase item_bosses query failed.', result.error.message);
          return null;
        }
        return result.data && result.data.length ? result.data : null;
      },
      function (err) {
        console.warn('Supabase item_bosses query failed.', err);
        return null;
      }
    );
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(null);
    }, 10000);
  });
  return Promise.race([query, timeout]);
}

// Midnight Season 2's tier gear doesn't drop as the wearable class piece --
// bosses drop a generic per-armor-type token (e.g. "Venomwoven Idol"), which
// resolves to a class's actual named tier item (e.g. "Damned Necrolyte's
// Charred Grasps") only once redeemed via catalyst. tier_token_map (see
// supabase/migrations/20260804013135_tier_token_map.sql) is the lookup the
// Wishlist uses to display the resolved item instead of the token -- the
// underlying item_preferences.item_id a raider tags stays on the token
// throughout, matching what rclc_loot actually logs, so priority generation
// needs no changes. Two FKs to items (token + resolved) need the `!<fkey>`
// disambiguation hint since Postgrest can't otherwise tell which one a bare
// `items(name)` embed refers to.
function fetchSupabaseTierTokenMap() {
  if (!supabaseClient) return Promise.resolve(null);
  var query = supabaseClient
    .from('tier_token_map')
    .select(
      'class, token:items!tier_token_map_token_item_id_fkey(name), resolved:items!tier_token_map_resolved_item_id_fkey(name)'
    )
    .then(
      function (result) {
        if (result.error) {
          console.warn('Supabase tier_token_map query failed.', result.error.message);
          return null;
        }
        return result.data && result.data.length ? result.data : null;
      },
      function (err) {
        console.warn('Supabase tier_token_map query failed.', err);
        return null;
      }
    );
  var timeout = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(null);
    }, 10000);
  });
  return Promise.race([query, timeout]);
}

// { tokenItemName: { class: resolvedItemName } } -- wishlistBucketRealItems
// (js/wishlist.js) looks up the viewing raider's class here to swap a token
// row's displayed name for their class's resolved tier item.
//
// Also returns tierResolvedItemNames -- the 65 resolved items are real rows
// in `items` (they need their own name/icon/stats for itemNameBlockHtml to
// find), so without this they'd independently pass every wishlist/BiS
// catalog filter and show up a *second* time as their own row, alongside the
// token row that's been substituted to display the same name. Both
// wishlistBucketRealItems and tab-bis.js's bisSlotOnInput skip any name in
// this set when walking the full catalog -- a resolved item should only ever
// be reachable by substitution through its token, never listed directly.
function mapSupabaseTierTokenMap(rows) {
  var map = {};
  var resolvedNames = {};
  (rows || []).forEach(function (row) {
    var tokenName = row.token && row.token.name;
    var resolvedName = row.resolved && row.resolved.name;
    if (!tokenName || !resolvedName || !row.class) return;
    if (!map[tokenName]) map[tokenName] = {};
    map[tokenName][row.class] = resolvedName;
    resolvedNames[resolvedName] = true;
  });
  return { map: map, resolvedNames: resolvedNames };
}

// Builds the DATA.itemSlots/itemArmorTypes maps (name -> slot / name ->
// armor_type) straight from Supabase's items rows -- no GAS merge, per #391.
// Placeholder rows (M+, Crafted, Catalyst -- items.slot is NOT NULL, so those
// stand-ins store the literal string 'Placeholder' since they name a loot
// source rather than a gear slot) map to '' here rather than surfacing that
// sentinel as if it were a real slot name in the UI.
function buildItemMaps(rows) {
  var itemSlots = {};
  var itemArmorTypes = {};
  var itemPlaceholders = {};
  var itemIds = {};
  var itemWowIds = {};
  var itemIcons = {};
  var itemZones = {};
  var itemSecondaryStats = {};
  var itemMainStats = {};
  var itemWeaponSubtypes = {};
  var itemIsPtr = {};
  (rows || []).forEach(function (row) {
    var name = String(row.name || '').trim();
    if (!name) return;
    itemSlots[name] = row.is_placeholder ? '' : row.slot || '';
    if (row.armor_type) itemArmorTypes[name] = row.armor_type;
    if (row.is_placeholder) itemPlaceholders[name] = true;
    if (row.id != null) itemIds[name] = row.id;
    if (row.wow_item_id != null) itemWowIds[name] = row.wow_item_id;
    if (row.icon) itemIcons[name] = row.icon;
    if (row.wcl_zone_id != null) itemZones[name] = row.wcl_zone_id;
    if (row.secondary_stats) itemSecondaryStats[name] = row.secondary_stats;
    if (row.main_stats) itemMainStats[name] = row.main_stats;
    if (row.weapon_subtype) itemWeaponSubtypes[name] = row.weapon_subtype;
    if (row.is_ptr) itemIsPtr[name] = true;
  });
  return {
    itemSlots: itemSlots,
    itemArmorTypes: itemArmorTypes,
    itemPlaceholders: itemPlaceholders,
    itemIds: itemIds,
    itemWowIds: itemWowIds,
    itemIcons: itemIcons,
    itemZones: itemZones,
    itemSecondaryStats: itemSecondaryStats,
    itemMainStats: itemMainStats,
    itemWeaponSubtypes: itemWeaponSubtypes,
    itemIsPtr: itemIsPtr
  };
}

// Short display labels for items.secondary_stats' Blizzard-enum values (#560),
// matching a similar tool's (Viserio) pill wording -- "Crit"/"Haste" etc, not
// the full "Crit Rating" -- since these are meant to read as compact badges,
// not full stat names.
var STAT_PILL_LABELS = {
  CRIT_RATING: 'Crit',
  HASTE_RATING: 'Haste',
  MASTERY_RATING: 'Mastery',
  VERSATILITY: 'Vers'
};

// Builds the small muted stat-pill badges (#561) from a
// DATA.itemSecondaryStats[name] array. Empty/missing (still-null column, or
// an item confirmed to roll none, e.g. most trinkets) renders no pills.
function statPillListHtml(types) {
  return (types || [])
    .map(function (type) {
      var label = STAT_PILL_LABELS[type];
      return label ? '<span class="stat-pill">' + label + '</span>' : '';
    })
    .join('');
}

// Icon + Epic-purple name on one line, then slot/stat-pills/boss on a second
// (#561) -- shared by the Priority tab (js/tabs/tab-priority.js) and the
// raider Wishlist (js/wishlist.js, previously its own near-identical
// wishlistItemNameHtml() before the Priority restyle needed the same
// treatment plus stat pills) so both stay pixel-identical rather than
// drifting apart as two copies. Epic purple is hardcoded, not data-driven:
// raid drops are effectively always Epic quality, so there's no per-item
// value worth fetching/storing just to reproduce the one color every item
// already gets.
//
// The icon <img> is drawn from our own items.icon column (populated by
// scripts/fetch-items.js from Wowhead's item XML) rather than depending on
// the Wowhead tooltip widget rendering one -- that widget only works when its
// external script actually loads, which ad-blockers commonly block for
// wow.zamimg.com specifically (#515 follow-up, confirmed live: the widget
// silently no-ops and item names rendered as bare unstyled links). The
// wowhead-class link is kept around the icon+name anyway as a bonus hover
// tooltip for whoever's browser does let it load; index.html/officer.html set
// window.whTooltips = {colorLinks:true, iconizeLinks:true} before that
// script, so real rarity coloring layers on top when it works.
//
// The link itself points at /ptr/item=<id> instead of the bare /item=<id>
// for items.is_ptr items -- same root cause as #560's Blizzard/Wowhead
// backend fetch gap, but on the client side this time: the Wowhead tooltip
// widget resolves a bare wowhead.com/item=<id> link against live data only,
// so a still-PTR item's hover tooltip would show empty/wrong stats even
// though scripts/fetch-item-stats.js already has the real data server-side.
function itemNameBlockHtml(name, slot) {
  var wowId = ((DATA && DATA.itemWowIds) || {})[name];
  var isPtr = ((DATA && DATA.itemIsPtr) || {})[name];
  var icon = ((DATA && DATA.itemIcons) || {})[name];
  var boss = ((DATA && DATA.itemBosses) || {})[name];
  var stats = ((DATA && DATA.itemSecondaryStats) || {})[name];
  var armorType = ((DATA && DATA.itemArmorTypes) || {})[name];
  var isTierItem = !!((DATA && DATA.tierResolvedItemNames) || {})[name];
  var iconImg = icon
    ? '<img src="https://wow.zamimg.com/images/wow/icons/large/' + icon + '.jpg" alt="" class="item-icon-lg">'
    : '';

  // Boss gets its own (third) line rather than sharing the slot/pills line --
  // at this card's fixed width, a long encounter name (e.g. "The Lost
  // Explorers") wrapped mid-line looked broken next to the pills instead of
  // just flowing onto a clean line of its own.
  var slotPillsParts = [];
  if (slot) slotPillsParts.push('<span style="color:' + getSlotColor(slot) + ';">' + slot + '</span>');
  // Visual guide only, no filtering behavior -- weapons/trinkets/jewelry have
  // no armor_type at all (items.armor_type is only set for armor pieces), so
  // this only appears on rows where it's actually meaningful.
  if (armorType)
    slotPillsParts.push('<span style="color:' + getArmorTypeColor(armorType) + ';">' + armorType + '</span>');
  // Flags a resolved tier-set class piece (see mapSupabaseTierTokenMap) --
  // these are only ever reached via a token's substitution, so nothing else
  // marks them as tier gear the way Wowhead/Viserio's own "Tier" badge does.
  // Sits before the stat pills so it reads next to the slot/armor type, not
  // buried after the Crit/Haste/etc badges.
  if (isTierItem) slotPillsParts.push('<span class="tier-pill">TIER</span>');
  var pills = statPillListHtml(stats);
  if (pills) slotPillsParts.push(pills);
  var slotPillsLine = slotPillsParts.length
    ? '<span class="item-detail-line">' +
      slotPillsParts.join('<span class="item-detail-sep">&middot;</span>') +
      '</span>'
    : '';
  var bossLine = boss ? '<span class="item-detail-line">' + boss + '</span>' : '';

  // Icon sits beside the whole text stack (name + detail lines), not just
  // inline with the name, so it's sized to match their combined height
  // rather than looking cramped next to just the first line.
  var textStack =
    '<span style="display:flex;flex-direction:column;min-width:0;">' +
    '<span style="color:#a335ee;font-weight:600;">' +
    name +
    '</span>' +
    slotPillsLine +
    bossLine +
    '</span>';
  // flex-basis matches min-width (rather than "flex:1"'s implicit 0%) so the
  // wrap calculation actually accounts for this column's floor size instead
  // of assuming it starts at zero width -- with a 0% basis, a wide sibling
  // (e.g. a status-button row) never triggers a wrap onto its own line, so
  // this column gets squeezed below min-width instead and the item name text
  // wraps mid-word (exposed by #515's wider custom wishlist status labels).
  var rowStyle = 'display:flex;align-items:center;gap:0.5rem;flex:1 1 12rem;min-width:12rem;';
  if (wowId == null) {
    return '<span style="' + rowStyle + '">' + iconImg + textStack + '</span>';
  }
  // The wowhead widget's hover-tooltip positioning anchors off the hovered
  // element's own bounding box, not raw cursor coordinates -- confirmed by
  // reading power.js directly after a live report of every item's tooltip
  // rendering at the same fixed horizontal position regardless of cursor,
  // reproducible across browsers/machines (not a browser/extension quirk).
  // flex:1 directly on the <a> (rowStyle, same as the no-wowId span above)
  // stretched the actual hover target to span the whole row -- every row's
  // element then shared the same right edge, so the widget's element-based
  // anchor was identical row to row (only vertical position, which does
  // still vary per row's own top, looked correct). flex:1/min-width stay on
  // a non-interactive wrapper for layout; the <a> itself sizes to just its
  // visible icon+text content so the widget anchors off the right place.
  return (
    '<span style="' +
    rowStyle +
    '">' +
    '<a href="https://www.wowhead.com/' +
    (isPtr ? 'ptr/' : '') +
    'item=' +
    wowId +
    '" class="wowhead" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:0.5rem;min-width:0;text-decoration:none;">' +
    iconImg +
    textStack +
    '</a>' +
    '</span>'
  );
}

// Maps item_bosses rows (joined through items) to the DATA.itemBosses shape
// the GAS heavy chunk used to emit: item name -> single boss string.
function mapSupabaseItemBosses(rows) {
  var map = {};
  (rows || []).forEach(function (row) {
    var name = row.items && row.items.name ? String(row.items.name).trim() : '';
    var boss = String(row.boss || '').trim();
    if (name && boss) map[name] = boss;
  });
  return map;
}

// Attendance reads come from Supabase's normalized `attendance` table (#223
// stage 3) instead of GAS's heavy attendanceDetails/rawAttendanceData/
// recentAttendanceTrend payload: refreshAttendance (wcl-sync Edge Function)
// writes into this table now instead of the GAS Attendance sheet those were
// read from, so that sheet -- and everything derived from it -- stops
// updating the moment this ships. Falls back to the GAS heavy payload only
// if the Supabase query itself fails/times out (resultRows === null); an
// empty-but-successful result is trusted as genuinely no data yet, not
// reached around, since Supabase is authoritative for attendance from here on.
// No timeout race against the GAS heavy payload here, unlike this repo's
// other fetchSupabaseX() helpers -- for those, a slow query racing a stale-
// but-still-updating GAS fallback is a reasonable tradeoff. For attendance,
// the GAS fallback is permanently frozen (refreshAttendance stopped writing
// to that sheet), so silently substituting it on mere slowness would swap
// correct data for confidently-wrong data instead of just being slow. Only
// a genuine query failure (caught below) falls back.
//
// Paginated (PostgREST caps an unpaginated select at 1000 rows server-side):
// a season or two of attendance easily exceeds that for an active team, and
// without an explicit order, which 1000 rows come back on any given request
// isn't even guaranteed stable -- silently truncating produced different,
// wrong attendance percentages on different page loads instead of an
// obvious failure.
var ATTENDANCE_FETCH_PAGE_SIZE = 1000;
function fetchSupabaseAttendanceRaw() {
  if (!supabaseClient) return Promise.resolve(null);

  function fetchPage(offset, accumulated) {
    return supabaseClient
      .from('attendance')
      .select('player_id, raid_date, status, report_excluded')
      .eq('team_id', _teamCfg.supabaseTeamId)
      .order('id', { ascending: true })
      .range(offset, offset + ATTENDANCE_FETCH_PAGE_SIZE - 1)
      .then(function (result) {
        if (result.error) {
          console.warn('Supabase attendance query failed.', result.error.message);
          return null;
        }
        var rows = result.data || [];
        var all = accumulated.concat(rows);
        if (rows.length < ATTENDANCE_FETCH_PAGE_SIZE) return all;
        return fetchPage(offset + ATTENDANCE_FETCH_PAGE_SIZE, all);
      });
  }

  return fetchPage(0, []).catch(function (err) {
    console.warn('Supabase attendance query failed.', err);
    return null;
  });
}

// Builds the {raidDates, players, joinDates} shape GAS's getRawAttendanceData
// used to emit, from raw attendance rows + the already-loaded roster.
// Excluded reports are dropped entirely (never count as raid nights),
// matching GAS's exclude-checkbox handling.
function mapSupabaseAttendanceRaw(rows, roster) {
  var byId = {};
  (roster || []).forEach(function (p) {
    byId[p.id] = p;
  });

  var raidDateSet = {};
  var players = {};
  (rows || []).forEach(function (row) {
    if (row.report_excluded) return;
    var p = byId[row.player_id];
    if (!p) return;
    raidDateSet[row.raid_date] = true;
    if (!players[p.firstName]) players[p.firstName] = [];
    players[p.firstName].push({ date: row.raid_date, status: row.status });
  });

  Object.keys(players).forEach(function (name) {
    players[name].sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });
  });

  var joinDates = {};
  (roster || []).forEach(function (p) {
    if (p.joinDate) joinDates[p.firstName] = p.joinDate;
  });

  return { raidDates: Object.keys(raidDateSet).sort(), players: players, joinDates: joinDates };
}

// Matches GAS's getAttendanceDetails: only the "penalizing" statuses.
function mapSupabaseAttendanceDetails(rawPlayers) {
  var details = {};
  Object.keys(rawPlayers || {}).forEach(function (name) {
    var penalties = rawPlayers[name].filter(function (r) {
      return (
        r.status === 'No Show' ||
        r.status === 'Excused' ||
        r.status === 'Late (with notice)' ||
        r.status === 'Late (no notice)'
      );
    });
    if (penalties.length) details[name] = penalties;
  });
  return details;
}

// Matches GAS's getRecentAttendanceTrend: full history minus Not on Roster.
function mapSupabaseAttendanceTrend(rawPlayers) {
  var trend = {};
  Object.keys(rawPlayers || {}).forEach(function (name) {
    var nights = rawPlayers[name].filter(function (r) {
      return r.status !== 'Not on Roster';
    });
    if (nights.length) trend[name] = nights;
  });
  return trend;
}

// Shared by the roster table's Attendance column, the player profile card's
// attendance bar (both below), and the Attendance tab's "Commit Attendance
// Scores" (js/tabs/tab-attendance.js), so all four represent the same
// metric. Lives here rather than officer.js because the profile card is
// shared by index.html (public) and officer.html -- index.html never loads
// officer.js. "Not on Roster" and any night with no row at all are excluded
// from both numerator and denominator (not weighted 0 -- see
// gs/Attendance.gs's ATTENDANCE_WEIGHTS this ports).
var ATTENDANCE_WEIGHTS_JS = {
  Present: 1.0,
  Bench: 1.0,
  'Medical Leave': 1.0,
  'Extended Leave': 1.0,
  Excused: 0.8,
  'Late (with notice)': 0.9,
  'Late (no notice)': 0.5,
  'No Show': 0.0
};

// Returns { start, end } date strings for the active season, or { start: null, end: null }
function getSeasonDateRange() {
  if (!ACTIVE_SEASON) return { start: null, end: null };
  var history = (DATA && DATA.seasonHistory) || [];
  var current = (DATA && DATA.seasonName) || '';
  var all = history.slice();
  if (current) all.push({ name: current, start: DATA.seasonStart || '', end: DATA.seasonEnd || '' });
  for (var i = 0; i < all.length; i++) {
    if (all[i].name === ACTIVE_SEASON) {
      return { start: all[i].start || null, end: all[i].end || null };
    }
  }
  return { start: null, end: null };
}

// Computes attendance % for a player for the active season from rawAttendanceData.
// Returns a string like "95.0%", "100.0%" for a player with no recorded
// nights yet, or null only if rawAttendanceData itself failed to load.
//
// Denominator is this player's own recorded nights only (status !== 'Not on
// Roster'), same as executeCommitScores' scoring.attendance_pct calculation
// (js/tabs/tab-attendance.js) -- a team-wide raid-night count was ported
// from GAS's buildAttendanceMap here initially, but that counted any night
// this player has no row for at all (WCL didn't find them, not bench-
// flagged, no officer override yet) as an implicit zero, silently dragging
// the percentage down for nights nobody ever actually marked them absent
// for. GAS itself was inconsistent about this (its commit-to-Scoring
// calculation already used the player's own night count, not the team's) --
// this makes both agree on the same definition.
function computeSeasonAttendancePct(firstName) {
  var raw = DATA && DATA.rawAttendanceData;
  if (!raw) return null;

  var range = getSeasonDateRange();
  var start = range.start;
  var end = range.end;
  var playerRecs = (raw.players || {})[firstName] || [];
  var joinDate = (raw.joinDates || {})[firstName] || '';

  // Determine this player's effective start within the season
  var effectiveStart = joinDate && (!start || joinDate > start) ? joinDate : start || '';

  var eligibleRecs = playerRecs.filter(function (r) {
    return (
      (!effectiveStart || r.date >= effectiveStart) &&
      (!start || r.date >= start) &&
      (!end || r.date <= end) &&
      r.status !== 'Not on Roster' &&
      // A row with no status yet (source 'WCL (Late?)' -- flagged as a
      // probable late arrival, pending an officer's Late (with/no notice)
      // classification) shouldn't silently score as a 0.0-weight miss while
      // it sits unreviewed -- same treatment as a night with no row at all.
      r.status
    );
  });
  // A player with zero recorded nights yet (brand-new roster add) hasn't
  // missed anything -- default to full credit rather than 0%, which would
  // otherwise read as a red flag before they've had a single chance to raid.
  if (!eligibleRecs.length) return '100.0%';

  var sum = eligibleRecs.reduce(function (acc, r) {
    var w = ATTENDANCE_WEIGHTS_JS[r.status];
    return acc + (w != null ? w : 0);
  }, 0);

  return (Math.round((sum / eligibleRecs.length) * 1000) / 10).toFixed(1) + '%';
}

// Returns attendance % for a player: prefers computed value from rawAttendanceData
// (works for any season, including All Seasons); falls back to server p.attendance.
function getDisplayAttendancePct(player) {
  if (DATA && DATA.rawAttendanceData) {
    var computed = computeSeasonAttendancePct(player.firstName);
    if (computed !== null) return computed;
  }
  return player.attendance || '0%';
}

// onCoreReady fires once the fast core chunk is loaded and the page can render.
// onHeavyReady (optional) fires once loot/attendance/BiS/priority data arrives.
function loadData(onCoreReady, onHeavyReady) {
  var loadingEl = document.getElementById('loadingMsg');
  function showError(msg) {
    if (loadingEl) {
      loadingEl.className = 'state-msg error';
      loadingEl.innerHTML = msg;
    }
  }

  // Fired in parallel with the core chunk; the core callback waits for it.
  var rosterPromise = fetchSupabaseRoster();
  // Fired alongside; the core callback waits for it before overlaying season config.
  var settingsPromise = fetchSupabaseSettings();
  // Fired alongside; the core callback waits for it before mapping the roster's M+ rejection badges.
  var mplusRejectionsPromise = fetchSupabaseMPlusRejections();
  // Fired alongside; the heavy callback waits for it before setting lootCounts.
  var lootPromise = fetchSupabaseLoot();
  // Fired alongside; the heavy callback waits for it before setting bisList.
  var bisItemsPromise = fetchSupabaseBisItems();
  // Fired alongside; the heavy callback waits for it before setting itemSlots.
  var itemsPromise = fetchSupabaseItems();
  // Fired alongside; the heavy callback waits for it before setting itemBosses.
  var itemBossesPromise = fetchSupabaseItemBosses();
  // Fired alongside; the heavy callback waits for it before setting tierTokenMap.
  var tierTokenMapPromise = fetchSupabaseTierTokenMap();
  // Fired alongside; the heavy callback waits for it before setting priorityOrder.
  var priorityOrderPromise = fetchSupabasePriorityOrder();
  // Fired alongside; the heavy callback waits for it before setting priorityStaleAfterHeroic.
  var priorityStaleAfterHeroicPromise = fetchSupabasePriorityStaleAfterHeroic();
  // Fired alongside; the heavy callback waits for it before setting priorityLiveFirstPrios.
  var priorityLiveFirstPriosPromise = fetchSupabasePriorityLiveFirstPrios();
  // Fired alongside; the heavy callback waits for it before setting selfReceived.
  var selfReceivedPromise = fetchSupabaseSelfReceived();
  // Fired alongside; the heavy callback waits for it before setting rawAttendanceData/attendanceDetails/recentAttendanceTrend.
  var attendancePromise = fetchSupabaseAttendanceRaw();
  // Fired alongside; the heavy callback waits for it before setting streamers.
  // Fires on every page (officer.html included) same as every other heavy
  // field, even though only index.html's js/streamers.js reads DATA.streamers
  // -- consistent with the rest of this batch, which never conditions on
  // which page loaded it.
  var streamersPromise = fetchSupabaseStreamers();
  // Fired alongside; the heavy callback waits for it before setting raidProgress.
  var raidProgressPromise = fetchSupabaseRaidProgress();
  // Fired alongside; the heavy callback waits for it before setting incomingRoster.
  var incomingRosterPromise = fetchSupabaseIncomingRoster();
  // Fired alongside; the heavy callback waits for it before setting raidZones.
  var raidZonesPromise = fetchSupabaseRaidZones();
  // Fired alongside; the heavy callback waits for it before setting
  // guildOfficerBios. Guild-wide (site_settings), not per-team.
  var guildOfficerBiosPromise = fetchSupabaseGuildOfficerBios();

  // Builds DATA from the Supabase roster/settings/M+ rejections, then runs
  // onCoreReady. GAS is retired (#225) -- there is no core payload to overlay
  // onto anymore, so this always starts from a bare { roster: [] } (an empty
  // roster is correct for a team with no players yet, not a loading
  // failure). Was applyCoreData(data, onSuccess): `data` came from the GAS
  // core chunk (or that same bare stub on the GAS-independent path, #426),
  // and onSuccess wired the GAS heavy-chunk callback in the same tick.
  // Neither is needed once GAS calls nothing at all.
  function applyCoreData() {
    return Promise.all([rosterPromise, settingsPromise, mplusRejectionsPromise]).then(function (results) {
      var rows = results[0];
      var settingsConfig = results[1];
      var mplusRejections = results[2];
      var data = { roster: [] };
      var mapped = rows ? mapSupabaseRoster(rows, data.roster, mplusRejections) : null;
      if (mapped && mapped.length) data.roster = mapped;
      applyTeamSettingsToData(data, settingsConfig);
      DATA = data;
      DATA._loadedAt = new Date();
      try {
        onCoreReady();
      } catch (e) {
        showError('Could not load roster data. ' + e.message);
        return false;
      }
      return true;
    });
  }

  // Merges the heavy Supabase reads into DATA. Every field defaults to an
  // empty container ({}, or null for rawAttendanceData) rather than
  // undefined when its query fails or returns nothing -- there is no GAS
  // heavy chunk left to fall back to (#225), and a few write paths
  // (tab-bis.js, tab-priority.js) index bisList/priorityOrder/selfReceived
  // without their own guard.
  function applyHeavyData() {
    return Promise.all([
      lootPromise,
      bisItemsPromise,
      itemsPromise,
      itemBossesPromise,
      tierTokenMapPromise,
      priorityOrderPromise,
      priorityStaleAfterHeroicPromise,
      priorityLiveFirstPriosPromise,
      selfReceivedPromise,
      attendancePromise,
      streamersPromise,
      raidProgressPromise,
      incomingRosterPromise,
      raidZonesPromise,
      guildOfficerBiosPromise
    ]).then(function (results) {
      var lootRows = results[0];
      var bisRows = results[1];
      var itemRows = results[2];
      var itemBossRows = results[3];
      var tierTokenMapRows = results[4];
      var priorityRows = results[5];
      var priorityStaleAfterHeroicRows = results[6];
      var priorityLiveFirstPriosRows = results[7];
      var selfReceivedRows = results[8];
      var attendanceRows = results[9];
      var streamerRows = results[10];
      var raidProgressRows = results[11];
      var incomingRosterRows = results[12];
      var raidZonesRows = results[13];
      var guildOfficerBiosRows = results[14];
      DATA.raidZones = raidZonesRows || [];
      var mappedLoot = lootRows ? mapSupabaseLoot(lootRows) : null;
      DATA.lootCounts = mappedLoot || {};
      var mappedAttendance = attendanceRows !== null ? mapSupabaseAttendanceRaw(attendanceRows, DATA.roster) : null;
      DATA.rawAttendanceData = mappedAttendance || null;
      DATA.attendanceDetails = mappedAttendance ? mapSupabaseAttendanceDetails(mappedAttendance.players) : {};
      DATA.recentAttendanceTrend = mappedAttendance ? mapSupabaseAttendanceTrend(mappedAttendance.players) : {};
      var mappedBis = bisRows ? mapSupabaseBisItems(bisRows) : null;
      DATA.bisList = mappedBis || {};
      // Raw rows aren't season-filtered by the query itself (see
      // fetchSupabasePriorityOrder()'s comment) -- cached here so
      // remapPriorityDataForSeasonView() can re-derive DATA.priorityOrder etc.
      // after a later Season View change without a round-trip to Supabase.
      DATA._priorityOrderRawRows = priorityRows || [];
      DATA._priorityStaleAfterHeroicRawRows = priorityStaleAfterHeroicRows || [];
      DATA._priorityLiveFirstPriosRawRows = priorityLiveFirstPriosRows || [];
      remapPriorityDataForSeasonView();
      var itemMaps = buildItemMaps(itemRows);
      DATA.itemSlots = itemMaps.itemSlots;
      DATA.itemArmorTypes = itemMaps.itemArmorTypes;
      DATA.itemPlaceholders = itemMaps.itemPlaceholders;
      DATA.itemIds = itemMaps.itemIds;
      DATA.itemWowIds = itemMaps.itemWowIds;
      DATA.itemIcons = itemMaps.itemIcons;
      DATA.itemZones = itemMaps.itemZones;
      DATA.itemSecondaryStats = itemMaps.itemSecondaryStats;
      DATA.itemMainStats = itemMaps.itemMainStats;
      DATA.itemWeaponSubtypes = itemMaps.itemWeaponSubtypes;
      DATA.itemIsPtr = itemMaps.itemIsPtr;
      DATA.itemBosses = mapSupabaseItemBosses(itemBossRows);
      var tierTokenMapResult = mapSupabaseTierTokenMap(tierTokenMapRows);
      DATA.tierTokenMap = tierTokenMapResult.map;
      DATA.tierResolvedItemNames = tierTokenMapResult.resolvedNames;
      // A resolved tier item never has its own item_bosses row (it doesn't
      // physically drop -- see mapSupabaseTierTokenMap's comment), so
      // itemNameBlockHtml's boss line would otherwise show nothing for it.
      // Backfills DATA.itemBosses[resolvedName] from its token's own boss,
      // which is the boss that actually needs killing for this piece --
      // itemNameBlockHtml needs no changes, it already reads this same map.
      Object.keys(DATA.tierTokenMap).forEach(function (tokenName) {
        var boss = DATA.itemBosses[tokenName];
        if (!boss) return;
        var byClass = DATA.tierTokenMap[tokenName];
        Object.keys(byClass).forEach(function (className) {
          DATA.itemBosses[byClass[className]] = boss;
        });
      });
      var mappedSelfReceived = selfReceivedRows ? mapSupabaseSelfReceived(selfReceivedRows) : null;
      DATA.selfReceived = mappedSelfReceived || {};
      DATA.streamers = mapSupabaseStreamers(streamerRows);
      DATA.raidProgress = mapSupabaseRaidProgress(raidProgressRows);
      var mappedIncomingRoster = incomingRosterRows ? mapSupabaseIncomingRoster(incomingRosterRows) : null;
      DATA.incomingRoster = mappedIncomingRoster || [];
      DATA.guildOfficerBios = guildOfficerBiosRows || [];
      if (typeof populateBossFilters === 'function') populateBossFilters();
      if (onHeavyReady) onHeavyReady();
    });
  }

  applyCoreData().then(function (ok) {
    if (ok) applyHeavyData();
  });
}

// -- Data helpers -----------------------------------------------------------
// The season an officer is actively viewing/planning (#549): DATA.seasonView
// when explicitly set (prepping a future season's catalog/wishlist/BiS/
// signups without touching the live raid), else DATA.seasonName (today's
// live season -- the default). Everything season-scoped below reads this
// instead of DATA.raidProgression, which is WCL progress-tracking config
// (which raids to pull kill/attendance data for), not a season-view concept,
// and gets wiped to [] by every archive_current_season() call (#537).
function resolveSeasonView() {
  return (DATA && (DATA.seasonView || DATA.seasonName)) || '';
}

// The season code to tag/query priority_order (and its fairness-warning
// views) with: DATA.seasonView when explicitly set -- already a raid_zones-
// style code, see populateSeasonViewOptions() -- else seasonCodeForDisplay()
// of the live DATA.seasonName. Deliberately not resolveSeasonView() itself:
// that helper's raw seasonName fallback is left unconverted on purpose, so
// isItemInSeasonScope()'s zone-id lookup fails open when seasonView is unset
// (#549); priority_order.season always needs a real code, live season or not,
// so a team without a seasonView override still gets one.
function resolveSeasonViewCode() {
  return (DATA && DATA.seasonView) || seasonCodeForDisplay((DATA && DATA.seasonName) || '');
}

// Re-derives DATA.priorityOrder/priorityStaleAfterHeroic/priorityLiveFirstPrios
// for whatever Season View is active *right now*, from the raw unfiltered
// rows applyHeavyData() cached at load time. Needed because these three
// fields are otherwise computed once, filtered to the season code that was
// active at that moment -- changing Season View afterward (tab-season.js's
// saveSeasonView) left them locked to the old season, so an already-open
// Priority tab showed stale or empty data until a full page reload.
function remapPriorityDataForSeasonView() {
  if (!DATA) return;
  var seasonCode = resolveSeasonViewCode();
  DATA.priorityOrder = mapSupabasePriorityOrder(DATA._priorityOrderRawRows, seasonCode);
  DATA.priorityStaleAfterHeroic = (DATA._priorityStaleAfterHeroicRawRows || []).filter(function (r) {
    return r.season === seasonCode;
  });
  DATA.priorityLiveFirstPrios = (DATA._priorityLiveFirstPriosRawRows || []).filter(function (r) {
    return r.season === seasonCode;
  });
}

// The set of raid zone IDs (#535, #549) the given season string covers, per
// DATA.raidZones (raid_zones.wcl_zone_id/season, the same team-agnostic
// mapping #285's WCL progress sync maintains) -- not DATA.raidProgression,
// which only reflects the live season's WCL-tracking config.
function currentZoneIdsForSeason(season) {
  var ids = {};
  (DATA.raidZones || []).forEach(function (rz) {
    if (rz.season !== season) return;
    var id = parseInt(rz.wclZoneId, 10);
    if (id) ids[id] = true;
  });
  return ids;
}

// Whether item `name` belongs to the team's viewed season (resolveSeasonView(),
// #549), per items.wcl_zone_id (#535) -- shared by the Priority tab, BiS grid
// editor, and Raider Wishlist so the "current tier only" scoping rule lives in
// one place. Placeholder items (M+/Crafted/Catalyst) aren't tied to a raid
// zone, so they can't be scoped this way at all -- pass the row's own
// `rowSeason` (bis_items.season / item_preferences.season, stamped at tag
// time) for those instead. Rows tagged before that column existed have
// rowSeason null/undefined and fail open (shown regardless of season)
// rather than silently disappearing.
//
// Fail-open only applies to the default (seasonView unset) case: no
// raid_zones rows for the live season yet still shows everything, so an
// incompletely-onboarded team isn't punished with an empty catalog. Once
// seasonView is explicitly set, filtering is strict -- no raid_zones row for
// that season means an empty view, the honest state, not a silent fallback
// to "show everything" (this doubles as the way to verify a new tier's
// import actually worked).
function isItemInSeasonScope(name, rowSeason) {
  if ((DATA.itemPlaceholders || {})[name]) return !rowSeason || rowSeason === resolveSeasonView();
  var zone = (DATA.itemZones || {})[name];
  if (!zone) return true;
  var explicit = !!(DATA && DATA.seasonView);
  var ids = currentZoneIdsForSeason(resolveSeasonView());
  if (!Object.keys(ids).length) return !explicit;
  return !!ids[zone];
}

// Returns every track this player is ranked on for itemName, as
// [{pos, diff}, ...] (diff: 'heroic'/'mythic'), or [] if unranked on both.
// DATA.priorityOrder[itemName] is {heroic?: string[], mythic?: string[]}
// (mapSupabasePriorityOrder(), js/common.js), not a flat array -- this used
// to index it as one (`list.length`/`list[i]` on the {heroic,mythic} object
// is always undefined, so the loop never ran and this always returned null,
// same underlying bug the Contested Items view had and fixed independently,
// see CHANGELOG "Rank labels now display in Contested Items"). Accepts
// either identity (nameRealm, preferred) or a bare first name -- same
// dual-mode shape as getLootEntry()/getBisItems() (#359/#529).
function getRank(nameOrNameRealm, itemName) {
  var entry = (DATA.priorityOrder || {})[itemName];
  if (!entry) return [];
  var norm = normalise(nameOrNameRealm);
  var diffs = ['heroic', 'mythic'];
  var ranks = [];
  for (var d = 0; d < diffs.length; d++) {
    var list = entry[diffs[d]] || [];
    for (var i = 0; i < list.length; i++) {
      if (normalise(list[i]) === norm) {
        ranks.push({ pos: i + 1, diff: diffs[d] });
        break;
      }
    }
  }
  return ranks;
}

// Accepts either a full "Name-Realm" identity (preferred -- exact,
// collision-free, #529) or a bare first name (from any remaining caller that
// hasn't been updated to carry full identity through). A bare first name
// falls through to the old ambiguous match against every key's own
// first-name segment -- same fallback shape as getLootEntry() (#359).
function getBisItems(nameOrNameRealm) {
  var bisMap = DATA.bisList || {};
  var norm = normalise(nameOrNameRealm);
  var key = null;
  var keys = Object.keys(bisMap);
  for (var i = 0; i < keys.length; i++) {
    if (normalise(keys[i]) === norm) {
      key = keys[i];
      break;
    }
  }
  if (!key) {
    for (var j = 0; j < keys.length; j++) {
      if (normalise(keys[j].split('-')[0]) === norm) {
        key = keys[j];
        break;
      }
    }
  }
  var entries = key ? bisMap[key] : [];
  return entries.map(function (e) {
    return typeof e === 'string' ? { item: e, slot: '' } : e;
  });
}

// Read-time merge for the BiS List display -- never writes to bis_items. A
// tagged wishlist "BiS" item supersedes the officer's pick for that same
// slot category; real items compare by catalog slot (Finger, Trinket, ...),
// since the wishlist has no notion of "which numbered ring" the way the
// officer's grid does -- any BiS-tagged ring supersedes both Finger 1 and
// Finger 2. Placeholders (M+/Crafted/Catalyst) compare by their exact
// tagged BIS_SLOTS row instead, since that's the only thing that
// distinguishes them. Shared core used by both wishlist.js's
// wishlistBisMergeGroups() (raider's own profile, `prefs` from
// _wishlistPrefs) and renderProfile() below directly (officer's read view
// of any raider's profile, `prefs` filtered from tab-priority.js's
// _teamItemPreferences) -- kept here rather than in wishlist.js since only
// index.html loads that file, and this needs to run from both pages.
function bisMergeWishlistPrefs(prefs, officerBisItems, playerId) {
  var idToName = {};
  Object.keys((DATA && DATA.itemIds) || {}).forEach(function (name) {
    idToName[DATA.itemIds[name]] = name;
  });
  var itemSlots = (DATA && DATA.itemSlots) || {};
  var itemPlaceholders = (DATA && DATA.itemPlaceholders) || {};

  var coveredCatalogSlots = {};
  var coveredPlaceholderRows = {};
  var fromWishlist = [];

  (prefs || []).forEach(function (p) {
    if (p.status !== 'bis') return;
    var name = idToName[p.item_id];
    if (!name) return;
    var isPlaceholder = !!itemPlaceholders[name];
    if (isPlaceholder) {
      if (p.slot) coveredPlaceholderRows[p.slot] = true;
    } else {
      var catalogSlot = itemSlots[name] || '';
      if (catalogSlot) coveredCatalogSlots[catalogSlot] = true;
    }
    fromWishlist.push({
      item: name,
      slot: isPlaceholder ? p.slot || '' : '',
      dbSlot: '',
      obtained: false,
      playerId: playerId,
      itemId: p.item_id,
      fromWishlist: true
    });
  });

  var officerSet = officerBisItems.filter(function (entry) {
    var isPlaceholder = !!itemPlaceholders[entry.item];
    if (isPlaceholder) {
      var row = entry.dbSlot || entry.slot || '';
      return !coveredPlaceholderRows[row];
    }
    var catalogSlot = itemSlots[entry.item] || '';
    return !(catalogSlot && coveredCatalogSlots[catalogSlot]);
  });

  return { fromWishlist: fromWishlist, officerSet: officerSet };
}

// Canonical row order for the BiS List display (renderProfile below) --
// bis_items has no ordering of its own (rows come back in whatever order
// they were added/fetched, and the wishlist merge appends its own entries
// on top), so entries need an explicit sort before rendering. Own copy here
// rather than reusing tab-bis.js's BIS_SLOTS/wishlist.js's WISHLIST_SLOTS --
// this is common.js, loaded by both index.html and officer.html, neither of
// which is guaranteed to have loaded either of those page-specific files
// yet at this point.
var BIS_DISPLAY_SLOT_ORDER = [
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

// A dual-row catalog slot (Finger/Trinket) or a weapon type (One-Hand/
// Two-Hand/Ranged/Off Hand/Held In Off-hand) collapses to its first/only
// matching row when an entry has no explicit dbSlot/slot to say which
// numbered row it belongs to (e.g. a real item merged in from the raider's
// wishlist, which has no per-row identity -- same data-model limitation
// wishlist.js's own completeness check works around).
var BIS_DISPLAY_CATALOG_TO_ROW = {
  Head: 'Head',
  Neck: 'Neck',
  Shoulder: 'Shoulder',
  Back: 'Back',
  Chest: 'Chest',
  Wrist: 'Wrist',
  Hands: 'Hands',
  Waist: 'Waist',
  Legs: 'Legs',
  Feet: 'Feet',
  Finger: 'Finger 1',
  Trinket: 'Trinket 1',
  'One-Hand': 'Weapon',
  'Two-Hand': 'Weapon',
  Ranged: 'Weapon',
  'Off Hand': 'Off Hand',
  'Held In Off-hand': 'Off Hand'
};

function bisDisplaySortKey(entry, itemSlots) {
  var row = entry.dbSlot || entry.slot || '';
  var idx = BIS_DISPLAY_SLOT_ORDER.indexOf(row);
  if (idx !== -1) return idx;
  var catalogSlot = itemSlots[entry.item] || '';
  var mapped = BIS_DISPLAY_CATALOG_TO_ROW[catalogSlot];
  idx = mapped ? BIS_DISPLAY_SLOT_ORDER.indexOf(mapped) : -1;
  return idx === -1 ? BIS_DISPLAY_SLOT_ORDER.length : idx;
}

// Read-only officer view of a raider's Wishlist, shown whenever the profile
// viewer isn't its owner (renderProfile()'s isOwnWishlistView below) --
// distinct from ownWishlistSectionHTML() (js/wishlist.js), which only ever
// renders for the owner and isn't loaded on officer.html at all. Lives here
// rather than tab-priority.js since an officer can reach another raider's
// profile two ways: officer.html's Roster tab (backTo === 'officer', where
// tab-priority.js's _teamItemPreferences is already loaded team-wide) and
// index.html's hash-based lookup (js/roster.js's _resolveHashProfile,
// backTo === 'landing' but viewer isn't the owner) -- only common.js is
// guaranteed loaded on both. Own copy of the status label/color map for the
// same reason (mirrors WISHLIST_LABEL_DEFAULTS/WISHLIST_TIER_COLORS
// elsewhere), and reuses BIS_DISPLAY_SLOT_ORDER/bisDisplaySortKey above --
// also built specifically to be usable from either page.
var PROFILE_WISHLIST_STATUS_LABELS = [
  { value: 'bis', label: 'BiS', color: 'var(--gold)', rgb: '214,163,68' },
  { value: 'good', label: 'Good', color: 'var(--heal)', rgb: '61,220,132' },
  { value: 'ok', label: 'OK', color: 'var(--tank)', rgb: '74,158,255' },
  { value: 'catalyst', label: 'Catalyst Only', color: 'var(--ranged)', rgb: '191,140,255' },
  { value: 'pass', label: 'Pass', color: 'var(--melee)', rgb: '255,124,92' }
];

// Keyed by player_id -- avoids re-fetching on every profile re-render when
// tab-priority.js's team-wide _teamItemPreferences isn't loaded (index.html
// never loads it at all; officer.html loads it lazily on dashboard boot).
var _profileWishlistPrefsCache = {};

function fetchPlayerItemPreferences(playerId) {
  if (!supabaseClient) return Promise.resolve(null);
  // Promise.resolve() unwraps the builder's PromiseLike into a real Promise
  // -- needed for the chained .then().catch() below, since PromiseLike
  // itself has no .catch() (same reason as addAttendanceNight() above).
  var query = Promise.resolve(
    supabaseClient.from('item_preferences').select('player_id, item_id, status, slot, note').eq('player_id', playerId)
  )
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

function officerWishlistRowHTML(name, slot, pref, labelOverrides) {
  var tier = PROFILE_WISHLIST_STATUS_LABELS.filter(function (t) {
    return t.value === pref.status;
  })[0];
  var rowBorder = tier ? tier.color : 'var(--border)';
  var rowBackground = tier ? 'rgba(' + tier.rgb + ',0.08)' : 'var(--bg-card)';
  var label = (tier && labelOverrides[tier.value]) || (tier && tier.label) || pref.status;
  return (
    '<div style="padding:0.4rem 0.6rem;border-radius:4px;border:1px solid ' +
    rowBorder +
    ';background:' +
    rowBackground +
    ';margin-bottom:2px;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;">' +
    itemNameBlockHtml(name, slot) +
    '<span style="font-size:0.85rem;font-weight:600;color:' +
    rowBorder +
    ';text-transform:uppercase;letter-spacing:0.04em;">' +
    escHtml(label) +
    '</span>' +
    '</div>' +
    (pref.note
      ? '<div style="font-size:0.92rem;color:var(--text-muted);font-style:italic;margin-top:0.25rem;">"' +
        escHtml(pref.note) +
        '"</div>'
      : '') +
    '</div>'
  );
}

function officerWishlistSectionHTML(player, backTo) {
  if (!player) return '';
  if (typeof featureEnabled === 'function' && !featureEnabled('bis')) return '';

  var html = '<div class="profile-section"><div class="section-label">Wishlist</div>';

  var teamPrefs = typeof _teamItemPreferences !== 'undefined' ? _teamItemPreferences : undefined;
  var prefs;
  if (teamPrefs !== undefined && teamPrefs !== null) {
    prefs = teamPrefs.filter(function (p) {
      return p.player_id === player.id;
    });
  } else if (_profileWishlistPrefsCache[player.id]) {
    prefs = _profileWishlistPrefsCache[player.id];
  } else {
    fetchPlayerItemPreferences(player.id).then(function (rows) {
      _profileWishlistPrefsCache[player.id] = rows || [];
      if (typeof reopenSelectedPlayer === 'function') reopenSelectedPlayer();
      else if (typeof renderProfile === 'function') renderProfile(player.firstName, backTo);
    });
    return html + '<p style="color:var(--text-muted);padding:0.5rem 0;">Loading...</p></div>';
  }

  if (!prefs.length) {
    return html + '<p style="color:var(--text-muted);padding:0.5rem 0;">No wishlist tags yet.</p></div>';
  }

  var itemIds = DATA.itemIds || {};
  var idToName = {};
  Object.keys(itemIds).forEach(function (name) {
    idToName[itemIds[name]] = name;
  });
  var itemSlots = DATA.itemSlots || {};
  var labelOverrides = (DATA && DATA.wishlistStatusLabels) || {};

  var entries = [];
  prefs.forEach(function (p) {
    var name = idToName[p.item_id];
    if (!name) return;
    entries.push({ item: name, slot: p.slot || itemSlots[name] || '', dbSlot: p.slot || '', pref: p });
  });
  entries.sort(function (a, b) {
    return bisDisplaySortKey(a, itemSlots) - bisDisplaySortKey(b, itemSlots);
  });

  entries.forEach(function (e) {
    html += officerWishlistRowHTML(e.item, e.dbSlot || itemSlots[e.item] || '', e.pref, labelOverrides);
  });

  return html + '</div>';
}

function getSelfReceivedItems(firstName) {
  var map = DATA.selfReceived || {};
  var norm = normalise(firstName);
  var keys = Object.keys(map);
  for (var i = 0; i < keys.length; i++) {
    if (normalise(keys[i]) === norm) return map[keys[i]];
  }
  return [];
}

function refreshBisCompletion(firstName, nameRealm) {
  var el = document.getElementById('bis-completion-' + firstName);
  if (!el) return;
  var bisItems = getBisItems(nameRealm || firstName).filter(function (e) {
    return typeof isItemInSeasonScope !== 'function' || isItemInSeasonScope(e.item, e.season);
  });
  if (!bisItems.length) return;
  var selfRecItems = getSelfReceivedItems(firstName);
  var selfRecMap = {};
  for (var i = 0; i < selfRecItems.length; i++) selfRecMap[normalise(selfRecItems[i].item)] = true;
  var lootEntry = getLootEntry(nameRealm || firstName);
  var receivedMap = {};
  if (lootEntry && lootEntry.items) {
    for (var j = 0; j < lootEntry.items.length; j++) {
      var n = typeof lootEntry.items[j] === 'string' ? lootEntry.items[j] : lootEntry.items[j].name;
      receivedMap[normalise(n)] = true;
    }
  }
  var count = 0;
  for (var k = 0; k < bisItems.length; k++) {
    if (receivedMap[normalise(bisItems[k].item)] || selfRecMap[normalise(bisItems[k].item)]) count++;
  }
  var pct = Math.round((count / bisItems.length) * 100);
  el.innerHTML =
    '<span style="color:var(--gold-light);font-weight:600;">' +
    pct +
    '%</span><span style="color:var(--text-muted);font-weight:400;"> (' +
    count +
    '/' +
    bisItems.length +
    ')</span>';
}

// Accepts either a full "Name-Realm" identity (preferred -- exact, collision-
// free, #359) or a bare first name (from callers whose upstream data, like
// bisList and the priority pool, is still keyed by first name only). A bare
// first name falls through to the old ambiguous match against every loot
// key's own first-name segment -- unchanged behavior for those callers until
// they're re-keyed by identity too.
function getLootEntry(nameOrNameRealm) {
  var lootMap = DATA.lootCounts || {};
  var norm = normalise(nameOrNameRealm);
  var keys = Object.keys(lootMap);
  for (var i = 0; i < keys.length; i++) {
    if (normalise(keys[i]) === norm) return lootMap[keys[i]];
  }
  for (var j = 0; j < keys.length; j++) {
    if (normalise(keys[j].split('-')[0]) === norm) return lootMap[keys[j]];
  }
  return null;
}

function getSeasonLootItems(firstName) {
  var entry = getLootEntry(firstName);
  var items = (entry && entry.items) || [];
  if (!ACTIVE_SEASON) return items;
  return items.filter(function (item) {
    return item.season === ACTIVE_SEASON;
  });
}

function getSeasonLootEntry(firstName) {
  if (!ACTIVE_SEASON) return getLootEntry(firstName);
  var items = getSeasonLootItems(firstName);
  var heroic = 0,
    mythic = 0;
  for (var i = 0; i < items.length; i++) {
    if (items[i].difficulty === 'Heroic') heroic++;
    else if (items[i].difficulty === 'Mythic') mythic++;
  }
  return { count: items.length, heroicCount: heroic, mythicCount: mythic, items: items };
}

// -- Render helpers ---------------------------------------------------------
// Fixed track widths, not "auto" -- each .priority-row is its own separate
// CSS grid (not a shared one across the list), so an "auto" column sizes to
// that row's own content only. A row ranked on both tracks (two rank pills
// side by side) would size its own Prio column wider than every other row,
// and a row's Source column (badge+date vs. a bare "Mark received" button
// vs. the header's plain "Source" label) would each auto-size differently
// too -- since the 1fr Item column absorbs whatever width the other columns
// don't take, any row whose Source content is wider ends up with a
// narrower, differently-centered Item column than the rest. Fixed pixel
// widths on every column but Item make every row (and the header) size
// identically regardless of content.
var PRIORITY_ROW_GRID_COLUMNS = '100px 110px 1fr 150px';

// Heroic/Mythic pill colors -- heroic reuses --heal (green), mythic reuses
// --ranged (the existing purple in the role palette, css/styles.css) rather
// than inventing a new color.
var RANK_PILL_DIFF_COLORS = {
  heroic: { c: 'var(--heal)', bg: 'rgba(72,187,120,0.18)', bd: 'rgba(72,187,120,0.4)' },
  mythic: { c: 'var(--ranged)', bg: 'rgba(191,140,255,0.18)', bd: 'rgba(191,140,255,0.4)' }
};

// ranks: getRank()'s return, [{pos, diff}, ...] -- empty/null renders "-".
// One pill per track (not one pill combining both, so heroic/mythic get
// visually distinct colors instead of sharing a single box), labeled
// "<pos> <letter>" (e.g. "2 H").
function rankPillHTML(ranks) {
  if (!ranks || !ranks.length)
    return '<span style="font-size:1rem;color:var(--text-dim);min-width:40px;text-align:center;">-</span>';
  return (
    '<span style="display:flex;gap:4px;justify-content:center;">' +
    ranks
      .map(function (r) {
        var colors = RANK_PILL_DIFF_COLORS[r.diff] || RANK_PILL_DIFF_COLORS.heroic;
        return (
          '<span class="rank-pill" style="font-size:0.85rem;background:' +
          colors.bg +
          ';color:' +
          colors.c +
          ';border:1px solid ' +
          colors.bd +
          ';">' +
          r.pos +
          ' ' +
          (r.diff === 'mythic' ? 'M' : 'H') +
          '</span>'
        );
      })
      .join('') +
    '</span>'
  );
}

function lookupItemSlot(itemName) {
  var slots = DATA.itemSlots || {};
  if (slots[itemName]) return slots[itemName];
  for (var key in slots) {
    if (key.indexOf(itemName) === 0) return slots[key];
  }
  return '';
}

// Takes either an items.slot catalog value (from DATA.itemSlots, passed by
// tab-priority.js/tab-conflicts.js/renderProfile) or a BIS_SLOTS row label
// (from tab-bis.js's editor). Those used to be two different vocabularies that
// this function had to bridge by listing every synonym pair (BOOTS and FEET,
// GLOVES and HANDS, ...); both now speak the canonical Wowhead/in-game names,
// so the only values that differ between them are the numbered BiS positions
// (FINGER vs FINGER 1) and the weapon rows.
function getSlotColor(slot) {
  var s = (slot || '').toUpperCase();
  if (['TRINKET', 'TRINKET 1', 'TRINKET 2'].indexOf(s) >= 0) return 'var(--gold)';
  if (['NECK', 'FINGER', 'FINGER 1', 'FINGER 2'].indexOf(s) >= 0) return 'var(--ranged)';
  if (['WEAPON', 'ONE-HAND', 'TWO-HAND', 'RANGED', 'OFF HAND', 'HELD IN OFF-HAND'].indexOf(s) >= 0)
    return 'var(--melee)';
  if (['HEAD', 'SHOULDER', 'CHEST', 'HANDS', 'LEGS', 'BACK', 'WRIST', 'WAIST', 'FEET'].indexOf(s) >= 0)
    return 'var(--tank)';
  return 'var(--text)';
}

// Visual guide only (Priority tab/Wishlist, via itemNameBlockHtml) -- lets an
// officer/raider spot at a glance whether an item fits their class's armor
// type, reusing the same role-color palette everything else already draws
// from rather than introducing new ones.
function getArmorTypeColor(armorType) {
  switch (armorType) {
    case 'Plate':
      return 'var(--tank)';
    case 'Mail':
      return 'var(--ranged)';
    case 'Leather':
      return 'var(--melee)';
    case 'Cloth':
      return 'var(--heal)';
    default:
      return 'var(--text)';
  }
}

function attendColor(pct) {
  return pct >= 95 ? 'var(--heal)' : pct >= 75 ? 'var(--gold)' : 'var(--melee)';
}

function attendTrendColor(status) {
  if (status === 'Present') return '#52b788';
  if (status === 'Bench') return '#7EC8E3';
  if (status === 'Excused') return '#d4a843';
  if (status === 'Medical Leave') return '#A8DADC';
  if (status === 'Late (with notice)') return '#e8a33d';
  if (status === 'Late (no notice)') return '#e07b39';
  if (status === 'No Show') return '#e05252';
  return '#555';
}

function attendTrendValue(status) {
  if (status === 'Present') return 1.0;
  if (status === 'Bench') return 0.85;
  if (status === 'Medical Leave') return 0.7;
  if (status === 'Late (with notice)') return 0.65;
  if (status === 'Excused') return 0.5;
  if (status === 'Late (no notice)') return 0.3;
  if (status === 'No Show') return 0.0;
  return 0.5;
}

function showAttendTip(evt, text) {
  var tip = document.getElementById('attend-trend-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'attend-trend-tip';
    tip.style.cssText =
      'position:fixed;background:var(--bg-elevated);border:1px solid var(--border-mid);border-radius:4px;padding:0.45rem 0.7rem;font-size:0.93rem;color:var(--text-muted);white-space:nowrap;pointer-events:none;z-index:200;font-family:Rajdhani,sans-serif;letter-spacing:0.03em;';
    document.body.appendChild(tip);
  }
  tip.textContent = text;
  tip.style.display = 'block';
  tip.style.left = evt.clientX + 12 + 'px';
  tip.style.top = evt.clientY - 32 + 'px';
}

function hideAttendTip() {
  var tip = document.getElementById('attend-trend-tip');
  if (tip) tip.style.display = 'none';
}

function attendTrendMonthColor(avg) {
  if (avg >= 0.9) return '#52b788';
  if (avg >= 0.7) return '#7EC8E3';
  if (avg >= 0.5) return '#d4a843';
  return '#e05252';
}

// Distinct raid dates per calendar month across the whole team, from
// DATA.rawAttendanceData.raidDates -- mapSupabaseAttendanceRaw() already
// builds this exact list once (excluded reports never added, see its own
// comment), so this reuses it rather than re-deriving the same thing a
// second way from raw.players. This is deliberately the team-wide count,
// not this player's own row count -- a player's own rows already exclude
// nights they weren't on roster for (see computeSeasonAttendancePct's
// comment on why that's intentional), so showing their count alone can't
// answer "how many raid nights did the team actually have this month" --
// e.g. a mid-month roster join, or a genuinely unrecorded night for this
// player specifically.
function _teamRaidNightsByMonth() {
  var raw = DATA && DATA.rawAttendanceData;
  var counts = {};
  if (!raw || !raw.raidDates) return counts;
  raw.raidDates.forEach(function (date) {
    var key = date.substring(0, 7);
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function renderAttendTrend(firstName) {
  var trend = (DATA.recentAttendanceTrend || {})[firstName];
  if (!trend || !trend.length) return '';

  // Season-scope the same way computeSeasonAttendancePct does, so a new
  // season clears this graph instead of carrying the whole raid history
  // forward under a new tier's profile card (ACTIVE_SEASON null = All
  // Seasons, left as-is).
  var range = getSeasonDateRange();
  if (range.start || range.end) {
    trend = trend.filter(function (n) {
      return (!range.start || n.date >= range.start) && (!range.end || n.date <= range.end);
    });
  }
  if (!trend.length) return '';

  var nights = trend.slice().reverse(); // oldest left, newest right

  // Aggregate by calendar month
  var monthMap = {},
    monthOrder = [];
  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (var i = 0; i < nights.length; i++) {
    var key = nights[i].date.substring(0, 7); // "yyyy-MM"
    if (!monthMap[key]) {
      monthMap[key] = [];
      monthOrder.push(key);
    }
    monthMap[key].push(nights[i]);
  }

  // Fall back to per-night dots if only one month of data
  if (monthOrder.length <= 1) {
    /** @type {number} */
    var n = nights.length;
    var W = Math.max(300, n * 24),
      H = 56,
      PAD = 6,
      R = 4;
    // Shared with the per-month branch below (var hoists to function scope):
    // per-night points carry `night`, per-month points carry `m`.
    /** @type {{x: number, y: number, night?: any, m?: any}[]} */
    var points = [];
    for (var i = 0; i < n; i++) {
      var x = n === 1 ? W / 2 : PAD + (i / (n - 1)) * (W - PAD * 2);
      var y = PAD + (1 - attendTrendValue(nights[i].status)) * (H - PAD * 2);
      points.push({ x: x, y: y, night: nights[i] });
    }
    var lineStr = points
      .map(function (p) {
        return p.x.toFixed(1) + ',' + p.y.toFixed(1);
      })
      .join(' ');
    var svg =
      '<svg width="' +
      W +
      '" height="' +
      H +
      '" viewBox="0 0 ' +
      W +
      ' ' +
      H +
      '" style="display:block;overflow:visible;">';
    svg +=
      '<polyline points="' +
      lineStr +
      '" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>';
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      var tip = p.night.date + ': ' + p.night.status;
      svg +=
        '<g style="cursor:default;" onmouseover="showAttendTip(event,' +
        "'" +
        tip +
        "')" +
        '" onmouseout="hideAttendTip()">';
      svg +=
        '<circle cx="' +
        p.x.toFixed(1) +
        '" cy="' +
        p.y.toFixed(1) +
        '" r="' +
        R +
        '" fill="' +
        attendTrendColor(p.night.status) +
        '"/>';
      svg += '</g>';
    }
    svg += '</svg>';
    return '<div style="overflow-x:auto;overflow-y:hidden;margin-top:0.75rem;">' + svg + '</div>';
  }

  var raidNightsByMonth = _teamRaidNightsByMonth();
  var months = monthOrder.map(function (key) {
    var entries = monthMap[key];
    var sum = 0;
    var attended = 0;
    for (var j = 0; j < entries.length; j++) {
      sum += attendTrendValue(entries[j].status);
      // "Attended" for the X/Y tooltip -- physically at the raid that night
      // (Late counts, since they did show up, just not on time; Excused/
      // Medical Leave/Extended Leave/No Show don't, even though some of
      // those still carry partial weight in avg/pct above).
      if (
        entries[j].status === 'Present' ||
        entries[j].status === 'Bench' ||
        entries[j].status === 'Late (with notice)' ||
        entries[j].status === 'Late (no notice)'
      )
        attended++;
    }
    var avg = sum / entries.length;
    var parts = key.split('-');
    var label = MONTH_NAMES[parseInt(parts[1], 10) - 1] + ' ' + parts[0];
    var pct = Math.round(avg * 100);
    // Team-wide total for the month, falling back to this player's own
    // record count if team-wide data isn't available (e.g. rawAttendanceData
    // failed to load) -- never shown smaller than their own attended count.
    var total = Math.max(raidNightsByMonth[key] || 0, entries.length, attended);
    return { key: key, label: label, avg: avg, attended: attended, total: total, pct: pct };
  });

  var n = months.length;
  var W = Math.max(200, n * 64),
    H = 56,
    PAD = 16,
    R = 7;

  /** @type {{x: number, y: number, night?: any, m?: any}[]} */
  var points = [];
  for (var i = 0; i < n; i++) {
    var x = n === 1 ? W / 2 : PAD + (i / (n - 1)) * (W - PAD * 2);
    var y = PAD + (1 - months[i].avg) * (H - PAD * 2);
    points.push({ x: x, y: y, m: months[i] });
  }

  var lineStr = points
    .map(function (p) {
      return p.x.toFixed(1) + ',' + p.y.toFixed(1);
    })
    .join(' ');

  var svg =
    '<svg width="' +
    W +
    '" height="' +
    (H + 18) +
    '" viewBox="0 0 ' +
    W +
    ' ' +
    (H + 18) +
    '" style="display:block;overflow:visible;">';
  svg +=
    '<polyline points="' +
    lineStr +
    '" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>';
  for (var i = 0; i < points.length; i++) {
    var p = points[i];
    var col = attendTrendMonthColor(p.m.avg);
    var tip =
      p.m.label +
      ': ' +
      p.m.pct +
      '% (' +
      p.m.attended +
      '/' +
      p.m.total +
      ' raid' +
      (p.m.total !== 1 ? 's' : '') +
      ')';
    svg +=
      '<g style="cursor:default;" onmouseover="showAttendTip(event,' +
      "'" +
      tip +
      "')" +
      '" onmouseout="hideAttendTip()">';
    svg += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + R + '" fill="' + col + '"/>';
    svg +=
      '<text x="' +
      p.x.toFixed(1) +
      '" y="' +
      (H + 14) +
      '" text-anchor="middle" font-size="10" fill="rgba(255,255,255,0.45)" font-family="sans-serif">' +
      p.m.label.split(' ')[0] +
      '</text>';
    svg += '</g>';
  }
  svg += '</svg>';

  return '<div style="overflow-x:auto;overflow-y:hidden;margin-top:0.75rem;">' + svg + '</div>';
}

function formatJoinDate(dateStr) {
  if (!dateStr) return '';
  var parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var m = parseInt(parts[1], 10) - 1;
  if (m < 0 || m > 11) return dateStr;
  return months[m] + ' ' + parseInt(parts[2], 10) + ', ' + parts[0];
}

// Shared by both pages (index.html's signup/claim flow and officer.html's
// BiS toggle) -- lives here rather than signup.js since only index.html
// loads that file.
function findRosterPlayerByNameRealm(nameRealm) {
  if (!nameRealm || !window.DATA || !DATA.roster) return null;
  var key = nameRealm.toLowerCase();
  for (var i = 0; i < DATA.roster.length; i++) {
    if ((DATA.roster[i].nameRealm || '').toLowerCase() === key) return DATA.roster[i];
  }
  return null;
}

// -- BiS state helpers ------------------------------------------------------
function bisSubmissionsOpen() {
  return !!(DATA && DATA.bisSubmissionsOpen);
}

// Same "editing gate, not visibility gate" shape as bisSubmissionsOpen() --
// when closed, the raider's own tags stay visible/read-only rather than the
// whole Wishlist tab disappearing (that's the 'bis' feature flag's job).
function wishlistOpen() {
  return !!(DATA && DATA.wishlistOpen);
}

// bis_allowed lives on players (#404) so the officer-write RLS rule already
// covering that table gates the toggle, instead of the team_leader-only
// set_team_setting() path a team_settings array would have required.
function bisAllowedFor(nameRealm) {
  var player = findRosterPlayerByNameRealm(nameRealm);
  return !!(player && player.bisAllowed);
}

// Same shape as bis_allowed/bisAllowedFor above -- the per-raider exception
// to Wishlist Editing being closed team-wide (#610/#611 follow-up).
function wishlistAllowedFor(nameRealm) {
  var player = findRosterPlayerByNameRealm(nameRealm);
  return !!(player && player.wishlistAllowed);
}

// -- BiS form actions (used from profile on both pages) --------------------
function toggleBisForm(firstName) {
  var form = document.getElementById('bisForm-' + firstName);
  if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

// -- M+ exclusion form actions ---------------------------------------------
function toggleMPlusForm(firstName) {
  var form = document.getElementById('mplusForm-' + firstName);
  if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

function submitMPlusExclusionForm(nameRealm, firstName) {
  var urlEl = /** @type {HTMLInputElement} */ (document.getElementById('mplusUrl-' + firstName));
  var notesEl = /** @type {HTMLTextAreaElement} */ (document.getElementById('mplusNotes-' + firstName));
  var formEl = document.getElementById('mplusForm-' + firstName);
  var mythCheckEl = /** @type {HTMLInputElement} */ (document.getElementById('mplusMythCheck-' + firstName));
  var socketCountEl = /** @type {HTMLSelectElement} */ (document.getElementById('mplusSocketCount-' + firstName));
  var checkErrorEl = document.getElementById('mplusCheckError-' + firstName);
  if (!urlEl || !urlEl.value.trim()) {
    if (urlEl) urlEl.style.borderColor = 'var(--melee)';
    return;
  }
  var socketCount = socketCountEl && socketCountEl.value !== '' ? parseInt(socketCountEl.value, 10) : NaN;
  if (!mythCheckEl || !mythCheckEl.checked || isNaN(socketCount) || socketCount < 2) {
    if (checkErrorEl) checkErrorEl.style.display = '';
    return;
  }
  if (checkErrorEl) checkErrorEl.style.display = 'none';
  if (formEl)
    formEl.innerHTML = '<p style="font-size:1.07rem;color:var(--text-muted);padding:0.5rem 0;">Submitting...</p>';

  if (!supabaseClient) {
    if (formEl)
      formEl.innerHTML =
        '<p style="font-size:1.07rem;color:var(--melee);padding:0.5rem 0;">Failed to submit. Try again.</p>';
    return;
  }

  supabaseClient
    .rpc('submit_mplus_exclusion', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_name_realm: nameRealm,
      p_raiderio_url: urlEl.value.trim(),
      p_reason: notesEl ? notesEl.value.trim() : ''
    })
    .then(function (result) {
      if (formEl) {
        formEl.innerHTML = result.error
          ? '<p style="font-size:1.07rem;color:var(--melee);padding:0.5rem 0;">Failed to submit. Try again.</p>'
          : '<p style="font-size:1.07rem;color:var(--text-muted);padding:0.5rem 0;">Request submitted! An officer will review it shortly.</p>';
      }
      if (!result.error) {
        supabaseClient.functions.invoke('discord-bot-webhook', {
          body: {
            action: 'mplus',
            team: TEAM_SLUG,
            payload: {
              nameRealm: nameRealm,
              raiderioUrl: urlEl.value.trim(),
              notes: notesEl ? notesEl.value.trim() : ''
            }
          }
        });
      }
    });
}

function submitBiSForm(nameRealm, firstName) {
  var urlEl = /** @type {HTMLInputElement} */ (document.getElementById('bisUrl-' + firstName));
  var notesEl = /** @type {HTMLTextAreaElement} */ (document.getElementById('bisNotes-' + firstName));
  if (!urlEl || !urlEl.value.trim()) {
    if (urlEl) urlEl.style.borderColor = 'var(--melee)';
    return;
  }
  var formEl = document.getElementById('bisForm-' + firstName);
  if (formEl)
    formEl.innerHTML = '<p style="font-size:1.07rem;color:var(--text-muted);padding:0.5rem 0;">Submitting...</p>';

  if (!supabaseClient) {
    if (formEl)
      formEl.innerHTML =
        '<p style="font-size:1.07rem;color:var(--melee);padding:0.5rem 0;">Failed to submit. Try again.</p>';
    return;
  }

  supabaseClient
    .rpc('submit_bis_link', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_name_realm: nameRealm,
      p_bis_link: urlEl.value.trim(),
      p_player_note: notesEl ? notesEl.value.trim() : ''
    })
    .then(function (result) {
      if (formEl) {
        formEl.innerHTML = result.error
          ? '<p style="font-size:1.07rem;color:var(--melee);padding:0.5rem 0;">Failed to submit. Try again.</p>'
          : '<p style="font-size:1.07rem;color:var(--text-muted);padding:0.5rem 0;">Submitted -- pending officer review.</p>';
      }
      if (!result.error) {
        supabaseClient.functions.invoke('discord-bot-webhook', {
          body: {
            action: 'bis',
            team: TEAM_SLUG,
            payload: {
              nameRealm: nameRealm,
              bisLink: urlEl.value.trim(),
              notes: notesEl ? notesEl.value.trim() : ''
            }
          }
        });
      }
    });
}

// -- "My list changed (same source)" flag (#278) ----------------------------
// Shared by the BiS tab and, via idSuffix, the Wishlist tab's own copy (#610
// follow-up) -- a raider shouldn't have to switch tabs to find this. Both
// tabs render into the DOM at once (only display:none toggles between them,
// see profileTabBis/profileTabWishlist in renderProfile()), so the two
// copies need distinct element ids or getElementById would only ever find
// the first one.
function bisFlagButtonHTML(player, idSuffix) {
  var suffix = idSuffix || '';
  return (
    '<div style="margin-top:0.75rem;">' +
    '<button class="btn btn-muted" style="font-size:1.04rem;padding:0.3rem 0.8rem;" onclick="toggleBisFlagForm(\'' +
    player.firstName.replace(/'/g, "\\'") +
    "','" +
    suffix +
    '\')">My BiS Changed (Same Source)</button>' +
    '<div id="bisFlagForm-' +
    player.firstName +
    suffix +
    '" style="display:none;margin-top:0.75rem;">' +
    '<textarea id="bisFlagNotes-' +
    player.firstName +
    suffix +
    '" placeholder="Notes (optional)" rows="2" class="self-received-notes" style="max-width:100%;"></textarea>' +
    '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
    '<button class="btn btn-gold" style="font-size:1.04rem;padding:0.3rem 0.8rem;" onclick="submitBisFlag(\'' +
    player.nameRealm.replace(/'/g, "\\'") +
    "','" +
    player.firstName.replace(/'/g, "\\'") +
    "','" +
    suffix +
    '\')">Flag for Review</button>' +
    '<button class="btn btn-muted" style="font-size:1.04rem;padding:0.3rem 0.8rem;" onclick="document.getElementById(\'bisFlagForm-' +
    player.firstName +
    suffix +
    "').style.display='none'\">Cancel</button>" +
    '</div>' +
    '<p class="self-received-note">Use this when the link on file hasn\'t changed but the list behind it has. An officer will recheck your tracked items.</p>' +
    '</div>' +
    '</div>'
  );
}
function toggleBisFlagForm(firstName, idSuffix) {
  var form = document.getElementById('bisFlagForm-' + firstName + (idSuffix || ''));
  if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

function submitBisFlag(nameRealm, firstName, idSuffix) {
  var suffix = idSuffix || '';
  var notesEl = /** @type {HTMLTextAreaElement} */ (document.getElementById('bisFlagNotes-' + firstName + suffix));
  var formEl = document.getElementById('bisFlagForm-' + firstName + suffix);
  if (formEl)
    formEl.innerHTML = '<p style="font-size:1.07rem;color:var(--text-muted);padding:0.5rem 0;">Submitting...</p>';

  if (!supabaseClient) {
    if (formEl)
      formEl.innerHTML =
        '<p style="font-size:1.07rem;color:var(--melee);padding:0.5rem 0;">Failed to submit. Try again.</p>';
    return;
  }

  supabaseClient
    .rpc('flag_bis_list_changed', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_name_realm: nameRealm,
      p_player_note: notesEl ? notesEl.value.trim() : ''
    })
    .then(function (result) {
      if (formEl) {
        formEl.innerHTML = result.error
          ? '<p style="font-size:1.07rem;color:var(--melee);padding:0.5rem 0;">Failed to submit. Try again.</p>'
          : '<p style="font-size:1.07rem;color:var(--text-muted);padding:0.5rem 0;">Flagged for officer review.</p>';
      }
      if (!result.error) {
        var player = findRosterPlayerByNameRealm(nameRealm);
        supabaseClient.functions.invoke('discord-bot-webhook', {
          body: {
            action: 'bis',
            team: TEAM_SLUG,
            payload: {
              nameRealm: nameRealm,
              bisLink: player ? player.bisLink : '',
              notes: notesEl ? notesEl.value.trim() : '',
              sameLink: true
            }
          }
        });
      }
    });
}

function officerUpdateBisLink(nameRealm, firstName) {
  var urlEl = /** @type {HTMLInputElement} */ (document.getElementById('bisUrl-' + firstName));
  if (!urlEl || !urlEl.value.trim()) {
    if (urlEl) urlEl.style.borderColor = 'var(--melee)';
    return;
  }
  var url = urlEl.value.trim();
  var formEl = document.getElementById('bisForm-' + firstName);
  if (formEl) formEl.innerHTML = '<p style="font-size:1.07rem;color:var(--text-muted);padding:0.5rem 0;">Saving...</p>';

  if (!supabaseClient) {
    if (formEl)
      formEl.innerHTML =
        '<p style="font-size:1.07rem;color:var(--melee);padding:0.5rem 0;">Failed to save. Try again.</p>';
    return;
  }

  var player = findRosterPlayerByNameRealm(nameRealm);
  supabaseClient
    .from('players')
    .update({ bis_link: url })
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('name_realm', nameRealm)
    .then(function (result) {
      if (result.error) {
        if (formEl)
          formEl.innerHTML =
            '<p style="font-size:1.07rem;color:var(--melee);padding:0.5rem 0;">Failed to save. Try again.</p>';
        return;
      }
      if (formEl)
        formEl.innerHTML =
          '<p style="font-size:1.07rem;color:var(--text-muted);padding:0.5rem 0;">BiS source updated. Clear cache to refresh.</p>';
      writeAuditLog('BiS Source Updated', 'players', player ? player.id : null, url);
    });
}

function updateBisAllowDiv(nameRealm, firstName) {
  var divEl = document.getElementById('bisAllowDiv-' + firstName);
  if (!divEl) return;
  var allowed = bisAllowedFor(nameRealm);
  divEl.innerHTML = '';
  var btn = document.createElement('button');
  btn.className = 'btn btn-muted';
  btn.style.cssText = 'font-size:1.04rem;padding:0.25rem 0.75rem;';
  if (allowed) {
    btn.textContent = 'Revoke BiS Access';
    btn.onclick = function () {
      revokeBisForPlayer(nameRealm, firstName);
    };
    var badge = document.createElement('span');
    badge.style.cssText = 'font-size:1.02rem;color:var(--heal);margin-left:0.5rem;';
    badge.textContent = 'Submission open';
    divEl.appendChild(btn);
    divEl.appendChild(badge);
  } else {
    btn.textContent = 'Allow BiS Submission';
    btn.onclick = function () {
      allowBisForPlayer(nameRealm, firstName);
    };
    divEl.appendChild(btn);
  }
}

function setBisAllowedForPlayer(nameRealm, firstName, allowed) {
  var divEl = document.getElementById('bisAllowDiv-' + firstName);
  if (divEl) divEl.innerHTML = '<span style="font-size:1.07rem;color:var(--text-muted);">Saving...</span>';

  if (!supabaseClient) {
    updateBisAllowDiv(nameRealm, firstName);
    return;
  }

  var player = findRosterPlayerByNameRealm(nameRealm);
  supabaseClient
    .from('players')
    .update({ bis_allowed: allowed })
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('name_realm', nameRealm)
    .then(function (result) {
      if (!result.error && player) player.bisAllowed = allowed;
      if (!result.error) {
        writeAuditLog(
          allowed ? 'BiS Submission Enabled' : 'BiS Submission Revoked',
          'players',
          player ? player.id : null,
          null
        );
      }
      updateBisAllowDiv(nameRealm, firstName);
    });
}

function allowBisForPlayer(nameRealm, firstName) {
  setBisAllowedForPlayer(nameRealm, firstName, true);
}

function revokeBisForPlayer(nameRealm, firstName) {
  setBisAllowedForPlayer(nameRealm, firstName, false);
}

// Per-raider Wishlist Editing exception (#610/#611 follow-up) -- same shape
// as the bis_allowed toggle above, so an officer can reopen just one
// raider's Wishlist without reopening it for the whole team.
function updateWishlistAllowDiv(nameRealm, firstName) {
  var divEl = document.getElementById('wishlistAllowDiv-' + firstName);
  if (!divEl) return;
  var allowed = wishlistAllowedFor(nameRealm);
  divEl.innerHTML = '';
  var btn = document.createElement('button');
  btn.className = 'btn btn-muted';
  btn.style.cssText = 'font-size:1.04rem;padding:0.25rem 0.75rem;';
  if (allowed) {
    btn.textContent = 'Revoke Wishlist Access';
    btn.onclick = function () {
      revokeWishlistForPlayer(nameRealm, firstName);
    };
    var badge = document.createElement('span');
    badge.style.cssText = 'font-size:1.02rem;color:var(--heal);margin-left:0.5rem;';
    badge.textContent = 'Editing open';
    divEl.appendChild(btn);
    divEl.appendChild(badge);
  } else {
    btn.textContent = 'Allow Wishlist Edit';
    btn.onclick = function () {
      allowWishlistForPlayer(nameRealm, firstName);
    };
    divEl.appendChild(btn);
  }
}

function setWishlistAllowedForPlayer(nameRealm, firstName, allowed) {
  var divEl = document.getElementById('wishlistAllowDiv-' + firstName);
  if (divEl) divEl.innerHTML = '<span style="font-size:1.07rem;color:var(--text-muted);">Saving...</span>';

  if (!supabaseClient) {
    updateWishlistAllowDiv(nameRealm, firstName);
    return;
  }

  var player = findRosterPlayerByNameRealm(nameRealm);
  supabaseClient
    .from('players')
    .update({ wishlist_allowed: allowed })
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('name_realm', nameRealm)
    .then(function (result) {
      if (!result.error && player) player.wishlistAllowed = allowed;
      if (!result.error) {
        writeAuditLog(
          allowed ? 'Wishlist Edit Enabled' : 'Wishlist Edit Revoked',
          'players',
          player ? player.id : null,
          null
        );
      }
      updateWishlistAllowDiv(nameRealm, firstName);
    });
}

function allowWishlistForPlayer(nameRealm, firstName) {
  setWishlistAllowedForPlayer(nameRealm, firstName, true);
}

function revokeWishlistForPlayer(nameRealm, firstName) {
  setWishlistAllowedForPlayer(nameRealm, firstName, false);
}

// -- Self-received (raider marks item from profile) ------------------------
// 'Mythic'/'Heroic'/'Champion' is the UI vocabulary (matches the diff select
// below); self_received_requests.track stores the same Hero/Myth/Champion
// values as rclc_loot (js/common.js mapSupabaseLoot, js/tabs/tab-priority.js).
function _selfReceivedTrackFromDiff(diff) {
  return diff === 'Mythic' ? 'Myth' : diff === 'Heroic' ? 'Hero' : diff;
}

// dbSlot is the raw bis_items.slot of the row this button was rendered for, as
// distinct from `slot` (the display slot, which prefers the item catalog's own
// slot name). They diverge routinely -- the catalog says "Boots"/"Gloves"/
// "Trinket" where bis_items says "Feet"/"Hands"/"Trinket 1" -- so only dbSlot
// can identify which BiS row an approval fills (#386). `slot` stays the display
// value used for the optimistic DATA.selfReceived patch below.
function showSelfReceivedForm(firstName, nameRealm, item, slot, rowId, defaultSource, isOfficer, dbSlot) {
  if (event) event.stopPropagation();
  var formEl = document.getElementById('form-' + rowId);
  if (!formEl) return;
  if (formEl.style.display !== 'none') {
    formEl.style.display = 'none';
    return;
  }
  var sources = ['M+', 'Great Vault', 'Crafted', 'Catalyst', 'Bonus Roll', 'Other'];
  var opts = '<option value="">-- How did you get it? --</option>';
  for (var si = 0; si < sources.length; si++) {
    opts +=
      '<option value="' +
      sources[si] +
      '"' +
      (sources[si] === defaultSource ? ' selected' : '') +
      '>' +
      sources[si] +
      '</option>';
  }
  var fnSafe = firstName.replace(/'/g, "\\'");
  var nrSafe = nameRealm.replace(/'/g, "\\'");
  var itemSafe = item.replace(/'/g, "\\'");
  var slotSafe = slot.replace(/'/g, "\\'");
  var dbSlotSafe = String(dbSlot || '').replace(/'/g, "\\'");
  var submitFn = isOfficer
    ? "submitDirectMarkReceived('" +
      fnSafe +
      "','" +
      nrSafe +
      "','" +
      itemSafe +
      "','" +
      slotSafe +
      "','" +
      rowId +
      "','" +
      dbSlotSafe +
      "')"
    : "submitSelfReceivedRequest('" +
      fnSafe +
      "','" +
      nrSafe +
      "','" +
      itemSafe +
      "','" +
      slotSafe +
      "','" +
      rowId +
      "','" +
      dbSlotSafe +
      "')";
  var submitLabel = isOfficer ? 'Mark received' : 'Submit request';
  var noteText = isOfficer
    ? ''
    : '<p class="self-received-note">An officer will review and approve this. Once approved it will appear on your profile.</p>';
  var formHtml =
    '<div class="self-received-form-inner" onclick="event.stopPropagation()">' +
    '<div style="display:flex;gap:0.5rem;margin-bottom:0.4rem;">' +
    '<select id="diff-' +
    rowId +
    '" class="self-received-source" style="flex:0 0 auto;width:auto;">' +
    '<option value="" selected>-- Difficulty --</option>' +
    '<option value="Mythic">Mythic</option>' +
    '<option value="Heroic">Heroic</option>' +
    '<option value="Champion">Champion (Normal)</option>' +
    '</select>' +
    '<select class="self-received-source" id="src-' +
    rowId +
    '" style="flex:1;">' +
    opts +
    '</select>' +
    '</div>' +
    '<textarea class="self-received-notes" id="notes-' +
    rowId +
    '" placeholder="Notes (optional)" rows="2"></textarea>' +
    '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
    '<button class="btn btn-gold" style="font-size:1.04rem;padding:0.3rem 0.8rem;" onclick="event.stopPropagation();' +
    submitFn +
    '">' +
    submitLabel +
    '</button>' +
    '<button class="btn btn-muted" style="font-size:1.04rem;padding:0.3rem 0.8rem;" onclick="event.stopPropagation();document.getElementById(\'form-' +
    rowId +
    "').style.display='none'\">Cancel</button>" +
    '</div>' +
    noteText +
    '</div>';
  formEl.innerHTML = formHtml;
  formEl.style.display = 'block';
}

function submitSelfReceivedRequest(firstName, nameRealm, item, slot, rowId, dbSlot) {
  var sourceEl = /** @type {HTMLSelectElement} */ (document.getElementById('src-' + rowId));
  var notesEl = /** @type {HTMLTextAreaElement} */ (document.getElementById('notes-' + rowId));
  var diffEl = /** @type {HTMLSelectElement} */ (document.getElementById('diff-' + rowId));
  if (!sourceEl || !sourceEl.value) {
    if (sourceEl) sourceEl.style.borderColor = 'var(--melee)';
    return;
  }
  if (!diffEl || !diffEl.value) {
    if (diffEl) diffEl.style.borderColor = 'var(--melee)';
    return;
  }
  var diff = diffEl.value;
  var formEl = document.getElementById('form-' + rowId);
  if (formEl)
    formEl.innerHTML = '<p style="font-size:1.07rem;color:var(--text-muted);padding:0.5rem 0;">Submitting...</p>';

  if (!supabaseClient) {
    if (formEl)
      formEl.innerHTML =
        '<p style="font-size:1.07rem;color:var(--melee);padding:0.5rem 0;">Failed to submit. Try again.</p>';
    return;
  }

  supabaseClient
    .rpc('submit_self_received', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_name_realm: nameRealm,
      p_item_name: item,
      p_track: _selfReceivedTrackFromDiff(diff),
      p_source: sourceEl.value,
      p_note: notesEl ? notesEl.value : '',
      // The raw bis_items.slot, not the display slot -- approval flips exactly
      // this row (#386). Empty for legacy rows that never had a slot, which the
      // trigger handles by only inferring a target when the item occupies a
      // single slot for that player.
      p_slot: dbSlot || ''
    })
    .then(function (result) {
      if (!formEl) return;
      if (result.error) {
        formEl.innerHTML =
          '<p style="font-size:1.07rem;color:var(--melee);padding:0.5rem 0;">Failed to submit. Try again.</p>';
        return;
      }
      var row = result.data && result.data[0];
      var autoApproved = !!(row && row.auto_approved);
      if (autoApproved && DATA && DATA.selfReceived) {
        if (!DATA.selfReceived[firstName]) DATA.selfReceived[firstName] = [];
        DATA.selfReceived[firstName].push({ item: item, slot: slot, source: diff + ': ' + sourceEl.value });
      } else {
        supabaseClient.functions.invoke('discord-bot-webhook', {
          body: {
            action: 'selfreceived',
            team: TEAM_SLUG,
            payload: {
              player: nameRealm,
              item: item,
              slot: slot,
              source: sourceEl.value,
              notes: notesEl ? notesEl.value : ''
            }
          }
        });
      }
      formEl.innerHTML =
        '<p style="font-size:1.07rem;color:var(--text-muted);padding:0.5rem 0;">' +
        (autoApproved ? 'Marked as received.' : 'Request submitted -- pending officer approval.') +
        '</p>';
      var btn = /** @type {HTMLElement} */ (
        document.querySelector('#bisrow-' + firstName + '-' + rowId.split('-').pop() + ' .mark-received-btn')
      );
      if (btn) btn.style.display = 'none';
      if (autoApproved) refreshBisCompletion(firstName, nameRealm);
    });
}

function submitDirectMarkReceived(firstName, nameRealm, item, slot, rowId, dbSlot) {
  var sourceEl = /** @type {HTMLSelectElement} */ (document.getElementById('src-' + rowId));
  var notesEl = /** @type {HTMLTextAreaElement} */ (document.getElementById('notes-' + rowId));
  var diffEl = /** @type {HTMLSelectElement} */ (document.getElementById('diff-' + rowId));
  if (!sourceEl || !sourceEl.value) {
    if (sourceEl) sourceEl.style.borderColor = 'var(--melee)';
    return;
  }
  if (!diffEl || !diffEl.value) {
    if (diffEl) diffEl.style.borderColor = 'var(--melee)';
    return;
  }
  var diff = diffEl.value;
  var source = diff + ': ' + sourceEl.value;
  var formEl = document.getElementById('form-' + rowId);
  if (formEl) formEl.innerHTML = '<p style="font-size:1.07rem;color:var(--text-muted);padding:0.5rem 0;">Saving...</p>';

  if (!supabaseClient) {
    if (formEl)
      formEl.innerHTML = '<p style="font-size:1.07rem;color:var(--melee);padding:0.5rem 0;">Failed. Try again.</p>';
    return;
  }

  supabaseClient
    .rpc('direct_mark_received', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_name_realm: nameRealm,
      p_item_name: item,
      p_track: _selfReceivedTrackFromDiff(diff),
      p_source: sourceEl.value,
      p_note: notesEl ? notesEl.value : '',
      // See submitSelfReceivedRequest: the raw bis_items.slot, targeting the
      // exact row this button was rendered for (#386).
      p_slot: dbSlot || ''
    })
    .then(function (result) {
      if (!formEl) return;
      if (result.error) {
        formEl.innerHTML = '<p style="font-size:1.07rem;color:var(--melee);padding:0.5rem 0;">Failed. Try again.</p>';
        return;
      }
      formEl.style.display = 'none';
      var rowEl = document.getElementById(rowId);
      if (rowEl) {
        rowEl.classList.add('bis-received');
        var btn = rowEl.querySelector('.mark-received-btn');
        if (btn) btn.outerHTML = '<span class="bis-self-received-badge">' + source + '</span>';
      }
      if (DATA && DATA.selfReceived) {
        if (!DATA.selfReceived[firstName]) DATA.selfReceived[firstName] = [];
        DATA.selfReceived[firstName].push({ item: item, slot: slot, source: source });
      }
      var markedPlayer = findRosterPlayerByNameRealm(nameRealm);
      writeAuditLog('Loot Marked Received', 'players', markedPlayer ? markedPlayer.id : null, item);
      refreshBisCompletion(firstName, nameRealm);
    });
}

// -- Player profile (shared between public and officer pages) --------------
// backTo: 'landing' = public page, 'officer' = officer page
// container: optional DOM element to render into (officer inline panel);
//            if omitted renders into #profileView (public page)
// Sub-tab state for the raider's own profile view (backTo === 'landing' only
// -- the officer inline view keeps its original single-flow layout). Mirrors
// js/roster.js's _rosterSubTab/showRosterSubTab pattern and reuses the same
// .roster-sub-nav/.roster-sub-tab CSS. Module-level so it survives the
// re-renders renderProfile() itself triggers (wishlist saves, the wishlist
// section's async load) without resetting back to Overview each time.
var _profileSubTab = 'overview';
var PROFILE_SUB_TABS = ['overview', 'bis', 'wishlist', 'stream'];

function showProfileSubTab(tab) {
  _profileSubTab = tab;
  PROFILE_SUB_TABS.forEach(function (t) {
    var el = document.getElementById('profileTab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (el) el.style.display = t === tab ? '' : 'none';
    var btn = document.getElementById('profileSubTab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn) btn.classList.toggle('active', t === tab);
  });
}

function renderProfile(firstName, backTo, container) {
  var norm = normalise(firstName);
  var player = null;
  for (var i = 0; i < DATA.roster.length; i++) {
    if (normalise(DATA.roster[i].firstName) === norm) {
      player = DATA.roster[i];
      break;
    }
  }
  if (!player) return;

  // backTo === 'landing' is the public-page render (officer.html's inline roster
  // table uses 'officer' instead) -- only reflect those into the URL (#517).
  if (backTo === 'landing') setViewHash('profile/' + encodeURIComponent(player.firstName));

  var displayName = player.nick || player.firstName;
  var initials = displayName.slice(0, 2).toUpperCase();
  var classLine = player.class
    ? '<span class="badge badge-class" style="' +
      classBadgeStyle(player.class) +
      '">' +
      (player.spec || player.class) +
      '</span>'
    : '';
  var trialBadge = player.isTrial ? '<span class="badge badge-trial">Trial</span>' : '';
  var benchBadge = player.isBench
    ? '<span class="badge" style="background:rgba(255,255,255,0.04);color:var(--text);border:1px solid var(--border);">Bench</span>'
    : '';
  var backupTankBadge = player.isBackupTank ? '<span class="badge badge-backup-tank">Backup Tank</span>' : '';
  var backupHealerBadge = player.isBackupHealer ? '<span class="badge badge-backup-healer">Backup Healer</span>' : '';

  // Per-character Armory/Raider.IO/WCL links (#289) -- constructed from
  // name/realm, no submission or API call.
  var charLinks = characterProfileLinks(player.firstName, player.realm);
  var charLinksHTML = charLinks
    ? '<div class="profile-links">' +
      '<a class="profile-link-icon" href="' +
      charLinks.warcraftLogs +
      '" target="_blank" rel="noopener" title="WarcraftLogs" aria-label="WarcraftLogs">' +
      '<img src="https://www.google.com/s2/favicons?sz=64&domain=warcraftlogs.com" alt="" width="24" height="24" loading="lazy"></a>' +
      '<a class="profile-link-icon" href="' +
      charLinks.raiderIo +
      '" target="_blank" rel="noopener" title="Raider.IO" aria-label="Raider.IO">' +
      '<img src="https://www.google.com/s2/favicons?sz=64&domain=raider.io" alt="" width="24" height="24" loading="lazy"></a>' +
      '<a class="profile-link-icon" href="' +
      charLinks.armory +
      '" target="_blank" rel="noopener" title="Armory" aria-label="Armory">' +
      '<img src="https://www.google.com/s2/favicons?sz=64&domain=worldofwarcraft.com" alt="" width="24" height="24" loading="lazy"></a>' +
      '</div>'
    : '';

  // Attendance
  var attendPct = getDisplayAttendancePct(player);
  var barWidth = attendPct;
  var attendDetail = (DATA.attendanceDetails || {})[player.firstName] || [];
  // Same season-scoping as renderAttendTrend -- mapSupabaseAttendanceDetails
  // returns full history, so without this a new season's "click to expand"
  // list still shows the previous season's No Show/Excused/Late nights.
  var attendRange = getSeasonDateRange();
  if (attendRange.start || attendRange.end) {
    attendDetail = attendDetail.filter(function (r) {
      return (!attendRange.start || r.date >= attendRange.start) && (!attendRange.end || r.date <= attendRange.end);
    });
  }
  var hasPenalties = attendDetail.length > 0;
  var attendExtra = '';
  if (hasPenalties) {
    attendExtra +=
      '<div id="attend-detail-' +
      player.firstName +
      '" style="display:none;margin-top:0.75rem;flex-direction:column;gap:0.3rem;">';
    for (var ai = 0; ai < attendDetail.length; ai++) {
      var ae = attendDetail[ai];
      var sc = ae.status === 'No Show' ? 'var(--melee)' : 'var(--gold)';
      attendExtra +=
        '<div style="display:flex;justify-content:space-between;font-size:1rem;padding:0.25rem 0;border-bottom:1px solid var(--border);">';
      attendExtra += '<span style="color:var(--text);">' + ae.date + '</span>';
      attendExtra += '<span style="color:' + sc + ';font-weight:600;">' + ae.status + '</span></div>';
    }
    attendExtra += '</div>';
  }

  // Loot (season-filtered when ACTIVE_SEASON is set)
  var lootEntry = getSeasonLootEntry(player.nameRealm);
  var allLootEntry = getLootEntry(player.nameRealm); // unfiltered, for received map
  var lootCount = lootEntry ? lootEntry.count : 0;
  var lootItemsHTML = '';
  var lastItems = [];
  var seasonLootItems = getSeasonLootItems(player.nameRealm);
  if (seasonLootItems.length > 0) {
    var sortedLoot = seasonLootItems.slice().sort(function (a, b) {
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
    var lastDate = sortedLoot[0].date;
    for (var ld = 0; ld < sortedLoot.length; ld++) {
      if (sortedLoot[ld].date === lastDate) lastItems.push(sortedLoot[ld]);
      else break;
    }
    for (var li = 0; li < seasonLootItems.length; li++) {
      var li_obj = seasonLootItems[li];
      var li_name = typeof li_obj === 'string' ? li_obj : li_obj.name;
      var li_diff = typeof li_obj === 'object' && li_obj.difficulty ? li_obj.difficulty : '';
      var li_date = typeof li_obj === 'object' && li_obj.date ? li_obj.date : '';
      var li_slot = lookupItemSlot(li_name);
      var li_sub =
        (li_slot ? '<span style="color:' + getSlotColor(li_slot) + ';">' + li_slot + '</span>' : '') +
        (li_slot && li_diff ? ' - ' : '') +
        (li_diff ? '<span>' + li_diff + '</span>' : '') +
        ((li_slot || li_diff) && li_date ? ' - ' : '') +
        (li_date ? '<span>' + li_date + '</span>' : '');
      lootItemsHTML +=
        '<div style="font-size:1rem;color:var(--text);padding:0.3rem 0;border-bottom:1px solid var(--border);">' +
        li_name +
        (li_sub ? '<div style="font-size:1rem;color:var(--text-muted);margin-top:0.1rem;">' + li_sub + '</div>' : '') +
        '</div>';
    }
  }

  // BiS source
  var bisStatusHTML = player.bisLink
    ? '<div class="bis-row"><div class="bis-dot yes"></div><a class="bis-link" href="' +
      player.bisLink +
      '" target="_blank" rel="noopener">View BiS Source</a></div>'
    : '<div class="bis-row"><div class="bis-dot no"></div><span class="bis-none">No BiS list submitted yet</span></div>';

  var bisActionHTML;
  if (backTo === 'officer') {
    var bisAllowed = bisAllowedFor(player.nameRealm);
    bisActionHTML =
      '<div style="margin-top:0.75rem;">' +
      '<button class="btn btn-muted" style="font-size:1.04rem;padding:0.3rem 0.8rem;" onclick="toggleBisForm(\'' +
      player.firstName.replace(/'/g, "\\'") +
      '\')">Update BiS Source</button>' +
      '<div id="bisForm-' +
      player.firstName +
      '" style="display:none;margin-top:0.75rem;">' +
      '<input type="url" id="bisUrl-' +
      player.firstName +
      '" placeholder="Paste BiS list URL" class="self-received-source" style="max-width:100%;font-size:1rem;">' +
      '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
      '<button class="btn request-approve-btn" onclick="officerUpdateBisLink(\'' +
      player.nameRealm.replace(/'/g, "\\'") +
      "','" +
      player.firstName.replace(/'/g, "\\'") +
      '\')">Save</button>' +
      '<button class="btn btn-muted" style="font-size:1.04rem;padding:0.25rem 0.75rem;" onclick="document.getElementById(\'bisForm-' +
      player.firstName +
      "').style.display='none'\">Cancel</button>" +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div id="bisAllowDiv-' +
      player.firstName +
      '" style="margin-top:0.5rem;"></div>' +
      '<div id="wishlistAllowDiv-' +
      player.firstName +
      '" style="margin-top:0.5rem;"></div>';
  } else {
    bisActionHTML = '';
    if (bisSubmissionsOpen() || bisAllowedFor(player.nameRealm)) {
      var bisBtnLabel = player.bisLink ? 'Update BiS Source' : 'Submit BiS Source';
      bisActionHTML +=
        '<div style="margin-top:0.75rem;">' +
        '<button class="btn btn-muted" style="font-size:1.04rem;padding:0.3rem 0.8rem;" onclick="toggleBisForm(\'' +
        player.firstName.replace(/'/g, "\\'") +
        '\')">' +
        bisBtnLabel +
        '</button>' +
        '<div id="bisForm-' +
        player.firstName +
        '" style="display:none;margin-top:0.75rem;">' +
        '<input type="url" id="bisUrl-' +
        player.firstName +
        '" placeholder="Paste your BiS list URL" class="self-received-source" style="max-width:100%;font-size:1rem;">' +
        '<textarea id="bisNotes-' +
        player.firstName +
        '" placeholder="Notes (optional)" rows="2" class="self-received-notes" style="max-width:100%;margin-top:0.4rem;"></textarea>' +
        '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
        '<button class="btn btn-gold" style="font-size:1.04rem;padding:0.3rem 0.8rem;" onclick="submitBiSForm(\'' +
        player.nameRealm.replace(/'/g, "\\'") +
        "','" +
        player.firstName.replace(/'/g, "\\'") +
        '\')">Submit</button>' +
        '<button class="btn btn-muted" style="font-size:1.04rem;padding:0.3rem 0.8rem;" onclick="document.getElementById(\'bisForm-' +
        player.firstName +
        "').style.display='none'\">Cancel</button>" +
        '</div>' +
        '<p class="self-received-note">An officer will review your submission. Once approved it will appear on your profile.</p>' +
        '</div>' +
        '</div>';
    }
    // Always-available even when submissions are closed and this character
    // isn't individually allow-listed: this doesn't change the link on file,
    // it just re-queues it so an officer knows to recheck items behind it
    // (#278). Only makes sense once there's a link to flag.
    if (player.bisLink) {
      bisActionHTML += bisFlagButtonHTML(player, '');
    }
  }
  var bisHTML = bisStatusHTML + bisActionHTML;

  // M+ exclusion section
  var mplusHTML = '';
  if (backTo === 'officer') {
    mplusHTML = '';
  } else if (player.mPlusExcluded) {
    mplusHTML =
      '<div style="display:flex;align-items:center;gap:0.5rem;">' +
      '<span class="signup-status-badge signup-status-open" style="font-size:0.93rem;">Excluded</span>' +
      '<span style="font-size:1.04rem;color:var(--text-muted);">No longer required to do weekly M+ dungeons.</span>' +
      '</div>' +
      (player.mPlusNote
        ? '<div style="font-size:1.04rem;color:var(--text);margin-top:0.4rem;font-style:italic;">' +
          player.mPlusNote +
          '</div>'
        : '');
  } else if (player.mPlusRejected) {
    var fnMplusR = player.firstName.replace(/'/g, "\\'");
    var nrMplusR = player.nameRealm.replace(/'/g, "\\'");
    mplusHTML =
      '<div style="display:flex;align-items:center;gap:0.5rem;">' +
      '<span class="signup-status-badge signup-status-closed" style="font-size:0.93rem;">Rejected</span>' +
      '<span style="font-size:1.04rem;color:var(--text-muted);">Your M+ exclusion request was not approved.</span>' +
      '</div>' +
      (player.mPlusRejectionNote
        ? '<div style="margin-top:0.5rem;padding:0.4rem 0.6rem;background:rgba(255,124,92,0.08);border-left:3px solid var(--melee);border-radius:3px;font-size:1.04rem;color:var(--text);font-style:italic;">' +
          player.mPlusRejectionNote +
          '</div>'
        : '');
    if (DATA && DATA.mPlusExclusionsOpen) {
      mplusHTML +=
        '<div style="margin-top:0.75rem;">' +
        '<button class="btn btn-muted" style="font-size:1.04rem;padding:0.3rem 0.8rem;" onclick="toggleMPlusForm(\'' +
        fnMplusR +
        '\')">Re-submit Request</button>' +
        '<div id="mplusForm-' +
        player.firstName +
        '" style="display:none;margin-top:0.75rem;">' +
        '<div style="font-size:1.04rem;color:var(--text-muted);margin-bottom:0.5rem;">Request exclusion from the weekly M+ requirement. Your Raider.io profile is filled in below.</div>' +
        '<label style="display:flex;align-items:flex-start;gap:0.4rem;font-size:1.02rem;color:var(--text);margin-bottom:0.4rem;"><input type="checkbox" id="mplusMythCheck-' +
        player.firstName +
        '" style="margin-top:0.2rem;">I am 6/6 Myth in every M+ obtainable slot.</label>' +
        '<div style="display:flex;align-items:center;gap:0.5rem;font-size:1.02rem;color:var(--text);margin-bottom:0.5rem;">Gem sockets filled (Helm/Bracer/Belt): ' +
        '<select id="mplusSocketCount-' +
        player.firstName +
        '" class="self-received-source" style="width:auto;">' +
        '<option value="">Select...</option>' +
        '<option value="3">3 of 3</option>' +
        '<option value="2">2 of 3</option>' +
        '<option value="1">1 of 3</option>' +
        '<option value="0">0 of 3</option>' +
        '</select>' +
        '</div>' +
        '<input type="url" id="mplusUrl-' +
        player.firstName +
        '" value="' +
        (charLinks ? charLinks.raiderIo : '') +
        '" placeholder="https://raider.io/characters/..." class="self-received-source" style="max-width:100%;font-size:1rem;">' +
        '<textarea id="mplusNotes-' +
        player.firstName +
        '" placeholder="Notes -- e.g. still on a Hero-track raid trinket with no Myth M+ equivalent" rows="2" class="self-received-notes" style="max-width:100%;margin-top:0.4rem;"></textarea>' +
        '<p id="mplusCheckError-' +
        player.firstName +
        '" style="display:none;color:var(--melee);font-size:1.02rem;margin:0.4rem 0 0;">Please confirm the Myth track checkbox and select at least 2 of 3 gem sockets before submitting.</p>' +
        '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
        '<button class="btn btn-gold" style="font-size:1.04rem;padding:0.3rem 0.8rem;" onclick="submitMPlusExclusionForm(\'' +
        nrMplusR +
        "','" +
        fnMplusR +
        '\')">Submit</button>' +
        '<button class="btn btn-muted" style="font-size:1.04rem;padding:0.3rem 0.8rem;" onclick="document.getElementById(\'mplusForm-' +
        player.firstName +
        "').style.display='none'\">Cancel</button>" +
        '</div>' +
        '<p class="self-received-note">An officer will review your request. Once approved you will no longer need to do the required weekly M+ dungeons.</p>' +
        '</div>' +
        '</div>';
    }
  } else {
    if (DATA && DATA.mPlusExclusionsOpen) {
      var fnMplus = player.firstName.replace(/'/g, "\\'");
      var nrMplus = player.nameRealm.replace(/'/g, "\\'");
      mplusHTML =
        '<button class="btn btn-muted" style="font-size:1.04rem;padding:0.3rem 0.8rem;" onclick="toggleMPlusForm(\'' +
        fnMplus +
        '\')">Request M+ Exclusion</button>' +
        '<div id="mplusForm-' +
        player.firstName +
        '" style="display:none;margin-top:0.75rem;">' +
        '<div style="font-size:1.04rem;color:var(--text-muted);margin-bottom:0.5rem;">Request exclusion from the weekly M+ requirement. Your Raider.io profile is filled in below.</div>' +
        '<label style="display:flex;align-items:flex-start;gap:0.4rem;font-size:1.02rem;color:var(--text);margin-bottom:0.4rem;"><input type="checkbox" id="mplusMythCheck-' +
        player.firstName +
        '" style="margin-top:0.2rem;">I am 6/6 Myth in every M+ obtainable slot.</label>' +
        '<div style="display:flex;align-items:center;gap:0.5rem;font-size:1.02rem;color:var(--text);margin-bottom:0.5rem;">Gem sockets filled (Helm/Bracer/Belt): ' +
        '<select id="mplusSocketCount-' +
        player.firstName +
        '" class="self-received-source" style="width:auto;">' +
        '<option value="">Select...</option>' +
        '<option value="3">3 of 3</option>' +
        '<option value="2">2 of 3</option>' +
        '<option value="1">1 of 3</option>' +
        '<option value="0">0 of 3</option>' +
        '</select>' +
        '</div>' +
        '<input type="url" id="mplusUrl-' +
        player.firstName +
        '" value="' +
        (charLinks ? charLinks.raiderIo : '') +
        '" placeholder="https://raider.io/characters/..." class="self-received-source" style="max-width:100%;font-size:1rem;">' +
        '<textarea id="mplusNotes-' +
        player.firstName +
        '" placeholder="Notes -- e.g. still on a Hero-track raid trinket with no Myth M+ equivalent" rows="2" class="self-received-notes" style="max-width:100%;margin-top:0.4rem;"></textarea>' +
        '<p id="mplusCheckError-' +
        player.firstName +
        '" style="display:none;color:var(--melee);font-size:1.02rem;margin:0.4rem 0 0;">Please confirm the Myth track checkbox and select at least 2 of 3 gem sockets before submitting.</p>' +
        '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
        '<button class="btn btn-gold" style="font-size:1.04rem;padding:0.3rem 0.8rem;" onclick="submitMPlusExclusionForm(\'' +
        nrMplus +
        "','" +
        fnMplus +
        '\')">Submit</button>' +
        '<button class="btn btn-muted" style="font-size:1.04rem;padding:0.3rem 0.8rem;" onclick="document.getElementById(\'mplusForm-' +
        player.firstName +
        "').style.display='none'\">Cancel</button>" +
        '</div>' +
        '<p class="self-received-note">An officer will review your request. Once approved you will no longer need to do the required weekly M+ dungeons.</p>' +
        '</div>';
    } else {
      mplusHTML =
        '<span style="font-size:1.04rem;color:var(--text-muted);">M+ exclusion requests are currently closed.</span>';
    }
  }

  // Build received lookup from full (unfiltered) loot history so BiS markers are always accurate
  var receivedMap = {};
  var receivedItems = (allLootEntry && allLootEntry.items) || [];
  for (var ri = 0; ri < receivedItems.length; ri++) {
    var ri_obj = receivedItems[ri];
    var ri_name = typeof ri_obj === 'string' ? ri_obj : ri_obj.name;
    var ri_key = normalise(ri_name);
    if (!receivedMap[ri_key]) receivedMap[ri_key] = [];
    receivedMap[ri_key].push(typeof ri_obj === 'object' ? ri_obj : { name: ri_name });
  }

  // Self-received (officer-approved) lookup
  var selfRecItems = getSelfReceivedItems(player.firstName);
  var selfRecMap = {};
  for (var sr = 0; sr < selfRecItems.length; sr++) {
    selfRecMap[normalise(selfRecItems[sr].item)] = selfRecItems[sr];
  }

  // Computed here (rather than down where streamSectionHTML is) so
  // _wishlistPrefs is already populated by the time the BiS List merge below
  // reads it -- ownWishlistSectionHTML() is what triggers/caches that fetch.
  //
  // Branches on actual ownership, not backTo -- an officer can reach
  // someone else's profile with backTo either value (officer.html's Roster
  // tab passes 'officer'; index.html's hash-based lookup in js/roster.js's
  // _resolveHashProfile() passes 'landing' even for an officer viewer, since
  // that's also the raider-self value). ownWishlistSectionHTML() itself
  // isn't loaded at all on officer.html and would silently no-op for a
  // non-owner anyway, but checking ownership up front is what actually
  // decides which section (editable vs read-only) to show, not just which
  // one happens to be safe to call.
  var _profileSession = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
  var isOwnWishlistView = !!(
    _profileSession &&
    _profileSession.nameRealm &&
    normalise(_profileSession.nameRealm) === normalise(player.nameRealm)
  );
  var wishlistSectionHTML = isOwnWishlistView
    ? typeof ownWishlistSectionHTML === 'function'
      ? ownWishlistSectionHTML(player, backTo)
      : ''
    : typeof officerWishlistSectionHTML === 'function'
      ? officerWishlistSectionHTML(player, backTo)
      : '';

  // Priority list
  var bisItems = getBisItems(player.nameRealm).filter(function (e) {
    return typeof isItemInSeasonScope !== 'function' || isItemInSeasonScope(e.item, e.season);
  });
  // Read-time merge only -- bis_items itself is never written to. A raider's
  // own wishlist "BiS" tag supersedes the officer's pick for that slot in
  // this display; untouched everywhere else (tab-conflicts.js,
  // tab-priority.js, the officer's own bis_items grid all still read
  // getBisItems()/bis_items directly, unaffected by this local reassignment).
  if (backTo === 'landing' && typeof wishlistBisMergeGroups === 'function') {
    var bisMerge = wishlistBisMergeGroups(player, bisItems);
    bisItems = bisMerge.fromWishlist.concat(bisMerge.officerSet);
  } else if (
    backTo === 'officer' &&
    (typeof featureEnabled !== 'function' || featureEnabled('bis')) &&
    typeof _teamItemPreferences !== 'undefined' &&
    _teamItemPreferences !== null
  ) {
    // Officer's read view of a raider's profile (Roster tab) -- index.html's
    // wishlistBisMergeGroups()/_wishlistPrefs aren't available here (only
    // loaded on that page), so this reuses tab-priority.js's already-fetched
    // _teamItemPreferences (populated once at officer dashboard load for the
    // Incomplete Wishlists banner) instead of a second per-profile fetch.
    var officerPrefs = _teamItemPreferences.filter(function (p) {
      return p.player_id === player.id;
    });
    var bisMergeOfficer = bisMergeWishlistPrefs(officerPrefs, bisItems, player.id);
    bisItems = bisMergeOfficer.fromWishlist.concat(bisMergeOfficer.officerSet);
  }
  var itemSlotsForSort = DATA.itemSlots || {};
  bisItems = bisItems.slice().sort(function (a, b) {
    return bisDisplaySortKey(a, itemSlotsForSort) - bisDisplaySortKey(b, itemSlotsForSort);
  });
  var rows = '';
  for (var bi = 0; bi < bisItems.length; bi++) {
    var entry = bisItems[bi];
    var item = entry.item,
      bisSlot = entry.slot;
    var rank = getRank(player.nameRealm, item);
    var slot = (DATA.itemSlots || {})[item] || bisSlot || '';
    // The raw bis_items.slot for this row, which "Mark received" sends so the
    // approval flips this exact row rather than every row sharing the item
    // (#386). Distinct from `slot` above, which prefers the catalog's name.
    var dbSlot = entry.dbSlot || '';
    var isGen = item === 'M+' || item === 'Crafted' || item === 'Catalyst';
    var received = receivedMap[normalise(item)] || null;
    var selfRec = selfRecMap[normalise(item)] || null;
    var isReceived = received || selfRec;
    // Mythic received outranks Heroic for the row's own highlight -- green
    // for Mythic (or any non-Hero/Myth track, e.g. Champion), gold for a
    // Heroic-only receive, so the row itself signals "how good" the receive
    // was, not just that a receive happened.
    var hasMythicReceived = !!(
      received &&
      received.some(function (r) {
        return r.difficulty === 'Mythic';
      })
    );
    var hasHeroicOnlyReceived =
      !hasMythicReceived &&
      !!(
        received &&
        received.some(function (r) {
          return r.difficulty === 'Heroic';
        })
      );
    // A Heroic-only receive (in-raid or self-reported) shouldn't hide the
    // button for going after the Mythic version of the same item -- only a
    // Mythic receive should retire the row.
    var hasMythicSelfReceived = !!(selfRec && /^Mythic:/.test(selfRec.source || ''));
    var mythicAlreadyReceived = hasMythicReceived || hasMythicSelfReceived;
    var rowId = 'bisrow-' + player.firstName + '-' + bi;
    rows +=
      '<div class="priority-row' +
      (isReceived ? ' bis-received' + (hasHeroicOnlyReceived ? ' bis-received-heroic' : '') : '') +
      '" id="' +
      rowId +
      '" style="grid-template-columns:' +
      PRIORITY_ROW_GRID_COLUMNS +
      ';">';
    rows += isGen
      ? '<span style="font-size:1rem;color:var(--text-dim);min-width:40px;text-align:center;">-</span>'
      : rankPillHTML(rank);
    rows += '<span class="priority-item-slot" style="color:' + getSlotColor(slot) + ';">' + slot + '</span>';
    rows +=
      '<span class="priority-item-name" style="text-align:center;" title="' +
      item +
      '">' +
      item +
      (entry.fromWishlist
        ? ' <span style="color:var(--gold-light);font-size:0.85em;font-weight:600;">(Wishlist)</span>'
        : '') +
      '</span>';
    var defaultSrc = isGen ? item : '';
    var isOfficer = backTo === 'officer';
    var officerFlag = isOfficer ? 'true' : 'false';
    var markRecvBtn =
      '<button class="mark-received-btn" style="font-size:0.91rem;padding:2px 7px;margin-top:2px;" onclick="event.stopPropagation();showSelfReceivedForm(\'' +
      player.firstName.replace(/'/g, "\\'") +
      "','" +
      player.nameRealm.replace(/'/g, "\\'") +
      "','" +
      item.replace(/'/g, "\\'") +
      "','" +
      slot.replace(/'/g, "\\'") +
      "','" +
      rowId +
      "','" +
      defaultSrc.replace(/'/g, "\\'") +
      "'," +
      officerFlag +
      ",'" +
      dbSlot.replace(/'/g, "\\'") +
      '\')">Mark received</button>';
    // The officer's own direct "Mark received" shortcut doesn't go through
    // the approval queue at all (submitDirectMarkReceived, not
    // submit_self_received), so it's unaffected by the requests flag -- only
    // the raider-facing "Submit request" button is gated on it. Either way, a
    // Mythic receive already on file retires the row for good.
    var showMarkBtn = !mythicAlreadyReceived && (isOfficer || featureEnabled('requests'));
    if (received) {
      var badges = '';
      for (var rv = 0; rv < received.length; rv++) {
        var rv_diff = received[rv].difficulty || '';
        var rv_date = received[rv].date || '';
        var rv_colors = RANK_PILL_DIFF_COLORS[rv_diff === 'Mythic' ? 'mythic' : 'heroic'];
        badges +=
          '<span style="display:inline-flex;align-items:center;gap:5px;">' +
          '<span class="bis-received-badge" style="background:' +
          rv_colors.bg +
          ';color:' +
          rv_colors.c +
          ';border-color:' +
          rv_colors.bd +
          ';">' +
          (rv_diff === 'Mythic' ? 'M' : rv_diff === 'Heroic' ? 'H' : rv_diff || '?') +
          '</span>' +
          (rv_date ? '<span style="font-size:0.9em;color:var(--text-muted);">' + rv_date + '</span>' : '') +
          '</span>';
      }
      rows +=
        '<div style="display:flex;flex-direction:column;gap:2px;align-items:flex-end;">' +
        badges +
        (showMarkBtn ? markRecvBtn : '') +
        '</div>';
    } else if (selfRec) {
      rows +=
        '<div style="display:flex;flex-direction:column;gap:2px;align-items:flex-end;"><span class="bis-self-received-badge">' +
        (selfRec.source || 'Self-reported') +
        '</span>' +
        (showMarkBtn ? markRecvBtn : '') +
        '</div>';
    } else {
      rows += showMarkBtn ? markRecvBtn : '';
    }
    rows += '</div>';
    rows += '<div class="self-received-form" id="form-' + rowId + '" style="display:none;"></div>';
  }
  var bisReceivedCount = 0;
  for (var bci = 0; bci < bisItems.length; bci++) {
    var bci_key = normalise(bisItems[bci].item);
    if (receivedMap[bci_key] || selfRecMap[bci_key]) bisReceivedCount++;
  }
  var bisCompletionHTML = bisItems.length
    ? '<span id="bis-completion-' +
      player.firstName +
      '" style="font-size:1.07rem;"><span style="color:var(--gold-light);font-weight:600;">' +
      Math.round((bisReceivedCount / bisItems.length) * 100) +
      '%</span><span style="color:var(--text-muted);font-weight:400;"> (' +
      bisReceivedCount +
      '/' +
      bisItems.length +
      ')</span></span>'
    : '';

  // Raw tier-set progress (#651) -- independent of any tagged BiS pick,
  // unlike bisCompletionHTML above. null means never synced (see
  // runRaiderIoTierSync/syncRosterTierCounts), not 0 -- shown as "--" rather
  // than claiming a real 0/5.
  var tierProgressHTML =
    player.tierPiecesEquipped != null
      ? '<span style="font-size:0.95rem;color:var(--text-muted);margin-left:0.5rem;" title="Tier pieces currently equipped, synced from Raider.IO">Tier: <span style="color:var(--gold-light);font-weight:600;">' +
        player.tierPiecesEquipped +
        '/5</span></span>'
      : '';

  var fullyBisBadge =
    bisItems.length > 0 && bisReceivedCount === bisItems.length
      ? '<span class="badge" style="background:rgba(212,175,55,0.15);color:var(--gold);border:1px solid rgba(212,175,55,0.45);font-weight:700;">Fully BiS</span>'
      : '';

  var priorityHTML = bisItems.length
    ? '<div class="priority-list">' +
      '<div class="priority-row" style="grid-template-columns:' +
      PRIORITY_ROW_GRID_COLUMNS +
      ';background:transparent;border:none;padding:0.2rem 0.8rem;">' +
      '<span style="font-size:1.02rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text);">Prio</span>' +
      '<span style="font-size:1.02rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text);">Slot</span>' +
      '<span style="font-size:1.02rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text);text-align:center;">Item</span>' +
      '<span style="font-size:1.02rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text);text-align:right;">Source</span>' +
      '</div>' +
      rows +
      '</div>'
    : '<p class="no-items-msg">No BiS items on record yet.</p>';

  var backLabel = backTo === 'officer' ? '<- Back to dashboard' : '<- Back to roster';
  var backAction =
    backTo === 'officer'
      ? "var ir=document.getElementById('inlineProfileRow');if(ir)ir.remove();selectedOfficerPlayer=null;document.querySelectorAll('.player-row').forEach(function(r){r.classList.remove('selected')});"
      : "showView('landing');document.getElementById('playerSelect').value='';";

  var officerActionsHTML = '';
  if (backTo === 'officer') {
    var currentNote = player.officerNote || '';
    var fnSafe = player.firstName.replace(/'/g, "\\'");
    var nrSafe = player.nameRealm.replace(/'/g, "\\'");
    var classKeys = Object.keys(CLASS_SPECS).sort();
    var classOptHtml = '<option value="">-- Select class --</option>';
    for (var ci = 0; ci < classKeys.length; ci++) {
      classOptHtml +=
        '<option value="' +
        classKeys[ci] +
        '"' +
        (player.class === classKeys[ci] ? ' selected' : '') +
        '>' +
        classKeys[ci] +
        '</option>';
    }
    var specOptHtml = '<option value="">-- Select spec --</option>';
    if (player.class && CLASS_SPECS[player.class]) {
      var specList = CLASS_SPECS[player.class].specs;
      for (var si = 0; si < specList.length; si++) {
        specOptHtml +=
          '<option value="' +
          specList[si] +
          '"' +
          (player.spec === specList[si] ? ' selected' : '') +
          '>' +
          specList[si] +
          '</option>';
      }
    }
    var realmOptHtml = '';
    for (var ri = 0; ri < WOW_REALMS.length; ri++) {
      realmOptHtml +=
        '<option value="' +
        WOW_REALMS[ri] +
        '"' +
        (player.realm === WOW_REALMS[ri] ? ' selected' : '') +
        '>' +
        WOW_REALMS[ri] +
        '</option>';
    }
    var settingsExpanded = !!officerPlayerSettingsExpanded[fnSafe];
    officerActionsHTML =
      '<div class="profile-section">' +
      '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="var d=document.getElementById(\'player-settings-' +
      fnSafe +
      "');var hint=document.getElementById('player-settings-hint-" +
      fnSafe +
      "');var open=d.style.display!=='none';d.style.display=open?'none':'';hint.textContent=open?'click to expand':'click to collapse';officerPlayerSettingsExpanded['" +
      fnSafe +
      '\']=!open;">Player Settings<span id="player-settings-hint-' +
      fnSafe +
      '" style="font-size:1.07rem;color:var(--text-dim);">' +
      (settingsExpanded ? 'click to collapse' : 'click to expand') +
      '</span></div>' +
      '<div id="player-settings-' +
      fnSafe +
      '" style="display:' +
      (settingsExpanded ? '' : 'none') +
      ';">' +
      '<div style="display:flex;flex-direction:column;gap:0.75rem;margin-top:0.5rem;">' +
      '<div style="display:flex;align-items:center;gap:0.75rem;">' +
      '<span style="font-size:1.04rem;color:var(--text-muted);min-width:3.5rem;">Role</span>' +
      '<span style="font-size:1.04rem;color:var(--text);">' +
      (player.role || '-') +
      '</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;">' +
      '<span style="font-size:1.04rem;color:var(--text-muted);min-width:3.5rem;">Class</span>' +
      '<select id="classSelect-' +
      player.firstName +
      '" class="self-received-source" style="font-size:1.04rem;padding:0.25rem 0.5rem;max-width:12rem;" onchange="officerUpdateClass(\'' +
      nrSafe +
      "','" +
      fnSafe +
      '\',this.value)">' +
      classOptHtml +
      '</select>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;">' +
      '<span style="font-size:1.04rem;color:var(--text-muted);min-width:3.5rem;">Spec</span>' +
      '<select id="specSelect-' +
      player.firstName +
      '" class="self-received-source" style="font-size:1.04rem;padding:0.25rem 0.5rem;max-width:12rem;">' +
      specOptHtml +
      '</select>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">' +
      '<span style="font-size:1.04rem;color:var(--text-muted);min-width:3.5rem;">Name</span>' +
      '<input type="text" id="editNameInput-' +
      player.firstName +
      '" value="' +
      player.firstName +
      '" class="self-received-source" style="font-size:1.04rem;padding:0.25rem 0.5rem;max-width:9rem;">' +
      '<select id="editRealmSelect-' +
      player.firstName +
      '" class="self-received-source" style="font-size:1.04rem;padding:0.25rem 0.5rem;max-width:10rem;">' +
      realmOptHtml +
      '</select>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;">' +
      '<span style="font-size:1.04rem;color:var(--text-muted);min-width:3.5rem;">Nickname</span>' +
      '<input type="text" id="editNicknameInput-' +
      player.firstName +
      '" value="' +
      escHtml(player.nick || '') +
      '" placeholder="(optional)" class="self-received-source" style="font-size:1.04rem;padding:0.25rem 0.5rem;max-width:9rem;">' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;">' +
      '<span style="font-size:1.04rem;color:var(--text-muted);min-width:3.5rem;">Trial</span>' +
      '<button id="trialToggle-' +
      player.firstName +
      '" class="btn ' +
      (player.isTrial ? 'btn-gold' : 'btn-muted') +
      '" style="font-size:1rem;padding:0.25rem 0.75rem;" onclick="togglePlayerTrial(\'' +
      nrSafe +
      "','" +
      fnSafe +
      '\')">' +
      (player.isTrial ? 'Remove Trial' : 'Mark as Trial') +
      '</button>' +
      '</div>' +
      (featureEnabled('bench')
        ? '<div style="display:flex;align-items:center;gap:0.75rem;">' +
          '<span style="font-size:1.04rem;color:var(--text-muted);min-width:3.5rem;">Bench</span>' +
          '<button id="benchToggle-' +
          player.firstName +
          '" class="btn ' +
          (player.isBench ? 'btn-gold' : 'btn-muted') +
          '" style="font-size:1rem;padding:0.25rem 0.75rem;" onclick="togglePlayerBench(\'' +
          nrSafe +
          "','" +
          fnSafe +
          '\')">' +
          (player.isBench ? 'Remove from Bench' : 'Move to Bench') +
          '</button>' +
          '</div>'
        : '') +
      '<div style="display:flex;align-items:center;gap:0.75rem;">' +
      '<span style="font-size:1.04rem;color:var(--text-muted);min-width:3.5rem;">Backup Tank</span>' +
      '<button id="backupTankToggle-' +
      player.firstName +
      '" class="btn ' +
      (player.isBackupTank ? 'btn-gold' : 'btn-muted') +
      '" style="font-size:1rem;padding:0.25rem 0.75rem;" onclick="togglePlayerBackupTank(\'' +
      nrSafe +
      "','" +
      fnSafe +
      '\')">' +
      (player.isBackupTank ? 'Remove Backup Tank' : 'Mark as Backup Tank') +
      '</button>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;">' +
      '<span style="font-size:1.04rem;color:var(--text-muted);min-width:3.5rem;">Backup Healer</span>' +
      '<button id="backupHealerToggle-' +
      player.firstName +
      '" class="btn ' +
      (player.isBackupHealer ? 'btn-gold' : 'btn-muted') +
      '" style="font-size:1rem;padding:0.25rem 0.75rem;" onclick="togglePlayerBackupHealer(\'' +
      nrSafe +
      "','" +
      fnSafe +
      '\')">' +
      (player.isBackupHealer ? 'Remove Backup Healer' : 'Mark as Backup Healer') +
      '</button>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;">' +
      '<span style="font-size:1.04rem;color:var(--text-muted);min-width:3.5rem;">M+ Excl.</span>' +
      '<button id="mplusExclToggle-' +
      player.firstName +
      '" class="btn ' +
      (player.mPlusExcluded ? 'btn-gold' : 'btn-muted') +
      '" style="font-size:1rem;padding:0.25rem 0.75rem;" onclick="toggleMPlusExcluded(\'' +
      nrSafe +
      "','" +
      fnSafe +
      '\')">' +
      (player.mPlusExcluded ? 'Remove Exclusion' : 'Mark as Excluded') +
      '</button>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;">' +
      '<span style="font-size:1.04rem;color:var(--text-muted);min-width:3.5rem;">Joined</span>' +
      '<input type="date" id="joinDateInput-' +
      player.firstName +
      '" value="' +
      (player.joinDate || '') +
      '" class="self-received-source" style="font-size:1.04rem;padding:0.25rem 0.5rem;max-width:12rem;">' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;">' +
      '<button class="btn btn-gold" style="font-size:1rem;padding:0.35rem 1rem;" onclick="officerSavePlayerSettings(\'' +
      nrSafe +
      "','" +
      fnSafe +
      '\')">Save Player Settings</button>' +
      '</div>' +
      '<div id="playerSettingsMsg-' +
      player.firstName +
      '" style="font-size:1.04rem;color:var(--text-muted);min-height:1.2rem;"></div>' +
      '<div style="display:flex;align-items:center;gap:0.75rem;padding-top:0.25rem;border-top:1px solid var(--border);margin-top:0.5rem;">' +
      '<span style="font-size:1.04rem;color:var(--text-muted);min-width:3.5rem;">Remove</span>' +
      '<button id="removePlayerBtn-' +
      player.firstName +
      '" class="btn btn-danger" style="font-size:1rem;padding:0.25rem 0.75rem;" onclick="confirmRemovePlayer(\'' +
      nrSafe +
      "','" +
      fnSafe +
      '\')">Remove Player</button>' +
      '<div id="removePlayerConfirm-' +
      player.firstName +
      '" style="display:none;gap:0.5rem;align-items:center;">' +
      '<span style="font-size:1.04rem;color:var(--melee);">Confirm?</span>' +
      '<button class="btn btn-danger" style="font-size:1rem;padding:0.25rem 0.75rem;" onclick="executeRemovePlayer(\'' +
      nrSafe +
      "','" +
      fnSafe +
      '\')">Yes, Remove</button>' +
      '<button class="btn btn-muted" style="font-size:1rem;padding:0.25rem 0.75rem;" onclick="cancelRemovePlayer(\'' +
      fnSafe +
      '\')">Cancel</button>' +
      '</div>' +
      '<span id="removePlayerMsg-' +
      player.firstName +
      '" style="display:none;font-size:1.04rem;"></span>' +
      '</div>' +
      '</div>' +
      '<div style="margin-top:1rem;">' +
      '<div style="font-size:1rem;color:var(--text-muted);margin-bottom:0.35rem;text-transform:uppercase;letter-spacing:0.08em;">Officer Notes</div>' +
      '<textarea id="playerNote-' +
      player.firstName +
      '" rows="3" class="self-received-notes" style="width:100%;box-sizing:border-box;font-size:1.04rem;">' +
      currentNote.replace(/</g, '&lt;').replace(/>/g, '&gt;') +
      '</textarea>' +
      '<div style="display:flex;gap:0.5rem;margin-top:0.4rem;align-items:center;">' +
      '<button class="btn btn-muted" style="font-size:1rem;padding:0.25rem 0.75rem;" onclick="savePlayerNote(\'' +
      nrSafe +
      "','" +
      fnSafe +
      '\')">Save Note</button>' +
      '<span id="playerNoteMsg-' +
      player.firstName +
      '" style="font-size:1.04rem;color:var(--text-muted);"></span>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';
  }

  var html =
    '<div class="profile-card">' +
    '<div class="role-bar role-bar-' +
    player.role +
    '"></div>' +
    '<div style="padding:0.6rem 1.25rem;border-bottom:1px solid var(--border);">' +
    '<button onclick="' +
    backAction +
    '" style="background:none;border:none;color:var(--text);font-family:\'Rajdhani\',sans-serif;font-size:1.02rem;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;padding:0;">' +
    backLabel +
    '</button>' +
    '</div>' +
    '<div class="profile-header">' +
    '<div class="profile-avatar avatar-' +
    player.role +
    '">' +
    initials +
    '</div>' +
    '<div class="profile-identity">' +
    '<div class="profile-name">' +
    displayName +
    '</div>' +
    '<div class="profile-realm">' +
    player.firstName +
    '-' +
    player.realm +
    '</div>' +
    '<div class="profile-badges"><span class="badge badge-' +
    player.role +
    '">' +
    player.role +
    '</span>' +
    trialBadge +
    benchBadge +
    backupTankBadge +
    backupHealerBadge +
    classLine +
    fullyBisBadge +
    '</div>' +
    (player.joinDate
      ? '<div style="font-size:1.02rem;color:var(--text-muted);margin-top:0.35rem;">Joined: ' +
        formatJoinDate(player.joinDate) +
        '</div>'
      : '') +
    '</div>' +
    charLinksHTML +
    '</div>';

  var attendanceSectionHTML =
    '<div class="profile-section">' +
    '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;' +
    (backTo === 'officer' || hasPenalties ? 'cursor:pointer;"' : '"') +
    (backTo === 'officer'
      ? ' onclick="loadAttendanceHistory(\'' + player.firstName.replace(/'/g, "\\'") + '\')"'
      : hasPenalties
        ? ' onclick="var d=document.getElementById(\'attend-detail-' +
          player.firstName +
          "');d.style.display=d.style.display==='none'?'flex':'none';\""
        : '') +
    '>Attendance' +
    (backTo !== 'officer'
      ? '<button class="help-btn" onclick="event.stopPropagation();toggleHelp(\'help-attend-' +
        player.firstName +
        '\')" title="Show help">?</button>'
      : '') +
    (backTo === 'officer'
      ? '<span class="attend-history-hint" style="font-size:1.07rem;color:var(--text-dim);">click to expand</span>'
      : hasPenalties
        ? '<span style="font-size:1.07rem;color:var(--text-dim);">click to expand</span>'
        : '') +
    '</div>' +
    (backTo !== 'officer'
      ? '<div id="help-attend-' +
        player.firstName +
        '" class="help-tip">Your attendance percentage is calculated from recent raid nights and feeds directly into your priority score -- higher attendance means higher priority for loot. Statuses like Excused or Medical Leave are weighted differently than a No Show. Contact an officer if a status on a specific night looks wrong.</div>'
      : '') +
    '<div class="attend-row"><div class="attend-bar-wrap"><div class="attend-bar" style="width:' +
    barWidth +
    '"></div></div><span class="attend-label">' +
    attendPct +
    '</span></div>' +
    renderAttendTrend(player.firstName) +
    (backTo === 'officer'
      ? '<div id="attend-history-' + player.firstName + '" style="display:none;margin-top:0.6rem;"></div>'
      : attendExtra) +
    '</div>';

  var lootSectionHTML = featureEnabled('loot')
    ? '<div class="profile-section">' +
      '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="var l=document.getElementById(\'loot-list-' +
      player.firstName +
      "');l.style.display=l.style.display==='none'?'grid':'none';\">Items Received <span style=\"font-size:1.07rem;color:var(--text-dim);\">click to expand</span></div>" +
      '<div style="font-size:1.1rem;font-weight:600;color:var(--gold);">' +
      lootCount +
      ' item' +
      (lootCount !== 1 ? 's' : '') +
      (ACTIVE_SEASON ? ' — ' + ACTIVE_SEASON : ' all-time') +
      '</div>' +
      (lastItems.length
        ? (function () {
            var lastDate = lastItems[0].date || '';
            var itemLines = '';
            for (var lx = 0; lx < lastItems.length; lx++) {
              var lxi = lastItems[lx];
              var lxColor =
                lxi.difficulty === 'Mythic' ? '#b085f0' : lxi.difficulty === 'Heroic' ? '#4dd9e0' : 'var(--gold)';
              itemLines +=
                '<div' +
                (lx > 0 ? ' style="margin-top:0.3rem;padding-top:0.3rem;border-top:1px solid var(--border);"' : '') +
                '>' +
                '<div style="font-size:1rem;color:' +
                lxColor +
                ';font-weight:600;">' +
                lxi.name +
                '</div>' +
                (lxi.difficulty
                  ? '<div style="font-size:1rem;color:var(--text-muted);margin-top:0.1rem;">' +
                    lxi.difficulty +
                    '</div>'
                  : '') +
                '</div>';
            }
            return (
              '<div style="margin-top:0.6rem;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:4px;display:flex;align-items:center;justify-content:space-between;">' +
              '<div style="flex:1;min-width:0;">' +
              '<div style="font-size:0.93rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.25rem;">Last received' +
              (lastDate ? ' - ' + lastDate : '') +
              '</div>' +
              itemLines +
              '</div>' +
              '<span style="font-size:1.8rem;font-weight:700;color:var(--gold);line-height:1;margin-left:0.75rem;">&#8679;</span>' +
              '</div>'
            );
          })()
        : '') +
      '<div id="loot-list-' +
      player.firstName +
      '" style="display:none;margin-top:0.75rem;grid-template-columns:1fr 1fr;gap:0 1rem;">' +
      lootItemsHTML +
      '</div>' +
      '</div>'
    : '';

  var bisTabIntroHTML =
    backTo !== 'officer'
      ? '<p style="color:var(--text-muted);font-size:1.02rem;margin:0;padding:0.75rem 1.25rem 0;">This is your Best-in-Slot list -- one target item per slot. The link you provide here is the source of truth for what you\'re considering BiS, and each slot is either set by officers from that list, or tagged as BiS on your Wishlist tab, where you can also mark items Good, OK, Catalyst Only, or Pass.</p>'
      : '';

  var bisSectionHTML = featureEnabled('bis')
    ? bisTabIntroHTML +
      '<div class="profile-section"><div class="section-label">BiS Source' +
      (backTo !== 'officer'
        ? '<button class="help-btn" onclick="toggleHelp(\'help-bislink-' +
          player.firstName +
          '\')" title="Show help">?</button>'
        : '') +
      '</div>' +
      (backTo !== 'officer'
        ? '<div id="help-bislink-' +
          player.firstName +
          '" class="help-tip">Submit a link to your Best-in-Slot list (e.g. a wowhead or raidbots URL) so officers know what you\'re targeting. An officer reviews new submissions before they show here. If the source stays the same but the list behind it changes, use "My BiS Changed (Same Source)" to have it rechecked.</div>'
        : '') +
      bisHTML +
      '</div>' +
      '<div class="profile-section">' +
      '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="var l=document.getElementById(\'prio-list-' +
      player.firstName +
      "');l.style.display=l.style.display==='none'?'block':'none';\">BiS List" +
      bisCompletionHTML +
      tierProgressHTML +
      // Self-service (#651): a raider can now sync their own tier picks
      // against Raider.IO's equipped gear directly from their own profile,
      // no officer needed -- RLS (bis_items_self_obtained migration) only
      // lets this UPDATE succeed against the viewer's own player_id, so it's
      // gated on isOwnWishlistView the same way the Wishlist tab itself is.
      (isOwnWishlistView && player.firstName && player.realm
        ? '<button id="bisRaiderIoSyncBtn-' +
          player.firstName +
          '" class="btn btn-muted" style="font-size:0.93rem;padding:0.15rem 0.6rem;" ' +
          'onclick="event.stopPropagation();syncOwnBisFromRaiderIo(\'' +
          player.firstName.replace(/'/g, "\\'") +
          "','" +
          player.nameRealm.replace(/'/g, "\\'") +
          '\')" title="Check Raider.IO\'s equipped gear and mark any matching tagged tier pieces obtained">Sync from Raider.IO</button>' +
          '<span id="bisRaiderIoMsg-' +
          player.firstName +
          '" style="font-size:0.95rem;color:var(--text-muted);"></span>'
        : '') +
      (backTo !== 'officer'
        ? '<button class="help-btn" onclick="event.stopPropagation();toggleHelp(\'help-bislist-' +
          player.firstName +
          '\')" title="Show help">?</button>'
        : '') +
      // BiS already has its own top-level sub-tab on the raider's own profile
      // (backTo === 'landing', profileTabBis above) -- collapsing this too was
      // a click behind a click for the one section that tab exists to show.
      // The officer's inline embedded view (backTo === 'officer') has no
      // sub-tabs and stays collapsed by default to keep the roster row compact.
      '<span style="font-size:1.07rem;color:var(--text-dim);">' +
      (backTo === 'landing' ? 'click to collapse' : 'click to expand') +
      '</span></div>' +
      (backTo !== 'officer'
        ? '<div id="help-bislist-' +
          player.firstName +
          '" class="help-tip">This is your tracked BiS items ranked by priority. When you receive one of these items in-game, click "Mark received" on its row and note how you got it -- an officer approves the request and it will count toward your BiS completion above.</div>'
        : '') +
      '<div id="prio-list-' +
      player.firstName +
      '" style="display:' +
      (backTo === 'landing' ? '' : 'none') +
      ';">' +
      priorityHTML +
      '</div>' +
      '</div>'
    : '';

  var mplusSectionHTML =
    mplusHTML && featureEnabled('mplus')
      ? '<div class="profile-section"><div class="section-label">M+ Exclusion' +
        (backTo !== 'officer'
          ? '<button class="help-btn" onclick="toggleHelp(\'help-mplus-' +
            player.firstName +
            '\')" title="Show help">?</button>'
          : '') +
        '</div>' +
        (backTo !== 'officer'
          ? '<div id="help-mplus-' +
            player.firstName +
            '" class="help-tip">Once you no longer have any gear upgrades to obtain through the Great Vault via M+ dungeons, you can request exclusion from running them. Your Raider.io profile is filled in automatically; an officer reviews the request and, once approved, you\'re no longer required to run them weekly.</div>'
          : '') +
        mplusHTML +
        '</div>'
      : '';

  var streamSectionHTML = typeof ownStreamerSectionHTML === 'function' ? ownStreamerSectionHTML(player, backTo) : '';

  // Sub-tabs only for the raider's own profile view -- the officer inline
  // view (backTo === 'officer') keeps its original single-flow layout, since
  // it's a different editing context entirely and isn't part of this rework.
  var profileTabsHTML;
  if (backTo === 'landing') {
    // BiS and Wishlist share the 'bis' feature flag -- a team not using BiS
    // lists isn't using the wishlist either (#515 Phase 2). Falls back off
    // 'bis'/'wishlist' to Overview if the flag got turned off while that tab
    // was the active one.
    var bisFeatureOn = featureEnabled('bis');
    if (!bisFeatureOn && (_profileSubTab === 'bis' || _profileSubTab === 'wishlist')) {
      _profileSubTab = 'overview';
    }
    profileTabsHTML =
      // .roster-sub-nav has no horizontal padding of its own -- on the Roster
      // page it sits inside an already-padded container, but .profile-card
      // has none (only .profile-header/.profile-section do, 1.25rem each),
      // so it needs its own inline inset here to line up with them.
      '<div class="roster-sub-nav" style="padding:0 1.25rem;">' +
      '<button class="roster-sub-tab' +
      (_profileSubTab === 'overview' ? ' active' : '') +
      '" id="profileSubTabOverview" onclick="showProfileSubTab(\'overview\')">Overview</button>' +
      (bisFeatureOn
        ? '<button class="roster-sub-tab' +
          (_profileSubTab === 'bis' ? ' active' : '') +
          '" id="profileSubTabBis" onclick="showProfileSubTab(\'bis\')">BiS</button>' +
          '<button class="roster-sub-tab' +
          (_profileSubTab === 'wishlist' ? ' active' : '') +
          '" id="profileSubTabWishlist" onclick="showProfileSubTab(\'wishlist\')">Wishlist</button>'
        : '') +
      '<button class="roster-sub-tab' +
      (_profileSubTab === 'stream' ? ' active' : '') +
      '" id="profileSubTabStream" onclick="showProfileSubTab(\'stream\')">Stream</button>' +
      '</div>' +
      '<div id="profileTabOverview" style="display:' +
      (_profileSubTab === 'overview' ? '' : 'none') +
      ';">' +
      attendanceSectionHTML +
      lootSectionHTML +
      mplusSectionHTML +
      '</div>' +
      (bisFeatureOn
        ? '<div id="profileTabBis" style="display:' +
          (_profileSubTab === 'bis' ? '' : 'none') +
          ';">' +
          bisSectionHTML +
          '</div>' +
          '<div id="profileTabWishlist" style="display:' +
          (_profileSubTab === 'wishlist' ? '' : 'none') +
          ';">' +
          wishlistSectionHTML +
          '</div>'
        : '') +
      '<div id="profileTabStream" style="display:' +
      (_profileSubTab === 'stream' ? '' : 'none') +
      ';">' +
      streamSectionHTML +
      '</div>';
  } else {
    profileTabsHTML =
      attendanceSectionHTML +
      lootSectionHTML +
      bisSectionHTML +
      mplusSectionHTML +
      streamSectionHTML +
      wishlistSectionHTML;
  }

  html = html + profileTabsHTML + officerActionsHTML + '</div>';

  if (container) {
    container.innerHTML = html;
  } else {
    document.getElementById('profileView').innerHTML = html;
  }
  if (backTo === 'officer') {
    updateBisAllowDiv(player.nameRealm, player.firstName);
    updateWishlistAllowDiv(player.nameRealm, player.firstName);
  }
  // Defensive re-apply: the inline display:none above already gets this
  // right on first paint, but ownWishlistSectionHTML()'s async reload and
  // every wishlistUpsert() write call renderProfile() again, and this keeps
  // whichever sub-tab was open instead of it silently resetting.
  if (backTo === 'landing') showProfileSubTab(_profileSubTab);
}

// #241 follow-up: reads straight from Supabase's attendance table. The GAS
// getPlayerAttendanceFull action this used to fall back to read the
// Attendance Google Sheet and had no visibility into writes this card (or
// the Attendance tab, #218) make straight to Supabase -- confirmed via
// manual testing, a change reverted on page reload because the Sheet-sourced
// read never saw it. GAS is retired (#225), so there is no fallback left to
// have; the full historical import (#320) already backfilled every Sheet row
// into Supabase, so an empty result means the player genuinely has no
// history, and a query error (or an unresolvable player) now surfaces an
// inline error instead of silently substituting stale data.
function loadAttendanceHistory(firstName) {
  var content = document.getElementById('attend-history-' + firstName);
  if (!content) return;
  var hint = content.parentNode ? content.parentNode.querySelector('.attend-history-hint') : null;

  if (content.style.display !== 'none') {
    content.style.display = 'none';
    if (hint) hint.textContent = 'click to expand';
    return;
  }

  if (content.dataset.loaded) {
    content.style.display = 'block';
    if (hint) hint.textContent = 'click to collapse';
    return;
  }

  content.innerHTML =
    '<span style="color:var(--text-muted);font-size:1.07rem;padding:0.5rem 0;display:block;">Loading...</span>';
  content.style.display = 'block';

  var norm = normalise(firstName);
  var roster = (DATA && DATA.roster) || [];
  var player = null;
  for (var i = 0; i < roster.length; i++) {
    if (normalise(roster[i].firstName) === norm) {
      player = roster[i];
      break;
    }
  }

  if (!player || !player.id || !supabaseClient) {
    content.innerHTML =
      '<p style="color:var(--melee);font-size:1.07rem;padding:0.5rem 0;">Failed to load. Try again.</p>';
    return;
  }

  supabaseClient
    .from('attendance')
    .select('raid_date, status')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('player_id', player.id)
    .then(function (result) {
      if (result.error) {
        console.warn('Supabase attendance query failed.', result.error.message);
        content.innerHTML =
          '<p style="color:var(--melee);font-size:1.07rem;padding:0.5rem 0;">Failed to load. Try again.</p>';
        return;
      }
      content.dataset.loaded = '1';
      if (hint) hint.textContent = 'click to collapse';

      var history = (result.data || []).map(function (row) {
        return { date: row.raid_date, status: row.status };
      });
      history.sort(function (a, b) {
        return b.date < a.date ? -1 : b.date > a.date ? 1 : 0;
      });

      renderAttendanceHistoryCard(firstName, content, history);
    });
}

// getPlayerAttendanceFull (the source loadAttendanceHistory fetches from) is
// still an Apps Script/Sheets read -- it has no idea about rows written
// straight to Supabase's attendance table, so a GAS re-fetch after
// addAttendanceNight's write would just show the same stale list again. This
// cache lets that write update the rendered card in place instead of relying
// on a round-trip that can never see it.
var _attendHistCache = {};

// #241: renders the existing per-night history (unchanged from before) plus
// an "Add raid night" control for creating a row on a night the player has
// none for at all -- the gap the old card had no way to fill, since every
// row it could show already had to exist first.
function renderAttendanceHistoryCard(firstName, content, history) {
  _attendHistCache[firstName] = history;
  var addControlHtml = '<div id="attend-add-night-' + firstName + '"></div>';

  if (!history.length) {
    content.innerHTML =
      '<p style="color:var(--text-muted);font-size:1.07rem;padding:0.5rem 0;">No attendance records found.</p>' +
      addControlHtml;
    renderAddAttendanceNightControl(firstName, history);
    return;
  }

  var counts = {};
  for (var i = 0; i < history.length; i++) {
    /** @type {string} */
    var s = history[i].status;
    counts[s] = (counts[s] || 0) + 1;
  }

  function statusColor(s) {
    if (s === 'Present') return 'var(--heal)';
    if (s === 'Late (with notice)') return 'var(--gold)';
    if (s === 'Late (no notice)') return 'var(--melee)';
    if (s === 'No Show') return 'var(--melee)';
    if (s === 'Medical Leave') return '#7EC8E3';
    if (s === 'Not on Roster') return 'var(--text-muted)';
    return 'var(--gold-light)';
  }

  var summaryParts = [];
  var order = ['Present', 'Late (with notice)', 'Late (no notice)', 'No Show', 'Excused', 'Medical Leave'];
  for (var oi = 0; oi < order.length; oi++) {
    var st = order[oi];
    if (counts[st])
      summaryParts.push('<span style="color:' + statusColor(st) + ';">' + counts[st] + ' ' + st + '</span>');
  }
  var otherKeys = Object.keys(counts).filter(function (k) {
    return order.indexOf(k) === -1;
  });
  for (var ok = 0; ok < otherKeys.length; ok++) {
    summaryParts.push(
      '<span style="color:var(--text-muted);">' + counts[otherKeys[ok]] + ' ' + otherKeys[ok] + '</span>'
    );
  }

  var CARD_STATUSES = [
    'Present',
    'Bench',
    'Late (with notice)',
    'Excused',
    'Late (no notice)',
    'No Show',
    'Extended Leave',
    'Medical Leave',
    'Not on Roster'
  ];

  var html =
    '<div style="font-size:1rem;color:var(--text-muted);margin-bottom:0.6rem;display:flex;gap:0.5rem;flex-wrap:wrap;">' +
    summaryParts.join('<span style="color:var(--border-mid);">|</span>') +
    '</div>';
  html += '<div style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;">';
  for (var j = 0; j < history.length; j++) {
    var entry = history[j];
    var isNOR = entry.status === 'Not on Roster';
    html +=
      '<div style="display:flex;justify-content:space-between;align-items:center;font-size:1.07rem;padding:0.28rem 0.75rem;border-bottom:1px solid var(--border);gap:0.5rem;">';
    html += '<span style="color:var(--text);white-space:nowrap;">' + entry.date + '</span>';
    if (isNOR) {
      html += '<span style="color:' + statusColor(entry.status) + ';font-weight:600;">' + entry.status + '</span>';
    } else {
      html += '<div style="display:flex;align-items:center;gap:0.4rem;">';
      html += '<div class="attend-status-wrap">';
      html +=
        '<select class="attend-status-select attend-card-status-select" data-date="' +
        entry.date +
        '" data-name="' +
        firstName +
        '" data-old="' +
        entry.status +
        '" onchange="saveAttendanceFromCard(this)">';
      for (var k = 0; k < CARD_STATUSES.length; k++) {
        var s = CARD_STATUSES[k];
        html += '<option value="' + s + '"' + (entry.status === s ? ' selected' : '') + '>' + s + '</option>';
      }
      html += '</select></div>';
      html += '<span class="attend-save-ind" style="min-width:40px;text-align:right;"></span>';
      html += '</div>';
    }
    html += '</div>';
  }
  html += '</div>';
  content.innerHTML = html + addControlHtml;
  renderAddAttendanceNightControl(firstName, history);
}

// #241: populates the "Add raid night" control with every raid date the team
// has an attendance row for (from anyone), minus dates this player already
// has a row for (shown above) and minus dates before the player's join date
// (those are backfilled as "Not on Roster" automatically -- see
// backfillNotOnRosterForPlayer in tab-roster.js -- and aren't manual-entry
// candidates).
function renderAddAttendanceNightControl(firstName, history) {
  var container = document.getElementById('attend-add-night-' + firstName);
  if (!container || !supabaseClient) return;

  var norm = normalise(firstName);
  var roster = (DATA && DATA.roster) || [];
  var player = null;
  for (var i = 0; i < roster.length; i++) {
    if (normalise(roster[i].firstName) === norm) {
      player = roster[i];
      break;
    }
  }
  if (!player || !player.id) return;

  var existingDates = {};
  for (var h = 0; h < history.length; h++) existingDates[history[h].date] = true;

  supabaseClient
    .from('attendance')
    .select('raid_date')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      if (result.error) return;
      var seen = {};
      var dates = [];
      (result.data || []).forEach(function (row) {
        var d = row.raid_date;
        if (!d || seen[d] || existingDates[d]) return;
        if (player.joinDate && d < player.joinDate) return;
        seen[d] = true;
        dates.push(d);
      });
      if (!dates.length) return;
      dates.sort();

      var CARD_STATUSES = [
        'Present',
        'Bench',
        'Late (with notice)',
        'Excused',
        'Late (no notice)',
        'No Show',
        'Extended Leave',
        'Medical Leave',
        'Not on Roster'
      ];
      var dateOptions = dates
        .map(function (d) {
          return '<option value="' + d + '">' + d + '</option>';
        })
        .join('');
      var statusOptions = CARD_STATUSES.map(function (s) {
        return '<option value="' + s + '">' + s + '</option>';
      }).join('');
      var nameSafe = firstName.replace(/'/g, "\\'");

      container.innerHTML =
        '<div style="display:flex;align-items:center;gap:0.4rem;margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid var(--border);flex-wrap:wrap;">' +
        '<span style="font-size:1.02rem;color:var(--text-muted);">Add raid night:</span>' +
        '<select id="attend-add-date-' +
        firstName +
        '" style="font-size:1.02rem;padding:0.15rem 0.35rem;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);">' +
        dateOptions +
        '</select>' +
        '<select id="attend-add-status-' +
        firstName +
        '" style="font-size:1.02rem;padding:0.15rem 0.35rem;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);">' +
        statusOptions +
        '</select>' +
        '<button class="btn btn-gold" style="font-size:0.97rem;padding:0.2rem 0.6rem;" onclick="addAttendanceNight(\'' +
        nameSafe +
        '\')">Add</button>' +
        '<span id="attend-add-ind-' +
        firstName +
        '" style="font-size:0.97rem;"></span>' +
        '</div>';
    });
}

// #241: creates the attendance row saveAttendanceFromCard's per-row dropdown
// has nothing to edit until it exists -- same upsert + audit log shape, just
// a different entry point (a brand-new date instead of an existing row).
function addAttendanceNight(firstName) {
  var dateSel = /** @type {HTMLSelectElement} */ (document.getElementById('attend-add-date-' + firstName));
  var statusSel = /** @type {HTMLSelectElement} */ (document.getElementById('attend-add-status-' + firstName));
  var ind = document.getElementById('attend-add-ind-' + firstName);
  if (!dateSel || !statusSel) return;
  var date = dateSel.value;
  var status = statusSel.value;
  if (!date || !status) return;

  var norm = normalise(firstName);
  var roster = (DATA && DATA.roster) || [];
  var player = null;
  for (var i = 0; i < roster.length; i++) {
    if (normalise(roster[i].firstName) === norm) {
      player = roster[i];
      break;
    }
  }
  if (!player || !player.id) return;

  dateSel.disabled = true;
  statusSel.disabled = true;
  if (ind) {
    ind.textContent = 'Saving...';
    ind.style.color = 'var(--text-muted)';
  }

  // Promise.resolve() unwraps the builder's PromiseLike into a real Promise
  // (same resolution, no behavior change) -- needed for the chained
  // .then().then().catch() below, since PromiseLike itself has no .catch().
  Promise.resolve(
    supabaseClient
      .from('attendance')
      .upsert(
        { team_id: _teamCfg.supabaseTeamId, player_id: player.id, raid_date: date, status: status },
        { onConflict: 'team_id,player_id,raid_date' }
      )
  )
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      return writeAuditLog('Attendance Status Set', 'players', player.id, '(none) -> ' + status + ' (' + date + ')');
    })
    .then(function () {
      applyNewAttendanceNight(firstName, date, status);
    })
    .catch(function (err) {
      dateSel.disabled = false;
      statusSel.disabled = false;
      console.warn('Failed to add attendance night.', err);
      if (ind) {
        ind.textContent = 'Error';
        ind.style.color = 'var(--melee)';
        setTimeout(function () {
          if (ind) ind.textContent = '';
        }, 3000);
      }
    });
}

// Updates the rendered card in place after a successful add, instead of
// re-fetching history from GAS (which can never see a write that landed
// straight in Supabase -- see the _attendHistCache comment above).
function applyNewAttendanceNight(firstName, date, status) {
  var content = document.getElementById('attend-history-' + firstName);
  if (!content) return;
  var history = (_attendHistCache[firstName] || []).filter(function (e) {
    return e.date !== date;
  });
  history.push({ date: date, status: status });
  history.sort(function (a, b) {
    return b.date < a.date ? -1 : b.date > a.date ? 1 : 0;
  });
  renderAttendanceHistoryCard(firstName, content, history);
}

// Second write path onto the same attendance table setPlayerStatus()
// (js/tabs/tab-attendance.js, #218) covers -- this one fires from the
// player-profile "Attendance" history card instead of the Attendance tab's
// per-night grid. Same Supabase upsert + audit log shape as that one.
function saveAttendanceFromCard(selectEl) {
  var date = selectEl.getAttribute('data-date');
  var firstName = selectEl.getAttribute('data-name');
  var status = selectEl.value;
  var oldStatus = selectEl.getAttribute('data-old');
  var indicator =
    selectEl.parentElement && selectEl.parentElement.parentElement
      ? selectEl.parentElement.parentElement.querySelector('.attend-save-ind')
      : null;

  if (!status) return;

  var norm = normalise(firstName);
  var roster = (DATA && DATA.roster) || [];
  var player = null;
  for (var i = 0; i < roster.length; i++) {
    if (normalise(roster[i].firstName) === norm) {
      player = roster[i];
      break;
    }
  }
  if (!player || !player.id) {
    selectEl.value = oldStatus || '';
    if (indicator) {
      indicator.textContent = 'Error';
      indicator.style.color = 'var(--melee)';
      setTimeout(function () {
        if (indicator) indicator.textContent = '';
      }, 3000);
    }
    return;
  }

  selectEl.disabled = true;
  if (indicator) {
    indicator.textContent = 'Saving...';
    indicator.style.color = 'var(--text-muted)';
  }

  // Promise.resolve() unwraps the builder's PromiseLike into a real Promise
  // (same resolution, no behavior change) -- needed for the chained
  // .then().then().catch() below, since PromiseLike itself has no .catch().
  Promise.resolve(
    supabaseClient
      .from('attendance')
      .upsert(
        { team_id: _teamCfg.supabaseTeamId, player_id: player.id, raid_date: date, status: status },
        { onConflict: 'team_id,player_id,raid_date' }
      )
  )
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      return writeAuditLog('Attendance Status Set', 'players', player.id, (oldStatus || '(none)') + ' -> ' + status);
    })
    .then(function () {
      selectEl.disabled = false;
      selectEl.setAttribute('data-old', status);
      if (indicator) {
        indicator.textContent = 'Saved';
        indicator.style.color = 'var(--heal)';
        setTimeout(function () {
          if (indicator) indicator.textContent = '';
        }, 2000);
      }
    })
    .catch(function (err) {
      selectEl.disabled = false;
      selectEl.value = oldStatus || '';
      console.warn('Failed to save attendance status.', err);
      if (indicator) {
        indicator.textContent = 'Error';
        indicator.style.color = 'var(--melee)';
        setTimeout(function () {
          if (indicator) indicator.textContent = '';
        }, 3000);
      }
    });
}
