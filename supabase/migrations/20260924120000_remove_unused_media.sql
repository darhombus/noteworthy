-- Removing files no entry uses: a nightly job, through the Storage API.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS CHANGES FOR EXISTING USERS
-- ---------------------------------------------------------------------------
-- `main` and `dev` share one database, so this reaches production on `db push`.
-- When it was written `main` and `dev` were the same commit, and the bucket
-- held 11 objects, 5 of them named by no entry.
--
--   1. A file in the `media` bucket that no entry names — live, hidden or
--      soft-deleted, in any journal — is removed from Storage, row and bytes,
--      once it has been unused for 24 hours. The job is `remove-unused-media`,
--      04:00 UTC nightly. Until the two Vault secrets it reads exist (part 4),
--      every run fails, loudly, and removes nothing.
--   2. Every entry row counts, soft-deleted ones too, so a deleted entry's
--      files stay restorable until `purge-deleted` removes the entry after 30
--      days. They are removed 24 hours after that.
--   3. Taking a media node out of an entry, or removing an entry row, records
--      the time in `public.media_released`, a table clients cannot reach. It is
--      how "unused for 24 hours" is known for a file uploaded long before.
--      Entries whose previous body held no media path never reach the trigger
--      (its WHEN clause), so text-only saves — every save `main` makes — cost
--      one jsonpath test and nothing else.
--   4. The `http` extension is installed, in a schema of its own that no
--      client role can use (part 4).
--
-- Nothing existing is altered or removed: `purge-deleted` and `public.media`
-- are untouched. Dropping `media` is held back in
-- supabase/held/drop_media_table.sql until this job has run cleanly on hosted.
-- So this can be undone by dropping what it creates:
--
--   SELECT cron.unschedule('remove-unused-media');
--   DROP TRIGGER trg_entries_release_media_update ON public.entries;
--   DROP TRIGGER trg_entries_release_media_delete ON public.entries;
--   DROP FUNCTION public.remove_unused_media(), public.unused_media(),
--                 public.fn_entries_release_media();
--   DROP TABLE public.media_released;
--   DROP EXTENSION http; DROP SCHEMA media_cleanup;
--
-- plus deleting the two Vault secrets. Files it has already removed stay
-- removed; by construction they were ones no entry named for a day.
--
-- Files already unused when this is pushed are recorded as released now, not
-- at their upload (part 2 of the body), so the first run cannot remove a file
-- that someone took out of an entry an hour before the push.
--
-- ---------------------------------------------------------------------------
-- HOW A FILE IS REMOVED
-- ---------------------------------------------------------------------------
-- Through the Storage API and nothing else. A DELETE on storage.objects is
-- refused by storage.protect_delete(); with `storage.allow_delete_query` set it
-- removes the row and leaves the bytes where nothing can find them.
--
-- The job calls Storage's bulk delete, `DELETE /storage/v1/object/media` with
-- `{"prefixes": [names]}`, the request supabase-js's `remove()` makes, from
-- inside the database with the synchronous `http` extension. Established
-- against storage-api v1.73.1 on the local stack, from the database container
-- through the gateway:
--
--   * With the project's secret key (`sb_secret_…`) in the `apikey` header it
--     answers 200 and a JSON array of the objects it removed. The row is gone
--     and so are the bytes (the local file backend's folder disappears).
--   * A name that does not exist, or was removed already, is left out of the
--     array — no error. So a second run, or two runs at once, are harmless.
--   * With the publishable key it also answers 200, with `[]`, and removes
--     nothing. A misconfigured key would look like success, so the job counts
--     what came back instead of trusting the status.
--
-- `http` rather than `pg_net`: pg_net queues the request and sends it after the
-- transaction commits, so the job could not see what Storage answered, a run
-- would report success whatever happened, and a test would have to poll. `http`
-- answers inside the call. Both are on hosted's list of available extensions
-- (1.6 and 0.20.4); neither was installed.
--
-- ---------------------------------------------------------------------------
-- THE KEY
-- ---------------------------------------------------------------------------
-- The URL and key come from Vault (`vault.decrypted_secrets`), the way
-- Supabase's own guide to calling the API from pg_cron does it, because a
-- migration is committed and a secret key must not be:
--
--   media_cleanup_api_url     https://<project ref>.supabase.co on hosted;
--                             http://supabase_kong_<project id>:8000 locally,
--                             the gateway as seen from the database container
--   media_cleanup_secret_key  a secret key (sb_secret_…) from the dashboard
--
-- A secret key is the service role, whole: Supabase offers no narrower secret
-- key. Who can read it, checked on hosted and local alike: `postgres` and
-- `service_role`, the only roles with USAGE on `vault` — and anything that can
-- act as either already bypasses RLS on every table. anon and authenticated
-- cannot use the schema, and PostgREST exposes only `public` and
-- `graphql_public`. The key is a variable inside remove_unused_media() and is
-- never written into a message: the job's cron command is the bare call,
-- errors quote Storage's answer and the URL's failure, and none of them, nor
-- the database's log, contained it when a wrong path and an unresolvable host
-- were forced locally with the real key stored, or on a run that succeeded.
-- Not checked: whether Supabase's API-gateway logs keep the request's `apikey`.
-- docs/constraints.md ("Cleaning up unused files") says how to check after the
-- first run, and how to rotate the key.
--
-- ---------------------------------------------------------------------------
-- WHY IT IS SAFE TO RUN WHILE SOMEONE IS EDITING
-- ---------------------------------------------------------------------------
--   * An upload for an entry not yet saved is younger than 24 hours: kept.
--   * A node taken out of an entry, which undo may put back, was released less
--     than 24 hours ago: kept. The release is written in the same transaction
--     as the save that took the node out, so there is no moment when the entry
--     no longer names the file and the release is not yet recorded.
--   * What is left is a file unused for over 24 hours that someone names again
--     in the moment between the job choosing it and Storage removing it — an
--     undo in a tab open for more than a day, say. The job chooses each batch
--     immediately before sending it, which keeps that moment to one request.
--     No lock closes it: Storage removes in its own transaction.

-- ---------------------------------------------------------------------------
-- 1. When a file was last taken out of an entry
-- ---------------------------------------------------------------------------
-- One row per path, holding the latest time any entry stopped naming it. Rows
-- older than 24 hours protect nothing, and the job deletes them. A row is not
-- evidence the file is unused — another entry may still name it; the job asks
-- the entries for that.
--
-- No client privileges and no policies. Only the trigger below (SECURITY
-- DEFINER) and the job (run as `postgres`) touch it. RLS forced, like every
-- other table here, so a grant added by mistake still reaches no row.

CREATE TABLE public.media_released (
  path text PRIMARY KEY,
  released_at timestamptz NOT NULL
);

COMMENT ON TABLE public.media_released IS
  'When each storage path was last removed from an entry. Read by '
  'remove_unused_media(): a file released less than 24 hours ago is kept, so '
  'undo can bring it back. Written only by fn_entries_release_media().';

ALTER TABLE public.media_released ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_released FORCE ROW LEVEL SECURITY;

-- Default privileges give anon and authenticated everything on a new table in
-- public; take it back. service_role keeps it, as on every other table.
REVOKE ALL ON public.media_released FROM anon, authenticated;

-- The paths an entry stopped naming, stamped now. On UPDATE, what the old body
-- named and the new one does not; on DELETE (a purge, a journal purge's
-- cascade, an account's deletion), everything the old body named. EXCEPT also
-- removes a path named twice, which ON CONFLICT would otherwise meet twice in
-- one statement and refuse.
--
-- SECURITY DEFINER because the person saving holds nothing on the table. It
-- takes nothing from the caller but the row being written, and search_path is
-- pinned with every name qualified.

CREATE FUNCTION public.fn_entries_release_media()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.media_released (path, released_at)
  SELECT gone.path, now()
  FROM (
    SELECT p FROM public.entry_media_paths(OLD.content) AS p
    EXCEPT
    SELECT p FROM public.entry_media_paths(
      CASE WHEN TG_OP = 'UPDATE' THEN NEW.content END
    ) AS p
  ) AS gone(path)
  WHERE gone.path IS NOT NULL
  ON CONFLICT (path) DO UPDATE SET released_at = excluded.released_at;

  RETURN NULL;
END;
$function$;

ALTER FUNCTION public.fn_entries_release_media() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.fn_entries_release_media() FROM PUBLIC, anon, authenticated;

-- The WHEN clauses keep the function from running at all for a body that held
-- no media path, which is nearly every save. The test is the one
-- entry_media_paths() asks first.

CREATE TRIGGER trg_entries_release_media_update
  AFTER UPDATE OF content ON public.entries
  FOR EACH ROW
  WHEN (
    OLD.content @? 'strict $.**.attrs.path'
    AND OLD.content IS DISTINCT FROM NEW.content
  )
  EXECUTE FUNCTION public.fn_entries_release_media();

CREATE TRIGGER trg_entries_release_media_delete
  AFTER DELETE ON public.entries
  FOR EACH ROW
  WHEN (OLD.content @? 'strict $.**.attrs.path')
  EXECUTE FUNCTION public.fn_entries_release_media();

-- ---------------------------------------------------------------------------
-- 2. Files already unused
-- ---------------------------------------------------------------------------
-- Nothing recorded releases before this, so a file taken out of an entry an
-- hour ago would otherwise be judged by its upload time. Every file no entry
-- names is stamped now instead; the first run that can remove one is the one
-- more than 24 hours after the push.

INSERT INTO public.media_released (path, released_at)
SELECT o.name, now()
FROM storage.objects o
WHERE o.bucket_id = 'media'
  AND o.name NOT IN (
    SELECT p.path
    FROM public.entries e
    CROSS JOIN LATERAL public.entry_media_paths(e.content) AS p(path)
    WHERE p.path IS NOT NULL
  );

-- ---------------------------------------------------------------------------
-- 3. Which files are unused
-- ---------------------------------------------------------------------------
-- Every account's files, as `postgres` (BYPASSRLS, hosted and local alike), that
--
--   * were uploaded more than 24 hours ago,
--   * were not taken out of an entry in the last 24 hours, and
--   * no entry row names — live, hidden, soft-deleted, or in a soft-deleted
--     journal. A soft-deleted entry stays restorable until the purge.
--
-- "Names" is entry_media_paths(), the one definition. Paths in another
-- person's folder cannot be saved (the sanitiser refuses them), and a stray one
-- written underneath would only keep a file longer, never remove one early.
--
-- `IN (subquery)`, hashed, for the reason media_usage() gives. Not callable by
-- clients: it lists every account's files.

CREATE FUNCTION public.unused_media()
  RETURNS SETOF text
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = ''
AS $function$
  SELECT o.name
  FROM storage.objects o
  WHERE o.bucket_id = 'media'
    AND o.created_at < now() - interval '24 hours'
    AND NOT EXISTS (
      SELECT 1
      FROM public.media_released r
      WHERE r.path = o.name
        AND r.released_at >= now() - interval '24 hours'
    )
    AND o.name NOT IN (
      SELECT p.path
      FROM public.entries e
      CROSS JOIN LATERAL public.entry_media_paths(e.content) AS p(path)
      WHERE p.path IS NOT NULL
    )
  ORDER BY o.name;
$function$;

ALTER FUNCTION public.unused_media() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.unused_media() FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Removing them
-- ---------------------------------------------------------------------------

-- `http` goes in a schema of its own. Supabase installs it as `supabase_admin`,
-- which grants EXECUTE on every one of its functions to PUBLIC, and only the
-- grantor can take that back: a REVOKE run here, as `postgres`, succeeds and
-- changes nothing (checked). In `extensions`, which anon and authenticated can
-- use, that would let any SQL running as either send requests from the
-- database. Here nobody but `postgres` has USAGE on the schema, so the PUBLIC
-- grant reaches nothing. No client runs SQL today (PostgREST exposes `public`
-- and `graphql_public` only); this keeps it so if that changes. supautils
-- forces a schema for pg_cron alone, on hosted as locally, so the schema named
-- here is the one used.

CREATE SCHEMA media_cleanup;
REVOKE ALL ON SCHEMA media_cleanup FROM PUBLIC;
CREATE EXTENSION http WITH SCHEMA media_cleanup;

-- Returns how many objects Storage says it removed.
--
-- One run at a time: a second, started while one is going, returns 0 at once.
-- Up to 1,000 names a request, Storage's limit for one bulk delete. Each batch
-- is chosen afresh just before it is sent, so an entry saved during a run is
-- seen, and names already sent are not chosen again, so a name Storage keeps
-- refusing cannot loop.
--
-- Fails — raising, so cron.job_run_details says `failed` — when the secrets are
-- missing or Storage answers anything but 200 and an array. Batches already
-- sent stay removed; what they removed was unused, and the next run carries on.
--
-- SECURITY INVOKER, run as `postgres` by the job; nobody else may execute it.

CREATE FUNCTION public.remove_unused_media()
  RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SECURITY INVOKER
  SET search_path = ''
AS $function$
DECLARE
  api text;
  api_key text;
  batch text[];
  sent text[] := '{}';
  response media_cleanup.http_response;
  answer jsonb;
  removed integer := 0;
BEGIN
  -- Any constant will do, as long as nothing else takes it. Nothing else here
  -- takes an advisory lock.
  IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('nw_media_cleanup')) THEN
    RAISE NOTICE 'remove_unused_media: another run is in progress';
    RETURN 0;
  END IF;

  SELECT s.decrypted_secret INTO api
  FROM vault.decrypted_secrets s WHERE s.name = 'media_cleanup_api_url';
  SELECT s.decrypted_secret INTO api_key
  FROM vault.decrypted_secrets s WHERE s.name = 'media_cleanup_secret_key';

  IF api IS NULL OR api_key IS NULL THEN
    RAISE EXCEPTION 'remove_unused_media: Vault secrets media_cleanup_api_url and media_cleanup_secret_key are required';
  END IF;

  -- Releases older than 24 hours no longer keep anything.
  DELETE FROM public.media_released WHERE released_at < now() - interval '24 hours';

  -- Removing up to a thousand files is slow on a slow day; the default is 5 s.
  PERFORM media_cleanup.http_set_curlopt('CURLOPT_TIMEOUT', '120');

  LOOP
    SELECT array_agg(u.name) INTO batch
    FROM (
      SELECT u.name FROM public.unused_media() AS u(name)
      WHERE u.name <> ALL (sent)
      LIMIT 1000
    ) AS u;

    EXIT WHEN batch IS NULL;
    sent := sent || batch;

    response := media_cleanup.http((
      'DELETE',
      pg_catalog.rtrim(api, '/') || '/storage/v1/object/media',
      ARRAY[media_cleanup.http_header('apikey', api_key)],
      'application/json',
      pg_catalog.jsonb_build_object('prefixes', pg_catalog.to_jsonb(batch))::text
    )::media_cleanup.http_request);

    IF response.status <> 200 THEN
      RAISE EXCEPTION 'remove_unused_media: Storage answered %: %',
        response.status, pg_catalog.left(response.content, 500);
    END IF;

    answer := response.content::jsonb;
    IF pg_catalog.jsonb_typeof(answer) <> 'array' THEN
      RAISE EXCEPTION 'remove_unused_media: Storage answered % without a list: %',
        response.status, pg_catalog.left(response.content, 500);
    END IF;

    removed := removed + pg_catalog.jsonb_array_length(answer);
  END LOOP;

  -- Asked to remove something and removed nothing: a key without the service
  -- role's rights gets exactly this answer. Somebody else's run removing the
  -- same files first would too, but runs do not overlap (the lock above).
  IF pg_catalog.cardinality(sent) > 0 AND removed = 0 THEN
    RAISE EXCEPTION 'remove_unused_media: Storage removed none of % unused files; is media_cleanup_secret_key a secret key?',
      pg_catalog.cardinality(sent);
  END IF;

  RETURN removed;
END;
$function$;

ALTER FUNCTION public.remove_unused_media() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.remove_unused_media() FROM PUBLIC, anon, authenticated, service_role;

-- 04:00, an hour after purge-deleted. A purge at 03:00 releases its entries'
-- files at 03:00; at 04:00 the next day they have been unused for 25 hours. At
-- 03:00 the two would race, and a file released a few milliseconds after the
-- next day's `now() - 24 hours` would wait another day.

SELECT cron.schedule(
  'remove-unused-media',
  '0 4 * * *',
  'SELECT public.remove_unused_media();'
);
