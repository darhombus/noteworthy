-- Private media: the bucket, who may read and write it, and how much.
--
-- Entries will hold storage paths, and pages will resolve them to signed URLs
-- on the server. This migration is the storage half of that: it closes the
-- bucket, confines reading to the owner, sets the per-file and per-account
-- limits, and takes the client's grants off the `media` table, which nothing
-- writes.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS CHANGES FOR EXISTING USERS
-- ---------------------------------------------------------------------------
-- `main` and `dev` share one database, so this reaches production on `db push`.
-- When it was written the hosted bucket held no objects, no profile had an
-- avatar_url, the `media` table had no rows, and nothing on `main` read or wrote
-- the bucket or the table. Each change, and who it reaches:
--
--   1. The bucket is private. A /storage/v1/object/public/media/... URL stops
--      working. None has ever been produced.
--   2. Only a file's owner can read it or its metadata. Before this, the select
--      policy named no role and checked only the bucket, so anyone — signed out
--      included — could list every folder and download every file.
--   3. The per-file limit drops from 30 MB to 25 MB, and four audio types are
--      accepted: audio/webm, audio/mpeg, audio/mp4, audio/ogg.
--   4. An upload must be named `<own user id>/<uuid>.<extension>` and must fit
--      in what is left of the 70 MB allowance. Before, any name inside one's own
--      folder was accepted, at any total.
--   5. anon and authenticated lose every privilege on `public.media`, which the
--      app neither reads nor writes.
--   6. `public.media_allowance_remaining()` is new, callable by authenticated.
--
-- Unchanged: the delete policy (own folder only), and the absence of an UPDATE
-- policy, which is what refuses an overwrite (`upsert`) and a move.
--
-- ---------------------------------------------------------------------------
-- WHAT STORAGE SHOWS A POLICY
-- ---------------------------------------------------------------------------
-- Established against storage-api v1.73.1, the version both the hosted project
-- and the linked local stack run:
--
--   * The INSERT policy is evaluated once per upload, in a permission check
--     Storage runs before it accepts the body and then rolls back. The row that
--     is finally written after the upload is not checked against RLS.
--   * At that check, `metadata` is {"mimetype": ..., "contentLength": N}.
--     contentLength is the request's Content-Length: exactly the file for a raw
--     body, the whole form (a few hundred bytes more) for multipart. A resumable
--     (TUS) upload shows Upload-Length, and a server-side copy shows the source
--     object's size. The file's final `size` is not there yet.
--   * The bucket's own limit is enforced by Storage while it reads the body, so
--     a declared length cannot be used to sneak a larger file past it.
--
-- So the allowance check below is exact for a single upload: it compares the
-- incoming length with what is left. Where no length is shown it falls back to
-- "something must be left", which is the bound the PRD accepts — at most one
-- file over. What it cannot see is another upload in flight: two uploads started
-- together each compare against the same stored total, so parallel uploads can
-- overshoot by one file each. Storage writes nothing a policy could read until
-- an upload completes, so no policy can close that.

-- ---------------------------------------------------------------------------
-- 1. The bucket
-- ---------------------------------------------------------------------------
-- 25 MB is 26214400 bytes, in the same binary megabytes as the 30 MB this
-- replaces (31457280). The type list is exact: Storage compares the type and
-- subtype literally, so an alias (audio/x-m4a, audio/mp3) or a parameter on a
-- raw upload's Content-Type (audio/webm;codecs=opus) is refused. The client
-- normalises before uploading; see docs/constraints.md.

DO $$
BEGIN
  UPDATE storage.buckets
  SET public = false,
      file_size_limit = 26214400,
      allowed_mime_types = ARRAY[
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'video/mp4',
        'video/webm',
        'video/quicktime',
        'audio/webm',
        'audio/mpeg',
        'audio/mp4',
        'audio/ogg'
      ]
  WHERE id = 'media';

  -- An UPDATE that matched nothing would leave a public bucket and report
  -- success.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'storage bucket "media" does not exist';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. The allowance
-- ---------------------------------------------------------------------------
-- 70 MB (73400320 bytes) per account, summed over every object in the caller's
-- folder: files an entry shows, files removed from an entry, and files of
-- deleted entries waiting to be cleared. Counting only referenced files would
-- let someone delete and re-upload their way round it.
--
-- SECURITY INVOKER: it runs as the caller, under the caller's own RLS, and
-- needs nothing more. Called from the insert policy it runs inside Storage's
-- permission check, as `authenticated` with the uploader's claims, so it reads
-- storage.objects through the select policy below. That policy shows exactly
-- the caller's folder, which is exactly what the WHERE clause asks for, so the
-- two select the same rows and the sum is complete. SECURITY DEFINER was tried
-- and changed nothing a test could see; all it added was running as `postgres`,
-- with BYPASSRLS. As invoker, RLS is a second layer under the WHERE clause: a
-- mistake in the filter still cannot count, or reveal, another person's files.
--
-- THE ONE THING TO WATCH: the sum is only as complete as the select policy.
-- Narrow that policy — a locked vault hiding some of a person's files from
-- their own session, say — and the hidden files stop counting, and the
-- allowance leaks. Whoever narrows it makes this SECURITY DEFINER (owner
-- `postgres`) in the same change.
--
-- The caller comes from auth.uid() and nowhere else: the function takes no
-- argument, so it cannot be asked about anybody else's folder. search_path is
-- empty and every name is qualified. Returns what is left, which can be
-- negative after parallel uploads overshoot (see above), and NULL for a caller
-- with no identity. The UI reads it for "you have 12 MB left".

CREATE FUNCTION public.media_allowance_remaining()
  RETURNS bigint
  LANGUAGE plpgsql
  STABLE
  SECURITY INVOKER
  SET search_path = ''
AS $function$
DECLARE
  caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RETURN NULL;
  END IF;

  -- The prefix match reaches the same objects as storage.foldername(name)[1] =
  -- the caller, since a uuid holds no LIKE wildcard, and it can use the
  -- text_pattern_ops index Storage keeps on `name`.
  RETURN 73400320 - (
    SELECT coalesce(sum((o.metadata->>'size')::bigint), 0)
    FROM storage.objects o
    WHERE o.bucket_id = 'media'
      AND o.name LIKE caller::text || '/%'
  );
END;
$function$;

ALTER FUNCTION public.media_allowance_remaining() OWNER TO postgres;

-- Default privileges already withhold EXECUTE from anon and authenticated; this
-- states it rather than relying on it, and names PUBLIC as well.
REVOKE EXECUTE ON FUNCTION public.media_allowance_remaining() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_allowance_remaining() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Reading: the owner only
-- ---------------------------------------------------------------------------
-- The server signs URLs with the person's own session, not a service key, so
-- this policy is what decides which paths can be signed — and what
-- media_allowance_remaining() can sum, since it runs as the caller. It is also
-- what the owner's browser meets if it asks Storage directly, and that is
-- allowed: it is their own file. Everybody else — anon, or another account — sees no row, so
-- a guessed path, a list of someone's folder and a request to sign their file
-- all come back empty.

DROP POLICY "media bucket: select" ON storage.objects;

CREATE POLICY "media bucket: select own"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- 4. Writing: own folder, one shape, within the allowance
-- ---------------------------------------------------------------------------
-- The shape is <user id>/<uuid>.<extension>, lower case, one level deep. The
-- entry sanitiser refuses any media path not in that shape; refusing it here
-- too means no object outside it can exist to be referred to. The extensions
-- are the ones the accepted types map to (src/lib/media/types.ts). Whether the
-- extension agrees with the type is not checked: the stored type is what the
-- file is served as, and the node, not the extension, decides how it renders.
--
-- contentLength is Storage's, not the client's; a client's own metadata lands
-- in `user_metadata`. A missing length counts as one byte, so it still needs
-- something to be left.

DROP POLICY "media bucket: insert own" ON storage.objects;

CREATE POLICY "media bucket: insert own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|gif|webp|mp4|webm|mov|mp3|m4a|ogg)$'
    AND coalesce((metadata->>'contentLength')::bigint, 1) <= (SELECT public.media_allowance_remaining())
  );

-- ---------------------------------------------------------------------------
-- 5. The `media` table: no client privileges
-- ---------------------------------------------------------------------------
-- Entries record their media as paths inside the document, and Storage records
-- each file — owner (the folder), size, type, upload time — in storage.objects.
-- A second record here would be one more thing to keep in step with both, and
-- `entry_id NOT NULL` could not even hold a file uploaded before its entry
-- exists. So the app does not use this table, and clients get nothing on it.
--
-- The table, its RLS and its policies stay: `purge-deleted` names it, and
-- dropping it is a decision for the section that replaces that job. With no
-- grant, the policies are unreachable from the API; they remain as the second
-- layer should a grant ever come back.
--
-- ALL, because the baseline also granted MAINTAIN, which information_schema
-- does not list. service_role keeps ALL.

REVOKE ALL ON public.media FROM anon, authenticated;
