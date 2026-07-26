var signupStep = 1;
var signupData = {};
// Holds the row rendered by renderSignupSummary(), so its Edit button can
// call startSignupEdit() with no args -- simpler and safer than round-
// tripping the row through the DOM (e.g. a serialized <script> blob).
var _ownSignupRow = null;

// Local copy of tab-attendance.js's escHtml() -- that bundle isn't loaded on
// the public page, and renderSignupSummary() interpolates raider-supplied
// text (signup_name_realm, player_note, off_specs) the same way
// tab-signups.js already does for player_note when officers view it.
function signupEscHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Checks for an existing signup before deciding what to render (#500) --
// via get_own_signup(), not any client-cached id, since a signup submitted
// on a different device/session (or a prior page load, since the create
// RPC's returned id was never persisted) still needs to be found.
function showSignupView() {
  showView('signup');
  var container = document.getElementById('signupForm');
  container.innerHTML = '<p class="signup-step-desc">Loading...</p>';

  var session = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
  if (!session) {
    renderSignupLoginRequired();
    return;
  }
  if (!supabaseClient) {
    signupStep = 1;
    signupData = {};
    renderSignupStep();
    return;
  }

  supabaseClient.rpc('get_own_signup', { p_team_id: _teamCfg.supabaseTeamId }).then(function (result) {
    var row = result.error ? null : (result.data && result.data[0]) || null;
    if (row) {
      renderSignupSummary(row);
    } else {
      signupStep = 1;
      signupData = {};
      renderSignupStep();
    }
  });
}

// Signups now require a Discord session so a submission can be tied to a
// real account -- no more anonymous entries. The "Sign Up" nav item stays
// visible either way; this is what renders in its place when logged out.
function renderSignupLoginRequired() {
  var container = document.getElementById('signupForm');
  container.innerHTML =
    '<h2 class="signup-step-title">Sign Up for Next Season</h2>' +
    '<p class="signup-step-desc">You must sign in with Discord to do this.</p>' +
    '<div class="signup-actions">' +
    '<button class="btn btn-gold" onclick="loginWithDiscord()">Login with Discord</button>' +
    '<button class="btn btn-muted" onclick="showView(\'landing\')">Back to Roster</button>' +
    '</div>';
}

// Raider-facing "Your Signup" summary (#500) -- shown instead of a blank
// fresh form when get_own_signup() finds an existing row for the currently
// active season. Never renders any officer-only field: the RPC's return
// shape structurally excludes signup_officer_note/reviewed_by, so there's
// nothing to accidentally bind to a template here.
function renderSignupSummary(row) {
  _ownSignupRow = row;
  var container = document.getElementById('signupForm');
  var statusLabels = { pending: 'Pending', approved: 'Approved', rejected: 'Denied', added: 'Rostered' };
  var statusLabel = statusLabels[row.status] || row.status;
  var statusClass =
    row.status === 'pending' || row.status === 'approved' ? 'signup-status-open' : 'signup-status-closed';

  var displayClass = row.main_swap ? row.swap_class : row.class;
  var displaySpec = row.main_swap ? row.swap_spec : row.spec;
  var swapNote =
    row.main_swap && row.swap_from_name_realm
      ? '<p class="signup-step-desc">Switching from <strong style="color:var(--text);">' +
        signupEscHtml(row.swap_from_name_realm) +
        '</strong>.</p>'
      : '';

  var actionsHtml;
  if (row.status === 'pending' || row.status === 'approved') {
    actionsHtml = '<button class="btn btn-gold" onclick="startSignupEdit()">Edit Signup</button>';
  } else if (row.status === 'added') {
    actionsHtml = '<p class="signup-step-desc">You\'re on the roster for this season -- signup details are locked.</p>';
  } else {
    actionsHtml =
      '<p class="signup-step-desc">This signup was not approved. Contact an officer on Discord if you have questions.</p>';
  }

  container.innerHTML =
    '<h2 class="signup-step-title">Your Signup</h2>' +
    '<p class="signup-step-desc"><span class="signup-status-badge ' +
    statusClass +
    '">' +
    statusLabel +
    '</span></p>' +
    '<p class="signup-step-desc"><strong style="color:var(--text);">' +
    signupEscHtml(row.signup_name_realm) +
    '</strong> -- ' +
    (displaySpec
      ? signupEscHtml(displaySpec) + ' ' + signupEscHtml(displayClass)
      : signupEscHtml(displayClass) || '-') +
    '</p>' +
    swapNote +
    (row.off_specs ? '<p class="signup-step-desc">Off-specs: ' + signupEscHtml(row.off_specs) + '</p>' : '') +
    (row.player_note ? '<p class="signup-step-desc">Note: ' + signupEscHtml(row.player_note) + '</p>' : '') +
    '<div class="signup-actions">' +
    actionsHtml +
    '<button class="btn btn-muted" onclick="showView(\'landing\')">Back to Roster</button>' +
    '</div>';
}

// Re-enters the existing step 1-4 components pre-filled with the signup
// being edited (#500). mainSwap/mainSwapChecked/matchesClaim/claimNameRealm
// are intentionally left unset so step 4 redrives claim-matching against the
// CURRENT claim state, same as a fresh signup -- the actual fix for the
// claim-timing race that motivated this issue: the raider's claim may have
// resolved/changed since the original submission.
function startSignupEdit() {
  var row = _ownSignupRow;
  if (!row) return;
  signupData = {
    editingSignupId: row.id,
    charName: (row.signup_name_realm || '').split('-')[0],
    realm: (row.signup_name_realm || '').split('-').slice(1).join('-'),
    className: row.main_swap ? row.swap_class : row.class,
    mainSpec: row.main_swap ? row.swap_spec : row.spec,
    offSpecs: (row.off_specs || '')
      .split(',')
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean),
    notes: row.player_note || ''
  };
  signupStep = 1;
  renderSignupStep();
}

function renderSignupStep() {
  var container = document.getElementById('signupForm');
  var html = '';

  if (signupStep === 1) {
    var showClaimDiffersBox = signupData.claimNameRealm && signupData.matchesClaim === false;
    html =
      '<div class="signup-step-label">Step 1 of 4</div>' +
      '<h2 class="signup-step-title">Sign Up for Next Season</h2>' +
      '<p class="signup-step-desc">Enter your exact in-game character name and select your realm.</p>' +
      '<div class="signup-field">' +
      '<span class="signup-label">Character Name</span>' +
      '<input type="text" id="signupCharName" class="signup-input" placeholder="Katorri" value="' +
      (signupData.charName || '') +
      '" autocomplete="off">' +
      '</div>' +
      '<div class="signup-field">' +
      '<span class="signup-label">Realm</span>' +
      '<div class="realm-combobox">' +
      '<input type="text" id="signupRealm" class="signup-input realm-input" placeholder="Type to search..." autocomplete="off" value="' +
      (signupData.realm || '') +
      '">' +
      '<div class="realm-dropdown" id="realmDropdown"></div>' +
      '</div>' +
      '</div>' +
      (showClaimDiffersBox ? buildClaimDiffersWarningHtml() : '') +
      '<p id="signupError" class="signup-error"></p>' +
      '<div class="signup-actions">' +
      '<button class="btn btn-muted" onclick="showView(\'landing\')">Cancel</button>' +
      '<button class="btn btn-gold" onclick="signupNext()">Next</button>' +
      '</div>';
  } else if (signupStep === 2) {
    html =
      '<div class="signup-step-label">Step 2 of 4</div>' +
      '<h2 class="signup-step-title">Select Your Class</h2>' +
      '<div class="signup-class-grid">';
    Object.keys(CLASS_SPECS).forEach(function (cls) {
      var hex = CLASS_COLORS[cls] || '#888888';
      var sel = signupData.className === cls ? ' signup-class-btn-selected' : '';
      html +=
        '<button class="signup-class-btn' +
        sel +
        '" style="--cls-color:' +
        hex +
        ';" onclick="signupSelectClass(\'' +
        cls.replace(/'/g, "\\'") +
        '\')">' +
        cls +
        '</button>';
    });
    html +=
      '</div>' +
      '<p id="signupError" class="signup-error"></p>' +
      '<div class="signup-actions">' +
      '<button class="btn btn-muted" onclick="signupBack()">Back</button>' +
      '<button class="btn btn-gold" onclick="signupNext()">Next</button>' +
      '</div>';
  } else if (signupStep === 3) {
    var specData = CLASS_SPECS[signupData.className];
    var clsColor = CLASS_COLORS[signupData.className] || 'var(--gold-light)';
    html =
      '<div class="signup-step-label">Step 3 of 4</div>' +
      '<h2 class="signup-step-title" style="color:' +
      clsColor +
      ';">' +
      signupData.className +
      '</h2>' +
      buildSignupClassInfoHtml(signupData.className) +
      (signupHasClassMismatch() ? buildClassMismatchWarningHtml() : '') +
      '<div class="signup-field">' +
      '<span class="signup-label">Main Spec</span>' +
      '<div class="signup-radio-group">';
    specData.specs.forEach(function (s) {
      html +=
        '<label class="signup-radio-label"><input type="radio" name="mainSpec" value="' +
        s +
        '"' +
        (signupData.mainSpec === s ? ' checked' : '') +
        ' onchange="updateOffSpecList()">' +
        s +
        '</label>';
    });
    html +=
      '</div>' +
      '</div>' +
      '<div class="signup-field">' +
      '<span class="signup-label">Off Spec <span class="signup-optional">(optional -- select all that apply)</span></span>' +
      '<div class="signup-checkbox-group" id="offSpecGroup">' +
      buildOffSpecHTML(specData.specs, signupData.mainSpec, signupData.offSpecs) +
      '</div>' +
      '</div>';
    if (specData.roles) {
      html +=
        '<div class="signup-field">' +
        '<span class="signup-label">Primary Role</span>' +
        '<div class="signup-radio-group">';
      specData.roles.forEach(function (r) {
        html +=
          '<label class="signup-radio-label"><input type="radio" name="primaryRole" value="' +
          r +
          '"' +
          (signupData.role === r ? ' checked' : '') +
          ' onchange="updateSignupRoleInfo()">' +
          r +
          '</label>';
      });
      html +=
        '</div>' + '<div id="signupRoleInfo">' + buildSignupRoleAdvisoryHtml(signupData.role || '') + '</div></div>';
    }
    html +=
      '<p id="signupError" class="signup-error"></p>' +
      '<div class="signup-actions">' +
      '<button class="btn btn-muted" onclick="signupBack()">Back</button>' +
      '<button class="btn btn-gold" onclick="signupNext()">Next</button>' +
      '</div>';
  } else if (signupStep === 4) {
    // Refreshed on every render, not just trusted from step 1 -- see
    // signupRefreshMatchesClaim()'s comment. Keeps this step's "will be
    // recorded as switching..." message accurate if the claim resolves
    // while the raider is sitting on this step.
    signupRefreshMatchesClaim(signupData.charName, signupData.realm);
    var discordSession = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
    var hasClaim = !!(discordSession && discordSession.nameRealm);
    var claimDiffers = hasClaim && signupData.matchesClaim === false;

    var mainSwapFieldHtml;
    if (claimDiffers) {
      mainSwapFieldHtml =
        '<div class="signup-field">' +
        '<p style="margin:0;font-size:1.04rem;color:var(--text-muted);">This will be recorded as switching from your claimed character <strong style="color:var(--text);">' +
        discordSession.nameRealm +
        '</strong>.</p>' +
        '</div>';
    } else {
      // No claimed character on this Discord account -- main swap requires
      // a claim so the swap can be tied to a real character, so no option
      // is offered here.
      mainSwapFieldHtml = '';
    }

    html =
      '<div class="signup-step-label">Step 4 of 4</div>' +
      '<h2 class="signup-step-title">Additional Information</h2>' +
      mainSwapFieldHtml +
      '<div class="signup-field">' +
      '<span class="signup-label">Anything else officers should know? <span class="signup-optional">(optional)</span></span>' +
      '<textarea id="signupNotes" class="signup-textarea" placeholder="e.g. applying as a trial, recently changed mains, availability caveats...">' +
      (signupData.notes || '') +
      '</textarea>' +
      '</div>' +
      '<p id="signupError" class="signup-error"></p>' +
      '<div class="signup-actions">' +
      '<button class="btn btn-muted" onclick="signupBack()">Back</button>' +
      '<button class="btn btn-gold" id="signupSubmitBtn" onclick="submitSignup()">Submit</button>' +
      '</div>';
  } else if (signupStep === 5) {
    var wasEdit = !!signupData.editingSignupId;
    html =
      '<div class="signup-confirm">' +
      '<div class="signup-confirm-check">&#10003;</div>' +
      '<h2 class="signup-step-title">' +
      (wasEdit ? 'Signup Updated' : 'Signup Submitted') +
      '</h2>' +
      '<p class="signup-step-desc">' +
      (wasEdit
        ? 'Your signup has been updated. Officers will see the changes on their next review.'
        : 'Your signup has been submitted. Officers will review your application and be in touch. If you need to update anything, message Katorri or Rod on Discord -- do not resubmit without officer approval.') +
      '</p>' +
      '<button class="btn btn-gold" onclick="showView(\'landing\')" style="margin-top:1.5rem;">Back to Roster</button>' +
      '</div>';
  }

  container.innerHTML = html;
  if (signupStep === 1) initRealmCombobox();
  var firstInput = container.querySelector('input[type="text"]');
  if (firstInput)
    setTimeout(function () {
      firstInput.focus();
    }, 50);
}

function initRealmCombobox() {
  var input = document.getElementById('signupRealm');
  var dropdown = document.getElementById('realmDropdown');
  if (!input || !dropdown) return;

  function showMatches(query) {
    var q = query.toLowerCase().trim();
    if (!q) {
      dropdown.style.display = 'none';
      return;
    }
    var matches = WOW_REALMS.filter(function (r) {
      return r.toLowerCase().indexOf(q) !== -1;
    }).slice(0, 12);
    if (!matches.length) {
      dropdown.style.display = 'none';
      return;
    }
    dropdown.innerHTML = matches
      .map(function (r) {
        return '<div class="realm-option" onmousedown="pickRealm(\'' + r.replace(/'/g, "\\'") + '\')">' + r + '</div>';
      })
      .join('');
    dropdown.style.display = 'block';
  }

  input.addEventListener('input', function () {
    showMatches(this.value);
  });
  input.addEventListener('focus', function () {
    showMatches(this.value);
  });
  input.addEventListener('blur', function () {
    setTimeout(function () {
      dropdown.style.display = 'none';
    }, 150);
  });
}

function pickRealm(realm) {
  var input = document.getElementById('signupRealm');
  if (input) input.value = realm;
  var dropdown = document.getElementById('realmDropdown');
  if (dropdown) dropdown.style.display = 'none';
  signupData.realm = realm;
}

function buildOffSpecHTML(specs, mainSpec, selectedOffSpecs) {
  var html = '';
  specs
    .filter(function (s) {
      return s !== mainSpec;
    })
    .forEach(function (s) {
      var checked = selectedOffSpecs && selectedOffSpecs.indexOf(s) !== -1 ? ' checked' : '';
      html +=
        '<label class="signup-checkbox-label"><input type="checkbox" name="offSpec" value="' +
        s +
        '"' +
        checked +
        '>' +
        s +
        '</label>';
    });
  return html;
}

function updateOffSpecList() {
  var mainSpecEl = document.querySelector('input[name="mainSpec"]:checked');
  var mainSpec = mainSpecEl ? mainSpecEl.value : '';
  var specData = CLASS_SPECS[signupData.className];
  var group = document.getElementById('offSpecGroup');
  if (!group || !specData) return;
  var currentChecked = Array.prototype.map.call(
    document.querySelectorAll('input[name="offSpec"]:checked'),
    function (el) {
      return el.value;
    }
  );
  group.innerHTML = buildOffSpecHTML(specData.specs, mainSpec, currentChecked);
}

// Who to compare a signup-in-progress against: always the already-approved
// incoming roster (#499). Also excludes still-pending signups -- season_
// signups RLS only lets officers read it, and the one raider-facing RPC
// (get_own_signup) is scoped to the caller's own row, so there's no privacy-
// safe way to name other pending applicants here.
//
// The confirmed active roster is included too, but ONLY when the team's
// live raiding season already equals the season being signed up for
// (DATA.seasonName === DATA.signupSeason) -- e.g. Hellfire, who push
// approved signups straight onto the roster instead of leaving them
// pending, so their roster already IS this season's confirmed membership.
// When the two differ (e.g. Phoenix, still raiding a prior season while
// collecting signups for the next one), the roster reflects a stale season
// and would wrongly count someone who simply hasn't signed up yet --
// officers already have a separate view for that; the incoming roster alone
// is the accurate answer there.
function signupClassmatesPool() {
  var incoming = (window.DATA && DATA.incomingRoster) || [];
  var seasonName = ((window.DATA && DATA.seasonName) || '').trim().toLowerCase();
  var signupSeason = ((window.DATA && DATA.signupSeason) || '').trim().toLowerCase();
  var includeRoster = !!seasonName && !!signupSeason && seasonName === signupSeason;
  if (!includeRoster) return incoming;

  // Same swap-duplicate handling as before: a returning roster member who
  // resubmits under the same character name is deduped (incoming wins); a
  // true main-swap to a different character name has its old character
  // excluded via incoming_roster's swap_from_name_realm column.
  var swappedFromKeys = {};
  incoming.forEach(function (p) {
    if (p.swapFromNameRealm) swappedFromKeys[String(p.swapFromNameRealm).toLowerCase()] = true;
  });
  var byNameRealm = {};
  ((window.DATA && DATA.roster) || []).forEach(function (p) {
    var key = signupNameRealmKey(p);
    if (swappedFromKeys[key]) return;
    byNameRealm[key] = p;
  });
  incoming.forEach(function (p) {
    byNameRealm[signupNameRealmKey(p)] = p;
  });
  return Object.keys(byNameRealm).map(function (k) {
    return byNameRealm[k];
  });
}

function signupNameRealmKey(p) {
  return String(p.nameRealm || p.firstName + '-' + p.realm || '').toLowerCase();
}

// Always shown for step 3, regardless of role/spec -- "who else already
// plays this class" (#586 follow-up). Class-level only, not spec-level: a
// Paladin signing up sees every other Paladin regardless of whether they're
// tanking/healing/dpsing.
function buildSignupClassInfoHtml(className) {
  var classmates = signupClassmatesPool().filter(function (p) {
    return p.class === className;
  });
  if (!classmates.length) {
    return '<p class="signup-role-info">No one else is currently playing ' + signupEscHtml(className) + '.</p>';
  }
  var names = classmates.map(function (p) {
    return signupEscHtml(p.nick || p.firstName);
  });
  return '<p class="signup-role-info">Already playing ' + signupEscHtml(className) + ': ' + names.join(', ') + '</p>';
}

// Tank/Heal capacity advisory against an officer-set target
// (DATA.targetTankCount/targetHealCount, Season Settings -- "Target Roster
// Sizes"). Returns '' for any other role, including a pure class's fixed
// Melee/Ranged role -- there's no cap on DPS, so no advisory box is shown
// for those at all (see the signupStep === 3 render, which only inserts
// #signupRoleInfo for hybrid classes to begin with).
function buildSignupRoleAdvisoryHtml(role) {
  var roleKey = role === 'Tank' ? 'Tank' : role === 'Healer' ? 'Heal' : null;
  if (!roleKey) return '';
  var target = roleKey === 'Tank' ? DATA && DATA.targetTankCount : DATA && DATA.targetHealCount;
  var count = signupClassmatesPool().filter(function (p) {
    return p.role === roleKey;
  }).length;
  var roleLabel = roleKey === 'Tank' ? 'tank' : 'healer';
  var countLine = count + ' ' + roleLabel + (count === 1 ? '' : 's') + ' already signed up';
  // Always shown in the caution/yellow style -- Tank/Heal are inherently
  // capacity-sensitive roles, unlike the neutral DPS class-info box, even
  // before an officer has configured an actual target.
  if (target == null) {
    return '<p class="signup-role-info signup-role-info-warn">' + countLine + '.</p>';
  }
  if (count >= target) {
    return (
      '<p class="signup-role-info signup-role-info-warn">' +
      countLine +
      ' (target: ' +
      target +
      '). Consider signing up as DPS and being a backup ' +
      roleLabel +
      ", or talk to an officer if you're set on " +
      roleLabel +
      'ing.</p>'
    );
  }
  return (
    '<p class="signup-role-info signup-role-info-warn">' +
    count +
    ' of ' +
    target +
    ' ' +
    roleLabel +
    's currently signed up.</p>'
  );
}

// Live-patches #signupRoleInfo as the Primary Role radio changes, without a
// full step re-render -- mirrors updateOffSpecList()'s partial-DOM-patch
// pattern so it doesn't disturb the Main Spec/Off Spec selections already
// made on this same render.
function updateSignupRoleInfo() {
  var roleEl = document.querySelector('input[name="primaryRole"]:checked');
  var el = document.getElementById('signupRoleInfo');
  if (!el) return;
  el.innerHTML = buildSignupRoleAdvisoryHtml(roleEl ? roleEl.value : '');
}

function buildClaimDiffersWarningHtml() {
  return (
    '<div style="margin:0.5rem 0 1rem;padding:0.7rem 0.85rem;background:var(--bg-alt);' +
    'border:1px solid var(--gold-dim);border-radius:4px;">' +
    '<p style="margin:0 0 0.5rem;font-size:1.04rem;color:var(--text-muted);">You\'re signed in with <strong style="color:var(--text);">' +
    signupData.claimNameRealm +
    '</strong> claimed, but typed <strong style="color:var(--text);">' +
    signupData.charName +
    '-' +
    signupData.realm +
    "</strong> above. Double-check the spelling if that's not what you meant.</p>" +
    '<label style="display:flex;align-items:center;gap:0.55rem;font-size:1.07rem;color:var(--text);cursor:pointer;">' +
    '<input type="checkbox" id="signupClaimDiffersConfirm"' +
    (signupData.claimDiffersConfirmed ? ' checked' : '') +
    ' style="width:1.1rem;height:1.1rem;accent-color:var(--gold-light);cursor:pointer;flex-shrink:0;">' +
    '<span>Yes, I meant to sign up ' +
    signupData.charName +
    '-' +
    signupData.realm +
    ', not ' +
    signupData.claimNameRealm +
    '</span>' +
    '</label>' +
    '</div>'
  );
}

function signupHasClassMismatch() {
  if (!signupData.matchesClaim || !signupData.claimNameRealm || !signupData.className) return false;
  var claimedPlayer = findRosterPlayerByNameRealm(signupData.claimNameRealm);
  return !!(claimedPlayer && claimedPlayer.class && claimedPlayer.class !== signupData.className);
}

function buildClassMismatchWarningHtml() {
  var claimedPlayer = findRosterPlayerByNameRealm(signupData.claimNameRealm);
  return (
    '<div style="margin:0.5rem 0 1rem;padding:0.7rem 0.85rem;background:var(--bg-alt);' +
    'border:1px solid var(--gold-dim);border-radius:4px;">' +
    '<p style="margin:0 0 0.5rem;font-size:1.04rem;color:var(--text-muted);">Your claimed character <strong style="color:var(--text);">' +
    signupData.claimNameRealm +
    '</strong> is on file as a <strong style="color:var(--text);">' +
    claimedPlayer.class +
    '</strong>, but you selected <strong style="color:var(--text);">' +
    signupData.className +
    "</strong>. A character's class doesn't change, so this usually means the wrong class got clicked. If you meant to sign up a different character instead, go back and check the name/realm.</p>" +
    '<label style="display:flex;align-items:center;gap:0.55rem;font-size:1.07rem;color:var(--text);cursor:pointer;">' +
    '<input type="checkbox" id="signupClassMismatchConfirm"' +
    (signupData.classMismatchConfirmed ? ' checked' : '') +
    ' style="width:1.1rem;height:1.1rem;accent-color:var(--gold-light);cursor:pointer;flex-shrink:0;">' +
    '<span>Yes, I meant to pick ' +
    signupData.className +
    ' for ' +
    signupData.claimNameRealm +
    '</span>' +
    '</label>' +
    '</div>'
  );
}

// Selects a class on step 2 without advancing -- a separate Next button
// (signupNext(), step 2 case) moves to step 3. Only clears spec/off-specs/
// role when the class actually changes: #500's edit flow pre-fills
// className/mainSpec/offSpecs from the existing signup, and re-clicking the
// same already-selected class (nothing stops a raider from doing that)
// shouldn't discard a pre-filled spec that's still valid for that class.
function signupSelectClass(cls) {
  var classChanged = cls !== signupData.className;
  signupData.className = cls;
  if (classChanged) {
    signupData.mainSpec = '';
    signupData.offSpecs = [];
    signupData.role = '';
  }
  signupData.classMismatchConfirmed = false;
  renderSignupStep();
}

// Recomputes claimNameRealm/matchesClaim against whatever Discord claim is
// currently resolved, rather than trusting a value cached from an earlier
// step. getDiscordSession() (discord.js) returns a snapshot that fills in
// asynchronously after a DB round trip, so the claim it reports at step 1 can
// still be null/stale even though it resolves correctly moments later while
// the raider is on steps 2-4 -- if nothing rechecks before submit, a raider
// whose claim just hadn't loaded yet gets permanently recorded as swapping
// from the exact character they're signing up as. Same race #500 fixed for
// the edit-prefill path; this covers the fresh-signup path.
function signupRefreshMatchesClaim(charName, realm) {
  var discordSession = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
  var claimNameRealm = discordSession && discordSession.nameRealm ? discordSession.nameRealm : null;
  signupData.claimNameRealm = claimNameRealm;
  signupData.matchesClaim = !!(
    claimNameRealm && (charName + '-' + realm).toLowerCase() === claimNameRealm.toLowerCase()
  );
  return claimNameRealm;
}

function signupNext() {
  if (signupStep === 1) {
    var charName = (document.getElementById('signupCharName').value || '').trim();
    var realm = (document.getElementById('signupRealm').value || '').trim();
    var charNameErr = validateCharName(charName);
    if (charNameErr) {
      document.getElementById('signupError').textContent = charNameErr;
      return;
    }
    if (!realm) {
      document.getElementById('signupError').textContent = 'Please select your realm.';
      return;
    }
    var priorCharName = signupData.charName;
    var priorRealm = signupData.realm;
    signupData.charName = charName;
    signupData.realm = realm;

    if (charName !== priorCharName || realm !== priorRealm) signupData.claimDiffersConfirmed = false;
    var claimNameRealm = signupRefreshMatchesClaim(charName, realm);

    if (claimNameRealm && !signupData.matchesClaim && !signupData.claimDiffersConfirmed) {
      var claimConfirmEl1 = document.getElementById('signupClaimDiffersConfirm');
      if (claimConfirmEl1 && claimConfirmEl1.checked) {
        signupData.claimDiffersConfirmed = true;
      } else {
        renderSignupStep();
        return;
      }
    }

    signupStep = 2;
  } else if (signupStep === 2) {
    if (!signupData.className) {
      document.getElementById('signupError').textContent = 'Please select a class.';
      return;
    }
    signupStep = 3;
  } else if (signupStep === 3) {
    var mainSpecEl = document.querySelector('input[name="mainSpec"]:checked');
    var offSpecEls = document.querySelectorAll('input[name="offSpec"]:checked');
    var roleEl = document.querySelector('input[name="primaryRole"]:checked');
    var specData = CLASS_SPECS[signupData.className];
    if (!mainSpecEl) {
      document.getElementById('signupError').textContent = 'Please select your main spec.';
      return;
    }
    if (specData.roles && !roleEl) {
      document.getElementById('signupError').textContent = 'Please select your primary role.';
      return;
    }
    if (signupHasClassMismatch()) {
      var confirmEl = document.getElementById('signupClassMismatchConfirm');
      if (!confirmEl || !confirmEl.checked) {
        document.getElementById('signupError').textContent =
          'Please confirm the class change, or go back and re-check your character selection.';
        return;
      }
      signupData.classMismatchConfirmed = true;
    }
    signupData.mainSpec = mainSpecEl.value;
    signupData.offSpecs = Array.prototype.map.call(offSpecEls, function (el) {
      return el.value;
    });
    var rawRole = roleEl ? roleEl.value : specData.role || null;
    if (rawRole === 'DPS' || rawRole === 'Healer') {
      rawRole = SPEC_ROLE[signupData.mainSpec] || rawRole;
    }
    signupData.role = rawRole;
    signupStep = 4;
  } else {
    signupStep++;
  }
  renderSignupStep();
}

function signupBack() {
  if (signupStep === 3) {
    signupStep = 2;
  } else if (signupStep > 1) {
    signupStep--;
  }
  renderSignupStep();
}

function submitSignup() {
  // Refreshed here, not just trusted from step 1 -- see
  // signupRefreshMatchesClaim()'s comment for why a value computed earlier
  // in the flow can go stale by the time the raider actually hits Submit.
  signupRefreshMatchesClaim(signupData.charName, signupData.realm);
  var discordSession = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
  var hasClaim = !!(discordSession && discordSession.nameRealm);
  var claimDiffers = hasClaim && signupData.matchesClaim === false;

  if (claimDiffers) {
    // Already confirmed at step 1 -- signupNext() won't advance past step 1 otherwise.
    signupData.mainSwap = discordSession.nameRealm;
  } else {
    // No claim, or typed name matches the claimed character -- no swap.
    signupData.mainSwap = '';
  }

  signupData.notes = (document.getElementById('signupNotes').value || '').trim();
  signupData.submittedAt = new Date().toISOString();

  var btn = document.getElementById('signupSubmitBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Submitting...';
  }

  if (!supabaseClient) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Submit';
    }
    var noClientErr = document.getElementById('signupError');
    if (noClientErr) noClientErr.textContent = 'Submission failed. Please try again or contact an officer on Discord.';
    return;
  }

  // #500: an edit calls update_own_signup instead of submit_season_signup.
  // Both take the same field shape (class/spec/off-specs/main-swap/note/
  // swap-from-name-realm) -- update_own_signup just identifies the row by
  // p_signup_id instead of creating one under p_team_id.
  var isEdit = !!signupData.editingSignupId;
  var rpcName = isEdit ? 'update_own_signup' : 'submit_season_signup';
  var rpcParams = {
    p_name_realm: signupData.charName + '-' + signupData.realm,
    p_class: signupData.className,
    p_spec: signupData.mainSpec,
    p_off_specs: (signupData.offSpecs || []).join(', '),
    p_main_swap: !!signupData.mainSwap,
    p_player_note: signupData.notes,
    // Only the verified-claim case (claimDiffers, above) sets this to the
    // Discord-claimed character; the free-typed manual swap box has no
    // claim backing it and stays unlinked on purpose.
    p_swap_from_name_realm: claimDiffers ? discordSession.nameRealm : null
  };
  if (isEdit) {
    rpcParams.p_signup_id = signupData.editingSignupId;
  } else {
    rpcParams.p_team_id = _teamCfg.supabaseTeamId;
  }

  supabaseClient.rpc(rpcName, rpcParams).then(function (result) {
    if (result.error) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Submit';
      }
      var err = document.getElementById('signupError');
      if (err) {
        // update_own_signup's exceptions (locked/not-found) are purpose-
        // written to be shown to the raider verbatim; submit_season_signup's
        // are not all raider-safe as-is, so that path keeps a generic message.
        err.textContent = isEdit
          ? result.error.message
          : 'Submission failed. Please try again or contact an officer on Discord.';
      }
      return;
    }

    if (!isEdit) {
      // Best-effort Discord notification via the discord-bot-webhook Edge
      // Function -- only for a fresh submission, not an edit; officers don't
      // need a second "someone signed up" ping. Not gated on its result --
      // the Supabase insert above is the write of record.
      supabaseClient.functions.invoke('discord-bot-webhook', {
        body: {
          action: 'signup',
          team: TEAM_SLUG,
          payload: {
            charName: signupData.charName || '',
            realm: signupData.realm || '',
            className: signupData.className || '',
            mainSpec: signupData.mainSpec || '',
            offSpecs: (signupData.offSpecs || []).join(', '),
            role: signupData.role || '',
            discord: (discordSession && discordSession.username) || '',
            mainSwap: !!signupData.mainSwap,
            swapFromNameRealm: claimDiffers ? discordSession.nameRealm : '',
            notes: signupData.notes || ''
          }
        }
      });
    }

    signupStep = 5;
    renderSignupStep();
  });
}
