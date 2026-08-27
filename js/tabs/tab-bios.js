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

// Self-serve bio photo upload (#625) -- shared by both the team and guild
// editors below. All the actual work (auth, resize, compression, the
// Storage write) happens server-side in the upload-bio-photo Edge Function;
// this is just client-side pre-checks (cheap rejection before a network
// round trip) and the request/response plumbing.
var BIO_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
var BIO_PHOTO_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
var BIO_PHOTO_STORAGE_PREFIX = SUPABASE_URL + '/storage/v1/object/public/bio-photos/';

function _bioValidatePhotoFile(file) {
  if (!file) return 'No file selected.';
  if (BIO_PHOTO_ALLOWED_TYPES.indexOf(file.type) === -1) return 'Photos must be PNG, JPEG, or WebP.';
  if (file.size > BIO_PHOTO_MAX_BYTES) return 'Photo must be under 5MB.';
  return null;
}

function _bioUploadPhotoFile(file) {
  return supabaseClient.functions
    .invoke('upload-bio-photo', { method: 'POST', body: file, headers: { 'Content-Type': file.type } })
    .then(function (res) {
      if (res.error) throw new Error(res.error.message || 'Upload failed.');
      if (!res.data || !res.data.success) throw new Error((res.data && res.data.error) || 'Upload failed.');
      return res.data.url;
    });
}

// A bio's imagePath is a bare URL/path string with no owner metadata of its
// own -- ownership for the delete call is recovered by checking whether it
// falls under the bucket's public URL prefix at all. A legacy hand-typed
// assets/officers/*.jpg path simply doesn't match, and is skipped rather
// than sent to the Edge Function.
function _bioStoragePathFromImagePath(imagePath) {
  if (!imagePath || imagePath.indexOf(BIO_PHOTO_STORAGE_PREFIX) !== 0) return null;
  return imagePath.slice(BIO_PHOTO_STORAGE_PREFIX.length);
}

function _bioRemovePhotoFile(imagePath) {
  var targetPath = _bioStoragePathFromImagePath(imagePath);
  if (!targetPath) return Promise.resolve();
  return supabaseClient.functions
    .invoke('upload-bio-photo', { method: 'DELETE', body: { targetPath: targetPath } })
    .then(function (res) {
      if (res.error) throw new Error(res.error.message || 'Remove failed.');
    });
}

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
    html += '<div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;margin-bottom:0.4rem;">';
    if (entry.imagePath) {
      html +=
        '<img src="' +
        _escAttr(entry.imagePath) +
        '" alt="" style="width:44px;height:44px;border-radius:50%;object-fit:cover;">';
    }
    html +=
      '<input type="file" accept="image/png,image/jpeg,image/webp" class="bio-photo-file-input" onchange="bioUploadPhoto(' +
      i +
      ', this)">';
    if (entry.imagePath) {
      html +=
        '<button class="btn btn-muted" style="padding:2px 10px;font-size:0.93rem;" onclick="bioRemovePhoto(' +
        i +
        ')">Remove Photo</button>';
    }
    html += '<span class="bio-photo-status" style="font-size:0.85rem;color:var(--text-muted);"></span>';
    html += '</div>';
    html +=
      '<input class="bio-image-input add-player-input" placeholder="assets/officers/kato.jpg" value="' +
      _escAttr(entry.imagePath || '') +
      '" style="width:100%;font-size:1rem;padding:0.3rem 0.55rem;">';
    html +=
      '<p style="font-size:0.91rem;color:var(--text-muted);margin:0.3rem 0 0;">Upload a photo above (max 5MB), or paste a path/URL directly. Leave blank to show initials instead.</p>';
    html += '</div>';
    html +=
      '<textarea class="bio-text-input add-player-notes" placeholder="Short bio..." rows="3" style="width:100%;font-size:1rem;padding:0.3rem 0.55rem;">' +
      _esc(entry.bio || '') +
      '</textarea>';
    html += '</div>';
  }
  wrap.innerHTML = html;
}

function bioUploadPhoto(idx, inputEl) {
  var file = inputEl.files && inputEl.files[0];
  var block = inputEl.closest('.bio-editor-block');
  var status = block ? block.querySelector('.bio-photo-status') : null;
  var err = _bioValidatePhotoFile(file);
  if (err) {
    if (status) status.textContent = err;
    inputEl.value = '';
    return;
  }
  bioCollectFromDOM();
  inputEl.disabled = true;
  if (status) status.textContent = 'Uploading...';
  _bioUploadPhotoFile(file)
    .then(function (url) {
      TEAM_OFFICER_BIOS[idx].imagePath = url;
      renderBioCards();
    })
    .catch(function (e) {
      inputEl.disabled = false;
      inputEl.value = '';
      if (status) status.textContent = e.message || 'Upload failed.';
    });
}

// Best-effort remote cleanup, then clear the reference locally regardless
// (matches how the manual path field has always worked -- clearing it is
// unrestricted client-side, the real gate is the save RPC).
function bioRemovePhoto(idx) {
  bioCollectFromDOM();
  var imagePath = TEAM_OFFICER_BIOS[idx].imagePath;
  _bioRemovePhotoFile(imagePath)
    .catch(function () {})
    .then(function () {
      TEAM_OFFICER_BIOS[idx].imagePath = '';
      renderBioCards();
    });
}

function saveBios() {
  bioCollectFromDOM();
  var btn = document.getElementById('bioSaveBtn');
  var status = document.getElementById('bioStatus');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveTeamSetting({ teamOfficerBios: TEAM_OFFICER_BIOS }, true)
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

// Guild officer bios (#577) -- a second, parallel officer editor for
// guild-officer bio cards. Separate list from TEAM_OFFICER_BIOS above: team
// officers only decide team-specific duties and aren't necessarily guild
// officers, and most (not all) team officers happen to also hold a guild
// officer rank. Same shape/round-trip as the Team section above, just a
// distinct DOM/config namespace so the two never collide.

var GUILD_OFFICER_BIOS = [];
// Guild Officer Bios are guild-wide (site_settings, not team_settings) --
// only a site admin or a guild officer (#607) can save them, since it isn't
// any one team's content to own. Any other officer still sees the current
// list, read-only.
var _guildBiosCanEdit = false;

function buildGuildBioCards() {
  GUILD_OFFICER_BIOS = JSON.parse(JSON.stringify((DATA && DATA.guildOfficerBios) || []));
  var session = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
  _guildBiosCanEdit = !!(session && (session.isAdmin || session.isGuildOfficer));
  var note = document.getElementById('guildBiosAdminNote');
  var controls = document.getElementById('guildBiosControls');
  if (note) note.style.display = _guildBiosCanEdit ? 'none' : '';
  if (controls) controls.style.display = _guildBiosCanEdit ? 'flex' : 'none';
  populateGuildBioRosterPicker();
  renderGuildBioCards();
}

function populateGuildBioRosterPicker() {
  var sel = document.getElementById('guildBioRosterPicker');
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

function guildBioAdd() {
  guildBioCollectFromDOM();
  var pickerEl = document.getElementById('guildBioRosterPicker');
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
  GUILD_OFFICER_BIOS.push({
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
  renderGuildBioCards();
}

function guildBioRemove(idx) {
  guildBioCollectFromDOM();
  GUILD_OFFICER_BIOS.splice(idx, 1);
  renderGuildBioCards();
}

function guildBioMoveUp(idx) {
  if (idx <= 0) return;
  guildBioCollectFromDOM();
  var entry = GUILD_OFFICER_BIOS.splice(idx, 1)[0];
  GUILD_OFFICER_BIOS.splice(idx - 1, 0, entry);
  renderGuildBioCards();
}

function guildBioMoveDown(idx) {
  guildBioCollectFromDOM();
  if (idx >= GUILD_OFFICER_BIOS.length - 1) return;
  var entry = GUILD_OFFICER_BIOS.splice(idx, 1)[0];
  GUILD_OFFICER_BIOS.splice(idx + 1, 0, entry);
  renderGuildBioCards();
}

function guildBioCollectFromDOM() {
  var wrap = document.getElementById('guildBioCards');
  if (!wrap) return;
  var blocks = wrap.querySelectorAll('.guild-bio-editor-block');
  for (var i = 0; i < blocks.length; i++) {
    if (!GUILD_OFFICER_BIOS[i]) continue;
    var nameEl = blocks[i].querySelector('.guild-bio-name-input');
    var charEl = blocks[i].querySelector('.guild-bio-charname-input');
    var pronounsEl = blocks[i].querySelector('.guild-bio-pronouns-input');
    var titleEl = blocks[i].querySelector('.guild-bio-title-input');
    var classEl = blocks[i].querySelector('.guild-bio-class-select');
    var specEl = blocks[i].querySelector('.guild-bio-spec-input');
    var imgEl = blocks[i].querySelector('.guild-bio-image-input');
    var bioEl = blocks[i].querySelector('.guild-bio-text-input');
    if (nameEl) GUILD_OFFICER_BIOS[i].name = nameEl.value.trim();
    if (charEl) GUILD_OFFICER_BIOS[i].characterName = charEl.value.trim();
    if (pronounsEl) GUILD_OFFICER_BIOS[i].pronouns = pronounsEl.value.trim();
    if (titleEl) GUILD_OFFICER_BIOS[i].title = titleEl.value.trim();
    if (classEl) GUILD_OFFICER_BIOS[i].classKey = classEl.value;
    if (specEl) GUILD_OFFICER_BIOS[i].spec = specEl.value.trim();
    if (imgEl) GUILD_OFFICER_BIOS[i].imagePath = imgEl.value.trim();
    if (bioEl) GUILD_OFFICER_BIOS[i].bio = bioEl.value.trim();
  }
}

function renderGuildBioCards() {
  var wrap = document.getElementById('guildBioCards');
  if (!wrap) return;
  if (!GUILD_OFFICER_BIOS.length) {
    wrap.innerHTML =
      '<p style="font-size:1rem;color:var(--text-muted);">No guild officer bios added yet.' +
      (_guildBiosCanEdit ? ' Click "+ Add Guild Officer" to start.' : '') +
      '</p>';
    return;
  }
  var classKeys = Object.keys(CLASS_SPECS).sort();
  var ro = !_guildBiosCanEdit;
  var disabledAttr = ro ? ' disabled' : '';
  var html = '';
  for (var i = 0; i < GUILD_OFFICER_BIOS.length; i++) {
    var entry = GUILD_OFFICER_BIOS[i];
    html +=
      '<div class="guild-bio-editor-block" style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:1rem;">';
    html += '<div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.5rem;">';
    html +=
      '<input class="guild-bio-name-input add-player-input" placeholder="Display name (e.g. Kat)" value="' +
      _escAttr(entry.name) +
      '"' +
      disabledAttr +
      ' style="flex:1;min-width:140px;font-size:1.07rem;padding:0.35rem 0.6rem;">';
    html +=
      '<input class="guild-bio-charname-input add-player-input" placeholder="Character name (e.g. Katorri)" value="' +
      _escAttr(entry.characterName || '') +
      '"' +
      disabledAttr +
      ' style="flex:1;min-width:140px;font-size:1rem;padding:0.35rem 0.6rem;">';
    if (!ro) {
      html +=
        '<button class="btn btn-muted" style="padding:2px 10px;font-size:0.93rem;" onclick="guildBioMoveUp(' +
        i +
        ')"' +
        (i === 0 ? ' disabled' : '') +
        '>&uarr;</button>';
      html +=
        '<button class="btn btn-muted" style="padding:2px 10px;font-size:0.93rem;" onclick="guildBioMoveDown(' +
        i +
        ')"' +
        (i === GUILD_OFFICER_BIOS.length - 1 ? ' disabled' : '') +
        '>&darr;</button>';
      html +=
        '<button class="btn btn-danger" style="padding:2px 10px;font-size:0.93rem;" onclick="guildBioRemove(' +
        i +
        ')">Remove</button>';
    }
    html += '</div>';
    html += '<div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.5rem;">';
    html +=
      '<input class="guild-bio-title-input add-player-input" placeholder="Title (e.g. Loot Officer)" value="' +
      _escAttr(entry.title || '') +
      '"' +
      disabledAttr +
      ' style="flex:1;min-width:160px;font-size:1rem;padding:0.3rem 0.55rem;">';
    html +=
      '<input class="guild-bio-pronouns-input add-player-input" placeholder="Pronouns (e.g. she/her)" value="' +
      _escAttr(entry.pronouns || '') +
      '"' +
      disabledAttr +
      ' style="min-width:130px;font-size:1rem;padding:0.3rem 0.55rem;">';
    html +=
      '<select class="guild-bio-class-select add-player-input"' +
      disabledAttr +
      ' style="min-width:140px;font-size:1rem;padding:0.3rem 0.55rem;">';
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
      '<input class="guild-bio-spec-input add-player-input" placeholder="Spec (e.g. Protection)" value="' +
      _escAttr(entry.spec || '') +
      '"' +
      disabledAttr +
      ' style="min-width:140px;font-size:1rem;padding:0.3rem 0.55rem;">';
    html += '</div>';
    html += '<div style="margin-bottom:0.5rem;">';
    if (!ro) {
      html += '<div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;margin-bottom:0.4rem;">';
      if (entry.imagePath) {
        html +=
          '<img src="' +
          _escAttr(entry.imagePath) +
          '" alt="" style="width:44px;height:44px;border-radius:50%;object-fit:cover;">';
      }
      html +=
        '<input type="file" accept="image/png,image/jpeg,image/webp" class="guild-bio-photo-file-input" onchange="guildBioUploadPhoto(' +
        i +
        ', this)">';
      if (entry.imagePath) {
        html +=
          '<button class="btn btn-muted" style="padding:2px 10px;font-size:0.93rem;" onclick="guildBioRemovePhoto(' +
          i +
          ')">Remove Photo</button>';
      }
      html += '<span class="guild-bio-photo-status" style="font-size:0.85rem;color:var(--text-muted);"></span>';
      html += '</div>';
    }
    html +=
      '<input class="guild-bio-image-input add-player-input" placeholder="assets/officers/kato.jpg" value="' +
      _escAttr(entry.imagePath || '') +
      '"' +
      disabledAttr +
      ' style="width:100%;font-size:1rem;padding:0.3rem 0.55rem;">';
    if (!ro) {
      html +=
        '<p style="font-size:0.91rem;color:var(--text-muted);margin:0.3rem 0 0;">Upload a photo above (max 5MB), or paste a path/URL directly. Leave blank to show initials instead.</p>';
    }
    html += '</div>';
    html +=
      '<textarea class="guild-bio-text-input add-player-notes" placeholder="Short bio..." rows="3"' +
      disabledAttr +
      ' style="width:100%;font-size:1rem;padding:0.3rem 0.55rem;">' +
      _esc(entry.bio || '') +
      '</textarea>';
    html += '</div>';
  }
  wrap.innerHTML = html;
}

function guildBioUploadPhoto(idx, inputEl) {
  var file = inputEl.files && inputEl.files[0];
  var block = inputEl.closest('.guild-bio-editor-block');
  var status = block ? block.querySelector('.guild-bio-photo-status') : null;
  var err = _bioValidatePhotoFile(file);
  if (err) {
    if (status) status.textContent = err;
    inputEl.value = '';
    return;
  }
  guildBioCollectFromDOM();
  inputEl.disabled = true;
  if (status) status.textContent = 'Uploading...';
  _bioUploadPhotoFile(file)
    .then(function (url) {
      GUILD_OFFICER_BIOS[idx].imagePath = url;
      renderGuildBioCards();
    })
    .catch(function (e) {
      inputEl.disabled = false;
      inputEl.value = '';
      if (status) status.textContent = e.message || 'Upload failed.';
    });
}

function guildBioRemovePhoto(idx) {
  guildBioCollectFromDOM();
  var imagePath = GUILD_OFFICER_BIOS[idx].imagePath;
  _bioRemovePhotoFile(imagePath)
    .catch(function () {})
    .then(function () {
      GUILD_OFFICER_BIOS[idx].imagePath = '';
      renderGuildBioCards();
    });
}

function saveGuildBios() {
  guildBioCollectFromDOM();
  var btn = document.getElementById('guildBioSaveBtn');
  var status = document.getElementById('guildBioStatus');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  saveGuildOfficerBios(GUILD_OFFICER_BIOS)
    .then(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save Guild Bios';
      }
      // No client-side writeAuditLog() call here -- unlike set_team_setting,
      // set_guild_officer_bios logs its own audit entry server-side.
      DATA.guildOfficerBios = JSON.parse(JSON.stringify(GUILD_OFFICER_BIOS));
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
        btn.textContent = 'Save Guild Bios';
      }
      if (status) status.textContent = err.message || 'Error saving.';
    });
}
