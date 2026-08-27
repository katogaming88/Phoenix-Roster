// Site admin dashboard (admin.html) -- #232 (team management, site admin
// grant/revoke, feature flags, cross-team audit log) and #245 (maintenance
// mode).
//
// Deliberately standalone rather than reusing common.js/discord.js: both are
// built around a single active team (_teamCfg, TEAM_SLUG-keyed session
// storage, resolveDiscordSession() querying that team's team_members row).
// This page isn't scoped to a team, so it gets its own minimal Supabase
// client and a lean auth check that only needs is_site_admin().

var SUPABASE_URL = 'https://kxgjqnpwfklbgrxdgmmv.supabase.co';
var SUPABASE_ANON_KEY = 'sb_publishable_OdTUOR0Do1ThdKUPBh5inA_OWq78POC';
var supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

var _adminTeams = [];

function adminLoginWithDiscord() {
  if (!supabaseClient) return;
  supabaseClient.auth.signInWithOAuth({
    provider: 'discord',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
}

function adminLogout() {
  if (!supabaseClient) return;
  supabaseClient.auth.signOut().then(function () {
    window.location.href = 'index.html';
  });
}

function showState(name) {
  ['adminLoadingMsg', 'adminLoginPrompt', 'adminDeniedMsg', 'adminView'].forEach(function (id) {
    document.getElementById(id).style.display = id === name ? '' : 'none';
  });
}

// Same nav-item/tab-panel setup and switchTab() shape as officer.js,
// including its per-tab refresh-on-switch convention -- data is loaded once
// eagerly at login too (so a first paint doesn't need a click first), but
// without refetching here, switching to Audit Log after toggling a flag on
// the Feature Flags tab would still show whatever was fetched at login,
// same problem officer.js avoids by rebuilding each tab on every switch.
function switchTab(name) {
  document.querySelectorAll('.nav-item').forEach(function (b) {
    b.classList.remove('active');
  });
  document.querySelectorAll('.tab-panel').forEach(function (p) {
    p.classList.remove('active');
  });
  event.target.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'teams') loadTeams();
  if (name === 'siteadmins') loadSiteAdmins();
  if (name === 'guildofficers') loadGuildOfficers();
  if (name === 'boe') {
    loadBoeManagers();
    loadBoePayoutSettings();
  }
  if (name === 'flags') loadTeams().then(loadFeatureFlags);
  if (name === 'audit') loadAuditLog();
  if (name === 'maintenance') loadMaintenanceStatus();
}

function checkAdminAccess() {
  if (!supabaseClient) {
    showState('adminDeniedMsg');
    return;
  }
  supabaseClient.auth.getSession().then(function (result) {
    var session = result.data.session;
    if (!session) {
      showState('adminLoginPrompt');
      return;
    }
    supabaseClient.rpc('is_site_admin').then(function (adminResult) {
      if (!adminResult.data) {
        showState('adminDeniedMsg');
        return;
      }
      var name = session.user.user_metadata.full_name || session.user.user_metadata.name || 'Admin';
      var who = document.getElementById('adminWhoAmI');
      who.textContent = name + ' (log out)';
      who.style.cursor = 'pointer';
      who.onclick = adminLogout;
      showState('adminView');
      loadTeams().then(function () {
        loadFeatureFlags();
        populateAuditTeamFilter();
        loadAuditLog();
      });
      loadSiteAdmins();
      loadGuildOfficers();
      loadBoeManagers();
      loadBoePayoutSettings();
      loadMaintenanceStatus();
    });
  });
}

function loadTeams() {
  return supabaseClient
    .from('teams')
    .select('id, name, slug, archived_at')
    .order('id')
    .then(function (result) {
      _adminTeams = result.data || [];
      renderTeamRows();
    });
}

function renderTeamRows() {
  var tbody = document.getElementById('adminTeamRows');
  tbody.innerHTML = _adminTeams
    .map(function (team) {
      var archived = !!team.archived_at;
      return (
        '<tr' +
        (archived ? ' class="admin-archived-row"' : '') +
        '>' +
        '<td>' +
        escapeHtml(team.name) +
        '</td>' +
        '<td>' +
        escapeHtml(team.slug) +
        '</td>' +
        '<td><span class="admin-status-badge ' +
        (archived ? 'admin-status-archived' : 'admin-status-active') +
        '">' +
        (archived ? 'Archived' : 'Active') +
        '</span></td>' +
        '<td class="admin-row-actions">' +
        '<button class="btn btn-gold" onclick="showEditTeamModal(' +
        team.id +
        ')">Edit</button>' +
        '<button class="btn ' +
        (archived ? 'btn-muted' : 'btn-danger') +
        '" onclick="toggleArchiveTeam(' +
        team.id +
        ')">' +
        (archived ? 'Unarchive' : 'Archive') +
        '</button>' +
        '</td>' +
        '</tr>'
      );
    })
    .join('');
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function showCreateTeamModal() {
  document.getElementById('teamModalTitle').textContent = 'New Team';
  document.getElementById('teamModalId').value = '';
  document.getElementById('teamModalName').value = '';
  document.getElementById('teamModalSlug').value = '';
  document.getElementById('teamModalError').style.display = 'none';
  document.getElementById('teamModal').style.display = 'flex';
}

function showEditTeamModal(teamId) {
  var team = _adminTeams.filter(function (t) {
    return t.id === teamId;
  })[0];
  if (!team) return;
  document.getElementById('teamModalTitle').textContent = 'Edit Team';
  document.getElementById('teamModalId').value = team.id;
  document.getElementById('teamModalName').value = team.name;
  document.getElementById('teamModalSlug').value = team.slug;
  document.getElementById('teamModalError').style.display = 'none';
  document.getElementById('teamModal').style.display = 'flex';
}

function hideTeamModal() {
  document.getElementById('teamModal').style.display = 'none';
}

function submitTeamModal() {
  var id = document.getElementById('teamModalId').value;
  var name = document.getElementById('teamModalName').value.trim();
  var slug = document.getElementById('teamModalSlug').value.trim();
  var errorEl = document.getElementById('teamModalError');
  errorEl.style.display = 'none';

  if (!name || !slug) {
    errorEl.textContent = 'Name and slug are required.';
    errorEl.style.display = '';
    return;
  }

  var call = id
    ? supabaseClient.rpc('admin_update_team', { p_team_id: parseInt(id, 10), p_name: name, p_slug: slug })
    : supabaseClient.rpc('admin_create_team', { p_name: name, p_slug: slug });

  call.then(function (result) {
    if (result.error) {
      errorEl.textContent = result.error.message;
      errorEl.style.display = '';
      return;
    }
    hideTeamModal();
    loadTeams();
  });
}

function toggleArchiveTeam(teamId) {
  var team = _adminTeams.filter(function (t) {
    return t.id === teamId;
  })[0];
  if (!team) return;
  var archiving = !team.archived_at;
  var verb = archiving ? 'archive' : 'unarchive';
  if (!confirm('Are you sure you want to ' + verb + ' ' + team.name + '?')) return;

  supabaseClient.rpc('admin_set_team_archived', { p_team_id: teamId, p_archived: archiving }).then(function (result) {
    if (result.error) {
      alert(result.error.message);
      return;
    }
    loadTeams();
  });
}

var _adminSiteAdmins = [];

function loadSiteAdmins() {
  supabaseClient.rpc('admin_list_site_admins').then(function (result) {
    _adminSiteAdmins = result.data || [];
    renderSiteAdminRows();
  });
}

function renderSiteAdminRows() {
  var tbody = document.getElementById('adminSiteAdminRows');
  tbody.innerHTML = _adminSiteAdmins
    .map(function (sa) {
      return (
        '<tr>' +
        '<td>' +
        escapeHtml(sa.display_name || '(not yet logged in)') +
        '</td>' +
        '<td class="admin-discord-id">' +
        escapeHtml(sa.discord_id) +
        '</td>' +
        '<td class="admin-row-actions">' +
        '<button class="btn btn-danger" onclick="submitRevokeSiteAdmin(\'' +
        escapeHtml(sa.discord_id) +
        '\')">Revoke</button>' +
        '</td>' +
        '</tr>'
      );
    })
    .join('');
}

function submitGrantSiteAdmin() {
  var input = document.getElementById('grantDiscordId');
  var discordId = input.value.trim();
  var errorEl = document.getElementById('grantSiteAdminError');
  errorEl.style.display = 'none';

  if (!discordId) {
    errorEl.textContent = 'Discord user ID is required.';
    errorEl.style.display = '';
    return;
  }

  supabaseClient.rpc('admin_grant_site_admin', { p_discord_id: discordId }).then(function (result) {
    if (result.error) {
      errorEl.textContent = result.error.message;
      errorEl.style.display = '';
      return;
    }
    input.value = '';
    loadSiteAdmins();
  });
}

function submitRevokeSiteAdmin(discordId) {
  if (!confirm('Revoke site admin access for this Discord account?')) return;

  supabaseClient.rpc('admin_revoke_site_admin', { p_discord_id: discordId }).then(function (result) {
    if (result.error) {
      alert(result.error.message);
      return;
    }
    loadSiteAdmins();
  });
}

// ── Guild Officers (#607) ─────────────────────────────────────────────────

var _adminGuildOfficers = [];

function loadGuildOfficers() {
  supabaseClient.rpc('admin_list_guild_officers').then(function (result) {
    _adminGuildOfficers = result.data || [];
    renderGuildOfficerRows();
  });
}

function renderGuildOfficerRows() {
  var tbody = document.getElementById('adminGuildOfficerRows');
  tbody.innerHTML = _adminGuildOfficers
    .map(function (go) {
      return (
        '<tr>' +
        '<td>' +
        escapeHtml(go.display_name || '(not yet logged in)') +
        '</td>' +
        '<td class="admin-discord-id">' +
        escapeHtml(go.discord_id) +
        '</td>' +
        '<td class="admin-row-actions">' +
        '<button class="btn btn-danger" onclick="submitRevokeGuildOfficer(\'' +
        escapeHtml(go.discord_id) +
        '\')">Revoke</button>' +
        '</td>' +
        '</tr>'
      );
    })
    .join('');
}

function submitGrantGuildOfficer() {
  var input = document.getElementById('grantGuildOfficerDiscordId');
  var discordId = input.value.trim();
  var errorEl = document.getElementById('grantGuildOfficerError');
  errorEl.style.display = 'none';

  if (!discordId) {
    errorEl.textContent = 'Discord user ID is required.';
    errorEl.style.display = '';
    return;
  }

  supabaseClient.rpc('admin_grant_guild_officer', { p_discord_id: discordId }).then(function (result) {
    if (result.error) {
      errorEl.textContent = result.error.message;
      errorEl.style.display = '';
      return;
    }
    input.value = '';
    loadGuildOfficers();
  });
}

function submitRevokeGuildOfficer(discordId) {
  if (!confirm('Revoke guild officer access for this Discord account?')) return;

  supabaseClient.rpc('admin_revoke_guild_officer', { p_discord_id: discordId }).then(function (result) {
    if (result.error) {
      alert(result.error.message);
      return;
    }
    loadGuildOfficers();
  });
}

// ── BoE (#748) ────────────────────────────────────────────────────────────
//
// Two halves that both belong to a site admin and to nobody else: the
// boe_managers grant, which gates every BoE money mutation, and the two payout
// constants the sale split is computed from. Both are guild-wide, which is why
// they live here rather than on a team's officer dashboard.
//
// admin.html loads this file and nothing else, so common.js's and
// js/boe-manage.js's helpers are not reachable here. The two gold helpers below are
// private copies for that reason, the same situation js/signup.js documents.

// ── BoE managers

var _adminBoeManagers = [];

// The grant is guild-wide since #766, so there is no team or roster row to
// name a manager by -- only the Discord account the grant was issued to.
// admin_list_boe_managers() joins auth.users for a display name, and returns
// auth_user_id so this panel can tell a live grant from one that has not
// activated yet. A grant issued before its holder's first sign-in has a null
// auth_user_id and authorizes nothing until link_auth_user_to_member() fills
// it on their first login. Rendering that identically to a live grant is the
// gap #768 tracks for guild officers; this panel does not repeat it.
function boeManagerActivated(row) {
  return !!(row && row.auth_user_id);
}

// Three states, not two. A row can have activated and still carry no name,
// when the Discord account has neither full_name nor name in its metadata --
// falling back to a single "(not yet logged in)" string there would put a
// contradiction next to the Active badge in the following column.
function boeManagerDisplayName(row) {
  if (row && row.display_name) return row.display_name;
  if (boeManagerActivated(row)) return '(no name on file)';
  return '(not yet logged in)';
}

function loadBoeManagers() {
  return supabaseClient.rpc('admin_list_boe_managers').then(function (result) {
    _adminBoeManagers = result.data || [];
    renderBoeManagerRows();
  });
}

function renderBoeManagerRows() {
  var tbody = document.getElementById('adminBoeManagerRows');
  tbody.innerHTML = _adminBoeManagers
    .map(function (bm) {
      var activated = boeManagerActivated(bm);
      return (
        '<tr>' +
        '<td>' +
        escapeHtml(boeManagerDisplayName(bm)) +
        '</td>' +
        '<td class="admin-discord-id">' +
        escapeHtml(bm.discord_id) +
        '</td>' +
        '<td><span class="admin-status-badge ' +
        (activated ? 'admin-status-active' : 'admin-status-archived') +
        '">' +
        (activated ? 'Active' : 'Not activated') +
        '</span></td>' +
        '<td class="admin-row-actions">' +
        '<button class="btn btn-danger" onclick="submitRevokeBoeManager(\'' +
        escapeHtml(bm.discord_id) +
        '\')">Revoke</button>' +
        '</td>' +
        '</tr>'
      );
    })
    .join('');
}

function submitGrantBoeManager() {
  var input = document.getElementById('grantBoeManagerDiscordId');
  var discordId = input.value.trim();
  var errorEl = document.getElementById('grantBoeManagerError');
  errorEl.style.display = 'none';

  if (!discordId) {
    errorEl.textContent = 'Discord user ID is required.';
    errorEl.style.display = '';
    return;
  }

  return supabaseClient.rpc('admin_grant_boe_manager', { p_discord_id: discordId }).then(function (result) {
    if (result.error) {
      errorEl.textContent = result.error.message;
      errorEl.style.display = '';
      return;
    }
    input.value = '';
    return loadBoeManagers();
  });
}

function submitRevokeBoeManager(discordId) {
  if (!confirm('Revoke BoE manager access for this Discord account? They keep any officer role they hold.')) return;

  return supabaseClient.rpc('admin_revoke_boe_manager', { p_discord_id: discordId }).then(function (result) {
    if (result.error) {
      alert(result.error.message);
      return;
    }
    return loadBoeManagers();
  });
}

// ── BoE payout constants

// Private copies of js/boe-manage.js's parseGoldInput()/formatGold() -- that bundle
// is the officer dashboard's and isn't loaded on this page. Named distinctly
// so a grep for either original still finds only the officer-side call sites.
// This one adds the safe-integer bound the officer inputs don't need: floor
// and pivot are bigint server-side, and parseInt past 2^53 rounds silently, so
// a large enough entry would be saved as a different number than was typed.
function adminParseGold(value) {
  var cleaned = String(value == null ? '' : value)
    .replace(/[,\s]/g, '')
    .replace(/g$/i, '');
  if (!/^\d+$/.test(cleaned)) return null;
  var parsed = parseInt(cleaned, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function adminFormatGold(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// boe_record_sale pays least(sale, greatest(floor, round(sale * floor /
// pivot))). Two exact identities fall out of that, and they are all this line
// states: the rate is floor/pivot, and the percentage overtakes the floor
// exactly when sale > pivot (S * floor/pivot > floor <=> S > pivot, whatever
// the values). Neither restates the round/greatest/least logic itself, so
// there is no second copy of the money formula here to drift against the SQL.
//
// It exists because the raw numbers hide what they mean: nobody reading
// "pivot: 100000" can see that it is the sale price where the split switches
// from a flat fee to a percentage.
function boePayoutSummary(floorValue, pivotValue) {
  var floor = adminParseGold(floorValue);
  var pivot = adminParseGold(pivotValue);
  if (floor === null || pivot === null || pivot <= 0) return '';
  var rate = Math.round((floor / pivot) * 10000) / 100;
  return (
    'Finder gets ' +
    rate +
    '% on sales above ' +
    adminFormatGold(pivot) +
    'g, or a flat ' +
    adminFormatGold(floor) +
    'g below that, never more than the sale itself.'
  );
}

// Recomputed on every keystroke, so both inputs pass through blank and 0 on
// the way to any new value -- boePayoutSummary() returns '' for those rather
// than dividing by zero.
function renderBoePayoutSummary() {
  document.getElementById('boePayoutSummary').textContent = boePayoutSummary(
    document.getElementById('boePayoutFloor').value,
    document.getElementById('boePayoutPivot').value
  );
}

function loadBoePayoutSettings() {
  var errorEl = document.getElementById('boePayoutError');
  return supabaseClient
    .from('site_settings')
    .select('boe_payout_floor, boe_payout_pivot')
    .eq('id', 1)
    .maybeSingle()
    .then(function (result) {
      // Deliberately no default fallback here, unlike loadMaintenanceStatus().
      // Nothing writes the maintenance defaults back, but a Save on top of a
      // failed read would write these, overwriting the real payout policy with
      // whatever the page happened to be displaying.
      if (result.error || !result.data) {
        renderBoePayoutSettings(null);
        errorEl.textContent = result.error ? result.error.message : 'Could not read the payout settings.';
        errorEl.style.display = '';
        return;
      }
      errorEl.style.display = 'none';
      renderBoePayoutSettings(result.data);
    });
}

function renderBoePayoutSettings(row) {
  var floor = row && row.boe_payout_floor != null ? String(row.boe_payout_floor) : '';
  var pivot = row && row.boe_payout_pivot != null ? String(row.boe_payout_pivot) : '';
  document.getElementById('boePayoutFloor').value = floor;
  document.getElementById('boePayoutPivot').value = pivot;
  renderBoePayoutSummary();
}

function submitBoePayoutSettings() {
  var errorEl = document.getElementById('boePayoutError');
  var statusEl = document.getElementById('boePayoutStatus');
  errorEl.style.display = 'none';
  statusEl.textContent = '';

  // set_boe_payout_settings() checks the same bounds; these run first only so
  // the feedback is immediate and no round trip is spent on a typo.
  var floor = adminParseGold(document.getElementById('boePayoutFloor').value);
  var pivot = adminParseGold(document.getElementById('boePayoutPivot').value);
  if (floor === null) {
    errorEl.textContent = 'Payout floor must be a whole number of gold, zero or more.';
    errorEl.style.display = '';
    return;
  }
  if (pivot === null || pivot <= 0) {
    errorEl.textContent = 'Payout pivot must be a whole number of gold, greater than zero.';
    errorEl.style.display = '';
    return;
  }

  return supabaseClient.rpc('set_boe_payout_settings', { p_floor: floor, p_pivot: pivot }).then(function (result) {
    if (result.error) {
      errorEl.textContent = result.error.message;
      errorEl.style.display = '';
      return;
    }
    statusEl.textContent = 'Saved.';
    return loadBoePayoutSettings();
  });
}

// Mirrors #231's feature schema (team_settings.config.features). Missing
// key -- either the whole `features` object or one flag within it -- reads
// as enabled, matching current behavior (no team's webapp checks these yet,
// so "unset" has to mean "on" or every existing team would go dark the
// moment this panel starts writing to a team's config for the first time).
var FEATURE_FLAGS = [
  { key: 'loot', label: 'Loot' },
  { key: 'priority', label: 'Priority' },
  { key: 'bis', label: 'BiS' },
  { key: 'scoring', label: 'Scoring' },
  { key: 'mplus', label: 'M+' },
  { key: 'fairness', label: 'Fairness' },
  { key: 'bench', label: 'Bench' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'requests', label: 'Requests' },
  { key: 'boe', label: 'BoE' }
];

var _adminTeamSettings = {}; // team_id -> config

function loadFeatureFlags() {
  var ids = _adminTeams.map(function (t) {
    return t.id;
  });
  if (!ids.length) {
    renderFeatureFlagsTable();
    return Promise.resolve();
  }
  return supabaseClient
    .from('team_settings')
    .select('team_id, config')
    .in('team_id', ids)
    .then(function (result) {
      _adminTeamSettings = {};
      (result.data || []).forEach(function (row) {
        _adminTeamSettings[row.team_id] = row.config || {};
      });
      renderFeatureFlagsTable();
    });
}

function flagEnabled(teamId, key) {
  var config = _adminTeamSettings[teamId];
  var features = config && config.features;
  if (!features || !(key in features)) return true;
  return !!features[key];
}

function renderFeatureFlagsTable() {
  var headerRow = document.getElementById('adminFlagsHeaderRow');
  headerRow.innerHTML =
    '<th>Team</th>' +
    FEATURE_FLAGS.map(function (f) {
      return '<th>' + f.label + '</th>';
    }).join('');

  var tbody = document.getElementById('adminFlagsRows');
  tbody.innerHTML = _adminTeams
    .map(function (team) {
      var archived = !!team.archived_at;
      return (
        '<tr' +
        (archived ? ' class="admin-archived-row"' : '') +
        '>' +
        '<td>' +
        escapeHtml(team.name) +
        '</td>' +
        FEATURE_FLAGS.map(function (f) {
          var checked = flagEnabled(team.id, f.key);
          return (
            '<td><input type="checkbox" ' +
            (checked ? 'checked' : '') +
            ' onchange="toggleFeatureFlag(' +
            team.id +
            ",'" +
            f.key +
            '\',this.checked)"></td>'
          );
        }).join('') +
        '</tr>'
      );
    })
    .join('');
}

function toggleFeatureFlag(teamId, key, enabled) {
  var config = _adminTeamSettings[teamId] || {};
  var features = {};
  FEATURE_FLAGS.forEach(function (f) {
    features[f.key] = flagEnabled(teamId, f.key);
  });
  features[key] = enabled;

  supabaseClient
    .rpc('set_team_setting', { p_team_id: teamId, p_updates: { features: features } })
    .then(function (result) {
      if (result.error) {
        alert(result.error.message);
        renderFeatureFlagsTable(); // revert the checkbox to last-known state
        return;
      }
      config.features = features;
      _adminTeamSettings[teamId] = config;
    });
}

// Cross-team audit log. No new read path needed: "Officers read audit_log"
// already lets is_site_admin() through with no team_id restriction, so a
// plain select (no .eq('team_id', ...)) returns every team's rows for a
// site admin caller -- the per-team officer tab (tab-audit.js) just never
// exercises that branch since it always filters to _teamCfg.supabaseTeamId.
var _adminAuditEntries = [];

function populateAuditTeamFilter() {
  var select = document.getElementById('adminAuditTeamFilter');
  var options = ['<option value="all">All Teams</option>', '<option value="site">Site-level</option>'];
  _adminTeams.forEach(function (team) {
    options.push('<option value="' + team.id + '">' + escapeHtml(team.name) + '</option>');
  });
  select.innerHTML = options.join('');
}

function loadAuditLog() {
  var filter = (document.getElementById('adminAuditTeamFilter') || {}).value || 'all';
  var query = supabaseClient
    .from('audit_log')
    .select('team_id, actor_id, action, target_type, target_id, detail, created_at')
    .order('created_at', { ascending: false })
    .limit(300);

  if (filter === 'site') query = query.is('team_id', null);
  else if (filter !== 'all') query = query.eq('team_id', parseInt(filter, 10));

  return query.then(function (result) {
    var rows = result.data || [];
    return Promise.all([resolveAuditActorNames(rows), resolveAuditTargetNames(rows)]).then(function (maps) {
      var actorNames = maps[0];
      var targetNames = maps[1];
      _adminAuditEntries = rows.map(function (row) {
        return {
          ts: row.created_at,
          team: teamNameById(row.team_id),
          changedBy: row.actor_id ? actorNames[row.actor_id + '|' + row.team_id] || '' : '',
          action: row.action || '',
          target: auditTargetName(row, targetNames),
          detail: formatAuditDetail(row.detail)
        };
      });
      renderAuditRows();
    });
  });
}

function teamNameById(teamId) {
  if (teamId == null) return 'Site-level';
  var team = _adminTeams.filter(function (t) {
    return t.id === teamId;
  })[0];
  return team ? team.name : 'Team #' + teamId;
}

// Known short keys that don't title-case cleanly on their own (bis -> BiS,
// not Bis; mplus -> M+, not Mplus).
var AUDIT_DETAIL_LABELS = { bis: 'BiS', mplus: 'M+' };

function humanizeAuditKey(key) {
  if (AUDIT_DETAIL_LABELS[key]) return AUDIT_DETAIL_LABELS[key];
  var spaced = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function humanizeAuditValue(v) {
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  return String(v);
}

// Flattens nested objects to just their leaf key/value pairs -- a feature
// flag diff like {features: {bench: false}} renders as "Bench: Off" rather
// than repeating the (here, uninformative) parent key name.
function humanizeAuditEntries(obj, out) {
  Object.keys(obj).forEach(function (k) {
    var v = obj[k];
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      humanizeAuditEntries(v, out);
    } else {
      out.push(humanizeAuditKey(k) + ': ' + humanizeAuditValue(v));
    }
  });
}

function formatAuditDetail(detail) {
  if (detail == null) return '';
  if (typeof detail === 'string') return detail;
  var out = [];
  humanizeAuditEntries(detail, out);
  return out.join(', ');
}

function resolveAuditActorNames(rows) {
  var pairs = {};
  rows.forEach(function (r) {
    if (r.actor_id) pairs[r.actor_id + '|' + r.team_id] = { actorId: r.actor_id, teamId: r.team_id };
  });
  var keys = Object.keys(pairs);
  if (!keys.length) return Promise.resolve({});
  return Promise.all(
    keys.map(function (key) {
      return supabaseClient
        .rpc('resolve_actor_name', { p_actor_id: pairs[key].actorId, p_team_id: pairs[key].teamId })
        .then(function (result) {
          return { key: key, name: result.error ? '' : result.data || '' };
        });
    })
  ).then(function (results) {
    var map = {};
    results.forEach(function (r) {
      map[r.key] = r.name;
    });
    return map;
  });
}

// Only 'players' and 'team' target_types resolve today -- 'site_admin'
// (grant/revoke) has no meaningful name beyond the discord_id already in
// detail, so it's left blank rather than guessed at.
function resolveAuditTargetNames(rows) {
  var playerIds = [];
  var seen = {};
  rows.forEach(function (r) {
    if (r.target_type === 'players' && r.target_id != null && !seen[r.target_id]) {
      seen[r.target_id] = true;
      playerIds.push(r.target_id);
    }
  });
  if (!playerIds.length) return Promise.resolve({});
  return supabaseClient
    .from('players')
    .select('id, name_realm')
    .in('id', playerIds)
    .then(function (result) {
      var map = {};
      (result.data || []).forEach(function (p) {
        map[p.id] = p.name_realm;
      });
      return map;
    });
}

function auditTargetName(row, targetNames) {
  if (row.target_type === 'players' && row.target_id != null) return targetNames[row.target_id] || '';
  if (row.target_type === 'team' && row.target_id != null) return teamNameById(row.target_id);
  return '';
}

function renderAuditRows() {
  var search = (document.getElementById('adminAuditSearch') || {}).value || '';
  var searchLow = search.trim().toLowerCase();
  var countEl = document.getElementById('adminAuditCount');
  var tbody = document.getElementById('adminAuditRows');

  var entries = searchLow
    ? _adminAuditEntries.filter(function (e) {
        return (
          (e.team || '').toLowerCase().indexOf(searchLow) !== -1 ||
          (e.changedBy || '').toLowerCase().indexOf(searchLow) !== -1 ||
          (e.action || '').toLowerCase().indexOf(searchLow) !== -1 ||
          (e.target || '').toLowerCase().indexOf(searchLow) !== -1 ||
          (e.detail || '').toLowerCase().indexOf(searchLow) !== -1
        );
      })
    : _adminAuditEntries;

  countEl.textContent = entries.length + ' entr' + (entries.length !== 1 ? 'ies' : 'y') + ' (most recent 300)';

  if (!entries.length) {
    tbody.innerHTML =
      '<tr><td colspan="6" style="color:var(--text-muted);">' +
      (searchLow ? 'No entries match your search.' : 'No audit log entries yet.') +
      '</td></tr>';
    return;
  }

  tbody.innerHTML = entries
    .map(function (e) {
      return (
        '<tr>' +
        '<td style="white-space:nowrap;">' +
        escapeHtml(auditFormatTs(e.ts)) +
        '</td>' +
        '<td>' +
        escapeHtml(e.team) +
        '</td>' +
        '<td>' +
        escapeHtml(e.changedBy) +
        '</td>' +
        '<td>' +
        escapeHtml(e.action) +
        '</td>' +
        '<td>' +
        escapeHtml(e.target) +
        '</td>' +
        '<td>' +
        escapeHtml(e.detail) +
        '</td>' +
        '</tr>'
      );
    })
    .join('');
}

// created_at arrives as an ISO timestamptz string; same 'yyyy-MM-dd HH:mm'
// shape as the officer dashboard's audit tab (js/tabs/tab-audit.js), in the
// viewer's local time.
function auditFormatTs(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }
  return (
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    ' ' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes())
  );
}

function loadMaintenanceStatus() {
  return supabaseClient
    .from('site_settings')
    .select('maintenance_mode, maintenance_message')
    .eq('id', 1)
    .maybeSingle()
    .then(function (result) {
      var row = result.data || { maintenance_mode: false, maintenance_message: '' };
      renderMaintenanceStatus(row);
    });
}

function renderMaintenanceStatus(row) {
  var statusEl = document.getElementById('maintenanceStatus');
  var enabled = !!row.maintenance_mode;
  statusEl.textContent = enabled ? 'Maintenance mode is ON' : 'Maintenance mode is OFF';
  statusEl.className = 'admin-maintenance-status ' + (enabled ? 'admin-status-on' : 'admin-status-off');
  document.getElementById('maintenanceMessage').value = row.maintenance_message || '';
  document.getElementById('maintenanceEnableBtn').style.display = enabled ? 'none' : '';
  document.getElementById('maintenanceDisableBtn').style.display = enabled ? '' : 'none';
}

function submitMaintenanceMode(enabled) {
  var message = document.getElementById('maintenanceMessage').value.trim();
  var errorEl = document.getElementById('maintenanceError');
  errorEl.style.display = 'none';

  if (
    enabled &&
    !confirm('Enable maintenance mode? The public site and officer dashboard will show a banner instead of loading.')
  )
    return;
  if (!enabled && !confirm('Disable maintenance mode?')) return;

  supabaseClient
    .rpc('admin_set_maintenance_mode', { p_enabled: enabled, p_message: message || null })
    .then(function (result) {
      if (result.error) {
        errorEl.textContent = result.error.message;
        errorEl.style.display = '';
        return;
      }
      loadMaintenanceStatus();
    });
}

if (supabaseClient) {
  supabaseClient.auth.onAuthStateChange(function (event) {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') checkAdminAccess();
  });
}

checkAdminAccess();
