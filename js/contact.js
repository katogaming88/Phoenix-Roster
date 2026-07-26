// Contact sub-tab (#577, fourth slice) -- posts a site issue report through
// the contact-webhook Edge Function to a single fixed admin Discord channel,
// regardless of which team's site it was submitted from. Unlike signup.js's
// fire-and-forget discord-bot-webhook call (a side-channel notification
// alongside a real DB write), this *is* the whole action -- the user needs
// to see it actually sent, so it follows tab-bios.js's saveBios() status-
// message pattern instead.
function submitContactForm() {
  var nameEl = document.getElementById('contactName');
  var emailEl = document.getElementById('contactEmail');
  var messageEl = document.getElementById('contactMessage');
  var btn = document.getElementById('contactSubmitBtn');
  var status = document.getElementById('contactStatus');

  var message = messageEl ? messageEl.value.trim() : '';
  if (!message) {
    if (status) status.textContent = 'Please enter a message.';
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Sending...';
  }
  if (status) status.textContent = '';

  supabaseClient.functions
    .invoke('contact-webhook', {
      body: {
        team: TEAM_SLUG,
        page: 'about',
        name: nameEl ? nameEl.value.trim() : '',
        email: emailEl ? emailEl.value.trim() : '',
        message: message
      }
    })
    .then(function (res) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Send';
      }
      var result = res.data;
      if (res.error || !result || result.success === false) {
        if (status) {
          status.textContent = res.error ? res.error.message : (result && result.error) || 'Error sending.';
        }
        return;
      }
      if (nameEl) nameEl.value = '';
      if (emailEl) emailEl.value = '';
      if (messageEl) messageEl.value = '';
      if (status) status.textContent = 'Sent! Thanks for the report.';
    })
    .catch(function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Send';
      }
      if (status) status.textContent = (err && err.message) || 'Error sending. Please try again.';
    });
}
