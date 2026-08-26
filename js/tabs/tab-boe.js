// Officer BoE tab (#747): runs the auction lifecycle the #745 backend
// defines (found -> listed -> sold -> paid, plus retire). Three sections
// over one paged read of the team's boe_items -- Open (found/listed),
// Awaiting Payout (sold), History (paid/retired) -- plus a summary strip.
//
// Action buttons render only for BoE managers (the is_boe_manager RPC, the
// same function the RLS policies evaluate) and site admins; other officers
// get the tab read-only. The server enforces the gate regardless. The
// lifecycle RPCs write no audit entries themselves, so every successful
// mutation writes one from here.
//
// Mutations update the in-memory model and re-render instead of refetching:
// boe_record_sale returns the computed split, so the row it moves to
// Awaiting Payout carries its money columns without another read.

var _boeItems = [];
var _boeListings = [];
var _boeCanManage = false;

function buildBoeTab() {
  var summary = document.getElementById('boeSummary');
  var open = document.getElementById('boeOpen');
  var awaiting = document.getElementById('boeAwaiting');
  var history = document.getElementById('boeHistory');
  if (!summary || !open || !awaiting || !history) return;

  function bail(html) {
    summary.innerHTML = html;
    open.innerHTML = '';
    awaiting.innerHTML = '';
    history.innerHTML = '';
  }

  // Nav-hide alone does not protect the ?tab=boe deep link: openTab() clicks
  // the button even when it is hidden, so the tab guards itself.
  if (typeof featureEnabled === 'function' && !featureEnabled('boe')) {
    bail(
      '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">The BoE tracker is turned off for this team.</p>'
    );
    return;
  }
  // is_guild_officer() passes no BoE gate server-side and cannot read
  // boe_items, so a fetch would only render an error.
  if (window._guildOfficerAccessLevel === 'guild') {
    bail(
      '<p class="signup-officer-note">The BoE tracker is not available for guild officer access on a team you are not an officer of.</p>'
    );
    return;
  }
  if (!supabaseClient) {
    bail('<p style="color:var(--melee);font-size:1rem;">Database connection is not configured.</p>');
    return;
  }

  bail('<p style="color:var(--text-muted);font-size:1rem;">Loading BoE data...</p>');

  var session = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
  var isAdmin = !!(session && session.isAdmin);
  var managerPromise = isAdmin
    ? Promise.resolve(true)
    : supabaseClient.rpc('is_boe_manager', { p_team_id: _teamCfg.supabaseTeamId }).then(function (result) {
        return !result.error && result.data === true;
      });

  var itemsPromise = fetchAllPaged(
    function (afterId, limit) {
      var q = supabaseClient
        .from('boe_items')
        .select(
          'id, player_id, finder_name, item_name, track, note, status, found_at, sold_at, payout_paid_at, retired_at, sale_price, finder_payout, guild_cut',
          afterId === null ? { count: 'exact' } : undefined
        )
        .eq('team_id', _teamCfg.supabaseTeamId)
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
        .eq('team_id', _teamCfg.supabaseTeamId)
        .order('id', { ascending: true })
        .limit(limit);
      return afterId === null ? q : q.gt('id', afterId);
    },
    { label: 'boe listings' }
  );

  Promise.all([itemsPromise, listingsPromise, managerPromise]).then(function (results) {
    var items = results[0];
    var listings = results[1];
    // fetchAllPaged returns null on error or timeout, never partial rows;
    // an empty team is [] and must stay distinguishable.
    if (items === null || listings === null) {
      bail('<p style="color:var(--melee);font-size:1rem;">Could not load BoE data. Try again in a minute.</p>');
      return;
    }
    _boeItems = items;
    _boeListings = listings;
    _boeCanManage = !!results[2];
    renderBoeTab();
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

function _boeItemCell(item) {
  var html = escHtml(item.item_name);
  if (item.track) {
    html += ' <span class="badge" style="margin-left:0.35rem;">' + escHtml(item.track) + '</span>';
  }
  // The raider's submit-form note surfaces to officers only here.
  if (item.note) {
    html += '<br><span style="color:var(--text-muted);font-size:0.95rem;">' + escHtml(item.note) + '</span>';
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
  return '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">' + text + '</p>';
}

function _boeSection(title) {
  return (
    '<div style="font-size:1.02rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin:1.5rem 0 0.75rem;">' +
    title +
    '</div>'
  );
}

function findBoeItem(id) {
  for (var i = 0; i < _boeItems.length; i++) {
    if (_boeItems[i].id === id) return _boeItems[i];
  }
  return null;
}

function renderBoeTab() {
  var summary = document.getElementById('boeSummary');
  var open = document.getElementById('boeOpen');
  var awaiting = document.getElementById('boeAwaiting');
  var history = document.getElementById('boeHistory');
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
    (_boeCanManage
      ? ''
      : '<p class="signup-officer-note">Lifecycle actions are limited to BoE managers, assigned by a site admin.</p>');

  // Open: found and listed items. finder_name and found_at always render so
  // two identical items in flight stay tellable apart.
  var openHeaders = ['Item', 'Finder', 'Found', 'Status', 'Listings'];
  if (_boeCanManage) openHeaders.push('Actions');
  var openHtml = openRows
    .map(function (item) {
      var listings = (listingsByItem[item.id] || [])
        .map(function (l) {
          return escHtml(_boeDate(l.listed_at)) + ': ' + formatGold(l.price) + 'g';
        })
        .join('<br>');
      var cells =
        '<td>' +
        _boeItemCell(item) +
        '</td>' +
        '<td>' +
        escHtml(item.finder_name || '') +
        '</td>' +
        '<td>' +
        escHtml(_boeDate(item.found_at)) +
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
  var awaitingHeaders = ['Item', 'Finder', 'Sold', 'Sale', 'Finder payout', 'Guild cut', 'Status'];
  if (_boeCanManage) awaitingHeaders.push('Actions');
  var awaitingHtml = awaitingRows
    .map(function (item) {
      var cells =
        '<td>' +
        _boeItemCell(item) +
        '</td>' +
        '<td>' +
        escHtml(item.finder_name || '') +
        '</td>' +
        '<td>' +
        escHtml(_boeDate(item.sold_at)) +
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
          ', this)">Mark Paid</button>' +
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

  // History: paid and retired, newest first.
  var historyHtml = historyRows
    .map(function (item) {
      return (
        '<tr>' +
        '<td>' +
        _boeItemCell(item) +
        '</td>' +
        '<td>' +
        escHtml(item.finder_name || '') +
        '</td>' +
        '<td>' +
        _boeBadge(item.status) +
        '</td>' +
        '<td>' +
        escHtml(_boeDate(item.payout_paid_at || item.retired_at)) +
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
        '</tr>'
      );
    })
    .join('');
  history.innerHTML =
    _boeSection('History') +
    (historyRows.length
      ? _boeTable(['Item', 'Finder', 'Status', 'Date', 'Sale', 'Finder payout', 'Guild cut'], historyHtml)
      : _boeEmpty('No paid or retired BoEs yet.'));
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
      renderBoeTab();
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
    writeAuditLog('BoE Listed', 'boe_items', id, item.item_name + ' listed for ' + formatGold(price) + 'g');
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
        'g'
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
      item.item_name + ': ' + formatGold(item.finder_payout || 0) + 'g to ' + (item.finder_name || 'unknown finder')
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
    writeAuditLog('BoE Retired', 'boe_items', id, item.item_name);
  });
}
