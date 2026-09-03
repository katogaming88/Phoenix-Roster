// The BoE auction lifecycle surface (found -> listed -> sold -> paid, plus
// retire), running the RPCs the #745 backend defines. Three sections over one
// paged read of boe_items -- Open (found/listed), Awaiting Payout (sold),
// History (paid/retired) -- plus a summary strip.
//
// Lived on the officer dashboard as a per-team tab until #774 moved it to the
// guild page, and #864 moved it again onto a page of its own, boe.html.
// The move is what the data model already said: boe_items is guild property,
// its read policy is guild-wide, the manager grant went guild-wide in #766,
// and #765 had already made this read ignore whichever team's dashboard it was
// rendered under. Hosting a guild-scoped surface inside a per-team page was
// the vestigial part, and it locked out the one person the guild-wide grant
// exists for: a BoE manager with no officer role could not open officer.html
// at all, and a guild officer holding the grant was excluded by name.
//
// js/boe-page.js owns who sees this (js/guild.js did until #864) and calls
// buildBoeManage() only for someone who may read: any team officer, a BoE
// manager, or a site admin. It passes
// canManage, which the action buttons render behind. The server enforces the
// same gate regardless (is_boe_manager() or is_site_admin() inside every
// lifecycle RPC), so this is disclosure, not security.
//
// The lifecycle RPCs write no audit entries themselves, so every successful
// mutation writes one from here, naming the BoE's own team rather than the
// page's (#774) -- this page has no team, and the row's team is the correct
// attribution for a guild-wide surface either way.
//
// Mutations update the in-memory model and re-render instead of refetching:
// boe_record_sale returns the computed split, so the row it moves to
// Awaiting Payout carries its money columns without another read.

var _boeItems = [];
var _boeListings = [];
// The BoE catalog (#875): items flagged is_boe, id and name, for the edit
// form's picker and Save's link. Empty when the read fails.
var _boeCatalog = [];
var _boeCanManage = false;

// History renders one page at a time (#863): it holds every paid and retired
// row, 47 from the legacy import alone, and grows with every settled sale.
// The page index lives here beside the rows so it survives the re-render every
// action ends in; renderBoeManage() clamps it whenever the row count shrinks.
var BOE_HISTORY_PAGE_SIZE = 20;
var _boeHistoryPage = 0;
var _boeHistoryPageCount = 1;

function buildBoeManage(canManage) {
  var summary = document.getElementById('guildBoeSummary');
  var open = document.getElementById('guildBoeOpen');
  var awaiting = document.getElementById('guildBoeAwaiting');
  var history = document.getElementById('guildBoeHistory');
  if (!summary || !open || !awaiting || !history) return Promise.resolve();

  function bail(html) {
    summary.innerHTML = html;
    open.innerHTML = '';
    awaiting.innerHTML = '';
    history.innerHTML = '';
  }

  if (!supabaseClient) {
    bail('<p class="guild-empty">Database connection is not configured.</p>');
    return Promise.resolve();
  }

  _boeCanManage = !!canManage;
  _boeHistoryPage = 0;
  bail('<p class="guild-empty">Loading BoE data...</p>');

  // Neither read filters on team since #765. BoEs are guild property and the
  // manager grant went guild-wide in #766, so this shows every find the caller
  // may see rather than one team at a time. The scoping is the read policies'
  // job: my_team_role(team_id) in (officer, team_leader) or is_boe_manager()
  // or is_site_admin(), which gives a manager or site admin every team and a
  // plain officer exactly the teams they staff. A client-side
  // .eq('team_id', ...) on top would re-implement that, worse, and would keep
  // Wrathless finds invisible -- it has no members, so nobody holds a team
  // role on it and only the guild-wide grants reach its rows at all.
  var itemsPromise = fetchAllPaged(
    function (afterId, limit) {
      var q = supabaseClient
        .from('boe_items')
        .select(
          'id, team_id, player_id, finder_name, item_id, item_name, track, note, status, found_at, sold_at, payout_paid_at, retired_at, sale_price, finder_payout, guild_cut, payout_donated',
          afterId === null ? { count: 'exact' } : undefined
        )
        .order('id', { ascending: true })
        .limit(limit);
      return afterId === null ? q : q.gt('id', afterId);
    },
    { label: 'boe items' }
  );

  var listingsPromise = fetchAllPaged(
    function (afterId, limit) {
      var q = supabaseClient
        .from('boe_listings')
        .select('id, boe_item_id, listed_at, price, note', afterId === null ? { count: 'exact' } : undefined)
        .order('id', { ascending: true })
        .limit(limit);
      return afterId === null ? q : q.gt('id', afterId);
    },
    { label: 'boe listings' }
  );

  // The catalog for the edit form's picker (#875), a public read. Fail-open
  // to an empty list: a failed read costs the picker and nothing else.
  // team-read-guard: the BoE catalog, one row per BoE the guild tracks (17 today).
  var catalogPromise = supabaseClient
    .from('items')
    .select('id, name')
    .eq('is_boe', true)
    .order('name', { ascending: true })
    .then(
      function (result) {
        return result.error ? [] : result.data || [];
      },
      function () {
        return [];
      }
    );

  return Promise.all([itemsPromise, listingsPromise, catalogPromise]).then(function (results) {
    var items = results[0];
    var listings = results[1];
    _boeCatalog = results[2] || [];
    if (typeof renderBoeItemDatalist === 'function') {
      renderBoeItemDatalist(
        _boeCatalog.map(function (c) {
          return c.name;
        })
      );
    }
    // fetchAllPaged returns null on error or timeout, never partial rows;
    // no BoEs at all is [] and must stay distinguishable.
    if (items === null || listings === null) {
      bail('<p class="guild-empty">Could not load BoE data. Try again in a minute.</p>');
      return;
    }
    _boeItems = items;
    _boeListings = listings;
    renderBoeManage();
  });
}

function formatGold(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Accepts the formats officers actually paste: "250,000", "250000g",
// "1 000 000". Anything else (including negatives) is null, never NaN.
function parseGoldInput(value) {
  var cleaned = String(value == null ? '' : value)
    .replace(/[,\s]/g, '')
    .replace(/g$/i, '');
  if (!/^\d+$/.test(cleaned)) return null;
  return parseInt(cleaned, 10);
}

function _boeDate(iso) {
  return iso ? new Date(iso).toLocaleDateString() : '';
}

var _BOE_BADGE_COLORS = {
  found: 'var(--gold)',
  listed: 'var(--gold)',
  sold: 'var(--heal)',
  paid: 'var(--text-muted)',
  retired: 'var(--melee)'
};

function _boeBadge(status, labelOverride) {
  var label = labelOverride || status.charAt(0).toUpperCase() + status.slice(1);
  return (
    '<span style="font-size:0.95rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:' +
    (_BOE_BADGE_COLORS[status] || 'var(--text-muted)') +
    ';">' +
    label +
    '</span>'
  );
}

// The Status cell (#862): the lifecycle badge, plus the donate intent a raider
// recorded as a muted marker on found, listed and sold rows, so the manager
// knows which settle button to reach for. A donated paid row reads Donated
// instead of Paid; the intent means nothing on a retired row.
function _boeStatusCell(item) {
  if (item.status === 'paid' && item.payout_donated) return _boeBadge('paid', 'Donated');
  var html = _boeBadge(item.status);
  if (item.payout_donated && item.status !== 'paid' && item.status !== 'retired') {
    html +=
      ' <span style="font-size:0.85rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);">Donating</span>';
  }
  return html;
}

// What a settled row actually paid out (#862 follow-up, Russell 2026-09-02):
// a donated payout pays the finder nothing and the guild everything, so
// History and every total read that way. The stored split stays the policy
// record, which is what Undo Payout puts back, so this is a display rule
// and not a rewrite of the row.
function _boeFinderPaid(item) {
  return item.status === 'paid' && item.payout_donated ? 0 : item.finder_payout;
}

function _boeGuildKept(item) {
  if (item.status === 'paid' && item.payout_donated) return (item.guild_cut || 0) + (item.finder_payout || 0);
  return item.guild_cut;
}

function _boeMoney(n) {
  return n == null ? '' : formatGold(n) + 'g';
}

// Which team found it (#765). Rendered in every section, History included:
// the team is credit rather than a disambiguator, so it should outlive the
// payout, and for a Wrathless find it is the only attribution there is --
// that team has no members, so player_id is always null and the finder is
// free text forever.
//
// _esc() rather than escHtml(): that one is declared in js/tabs/tab-attendance.js
// and ships only in officer.html's bundle, so calling it here would be a
// ReferenceError. common.js's _esc() escapes quotes as well as angle brackets
// and covers everything this needs.
function _boeTeamCell(item) {
  return '<td style="color:var(--text-muted);">' + _esc(teamNameForId(item.team_id)) + '</td>';
}

// Per-team find counts and guild gold raised, under the two headline totals.
// Gold is guild_cut over sold and paid, the same measure "Guild income to
// date" uses, partitioned rather than redefined -- so these figures always
// sum to that one.
//
// Hidden below two teams: with one it just restates the headline in more
// words. Teams with no finds are left out entirely rather than listed at
// zero, but a team that has found and not yet sold shows its count against
// 0g, which is the Wrathless case on day one.
function _boeTeamCreditLine() {
  var byTeam = {};
  _boeItems.forEach(function (item) {
    var row = byTeam[item.team_id] || (byTeam[item.team_id] = { found: 0, gold: 0 });
    row.found++;
    if (item.status === 'sold' || item.status === 'paid') row.gold += _boeGuildKept(item) || 0;
  });

  var teams = Object.keys(byTeam).map(function (id) {
    return { name: teamNameForId(parseInt(id, 10)), found: byTeam[id].found, gold: byTeam[id].gold };
  });
  if (teams.length < 2) return '';

  // Most finds first, gold breaking a tie, then name so the order is stable
  // rather than dependent on key iteration.
  teams.sort(function (a, b) {
    return b.found - a.found || b.gold - a.gold || a.name.localeCompare(b.name);
  });

  return (
    '<div style="font-size:1.02rem;color:var(--text-muted);margin-bottom:0.75rem;">Found by team: ' +
    teams
      .map(function (t) {
        return (
          _esc(t.name) + ' <strong style="color:var(--text);">' + t.found + '</strong> (' + formatGold(t.gold) + 'g)'
        );
      })
      .join(' &middot; ') +
    '</div>'
  );
}

function _boeItemCell(item) {
  var html = _esc(item.item_name);
  if (item.track) {
    html += ' <span class="badge" style="margin-left:0.35rem;">' + _esc(item.track) + '</span>';
  }
  // The raider's submit-form note surfaces to officers only here.
  if (item.note) {
    html += '<br><span style="color:var(--text-muted);font-size:0.95rem;">' + _esc(item.note) + '</span>';
  }
  return html;
}

// The edit form (#874): a manager corrects the item name, track and note of a
// find in any section, on the same hidden-span pattern as Record Listing and
// Record Sale. The check_boe_status_transition trigger admits exactly these
// columns on a plain UPDATE and blocks everything else, so there is no RPC.
// Later PRs extend the column list rather than the form: #875 adds the
// catalog link, #865 the item level and upgrade rank.
var BOE_TRACKS = ['Champion', 'Hero', 'Myth'];
var BOE_EDIT_COLUMNS = [
  ['item_name', 'item'],
  ['track', 'track'],
  ['note', 'note'],
  ['item_id', 'catalog link']
];

function _boeEditForm(item) {
  var id = item.id;
  var options = '<option value=""' + (item.track ? '' : ' selected') + '>No track</option>';
  BOE_TRACKS.forEach(function (t) {
    options += '<option value="' + t + '"' + (item.track === t ? ' selected' : '') + '>' + t + '</option>';
  });
  return (
    ' <button class="btn btn-muted" style="font-size:0.85rem;padding:0.3rem 0.8rem;" id="boe-edit-btn-' +
    id +
    '" onclick="toggleBoeForm(' +
    id +
    ", 'edit')\">Edit</button>" +
    '<span id="boe-edit-form-' +
    id +
    '" style="display:none;">' +
    '<br><input id="boe-edit-name-' +
    id +
    '" list="boeItemOptions" aria-label="Item name" value="' +
    _esc(item.item_name || '') +
    '" style="width:14rem;"> ' +
    '<select id="boe-edit-track-' +
    id +
    '" aria-label="Track">' +
    options +
    '</select> ' +
    '<textarea id="boe-edit-note-' +
    id +
    '" aria-label="Note" rows="2" placeholder="Note (optional)" style="width:14rem;vertical-align:top;">' +
    _esc(item.note || '') +
    '</textarea> ' +
    '<button class="btn btn-gold" style="font-size:0.85rem;padding:0.3rem 0.8rem;" onclick="saveBoeEdit(' +
    id +
    ', this)">Save</button> ' +
    '<button class="btn btn-muted" style="font-size:0.85rem;padding:0.3rem 0.8rem;" onclick="cancelBoeEdit(' +
    id +
    ')">Cancel</button>' +
    '</span>'
  );
}

function _boeTable(headers, rowsHtml) {
  return (
    '<div style="overflow-x:auto;"><table class="roster-table"><thead><tr>' +
    headers
      .map(function (h) {
        return '<th scope="col">' + h + '</th>';
      })
      .join('') +
    '</tr></thead><tbody>' +
    rowsHtml +
    '</tbody></table></div>'
  );
}

function _boeEmpty(text) {
  return '<p class="guild-empty">' + text + '</p>';
}

function _boeSection(title) {
  return '<h3 class="guild-boe-subheading">' + title + '</h3>';
}

function findBoeItem(id) {
  for (var i = 0; i < _boeItems.length; i++) {
    if (_boeItems[i].id === id) return _boeItems[i];
  }
  return null;
}

function renderBoeManage() {
  var summary = document.getElementById('guildBoeSummary');
  var open = document.getElementById('guildBoeOpen');
  var awaiting = document.getElementById('guildBoeAwaiting');
  var history = document.getElementById('guildBoeHistory');
  if (!summary || !open || !awaiting || !history) return;

  var openRows = [];
  var awaitingRows = [];
  var historyRows = [];
  var guildIncome = 0;
  var outstanding = 0;
  var donated = 0;
  _boeItems.forEach(function (item) {
    if (item.status === 'found' || item.status === 'listed') openRows.push(item);
    else if (item.status === 'sold') awaitingRows.push(item);
    else if (item.status === 'paid' || item.status === 'retired') historyRows.push(item);
    // Guild income is what the guild kept, which on a donated payout is the
    // whole amount. A sold row that is donating stays outstanding until a
    // manager settles it.
    if (item.status === 'sold' || item.status === 'paid') guildIncome += _boeGuildKept(item) || 0;
    if (item.status === 'paid' && item.payout_donated) donated += item.finder_payout || 0;
    if (item.status === 'sold') outstanding += item.finder_payout || 0;
  });
  openRows.sort(function (a, b) {
    return String(a.found_at || '').localeCompare(String(b.found_at || ''));
  });
  awaitingRows.sort(function (a, b) {
    return String(a.sold_at || '').localeCompare(String(b.sold_at || ''));
  });
  historyRows.sort(function (a, b) {
    return String(b.payout_paid_at || b.retired_at || '').localeCompare(String(a.payout_paid_at || a.retired_at || ''));
  });
  // The slice comes after the sort, and would come after any future filter.
  // The totals above read historyRows and never the page.
  _boeHistoryPageCount = Math.max(1, Math.ceil(historyRows.length / BOE_HISTORY_PAGE_SIZE));
  if (_boeHistoryPage > _boeHistoryPageCount - 1) _boeHistoryPage = _boeHistoryPageCount - 1;
  if (_boeHistoryPage < 0) _boeHistoryPage = 0;
  var historyStart = _boeHistoryPage * BOE_HISTORY_PAGE_SIZE;
  var historyPageRows = historyRows.slice(historyStart, historyStart + BOE_HISTORY_PAGE_SIZE);

  var listingsByItem = {};
  _boeListings.forEach(function (l) {
    (listingsByItem[l.boe_item_id] = listingsByItem[l.boe_item_id] || []).push(l);
  });

  summary.innerHTML =
    '<div style="display:flex;gap:2rem;flex-wrap:wrap;margin-bottom:0.5rem;">' +
    '<span>Guild income to date: <strong style="color:var(--gold);">' +
    formatGold(guildIncome) +
    'g</strong></span>' +
    '<span>Outstanding payouts: <strong style="color:var(--gold);">' +
    formatGold(outstanding) +
    'g</strong></span>' +
    (donated > 0
      ? '<span>Donated by finders: <strong style="color:var(--gold);">' + formatGold(donated) + 'g</strong></span>'
      : '') +
    '</div>' +
    _boeTeamCreditLine() +
    (_boeCanManage
      ? ''
      : '<p class="signup-officer-note">Lifecycle actions are limited to BoE managers, assigned by a site admin. ' +
        'The totals above cover your own teams; a BoE manager sees the whole guild.</p>');

  // Open: found and listed items. finder_name and found_at always render so
  // two identical items in flight stay tellable apart.
  var openHeaders = ['Item', 'Team', 'Finder', 'Found', 'Status', 'Listings'];
  if (_boeCanManage) openHeaders.push('Actions');
  var openHtml = openRows
    .map(function (item) {
      var listings = (listingsByItem[item.id] || [])
        .map(function (l) {
          return _esc(_boeDate(l.listed_at)) + ': ' + formatGold(l.price) + 'g';
        })
        .join('<br>');
      var cells =
        '<td>' +
        _boeItemCell(item) +
        '</td>' +
        _boeTeamCell(item) +
        '<td>' +
        _esc(item.finder_name || '') +
        '</td>' +
        '<td>' +
        _esc(_boeDate(item.found_at)) +
        '</td>' +
        '<td>' +
        _boeStatusCell(item) +
        '</td>' +
        '<td>' +
        listings +
        '</td>';
      if (_boeCanManage) {
        cells +=
          '<td style="min-width:16rem;">' +
          '<div style="display:flex;gap:0.4rem;flex-wrap:wrap;">' +
          '<button class="btn btn-gold" style="font-size:0.85rem;padding:0.3rem 0.8rem;" onclick="toggleBoeForm(' +
          item.id +
          ", 'listing')\">Record Listing</button>" +
          '<button class="btn btn-gold" style="font-size:0.85rem;padding:0.3rem 0.8rem;" onclick="toggleBoeForm(' +
          item.id +
          ", 'sale')\">Record Sale</button>" +
          '<button class="btn btn-muted" style="font-size:0.85rem;padding:0.3rem 0.8rem;" onclick="retireBoe(' +
          item.id +
          ', this)">Retire</button>' +
          _boeEditForm(item) +
          '</div>' +
          '<span id="boe-listing-form-' +
          item.id +
          '" style="display:none;">' +
          '<br><input id="boe-listing-price-' +
          item.id +
          '" aria-label="Listing price in gold" placeholder="Price, like 250,000" style="width:10rem;"> ' +
          '<input id="boe-listing-note-' +
          item.id +
          '" aria-label="Listing note" placeholder="Note (optional)" style="width:10rem;"> ' +
          '<button class="btn btn-gold" style="font-size:0.85rem;padding:0.3rem 0.8rem;" onclick="confirmBoeListing(' +
          item.id +
          ', this)">Confirm Listing</button>' +
          '</span>' +
          '<span id="boe-sale-form-' +
          item.id +
          '" style="display:none;">' +
          '<br><input id="boe-sale-price-' +
          item.id +
          '" aria-label="Sale price in gold" placeholder="Sale price, like 250,000" style="width:10rem;"> ' +
          '<button class="btn btn-gold" style="font-size:0.85rem;padding:0.3rem 0.8rem;" onclick="confirmBoeSale(' +
          item.id +
          ', this)">Confirm Sale</button>' +
          '</span>' +
          '<span id="boe-status-' +
          item.id +
          '" role="status" style="display:block;color:var(--melee);font-size:0.95rem;"></span>' +
          '</td>';
      }
      return '<tr>' + cells + '</tr>';
    })
    .join('');
  open.innerHTML =
    _boeSection('Open') +
    (openRows.length
      ? _boeTable(openHeaders, openHtml)
      : _boeEmpty('No open BoEs. Found items land here from the raider form.'));

  // Awaiting Payout: sold items with the stored split.
  var awaitingHeaders = ['Item', 'Team', 'Finder', 'Sold', 'Sale', 'Finder payout', 'Guild cut', 'Status'];
  if (_boeCanManage) awaitingHeaders.push('Actions');
  var awaitingHtml = awaitingRows
    .map(function (item) {
      var cells =
        '<td>' +
        _boeItemCell(item) +
        '</td>' +
        _boeTeamCell(item) +
        '<td>' +
        _esc(item.finder_name || '') +
        '</td>' +
        '<td>' +
        _esc(_boeDate(item.sold_at)) +
        '</td>' +
        '<td>' +
        _boeMoney(item.sale_price) +
        '</td>' +
        '<td>' +
        _boeMoney(item.finder_payout) +
        '</td>' +
        '<td>' +
        _boeMoney(item.guild_cut) +
        '</td>' +
        '<td>' +
        _boeStatusCell(item) +
        '</td>';
      if (_boeCanManage) {
        cells +=
          '<td><div style="display:flex;gap:0.4rem;flex-wrap:wrap;">' +
          '<button class="btn btn-gold" style="font-size:0.85rem;padding:0.3rem 0.8rem;" onclick="markBoePaid(' +
          item.id +
          ', this)">Mark Paid</button>' +
          '<button class="btn btn-muted" style="font-size:0.85rem;padding:0.3rem 0.8rem;" onclick="donateBoePayout(' +
          item.id +
          ', this)">Donate to Guild</button>' +
          '<button class="btn btn-danger" style="font-size:0.85rem;padding:0.3rem 0.8rem;" onclick="revertBoe(' +
          item.id +
          ', this)">Undo Sale</button>' +
          _boeEditForm(item) +
          '</div>' +
          '<span id="boe-status-' +
          item.id +
          '" role="status" style="display:block;color:var(--melee);font-size:0.95rem;"></span></td>';
      }
      return '<tr>' + cells + '</tr>';
    })
    .join('');
  awaiting.innerHTML =
    _boeSection('Awaiting Payout') +
    (awaitingRows.length ? _boeTable(awaitingHeaders, awaitingHtml) : _boeEmpty('Nothing awaiting payout.'));

  // History: paid and retired, newest first. Both are undoable since #802,
  // so this section grew an Actions column it never had.
  var historyHeaders = ['Item', 'Team', 'Finder', 'Status', 'Date', 'Sale', 'Finder payout', 'Guild cut'];
  if (_boeCanManage) historyHeaders.push('Actions');
  var historyHtml = historyPageRows
    .map(function (item) {
      var cells =
        '<td>' +
        _boeItemCell(item) +
        '</td>' +
        _boeTeamCell(item) +
        '<td>' +
        _esc(item.finder_name || '') +
        '</td>' +
        '<td>' +
        _boeStatusCell(item) +
        '</td>' +
        '<td>' +
        _esc(_boeDate(item.payout_paid_at || item.retired_at)) +
        '</td>' +
        '<td>' +
        _boeMoney(item.sale_price) +
        '</td>' +
        '<td>' +
        _boeMoney(_boeFinderPaid(item)) +
        '</td>' +
        '<td>' +
        _boeMoney(_boeGuildKept(item)) +
        '</td>';
      if (_boeCanManage) {
        cells +=
          '<td><div style="display:flex;gap:0.4rem;flex-wrap:wrap;">' +
          '<button class="btn btn-danger" style="font-size:0.85rem;padding:0.3rem 0.8rem;" onclick="revertBoe(' +
          item.id +
          ', this)">' +
          (item.status === 'paid' ? 'Undo Payout' : 'Un-retire') +
          '</button>' +
          _boeEditForm(item) +
          '</div>' +
          '<span id="boe-status-' +
          item.id +
          '" role="status" style="display:block;color:var(--melee);font-size:0.95rem;"></span></td>';
      }
      return '<tr>' + cells + '</tr>';
    })
    .join('');
  history.innerHTML =
    _boeSection('History') +
    (historyRows.length ? _boeTable(historyHeaders, historyHtml) : _boeEmpty('No paid or retired BoEs yet.')) +
    _boeHistoryPager();

  // The count line is a static live region on boe.html, written by textContent
  // because a live region recreated by innerHTML is not announced. Optional:
  // the guild-page era never had one.
  var countEl = document.getElementById('guildBoeHistoryCount');
  if (countEl) {
    countEl.textContent =
      _boeHistoryPageCount > 1
        ? 'Showing ' +
          (historyStart + 1) +
          ' to ' +
          (historyStart + historyPageRows.length) +
          ' of ' +
          historyRows.length
        : '';
  }
}

// Previous and Next under the History table, disabled at each end rather than
// removed so the row never shifts; nothing at all when everything fits on one
// page. The visible text is the accessible name.
function _boeHistoryPager() {
  if (_boeHistoryPageCount < 2) return '';
  var atFirst = _boeHistoryPage <= 0;
  var atLast = _boeHistoryPage >= _boeHistoryPageCount - 1;
  return (
    '<div style="display:flex;gap:0.5rem;margin-top:0.75rem;">' +
    '<button class="btn btn-muted" id="boeHistoryPrev" onclick="boeHistoryPage(-1)"' +
    (atFirst ? ' disabled' : '') +
    '>Previous</button>' +
    '<button class="btn btn-muted" id="boeHistoryNext" onclick="boeHistoryPage(1)"' +
    (atLast ? ' disabled' : '') +
    '>Next</button>' +
    '</div>'
  );
}

// A page change is a slice of rows already in memory, so no refetch. The
// re-render replaces both buttons, which drops keyboard focus to body, so focus
// goes back to the pressed button, or to the other one when the pressed button
// has just reached its end and rendered disabled. Both are decided from the
// clamped page index rather than read off the DOM.
function boeHistoryPage(delta) {
  _boeHistoryPage += delta;
  renderBoeManage();
  var forward = delta > 0;
  var atEnd = forward ? _boeHistoryPage >= _boeHistoryPageCount - 1 : _boeHistoryPage <= 0;
  var pressed = forward ? 'boeHistoryNext' : 'boeHistoryPrev';
  var other = forward ? 'boeHistoryPrev' : 'boeHistoryNext';
  var target = document.getElementById(atEnd ? other : pressed);
  if (target && target.focus) target.focus();
}

var BOE_FORM_MODES = ['listing', 'sale', 'edit'];

// One form open per row at a time. Opening the edit form moves focus into its
// name field; the lifecycle forms keep focus on the button that opened them.
function toggleBoeForm(id, mode) {
  var show = document.getElementById('boe-' + mode + '-form-' + id);
  BOE_FORM_MODES.forEach(function (m) {
    if (m === mode) return;
    var other = document.getElementById('boe-' + m + '-form-' + id);
    if (other) other.style.display = 'none';
  });
  if (!show) return;
  var opening = show.style.display === 'none';
  show.style.display = opening ? '' : 'none';
  if (opening && mode === 'edit') {
    var name = document.getElementById('boe-edit-name-' + id);
    if (name && name.focus) name.focus();
  }
}

function _setBoeRowStatus(id, message) {
  var el = document.getElementById('boe-status-' + id);
  if (el) el.textContent = message;
}

// Shared RPC-call plumbing: disable the button for the flight, restore it on
// every settle path, surface the server's message verbatim (the raises are
// purpose-written), and only audit or touch the model after a success.
function _boeAction(id, btnEl, rpcName, params, onSuccess) {
  var prevLabel = btnEl ? btnEl.textContent : '';
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = '...';
  }
  function restore() {
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = prevLabel;
    }
  }
  return supabaseClient
    .rpc(rpcName, params)
    .then(function (result) {
      restore();
      if (result.error) {
        _setBoeRowStatus(id, result.error.message);
        return;
      }
      onSuccess(result);
      renderBoeManage();
    })
    .catch(function (err) {
      restore();
      _setBoeRowStatus(id, err && err.message ? err.message : 'Something went wrong.');
    });
}

function confirmBoeListing(id, btnEl) {
  var item = findBoeItem(id);
  if (!item) return;
  var priceEl = document.getElementById('boe-listing-price-' + id);
  var noteEl = document.getElementById('boe-listing-note-' + id);
  var price = parseGoldInput(priceEl ? priceEl.value : '');
  if (price === null) {
    _setBoeRowStatus(id, 'Enter a price in gold, like 250,000.');
    return;
  }
  var note = noteEl ? String(noteEl.value).trim() : '';
  return _boeAction(id, btnEl, 'boe_record_listing', { p_id: id, p_price: price, p_note: note || null }, function () {
    writeAuditLog(
      'BoE Listed',
      'boe_items',
      id,
      item.item_name + ' listed for ' + formatGold(price) + 'g',
      item.team_id
    );
    item.status = 'listed';
    _boeListings.push({ boe_item_id: id, listed_at: new Date().toISOString(), price: price, note: note || null });
  });
}

function confirmBoeSale(id, btnEl) {
  var item = findBoeItem(id);
  if (!item) return;
  var priceEl = document.getElementById('boe-sale-price-' + id);
  var price = parseGoldInput(priceEl ? priceEl.value : '');
  if (price === null || price <= 0) {
    _setBoeRowStatus(id, 'Enter a price in gold, like 250,000.');
    return;
  }
  return _boeAction(id, btnEl, 'boe_record_sale', { p_id: id, p_sale_price: price }, function (result) {
    // The RPC computes and returns the split, so the row carries its money
    // columns into Awaiting Payout without a refetch.
    var split = (result.data && result.data[0]) || {};
    item.status = 'sold';
    item.sold_at = new Date().toISOString();
    item.sale_price = split.sale_price;
    item.finder_payout = split.finder_payout;
    item.guild_cut = split.guild_cut;
    writeAuditLog(
      'BoE Sale Recorded',
      'boe_items',
      id,
      item.item_name +
        ' sold for ' +
        formatGold(price) +
        'g; finder payout ' +
        formatGold(split.finder_payout || 0) +
        'g',
      item.team_id
    );
  });
}

// Mark Paid sends p_donated false explicitly: the manager's button decides,
// so a row the raider flagged loses the intent here, and the audit says so.
function markBoePaid(id, btnEl) {
  var item = findBoeItem(id);
  if (!item) return;
  var hadIntent = !!item.payout_donated;
  return _boeAction(id, btnEl, 'boe_mark_paid', { p_id: id, p_donated: false }, function () {
    item.status = 'paid';
    item.payout_paid_at = new Date().toISOString();
    item.payout_donated = false;
    writeAuditLog(
      'BoE Payout Paid',
      'boe_items',
      id,
      item.item_name +
        ': ' +
        formatGold(item.finder_payout || 0) +
        'g to ' +
        (item.finder_name || 'unknown finder') +
        (hadIntent ? ' (donate intent cleared)' : ''),
      item.team_id
    );
  });
}

// Donate to Guild (#862): the same settlement moment as Mark Paid with the
// finder's cut marked as kept by the guild. The money columns stay what
// policy said; the flag is the recognition, and the summary counts it.
function donateBoePayout(id, btnEl) {
  var item = findBoeItem(id);
  if (!item) return;
  return _boeAction(id, btnEl, 'boe_mark_paid', { p_id: id, p_donated: true }, function () {
    item.status = 'paid';
    item.payout_paid_at = new Date().toISOString();
    item.payout_donated = true;
    writeAuditLog(
      'BoE Payout Donated',
      'boe_items',
      id,
      item.item_name +
        ': ' +
        formatGold(item.finder_payout || 0) +
        'g finder cut from ' +
        (item.finder_name || 'unknown finder') +
        ' kept by the guild',
      item.team_id
    );
  });
}

function retireBoe(id, btnEl) {
  var item = findBoeItem(id);
  if (!item) return;
  if (!confirm('Retire ' + item.item_name + '? It leaves the open list; the row stays in History.')) return;
  return _boeAction(id, btnEl, 'boe_retire', { p_id: id }, function () {
    item.status = 'retired';
    item.retired_at = new Date().toISOString();
    writeAuditLog('BoE Retired', 'boe_items', id, item.item_name, item.team_id);
  });
}

// The correction path (#802). boe_revert() walks the lifecycle backwards:
// paid -> sold, sold -> listed or found, retired -> found. It has existed
// since the #745 backend and had no caller, so a mistyped sale price or a
// premature Mark Paid could not be undone from the interface at all.

// Two things the other handlers do not have to deal with:
//
//   1. The landing status is the server's to decide. A sold row goes back to
//      listed while listing rows survive and to found otherwise, so the RPC
//      returns the new status as text and this takes that answer rather than
//      working it out from a local copy of _boeListings that may be stale.
//   2. The receipt has to be cleared locally as well. The server nulls the
//      money columns on the way out of sold; leaving them in the in-memory row
//      would render a sale price against an item that is no longer sold.
//
// The listed -> found edge is unreachable from here: boe_record_listing()
// inserts a boe_listings row and sets the status in the same call, so a listed
// BoE always has at least one listing and the RPC always raises "Delete the
// listing rows first". Nothing in the app deletes a listing. That edge waits on
// listing deletion; the message surfaces verbatim if anyone reaches it.
function revertBoe(id, btnEl) {
  var item = findBoeItem(id);
  if (!item) return;
  var from = item.status;
  // Undoing a payout or a sale rewrites money. Un-retiring only puts a row
  // back on the open list, so it does not earn the same interruption.
  if (from === 'paid' || from === 'sold') {
    var what =
      from === 'paid'
        ? 'Undo the payout on ' + item.item_name + '? It goes back to Awaiting Payout.'
        : 'Undo the sale of ' + item.item_name + '? The sale price and the split are cleared.';
    if (!confirm(what)) return;
  }
  return _boeAction(id, btnEl, 'boe_revert', { p_id: id }, function (result) {
    var to = result && result.data;
    item.status = to;
    if (from === 'paid') {
      // The donate intent (#862) stays on the row through an undo; the next
      // settle click sets it either way.
      item.payout_paid_at = null;
    } else if (from === 'sold') {
      item.sold_at = null;
      item.sale_price = null;
      item.finder_payout = null;
      item.guild_cut = null;
    } else if (from === 'retired') {
      item.retired_at = null;
    }
    writeAuditLog('BoE Reverted', 'boe_items', id, item.item_name + ': ' + from + ' back to ' + to, item.team_id);
  });
}

// --- Edit (#874) -----------------------------------------------------------
//
// Reads the row's edit form back. The name is trimmed; a blank track or note
// is null, which is what the raider form stores for "not given".
function _boeEditValues(id) {
  var nameEl = document.getElementById('boe-edit-name-' + id);
  var trackEl = document.getElementById('boe-edit-track-' + id);
  var noteEl = document.getElementById('boe-edit-note-' + id);
  var name = nameEl ? String(nameEl.value || '').trim() : '';
  var track = trackEl ? String(trackEl.value || '').trim() : '';
  var note = noteEl ? String(noteEl.value || '').trim() : '';
  // A catalog match (#875) stores the catalog spelling and the link; anything
  // else stores the text as typed with no link.
  var hit = _boeCatalogHit(name);
  return { item_name: hit ? hit.name : name, track: track || null, note: note || null, item_id: hit ? hit.id : null };
}

function _boeCatalogHit(name) {
  var key = String(name || '')
    .trim()
    .toLowerCase();
  if (!key) return null;
  for (var i = 0; i < _boeCatalog.length; i++) {
    if (String(_boeCatalog[i].name).toLowerCase() === key) return _boeCatalog[i];
  }
  return null;
}

// Which editable columns differ between the row and the form, with both values
// for the audit detail. Null and undefined compare equal to each other here.
function _boeEditChanges(item, values) {
  var changes = [];
  BOE_EDIT_COLUMNS.forEach(function (col) {
    var from = item[col[0]] == null ? null : item[col[0]];
    var to = values[col[0]] == null ? null : values[col[0]];
    if (from !== to) changes.push({ col: col[0], label: col[1], from: from, to: to });
  });
  return changes;
}

// The audit detail quotes the old and new value of every changed column, so a
// raider's original words survive a rewrite of the note.
function _boeEditDetail(changes) {
  var quote = function (v) {
    if (v == null) return '(none)';
    return typeof v === 'number' ? String(v) : '"' + v + '"';
  };
  return changes
    .map(function (c) {
      return c.label === 'item'
        ? 'item renamed from ' + quote(c.from) + ' to ' + quote(c.to)
        : c.label + ' was ' + quote(c.from) + ', now ' + quote(c.to);
    })
    .join('; ');
}

function _focusBoeEditButton(id) {
  var btn = document.getElementById('boe-edit-btn-' + id);
  if (btn && btn.focus) btn.focus();
}

// Save is a plain UPDATE of every editable column by id, not an RPC: the
// check_boe_status_transition trigger admits exactly these columns from an
// authenticated caller and raises on anything else, and the update policy is
// the manager grant. A grant revoked since the page loaded makes RLS filter
// the row out, which returns no error and zero rows, so the returned row is
// what turns that into a message rather than a silent no-op.
function saveBoeEdit(id, btnEl) {
  var item = findBoeItem(id);
  if (!item) return;
  var values = _boeEditValues(id);
  if (!values.item_name) {
    _setBoeRowStatus(id, 'Enter the item name.');
    return;
  }
  var changes = _boeEditChanges(item, values);
  if (!changes.length) {
    cancelBoeEdit(id);
    return;
  }
  var payload = {};
  BOE_EDIT_COLUMNS.forEach(function (col) {
    payload[col[0]] = values[col[0]];
  });
  var prevLabel = btnEl ? btnEl.textContent : '';
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = '...';
  }
  function restore() {
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = prevLabel;
    }
  }
  return supabaseClient
    .from('boe_items')
    .update(payload)
    .eq('id', id)
    .select('id')
    .then(function (result) {
      restore();
      if (result.error) {
        _setBoeRowStatus(id, result.error.message);
        return;
      }
      if (!result.data || !result.data.length) {
        _setBoeRowStatus(id, 'Nothing was saved. Your BoE manager grant may have been revoked; reload the page.');
        return;
      }
      BOE_EDIT_COLUMNS.forEach(function (col) {
        item[col[0]] = values[col[0]];
      });
      writeAuditLog('BoE Find Edited', 'boe_items', id, _boeEditDetail(changes), item.team_id);
      // The re-render recreates the row's Edit button under the same id; the
      // row cannot change section, since status and dates are untouched.
      renderBoeManage();
      _focusBoeEditButton(id);
    })
    .catch(function (err) {
      restore();
      _setBoeRowStatus(id, err && err.message ? err.message : 'Something went wrong.');
    });
}

// Cancel puts the fields back to the row's values and hides the form, with no
// re-render, so nothing else on the page moves.
function cancelBoeEdit(id) {
  var item = findBoeItem(id);
  var form = document.getElementById('boe-edit-form-' + id);
  if (form) form.style.display = 'none';
  if (item) {
    var nameEl = document.getElementById('boe-edit-name-' + id);
    var trackEl = document.getElementById('boe-edit-track-' + id);
    var noteEl = document.getElementById('boe-edit-note-' + id);
    if (nameEl) nameEl.value = item.item_name || '';
    if (trackEl) trackEl.value = item.track || '';
    if (noteEl) noteEl.value = item.note || '';
  }
  _focusBoeEditButton(id);
}
