// boe-webhook (#746): the BoE Found submit card posts here after
// submit_boe_found succeeds, replacing the Google Form -> Apps Script ->
// relay bot hop with a single direct post to a Discord native incoming
// webhook (BOE_WEBHOOK_URL). Like contact-webhook, every team's report lands
// in the same channel, so there is no per-team routing and no secondary bot
// hop; unlike contact-webhook the call site is fire-and-forget (the RPC
// insert is the write of record, this is a best-effort notification).
//
// No auth gate, same stance as contact-webhook: the card is a public
// unauthenticated form, and submit_boe_found is anon-callable by design.
//
// The embed description preserves the retired bot's message line so the
// channel keeps reading the same way:
//   **Finder-Realm** of Team <name> found \<Track>- <Item>
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
    const { team, finder, item, track, note } = await req.json();

    if (!finder || !String(finder).trim()) {
      return jsonResponse({ success: false, error: 'Missing finder' });
    }
    if (!item || !String(item).trim()) {
      return jsonResponse({ success: false, error: 'Missing item' });
    }

    // BOE_WEBHOOK_URL is the documented name (setup guide, .env.example) and
    // the one local `functions serve` can load from a dotenv file. The prod
    // secret was created in the dashboard as BOE-Found-Webhook (2026-08-26)
    // and the runtime delivers hyphenated names fine, so read it as the
    // fallback rather than asking for a re-paste. Either name works.
    const webhookUrl = Deno.env.get('BOE_WEBHOOK_URL') || Deno.env.get('BOE-Found-Webhook');
    if (!webhookUrl) {
      return jsonResponse({ success: true, skipped: true });
    }

    const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '...' : s);

    const finderText = truncate(String(finder).trim(), 200);
    const itemText = truncate(String(item).trim(), 200);
    const teamText = String(team || 'Unknown');
    // The backslash keeps Discord from parsing <Track> as a mention/channel
    // token, matching the retired bot's output byte for byte. Track is
    // optional on the card, so the chunk drops out entirely when unset.
    const trackChunk = track ? '\\<' + String(track) + '>- ' : '';
    const description = '**' + finderText + '** of Team ' + teamText + ' found ' + trackChunk + itemText;

    const fields = [
      { name: 'Team', value: teamText, inline: true },
      { name: 'Finder', value: finderText, inline: true },
      { name: 'Item', value: itemText, inline: true }
    ];
    if (track) {
      fields.push({ name: 'Track', value: String(track), inline: true });
    }
    if (note && String(note).trim()) {
      fields.push({ name: 'Note', value: truncate(String(note).trim(), 1024), inline: false });
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [
          {
            title: 'BoE Found',
            color: 0xd6a344,
            description: truncate(description, 4096),
            fields,
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
    console.error('boe-webhook error:', err);
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});
