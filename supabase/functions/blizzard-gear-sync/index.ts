// blizzard-gear-sync: syncs equipped gear from the Blizzard Game Data
// Profile API's Character Equipment Summary endpoint into
// public.player_equipped_gear, so generate_priority_order() has "what's
// already equipped in this slot" data without needing a client-side fetch.
//
// Two callers, same logic, matching the two existing cron-vs-JWT function
// shapes this repo already has (twitch-live-check vs wcl-sync):
//   - Scheduled full sweep, no logged-in caller: gated on the
//     x-cron-secret header against BLIZZARD_GEAR_SYNC_SECRET (see the
//     pg_cron migration), writes with the service role, every team.
//   - Officer-triggered on-demand sync: forwards the caller's JWT (like
//     wcl-sync), checks my_team_role(teamId)/is_site_admin, and syncs only
//     that team's roster -- or a single player, if playerId is passed.
// Deploy with --no-verify-jwt (same as twitch-live-check/wcl-sync both
// need to be reachable without Supabase's own JWT gate, since this
// function does its own auth check either way).
//
// Unlike Raider.IO (this repo's original design for this feature, #845),
// the Blizzard API needs OAuth client-credentials (BLIZZARD_CLIENT_ID/
// BLIZZARD_CLIENT_SECRET, already used by scripts/fetch-item-stats.js) --
// that secret can't be exposed to the browser, so this sync can no longer
// run as a direct client-side fetch the way the Raider.IO tier sync
// (js/common.js's fetchRaiderIoGear) still does for class-tier detection.
// That existing tier sync is untouched -- Raider.IO stays the source for
// class-tier-set detection, only equipped-gear-track detection moved here.
//
// Track label: an equipped item's `name_description.display_string`
// confirmed live against 3 real roster characters (#845) -- "Normal" for a
// Champion-track raid piece, "Heroic" for Hero, "Mythic" for Myth, exact
// match only (a Mythic+ dungeon drop's "Mythic+" or a special boss-specific
// item's "Mythic Sporefused: Myth" -- not a catalyst conversion, a distinct
// unique item with no raid track of its own -- must NOT match "Mythic").
// This is a display-only label -- generate_priority_order()'s actual
// fairness comparison uses raw item_level against team_settings.config's
// trackIlvlThresholds instead (Kat-confirmed: a Mythic+/crafted/special
// piece at Hero-equivalent ilvl should count too, not just true raid drops).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

// Same realm-slug conversion as wcl-sync's realmToServerSlug (ported from
// gs/WCL.gs) -- Blizzard's own Profile API realm slugs follow the identical
// convention (apostrophe dropped not hyphenated, camelCase/digit boundaries
// hyphenated, spaces hyphenated), confirmed live against a real roster
// character's equipment endpoint (#845).
function realmSlug(realm: string): string {
  const r = String(realm || '').trim();
  if (r.indexOf("'") !== -1) {
    return r.replace(/'/g, '').toLowerCase();
  }
  return r
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([a-zA-Z])(\d)/g, '$1-$2')
    .replace(/\s+/g, '-')
    .toLowerCase();
}

const TRACK_LABELS: Record<string, string> = {
  Normal: 'Champion',
  Heroic: 'Hero',
  Mythic: 'Myth'
};

async function getBlizzardToken(clientId: string, clientSecret: string): Promise<string | null> {
  const res = await fetch('https://oauth.battle.net/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${clientId}:${clientSecret}`),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token || null;
}

type EquippedRow = {
  player_id: number;
  equipment_slot: string;
  item_id: number;
  item_level: number | null;
  track: string | null;
};

async function fetchEquipment(firstName: string, realm: string, token: string): Promise<any[] | null> {
  const url =
    'https://us.api.blizzard.com/profile/wow/character/' +
    encodeURIComponent(realmSlug(realm)) +
    '/' +
    encodeURIComponent(firstName.toLowerCase()) +
    '/equipment?namespace=profile-us&locale=en_US';
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.equipped_items || null;
}

function buildRows(playerId: number, equippedItems: any[]): EquippedRow[] {
  const rows: EquippedRow[] = [];
  for (const it of equippedItems) {
    const slot = it?.slot?.type;
    const itemId = it?.item?.id;
    if (!slot || itemId == null) continue;
    const itemLevel = typeof it?.level?.value === 'number' ? it.level.value : null;
    const descriptor = it?.name_description?.display_string;
    rows.push({
      player_id: playerId,
      equipment_slot: slot,
      item_id: itemId,
      item_level: itemLevel,
      track: (descriptor && TRACK_LABELS[descriptor]) || null
    });
  }
  return rows;
}

async function syncRoster(
  supabase: ReturnType<typeof createClient>,
  players: Array<{ id: number; name_realm: string }>,
  token: string
): Promise<{ synced: number; skipped: number }> {
  let synced = 0;
  let skipped = 0;

  for (const player of players) {
    const parts = String(player.name_realm || '').split('-');
    const firstName = (parts[0] || '').trim();
    const realm = parts.slice(1).join('-').trim();
    if (!firstName || !realm) {
      skipped++;
      continue;
    }

    const equippedItems = await fetchEquipment(firstName, realm, token);
    if (!equippedItems) {
      skipped++;
      continue;
    }

    const rows = buildRows(player.id, equippedItems).map((r) => ({ ...r, synced_at: new Date().toISOString() }));
    if (rows.length > 0) {
      const { error: upsertError } = await supabase
        .from('player_equipped_gear')
        .upsert(rows, { onConflict: 'player_id,equipment_slot' });
      if (upsertError) {
        console.error('blizzard-gear-sync: upsert failed for player', player.id, upsertError.message);
        skipped++;
        continue;
      }
    }
    synced++;
  }

  return { synced, skipped };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const clientId = Deno.env.get('BLIZZARD_CLIENT_ID');
    const clientSecret = Deno.env.get('BLIZZARD_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      return jsonResponse({ success: false, error: 'Blizzard credentials not configured' }, 500);
    }
    const token = await getBlizzardToken(clientId, clientSecret);
    if (!token) return jsonResponse({ success: false, error: 'Failed to get Blizzard access token' }, 500);

    const cronSecret = Deno.env.get('BLIZZARD_GEAR_SYNC_SECRET');
    const isCronCall = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret;

    if (isCronCall) {
      const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data: players, error: playersError } = await supabase
        .from('players')
        .select('id, name_realm')
        .is('archived_at', null);
      if (playersError) return jsonResponse({ success: false, error: playersError.message }, 500);

      const result = await syncRoster(supabase, players || [], token);
      return jsonResponse({ success: true, ...result });
    }

    // Officer-triggered, on-demand path -- forwards the caller's own JWT so
    // my_team_role()/is_site_admin() resolve exactly as they would for a
    // direct frontend call, same reasoning wcl-sync's file header documents.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ success: false, error: 'Not signed in' }, 401);

    const { teamId, playerId } = await req.json();
    if (!teamId) return jsonResponse({ success: false, error: 'Missing teamId' }, 400);

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });

    const [{ data: role }, { data: isSiteAdmin }] = await Promise.all([
      supabase.rpc('my_team_role', { p_team_id: teamId }),
      supabase.rpc('is_site_admin')
    ]);
    const authorized = role === 'officer' || role === 'team_leader' || isSiteAdmin === true;
    if (!authorized) return jsonResponse({ success: false, error: 'Not authorized' }, 403);

    let query = supabase.from('players').select('id, name_realm').eq('team_id', teamId).is('archived_at', null);
    if (playerId) query = query.eq('id', playerId);
    const { data: players, error: playersError } = await query;
    if (playersError) return jsonResponse({ success: false, error: playersError.message }, 500);

    const result = await syncRoster(supabase, players || [], token);
    return jsonResponse({ success: true, ...result });
  } catch (err) {
    console.error('blizzard-gear-sync error:', err);
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});
