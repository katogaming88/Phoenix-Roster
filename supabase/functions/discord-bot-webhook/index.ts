// discord-bot-webhook (#224): ports gs/wgaWebApp.gs's sendToBot() out of Apps
// Script. Phoenix and Hellfire each run their own bot behind its own HTTPS
// URL/secret (BOT_WEBHOOK_URL_<TEAM>/BOT_WEBHOOK_SECRET_<TEAM>, per
// docs/supabase-setup-guide.md); Immolation has no bot deployed yet, so a
// missing secret pair is treated as a silent no-op rather than an error,
// same as GAS's catch-and-log failure mode.
//
// No auth gate: all four notification paths (signup, self-received,
// BiS link, M+ exclusion) are submitted by unauthenticated public-roster
// forms today (their RPCs are granted to `anon`), so this function accepts
// the same unauthenticated calls the GAS actions did. It only relays a
// notification -- the writes it accompanies are already committed via their
// own RPC before this is ever called.
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

const ACTION_PATHS: Record<string, string> = {
  signup: '/signup',
  selfreceived: '/selfreceived',
  bis: '/bis',
  mplus: '/mplus',
  rsvp: '/rsvp-status',
  optionalReminder: '/optional-reminder',
  signupSheetSync: '/signup-sheet-sync',
  verifyChannel: '/verify-channel'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const { action, team, payload } = await req.json();

    const path = ACTION_PATHS[action];
    if (!path) return jsonResponse({ success: false, error: 'Unknown action: ' + action });
    if (!team) return jsonResponse({ success: false, error: 'Missing team' });

    const teamKey = String(team).toUpperCase();
    const botUrl = Deno.env.get(`BOT_WEBHOOK_URL_${teamKey}`);
    const botSecret = Deno.env.get(`BOT_WEBHOOK_SECRET_${teamKey}`);
    if (!botUrl || !botSecret) {
      return jsonResponse({ success: true, skipped: true });
    }

    const response = await fetch(botUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-secret': botSecret },
      body: JSON.stringify({ ...(payload || {}), submittedAt: new Date().toISOString() })
    });

    if (!response.ok) {
      console.error('Bot error on ' + path + ': ' + response.status + ' - ' + (await response.text()));
      return jsonResponse({ success: false, error: 'Bot responded with ' + response.status });
    }

    // Every caller before verifyChannel is fire-and-forget and never reads
    // this body, so forwarding it is backward compatible -- verifyChannel
    // needs the bot's actual {ok, name}/{ok, error} to reach the officer UI.
    const body = await response.json().catch(() => ({}));
    return jsonResponse({ success: true, ...body });
  } catch (err) {
    console.error('discord-bot-webhook error:', err);
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});
