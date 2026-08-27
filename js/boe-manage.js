// The BoE auction lifecycle surface (found -> listed -> sold -> paid, plus
// retire), running the RPCs the #745 backend defines. Three sections over one
// paged read of boe_items -- Open (found/listed), Awaiting Payout (sold),
// History (paid/retired) -- plus a summary strip.
//
// Lived on the officer dashboard as a per-team tab until #774 moved it here.
// The move is what the data model already said: boe_items is guild property,
// its read policy is guild-wide, the manager grant went guild-wide in #766,
// and #765 had already made this read ignore whichever team's dashboard it was
// rendered under. Hosting a guild-scoped surface inside a per-team page was
// the vestigial part, and it locked out the one person the guild-wide grant
// exists for: a BoE manager with no officer role could not open officer.html
// at all, and a guild officer holding the grant was excluded by name.
//
// js/guild.js owns who sees this and calls buildBoeManage() only for someone
// who may read: any team officer, a BoE manager, or a site admin. It passes
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
var _boeCanManage = false;

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
          'id, team_id, player_id, finder_name, item_name, track, note, status, found_at, sold_at, payout_paid_at, retired_at, sale_price, finder_payout, guild_cut',
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

  return Promise.all([itemsPromise, listingsPromise]).then(function (results) {
    var items = results[0];
    var listings = results[1];
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

function _boeBadge(status) {
  var label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    '<span style="font-size:0.95rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:' +
    (_BOE_BADGE_COLORS[status] || 'var(--text-muted)') +
    ';">' +
    label +
    '</span>'
  );
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
    if (item.status === 'sold' || item.status === 'paid') row.gold += item.guild_cut || 0;
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
  _boeItems.forEach(function (item) {
    if (item.status === 'found' || item.status === 'listed') openRows.push(item);
    else if (item.status === 'sold') awaitingRows.push(item);
    else if (item.status === 'paid' || item.status === 'retired') historyRows.push(item);
    if (item.status === 'sold' || item.status === 'paid') guildIncome += item.guild_cut || 0;
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
        _boeBadge(item.status) +
        '</td>' +
        '<td>' +
        listings +
        '</td>';
      if (_boeCanManage) {
        cells +=
          '<td style="min-width:16rem;">' +
          '<button class="btn" onclick="toggleBoeForm(' +
          item.id +
          ", 'listing')\">Record Listing</button> " +
          '<button class="btn" onclick="toggleBoeForm(' +
          item.id +
          ", 'sale')\">Record Sale</button> " +
          '<button class="btn" onclick="retireBoe(' +
          item.id +
          ', this)">Retire</button>' +
          '<span id="boe-listing-form-' +
          item.id +
          '" style="display:none;">' +
          '<br><input id="boe-listing-price-' +
          item.id +
          '" aria-label="Listing price in gold" placeholder="Price, like 250,000" style="width:10rem;"> ' +
          '<input id="boe-listing-note-' +
          item.id +
          '" aria-label="Listing note" placeholder="Note (optional)" style="width:10rem;"> ' +
          '<button class="btn" onclick="confirmBoeListing(' +
          item.id +
          ', this)">Confirm Listing</button>' +
          '</span>' +
          '<span id="boe-sale-form-' +
          item.id +
          '" style="display:none;">' +
          '<br><input id="boe-sale-price-' +
          item.id +
          '" aria-label="Sale price in gold" placeholder="Sale price, like 250,000" style="width:10rem;"> ' +
          '<button class="btn" onclick="confirmBoeSale(' +
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
        _boeBadge(item.status) +
        '</td>';
      if (_boeCanManage) {
        cells +=
          '<td><button class="btn" onclick="markBoePaid(' +
          item.id +
          ', this)">Mark Paid</button> ' +
          '<button class="btn" onclick="revertBoe(' +
          item.id +
          ', this)">Undo Sale</button>' +
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
  var historyHtml = historyRows
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
        _boeBadge(item.status) +
        '</td>' +
        '<td>' +
        _esc(_boeDate(item.payout_paid_at || item.retired_at)) +
        '</td>' +
        '<td>' +
        _boeMoney(item.sale_price) +
        '</td>' +
        '<td>' +
        _boeMoney(item.finder_payout) +
        '</td>' +
        '<td>' +
        _boeMoney(item.guild_cut) +
        '</td>';
      if (_boeCanManage) {
        cells +=
          '<td><button class="btn" onclick="revertBoe(' +
          item.id +
          ', this)">' +
          (item.status === 'paid' ? 'Undo Payout' : 'Un-retire') +
          '</button>' +
          '<span id="boe-status-' +
          item.id +
          '" role="status" style="display:block;color:var(--melee);font-size:0.95rem;"></span></td>';
      }
      return '<tr>' + cells + '</tr>';
    })
    .join('');
  history.innerHTML =
    _boeSection('History') +
    (historyRows.length ? _boeTable(historyHeaders, historyHtml) : _boeEmpty('No paid or retired BoEs yet.'));
}

function toggleBoeForm(id, mode) {
  var show = document.getElementById('boe-' + mode + '-form-' + id);
  var other = document.getElementById('boe-' + (mode === 'listing' ? 'sale' : 'listing') + '-form-' + id);
  if (other) other.style.display = 'none';
  if (show) show.style.display = show.style.display === 'none' ? '' : 'none';
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

function markBoePaid(id, btnEl) {
  var item = findBoeItem(id);
  if (!item) return;
  return _boeAction(id, btnEl, 'boe_mark_paid', { p_id: id }, function () {
    item.status = 'paid';
    item.payout_paid_at = new Date().toISOString();
    writeAuditLog(
      'BoE Payout Paid',
      'boe_items',
      id,
      item.item_name + ': ' + formatGold(item.finder_payout || 0) + 'g to ' + (item.finder_name || 'unknown finder'),
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
