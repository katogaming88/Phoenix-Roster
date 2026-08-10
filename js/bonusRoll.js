// Raider-facing Bonus Roll target -- lets a raider declare which
// current-raid boss they're planning to spend their weekly Bonus Roll coin
// on, until they get the item(s) they're after. Purely informational: does
// NOT feed into generate_priority_order() (that stays piece-count/wishlist-
// status only, see supabase/migrations/20260808212802_tier_priority_bis_match.sql)
// -- this is a heads-up for officers making an in-raid loot call, surfaced
// as a roster badge (js/tabs/tab-roster.js). Own file since officer.html
// (which reads the value via DATA.roster but never edits it) and index.html
// are separate script bundles -- same reasoning as js/wishlist.js/js/streamers.js.
//
// Depends on: common.js (supabaseClient, DATA, normalise, getDiscordSession,
// renderProfile, _esc, toggleHelp).

// Shown only on the logged-in raider's own profile (backTo === 'landing' and
// the session's claimed character matches), same ownership check
// js/wishlist.js's ownWishlistSectionHTML() and js/streamers.js's
// ownStreamerSectionHTML() both use.
function ownBonusRollSectionHTML(player, backTo) {
  if (backTo !== 'landing') return '';
  var session = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
  if (!session || !session.nameRealm || normalise(session.nameRealm) !== normalise(player.nameRealm)) return '';

  // Fetched unfiltered (see fetchSupabaseRaidEncounters()'s comment) --
  // filtered here to the team's actual live/planning season, same
  // fail-open-when-unset convention isItemInSeasonScope() uses (an
  // unconfigured season shows every seeded boss rather than an empty
  // dropdown).
  var seasonView = typeof resolveSeasonView === 'function' ? resolveSeasonView() : '';
  var encounters = ((DATA && DATA.raidEncounters) || []).filter(function (e) {
    return !seasonView || e.season === seasonView;
  });
  var currentId = player.bonusRollEncounterId;

  var options =
    '<option value="">-- None --</option>' +
    encounters
      .map(function (e) {
        return (
          '<option value="' +
          e.id +
          '"' +
          (currentId != null && String(currentId) === String(e.id) ? ' selected' : '') +
          '>' +
          _esc(e.name) +
          '</option>'
        );
      })
      .join('');

  // A boss actually set is the state worth calling out -- gold border/text
  // (matching .tag-bonus-roll, the officer-side roster badge) so it reads
  // as "active" at a glance instead of blending into every other plain
  // select on the page. No background override here -- some browsers apply
  // a <select>'s own background to its native dropdown popup too, which
  // washed the whole open option list out to a pale color against gold
  // text. Border + bold text alone still reads clearly without touching
  // that. "-- None --" stays the default/unstyled look.
  var hasTarget = currentId != null && currentId !== '';
  var selectStyle = hasTarget ? 'border-color:var(--gold);color:var(--gold);font-weight:600;' : '';

  return (
    '<div class="profile-section"><div class="section-label">Bonus Roll' +
    '<button class="help-btn" onclick="toggleHelp(\'help-bonusroll-' +
    player.firstName +
    '\')" title="Show help">?</button>' +
    '</div>' +
    '<div id="help-bonusroll-' +
    player.firstName +
    '" class="help-tip">If you\'re planning to spend your weekly Bonus Roll on a specific boss until you get the item(s) you\'re after, set it here so officers have a heads-up. This is informational only -- it has no effect on Priority order.</div>' +
    (hasTarget
      ? '<div style="font-size:0.95rem;color:var(--gold);font-weight:600;margin-bottom:0.35rem;">🎲 Currently targeting</div>'
      : '') +
    '<select id="bonusRollSelect-' +
    player.firstName +
    '" class="self-received-source" style="' +
    selectStyle +
    '" onchange="setBonusRollTarget(' +
    player.id +
    ",'" +
    player.firstName.replace(/'/g, "\\'") +
    '\',this.value)">' +
    options +
    '</select>' +
    '<div id="bonusRollMsg-' +
    player.firstName +
    '" style="font-size:0.95rem;color:var(--text-muted);margin-top:0.4rem;"></div>' +
    '</div>'
  );
}

// select's onchange handler -- '' (the "-- None --" option) clears the
// target back to null. Writes straight to players.bonus_roll_encounter_id
// (no upsert-vs-update branching needed, unlike item_preferences: this is a
// single column on an already-existing row, gated by
// "Raiders update own bonus_roll_encounter_id"
// (20260809220657_players_bonus_roll_target.sql).
function setBonusRollTarget(playerId, firstName, encounterIdStr) {
  if (!supabaseClient) return;
  var encounterId = encounterIdStr ? parseInt(encounterIdStr, 10) : null;
  var msgEl = document.getElementById('bonusRollMsg-' + firstName);
  if (msgEl) msgEl.textContent = 'Saving...';

  supabaseClient
    .from('players')
    .update({ bonus_roll_encounter_id: encounterId })
    .eq('id', playerId)
    .then(function (result) {
      if (result.error) {
        if (msgEl) msgEl.textContent = 'Failed: ' + result.error.message;
        return;
      }
      if (msgEl) msgEl.textContent = 'Saved.';
      // Keep DATA.roster in sync so a re-render before the next full reload
      // (e.g. switching profile subtabs) doesn't show a stale value.
      var roster = (DATA && DATA.roster) || [];
      for (var i = 0; i < roster.length; i++) {
        if (roster[i].id === playerId) {
          roster[i].bonusRollEncounterId = encounterId;
          break;
        }
      }
      // Re-render so the select's gold "targeting" highlight and the
      // "Currently targeting" banner above it reflect the new value
      // immediately, same pattern wishlistUpsert() (js/wishlist.js) uses.
      if (typeof renderProfile === 'function') renderProfile(firstName, 'landing');
    });
}
