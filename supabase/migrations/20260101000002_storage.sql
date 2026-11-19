-- Storage: the `media` bucket and its three policies.
--
-- Neither buckets nor storage policies are carried by `supabase db dump`.
-- Rescued from the old project by reading storage.buckets and pg_policies.
--
-- Run this after the baseline migration. The cron purge job references
-- bucket_id = 'media', so the bucket must exist before that job first fires.

-- ---------------------------------------------------------------------------
-- The bucket
-- ---------------------------------------------------------------------------
-- public = true means any file is fetchable by URL without authentication.
-- See the note at the bottom before deciding to keep that.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media',
  'media',
  true,
  31457280,  -- 30 MB
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
-- Ownership is by folder: files are stored as <user_id>/<filename>, and
-- storage.foldername(name)[1] is that first path segment. Insert and delete
-- both require it to match the caller's uid, so a user can only write into and
-- delete from their own folder.
--
-- Any upload path in the app must therefore prefix the object name with the
-- user's id, or the insert is rejected with no obvious reason why.

CREATE POLICY "media bucket: select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'media');

CREATE POLICY "media bucket: insert own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'media'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

CREATE POLICY "media bucket: delete own"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'media'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- Two things worth deciding rather than inheriting
-- ---------------------------------------------------------------------------
-- 1. The bucket is public. Anyone holding a URL can fetch the file without
--    authenticating, and the select policy says the same at the policy layer:
--    it checks only the bucket, not the owner. For an app with a vault, that
--    means an image attached to a hidden entry is reachable by URL no matter
--    what RLS does to the entry row. The alternative is a private bucket with
--    signed URLs — more work in the app, and the only version where hidden
--    content is actually hidden.
--
-- 2. There is no UPDATE policy. Uploads must therefore be insert-then-delete
--    rather than overwrite; supabase-js `upsert: true` will fail silently in
--    the sense of being refused with no matching policy.
--
-- 3. No avatars bucket exists. profiles.avatar_url either points into `media`,
--    at an external URL, or at a feature that was never finished. Decide when
--    you build profile editing.
