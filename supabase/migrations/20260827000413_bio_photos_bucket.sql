-- Officer bio photo self-upload (#625): the first Supabase Storage bucket
-- in this project. Officer bio `imagePath` has always been a hand-typed
-- URL/path string (js/tabs/tab-bios.js) -- an officer who wanted a photo
-- had to send it to Kat out of band for her to commit into assets/officers/
-- and hand back the path. This bucket is where self-serve uploads land.
--
-- No client ever writes to this bucket directly: the upload-bio-photo Edge
-- Function does the auth check, resize/compression, and the write using the
-- service-role key (which bypasses Storage RLS). So this migration adds no
-- storage.objects grants at all -- Storage RLS is on by default with no
-- per-client rule, which already denies every client-side INSERT/UPDATE/
-- DELETE, exactly the posture we want. `public = true` serves reads through
-- the bucket's public URL without needing a read rule either.
--
-- file_size_limit/allowed_mime_types here are defense-in-depth only -- the
-- real 5MB/type enforcement lives in the Edge Function, which also resizes
-- to a max 800px edge and re-encodes down to a 300KB cap before writing.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bio-photos', 'bio-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- The upload-bio-photo Edge Function needs to know "is this caller a team
-- leader on some team" without a specific team_id to check against (unlike
-- my_team_role(p_team_id), which needs one) -- a moderator removing an
-- inappropriate photo may not be a leader of the team whose bio list it's
-- attached to. Mirrors is_guild_officer()'s exact shape
-- (20260730113259_guild_officer_tier.sql).
create or replace function public.is_team_leader_anywhere() returns boolean
    language sql stable security definer set search_path to 'public'
    as $$ select exists (select 1 from team_members where auth_user_id = auth.uid() and role = 'team_leader'); $$;

revoke all on function public.is_team_leader_anywhere() from public;
grant execute on function public.is_team_leader_anywhere() to anon, authenticated;
