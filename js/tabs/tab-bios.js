// Team officer bios (#477, second slice) -- an officer editor for the
// per-team raid-officer bio cards shown on the public "Bios" tab
// (js/roster.js buildBios()). Modeled directly on Raid Progression's
// SEASON_RAIDS/raidCollectFromDOM()/renderRaidProgressionCards() round trip
// in this same folder (tab-season.js) -- same add/remove/collect/render/save
// shape, just a flat list instead of nested raid/boss arrays. Saved through
// the existing saveTeamSetting() -> set_team_setting RPC (js/common.js);
// team_settings.config is jsonb, so this new key needed no migration.
//
// Fields are self-contained (name/class/spec typed in here, not looked up
// live from an existing players row) -- deliberate, since the later Guild
// Officer tier will reuse this same card shape and can't reliably resolve
// to a players row (a guild officer may not be on the roster of whichever
// team's page is being viewed). "+ Add Officer" can still prefill those
// fields from a roster player via populateBioRosterPicker()/bioAdd() below,
// but it's a one-time copy at add time, not a link -- the bio entry doesn't
// track that player afterward.

var TEAM_OFFICER_BIOS = [];

function buildBioCards() {
  TEAM_OFFICER_BIOS = JSON.parse(JSON.stringify((DATA && DATA.teamOfficerBios) || []));
  populateBioRosterPicker();
  renderBioCards();
}

// Lets an officer start a new bio from an existing roster player (fills
// name/character name/class/spec) instead of typing everything by hand --
// a one-time convenience at add time, not a persistent link. The bio entry
// stays a plain self-contained object afterward (see header comment), so
// editing/removing the player later, or them changing spec, never touches
// bios that already exist.
function populateBioRosterPicker() {
  var sel = document.getElementById('bioRosterPicker');
  if (!sel) return;
  var roster = (DATA && DATA.roster) || [];
  var sorted = roster.slice().sort(function (a, b) {
    return (a.nick || a.firstName).localeCompare(b.nick || b.firstName);
  });
  sel.innerHTML = '<option value="">-- Not on roster --</option>';
  for (var i = 0; i < sorted.length; i++) {
    var p = sorted[i];
    var opt = document.createElement('option');
    opt.value = p.firstName;
    opt.textContent = p.nick ? p.nick + ' (' + p.firstName + ')' : p.firstName;
    sel.appendChild(opt);
  }
}

function bioAdd() {
  bioCollectFromDOM();
  var pickerEl = document.getElementById('bioRosterPicker');
  var pickedName = pickerEl ? pickerEl.value : '';
  var player = null;
  if (pickedName) {
    var roster = (DATA && DATA.roster) || [];
    for (var i = 0; i < roster.length; i++) {
      if (roster[i].firstName === pickedName) {
        player = roster[i];
        break;
      }
    }
  }
  TEAM_OFFICER_BIOS.push({
    name: player ? player.nick || player.firstName : '',
    characterName: player ? player.firstName : '',
    pronouns: '',
    title: '',
    classKey: player ? player.class || '' : '',
    spec: player ? player.spec || '' : '',
    bio: '',
    imagePath: ''
  });
  if (pickerEl) pickerEl.value = '';
  renderBioCards();
}

function bioRemove(idx) {
  bioCollectFromDOM();
  TEAM_OFFICER_BIOS.splice(idx, 1);
  renderBioCards();
}

function bioMoveUp(idx) {
  if (idx <= 0) return;
  bioCollectFromDOM();
  var entry = TEAM_OFFICER_BIOS.splice(idx, 1)[0];
  TEAM_OFFICER_BIOS.splice(idx - 1, 0, entry);
  renderBioCards();
}

function bioMoveDown(idx) {
  bioCollectFromDOM();
  if (idx >= TEAM_OFFICER_BIOS.length - 1) return;
  var entry = TEAM_OFFICER_BIOS.splice(idx, 1)[0];
  TEAM_OFFICER_BIOS.splice(idx + 1, 0, entry);
  renderBioCards();
}

// Reads current input/select/textarea values back into TEAM_OFFICER_BIOS
// before any add/remove/reorder mutates the array -- otherwise an
// in-progress edit in another card would be lost on re-render, same role
// as raidCollectFromDOM() (tab-season.js).
function bioCollectFromDOM() {
  var wrap = document.getElementById('bioCards');
  if (!wrap) return;
  var blocks = wrap.querySelectorAll('.bio-editor-block');
  for (var i = 0; i < blocks.length; i++) {
    if (!TEAM_OFFICER_BIOS[i]) continue;
    var nameEl = blocks[i].querySelector('.bio-name-input');
    var charEl = blocks[i].querySelector('.bio-charname-input');
    var pronounsEl = blocks[i].querySelector('.bio-pronouns-input');
    var titleEl = blocks[i].querySelector('.bio-title-input');
    var classEl = blocks[i].querySelector('.bio-class-select');
    var specEl = blocks[i].querySelector('.bio-spec-input');
    var imgEl = blocks[i].querySelector('.bio-image-input');
    var bioEl = blocks[i].querySelector('.bio-text-input');
    if (nameEl) TEAM_OFFICER_BIOS[i].name = nameEl.value.trim();
    if (charEl) TEAM_OFFICER_BIOS[i].characterName = charEl.value.trim();
    if (pronounsEl) TEAM_OFFICER_BIOS[i].pronouns = pronounsEl.value.trim();
    if (titleEl) TEAM_OFFICER_BIOS[i].title = titleEl.value.trim();
    if (classEl) TEAM_OFFICER_BIOS[i].classKey = classEl.value;
    if (specEl) TEAM_OFFICER_BIOS[i].spec = specEl.value.trim();
    if (imgEl) TEAM_OFFICER_BIOS[i].imagePath = imgEl.value.trim();
    if (bioEl) TEAM_OFFICER_BIOS[i].bio = bioEl.value.trim();
  }
}

function renderBioCards() {
  var wrap = document.getElementById('bioCards');
  if (!wrap) return;
  if (!TEAM_OFFICER_BIOS.length) {
    wrap.innerHTML =
      '<p style="font-size:1rem;color:var(--text-muted);">No officer bios added yet. Click "+ Add Officer" to start.</p>';
    return;
  }
  var classKeys = Object.keys(CLASS_SPECS).sort();
  var html = '';
  for (var i = 0; i < TEAM_OFFICER_BIOS.length; i++) {
    var entry = TEAM_OFFICER_BIOS[i];
    html +=
      '<div class="bio-editor-block" style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:1rem;">';
    html += '<div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.5rem;">';
    html +=
      '<input class="bio-name-input add-player-input" placeholder="Display name (e.g. Kat)" value="' +
      _escAttr(entry.name) +
      '" style="flex:1;min-width:140px;font-size:1.07rem;padding:0.35rem 0.6rem;">';
    html +=
      '<input class="bio-charname-input add-player-input" placeholder="Character name (e.g. Katorri)" value="' +
      _escAttr(entry.characterName || '') +
      '" style="flex:1;min-width:140px;font-size:1rem;padding:0.35rem 0.6rem;">';
    html +=
      '<button class="btn btn-muted" style="padding:2px 10px;font-size:0.93rem;" onclick="bioMoveUp(' +
      i +
      ')"' +
      (i === 0 ? ' disabled' : '') +
      '>&uarr;</button>';
    html +=
      '<button class="btn btn-muted" style="padding:2px 10px;font-size:0.93rem;" onclick="bioMoveDown(' +
      i +
      ')"' +
      (i === TEAM_OFFICER_BIOS.length - 1 ? ' disabled' : '') +
      '>&darr;</button>';
    html +=
      '<button class="btn btn-danger" style="padding:2px 10px;font-size:0.93rem;" onclick="bioRemove(' +
      i +
      ')">Remove</button>';
    html += '</div>';
    html += '<div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.5rem;">';
    html +=
      '<input class="bio-title-input add-player-input" placeholder="Title (e.g. Loot Officer)" value="' +
      _escAttr(entry.title || '') +
      '" style="flex:1;min-width:160px;font-size:1rem;padding:0.3rem 0.55rem;">';
    html +=
      '<input class="bio-pronouns-input add-player-input" placeholder="Pronouns (e.g. she/her)" value="' +
      _escAttr(entry.pronouns || '') +
      '" style="min-width:130px;font-size:1rem;padding:0.3rem 0.55rem;">';
    html +=
      '<select class="bio-class-select add-player-input" style="min-width:140px;font-size:1rem;padding:0.3rem 0.55rem;">';
    html += '<option value=""' + (entry.classKey ? '' : ' selected') + '>-- Class --</option>';
    for (var c = 0; c < classKeys.length; c++) {
      html +=
        '<option value="' +
        classKeys[c] +
        '"' +
        (entry.classKey === classKeys[c] ? ' selected' : '') +
        '>' +
        classKeys[c] +
        '</option>';
    }
    html += '</select>';
    html +=
      '<input class="bio-spec-input add-player-input" placeholder="Spec (e.g. Protection)" value="' +
      _escAttr(entry.spec || '') +
      '" style="min-width:140px;font-size:1rem;padding:0.3rem 0.55rem;">';
    html += '</div>';
    html += '<div style="margin-bottom:0.5rem;">';
    html +=
      '<input class="bio-image-input add-player-input" placeholder="assets/officers/kato.jpg" value="' +
      _escAttr(entry.imagePath || '') +
      '" style="width:100%;font-size:1rem;padding:0.3rem 0.55rem;">';
    html +=
      '<p style="font-size:0.91rem;color:var(--text-muted);margin:0.3rem 0 0;">To add a photo, commit an image to <code>assets/officers/</code> in the repo, then paste its relative path here. Leave blank to show initials instead.</p>';
    html += '</div>';
    html +=
      '<textarea class="bio-text-input add-player-notes" placeholder="Short bio..." rows="3" style="width:100%;font-size:1rem;padding:0.3rem 0.55rem;">' +
      _esc(entry.bio || '') +
      '</textarea>';
    html += '</div>';
  }
  wrap.innerHTML = html;
}

function saveBios() {
  bioCollectFromDOM();
  var btn = document.getElementById('bioSaveBtn');
  var status = document.getElementById('bioStatus');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveTeamSetting({ teamOfficerBios: TEAM_OFFICER_BIOS })
    .then(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save Bios';
      }
      DATA.teamOfficerBios = JSON.parse(JSON.stringify(TEAM_OFFICER_BIOS));
      writeAuditLog('Team Officer Bios Saved', null, null, TEAM_OFFICER_BIOS.length + ' bio(s)');
      if (status) {
        status.textContent = 'Saved!';
        setTimeout(function () {
          if (status) status.textContent = '';
        }, 2500);
      }
    })
    .catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save Bios';
      }
      if (status) status.textContent = err.message || 'Error saving.';
    });
}
