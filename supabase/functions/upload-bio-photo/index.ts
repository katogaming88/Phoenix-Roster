// upload-bio-photo (#625): lets an officer upload their own Officer Bios
// photo instead of sending it to Kat out of band for a manual commit into
// assets/officers/. The client never writes to Storage directly -- this
// function does the auth check, resize/compression, and the write, using
// the service-role key (which bypasses Storage RLS on the bio-photos
// bucket, see 20260827000413_bio_photos_bucket.sql). That keeps "self-only"
// enforcement in one place: an uploader can only ever land a file under
// their own auth.uid() folder.
//
// POST body is the raw image bytes (the frontend sends the File object
// directly, not multipart) with Content-Type set to its mime type.
// DELETE body is { targetPath } -- the "{auth_user_id}/{file}" path parsed
// out of a bio entry's stored imagePath URL -- for the moderation escape
// hatch: a team leader, site admin, or guild officer can remove someone
// else's photo (an inappropriate upload), even though they can never
// upload *as* someone else. The uploader can also always remove their own.
//
// Auth pattern (forward the caller's own JWT, resolve role RPCs through it)
// mirrors wcl-sync/index.ts's action dispatcher.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS'
};

const BUCKET = 'bio-photos';
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB raw upload cap
const MAX_STORED_BYTES = 300 * 1024; // 300KB stored-size cap after compression
const MAX_EDGE_PX = 800;
const QUALITY_STEPS = [80, 65, 50];
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

// Two clients, deliberately kept separate: `supabase` forwards the caller's
// own JWT so is_site_admin()/is_guild_officer()/is_team_leader_anywhere()
// resolve auth.uid() exactly as they would for a direct frontend call (same
// pattern as wcl-sync/index.ts). `storage` uses the service-role key and is
// the only thing allowed to touch the bucket -- Storage RLS on
// storage.objects has no per-client rule at all (20260827000413_bio_photos_
// bucket.sql), so the anon-key client would be denied regardless of the
// RPC checks above; the service-role client is what makes this function the
// sole write path.
async function resolveCaller(authHeader: string | null) {
  if (!authHeader) return null;
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } }
  });
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return null;
  const storage = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  return { uid: user.id, supabase, storage };
}

async function isModerator(supabase: ReturnType<typeof createClient>) {
  const [{ data: isSiteAdmin }, { data: isGuildOfficer }, { data: isTeamLeader }] = await Promise.all([
    supabase.rpc('is_site_admin'),
    supabase.rpc('is_guild_officer'),
    supabase.rpc('is_team_leader_anywhere')
  ]);
  return isSiteAdmin === true || isGuildOfficer === true || isTeamLeader === true;
}

async function handleUpload(
  req: Request,
  uid: string,
  supabase: ReturnType<typeof createClient>,
  storage: ReturnType<typeof createClient>
) {
  if (!(await isModerator(supabase))) {
    return jsonResponse({ success: false, error: 'Not authorized' }, 403);
  }

  const contentType = req.headers.get('Content-Type') || '';
  if (!ALLOWED_TYPES.includes(contentType)) {
    return jsonResponse({ success: false, error: 'Unsupported image type' }, 400);
  }

  const contentLength = Number(req.headers.get('Content-Length') || '0');
  if (contentLength > MAX_UPLOAD_BYTES) {
    return jsonResponse({ success: false, error: 'Image is larger than 5MB' }, 400);
  }

  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.byteLength > MAX_UPLOAD_BYTES) {
    return jsonResponse({ success: false, error: 'Image is larger than 5MB' }, 400);
  }

  let image: Image;
  try {
    image = await Image.decode(raw);
  } catch {
    return jsonResponse({ success: false, error: 'Could not read that image file' }, 400);
  }

  const longestEdge = Math.max(image.width, image.height);
  if (longestEdge > MAX_EDGE_PX) {
    if (image.width >= image.height) {
      image.resize(MAX_EDGE_PX, Image.RESIZE_AUTO);
    } else {
      image.resize(Image.RESIZE_AUTO, MAX_EDGE_PX);
    }
  }

  let encoded: Uint8Array | null = null;
  for (const quality of QUALITY_STEPS) {
    const candidate = await image.encodeJPEG(quality);
    if (candidate.byteLength <= MAX_STORED_BYTES) {
      encoded = candidate;
      break;
    }
    encoded = candidate; // keep the smallest attempt so far as a fallback
  }
  if (!encoded || encoded.byteLength > MAX_STORED_BYTES) {
    return jsonResponse(
      { success: false, error: 'Could not compress that image under 300KB -- try a smaller or simpler source image' },
      400
    );
  }

  // Bounds Storage growth to one file per uploader -- a re-upload replaces
  // rather than accumulates.
  const { data: existing } = await storage.storage.from(BUCKET).list(uid);
  if (existing && existing.length) {
    await storage.storage.from(BUCKET).remove(existing.map((f) => uid + '/' + f.name));
  }

  const path = uid + '/' + Date.now() + '.jpg';
  const { error: uploadError } = await storage.storage.from(BUCKET).upload(path, encoded, {
    contentType: 'image/jpeg',
    upsert: true
  });
  if (uploadError) {
    return jsonResponse({ success: false, error: uploadError.message }, 500);
  }

  const {
    data: { publicUrl }
  } = storage.storage.from(BUCKET).getPublicUrl(path);
  return jsonResponse({ success: true, url: publicUrl });
}

async function handleDelete(
  req: Request,
  uid: string,
  supabase: ReturnType<typeof createClient>,
  storage: ReturnType<typeof createClient>
) {
  const { targetPath } = await req.json();
  if (!targetPath || typeof targetPath !== 'string') {
    return jsonResponse({ success: false, error: 'Missing targetPath' }, 400);
  }

  const isOwnPhoto = targetPath.startsWith(uid + '/');
  if (!isOwnPhoto && !(await isModerator(supabase))) {
    return jsonResponse({ success: false, error: 'Not authorized' }, 403);
  }

  // Idempotent: clearing a legacy assets/officers/*.jpg imagePath (never in
  // Storage) is a no-op here, not an error -- the frontend still clears the
  // field either way.
  await storage.storage.from(BUCKET).remove([targetPath]);
  return jsonResponse({ success: true });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const caller = await resolveCaller(req.headers.get('Authorization'));
    if (!caller) {
      return jsonResponse({ success: false, error: 'Not signed in' }, 401);
    }

    if (req.method === 'POST') {
      return await handleUpload(req, caller.uid, caller.supabase, caller.storage);
    }
    if (req.method === 'DELETE') {
      return await handleDelete(req, caller.uid, caller.supabase, caller.storage);
    }
    return jsonResponse({ success: false, error: 'Unsupported method' }, 405);
  } catch (err) {
    console.error('upload-bio-photo error:', err);
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});
