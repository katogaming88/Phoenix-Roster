// contact-webhook (#577, fourth slice): the public About tab's Contact
// sub-tab posts site issue reports here. Unlike discord-bot-webhook (a
// per-team relay to each team's own self-hosted bot server), every team's
// report needs to land in the same single admin Discord channel -- so this
// posts directly to a Discord native incoming webhook using CONTACT_WEBHOOK_URL,
// with no per-team routing and no secondary bot hop.
//
// No auth gate, same stance as discord-bot-webhook: this is a public
// unauthenticated form, same trust level as signup/BiS-link/M+ exclusion.
//
// No email field -- if the submitter is logged in with Discord, their
// snowflake ID (js/discord.js's getDiscordSession().discordId, sourced from
// raw_user_meta_data.provider_id) is sent instead, rendered here as a <@id>
// mention so the admin channel shows a clickable/right-clickable link
// straight to a DM, no email round trip needed.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const { team, name, discordUsername, discordId, message } = await req.json();

    if (!message || !String(message).trim()) {
      return jsonResponse({ success: false, error: 'Missing message' });
    }

    const webhookUrl = Deno.env.get('CONTACT_WEBHOOK_URL');
    if (!webhookUrl) {
      return jsonResponse({ success: true, skipped: true });
    }

    const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '...' : s);

    // <@id> renders as a clickable mention in the embed field (right-click ->
    // Message) same as it would in plain message content -- no ping/
    // notification fires from this alone, it's just a clickable chip.
    const discordField = discordId
      ? '<@' + discordId + '>'
      : discordUsername
        ? truncate(String(discordUsername), 1024)
        : '(not logged in)';

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [
          {
            title: 'Site Contact Form Submission',
            color: 0xd6a344,
            fields: [
              { name: 'Team', value: String(team || 'Unknown'), inline: true },
              { name: 'Name', value: name ? truncate(String(name), 1024) : '(not provided)', inline: true },
              { name: 'Discord', value: discordField, inline: true },
              { name: 'Message', value: truncate(String(message), 1024) }
            ],
            timestamp: new Date().toISOString()
          }
        ]
      })
    });

    if (!response.ok) {
      console.error('Discord webhook error: ' + response.status + ' - ' + (await response.text()));
      return jsonResponse({ success: false, error: 'Discord responded with ' + response.status });
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error('contact-webhook error:', err);
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});
