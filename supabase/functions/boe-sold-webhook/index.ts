// boe-sold-webhook (#873): posts to Discord when a BoE sells, so the finder
// hears it from the channel rather than from a manager remembering to tell
// them. js/boe-manage.js's confirmBoeSale() invokes this after
// boe_record_sale lands, fire and forget -- the row update is the write of
// record, this is a best-effort notification, the same stance as the found
// post in js/boe.js.
//
// The message keeps the retired relay bot's shape, which is what the channel
// has read for two seasons:
//
//   <@finder> -- BOE Sold!
//
//   Item: Hero - Voidglass Cloak 2/6
//   Sale Price: 52,800g
//   Auction House Fee: 2,640g
//   Guild Cut: 30,160g
//   Finder's Fee: 20,000g
//
//   Please get in touch with your raid leaders or <@manager> in the 15
//   minutes before raid starts to receive your gold.
//
// Four decisions worth stating, all settled with Russell on 2026-09-03:
//
//   - Content, not an embed. A mention inside an embed field never notifies
//     (the comment in contact-webhook records this), and the ping is the
//     whole point of the message.
//   - The auction house fee gets its own line. Since #861 the guild cut is
//     net of it, so without the line the four numbers do not add up and the
//     finder is left assuming the guild took the difference.
//   - The closing line names the raid leaders as a role and the BoE manager
//     as a mention. An earlier build listed the finding team's officers by
//     id, which put five names in one sentence on Phoenix and would grow
//     with the roster; the role covers them in two words a finder already
//     knows. The manager is the opposite case: the grant is held by one or
//     two people and a finder has no way to know who this season, so it is
//     read at post time and rendered as a link they can click.
//   - A donated row (#862) ends with thanks instead. Telling someone to
//     collect gold they chose to give away is the one thing the old message
//     could not have got wrong, because the option did not exist.
//
// Unlike boe-webhook this one is gated: it takes a row id and posts what the
// database says about it, so an open endpoint would let anyone announce any
// row, including a false one. The gate is the same pair boe_record_sale
// itself requires, so it admits exactly the people who could have caused this
// message legitimately.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// The window is prose because nothing in the data holds a raid schedule:
// teams, team settings and site settings carry none, and the WCL sync cron is
// a polling window rather than a calendar. Kat's raid_schedule (#640) is per
// team and this message goes to one channel for the whole guild, so it stays
// a constant here.
const PAYOUT_WINDOW = 'in the 15 minutes before raid starts';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

// "A", "A or B", "A, B or C" -- the manager list reads as a sentence rather
// than a comma-joined dump, because it sits inside one.
function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] || '';
  return names.slice(0, -1).join(', ') + ' or ' + names[names.length - 1];
}

// Whole gold with thousands separators, the way every money figure on the
// site and in the old bot's messages reads.
function gold(n: unknown) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('en-US') + 'g';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const { id } = await req.json();
    if (id === undefined || id === null || Number.isNaN(Number(id))) {
      return jsonResponse({ success: false, error: 'Missing id' }, 400);
    }

    // The caller's own JWT, so is_boe_manager()/is_site_admin() resolve
    // auth.uid() exactly as they would for a direct frontend call (the
    // upload-bio-photo and wcl-sync pattern).
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ success: false, error: 'Not authorized' }, 401);
    }
    const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });
    const {
      data: { user }
    } = await caller.auth.getUser();
    if (!user) {
      return jsonResponse({ success: false, error: 'Not authorized' }, 401);
    }
    const [{ data: isManager }, { data: isSiteAdmin }] = await Promise.all([
      caller.rpc('is_boe_manager'),
      caller.rpc('is_site_admin')
    ]);
    if (isManager !== true && isSiteAdmin !== true) {
      return jsonResponse({ success: false, error: 'Not authorized' }, 403);
    }

    // BOE_SOLD_WEBHOOK_URL first, so the sold post can be moved to its own
    // channel by adding one dashboard secret rather than by a code change.
    // With none set it lands in the found channel; with nothing set at all it
    // no-ops, the way the found function does.
    const webhookUrl =
      Deno.env.get('BOE_SOLD_WEBHOOK_URL') || Deno.env.get('BOE_WEBHOOK_URL') || Deno.env.get('BOE-Found-Webhook');
    if (!webhookUrl) {
      return jsonResponse({ success: true, skipped: true });
    }

    // Service role from here on, for the manager list below: boe_managers
    // has no authenticated grant at all, so a manager holding only the grant
    // would read an empty list and the closing line would name nobody. The
    // finder used to need it too, for the same shape of reason; that walk now
    // happens inside resolve_boe_finder_discord_id, which is security definer
    // and does it on the caller's behalf (#918).
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: row, error: rowError } = await db
      .from('boe_items')
      .select(
        'id, team_id, finder_name, item_name, track, upgrade_rank, status, sale_price, ah_fee, guild_cut, finder_payout, payout_donated'
      )
      .eq('id', Number(id))
      .maybeSingle();
    if (rowError) {
      console.error('boe-sold-webhook row read failed:', rowError.message);
      return jsonResponse({ success: false, error: 'Could not read the find' }, 500);
    }
    if (!row) {
      return jsonResponse({ success: false, error: 'No such find' }, 404);
    }
    // Only a sold row is news. A replay after Undo Sale, or an id that has
    // since been paid or retired, posts nothing rather than announcing a sale
    // that is no longer standing.
    if (row.status !== 'sold') {
      return jsonResponse({ success: true, skipped: true, reason: 'not sold' });
    }

    // The finder's Discord id, in one call (#918): the id stamped on the row
    // at submit when they were signed in (#889), else their claimed
    // character's member row, else a guild-wide name match, which is what
    // reaches somebody who reported a find while raiding with another team.
    // Null when nothing matches or when one name reaches two different
    // people, and the finder's name renders in bold with no ping instead, the
    // way the found post renders one.
    //
    // On the caller's client rather than the service-role one, so the
    // function's own gate does real work. It is security definer, which is
    // also what lets a BoE manager holding no officer role anywhere read the
    // rows behind it: team_members' self-read returns only their own.
    const { data: resolvedFinderId } = await caller.rpc('resolve_boe_finder_discord_id', {
      p_boe_id: Number(id)
    });
    const finderId: string | null = resolvedFinderId || null;

    // The BoE manager is a mention of whoever currently holds the grant, so
    // a finder can click through to them rather than go looking for who that
    // is this season. The list is read at post time, so it follows the grant
    // without anyone editing this file. Raid leaders stay prose: that is a
    // role a finder already knows how to find, and naming the officers of
    // every team would put five names in one sentence.
    //
    // Reading boe_managers needs the service role: the table has no
    // `authenticated` grant and its select policy admits officers and site
    // admins, so a manager holding only the grant would read an empty list.
    // A grant that is not yet active still carries a discord_id, so the
    // mention works before that person has ever signed in.
    const { data: managers } = await db.from('boe_managers').select('discord_id').not('discord_id', 'is', null);
    const managerText =
      managers && managers.length
        ? joinNames(managers.map((m: { discord_id: string }) => '<@' + m.discord_id + '>'))
        : 'a BoE manager';

    // The Item line, in the found post's own format: the track, then the
    // name, then the rank. Identical items can be open at once, so this is
    // what tells a finder with two open finds which one sold. The track used
    // to sit in an escaped angle bracket, which reproduced the retired relay
    // bot's output byte for byte and stopped being a reason once the bot was
    // retired (#918).
    const trackChunk = row.track ? String(row.track) + ' - ' : '';
    const rankChunk = row.upgrade_rank ? ' ' + String(row.upgrade_rank) : '';
    const itemLine = 'Item: ' + trackChunk + String(row.item_name || 'Unknown item') + rankChunk;

    const finderText = finderId ? '<@' + finderId + '>' : '**' + String(row.finder_name || 'Unknown finder') + '**';

    // Four money lines that add up. The fee is the game's cut off the top
    // (#861) and the guild cut below it is already net of it, so leaving the
    // fee out would read as the guild taking the difference.
    const moneyLines = [
      itemLine,
      'Sale Price: ' + gold(row.sale_price),
      'Auction House Fee: ' + gold(row.ah_fee),
      'Guild Cut: ' + gold(row.guild_cut),
      "Finder's Fee: " + gold(row.finder_payout)
    ];

    // A finder who ticked the donate box (#862) has nothing to collect, so
    // the closing line thanks them instead of sending them to find someone.
    // The money lines still stand: what their cut would have been is the size
    // of what they gave.
    const closing = row.payout_donated
      ? "Thanks for donating your finder's fee to the guild bank."
      : 'Please get in touch with your raid leaders or ' + managerText + ' ' + PAYOUT_WINDOW + ' to receive your gold.';

    const content = finderText + ' -- BOE Sold!\n\n' + moneyLines.join('\n') + '\n\n' + closing;

    // Only the finder is notified. The manager mention renders as a
    // clickable name but sends no notification, because allowed_mentions
    // lists the finder alone: with one manager today, listing them would mean
    // a ping on every sale for the rest of the season.
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // One name across the found and sold posts (#918). Without it Discord
        // shows whatever the webhook is called in the channel's integration
        // settings, which a rename there would silently change.
        username: 'BoE Sales',
        content: content.length > 2000 ? content.slice(0, 1997) + '...' : content,
        allowed_mentions: finderId ? { users: [finderId] } : { parse: [] }
      })
    });

    if (!response.ok) {
      console.error('Discord webhook error: ' + response.status + ' - ' + (await response.text()));
      return jsonResponse({ success: false, error: 'Discord responded with ' + response.status });
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error('boe-sold-webhook error:', err);
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});
