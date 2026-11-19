-- The 70 MB allowance, held by a trigger on the row Storage keeps.
--
-- ---------------------------------------------------------------------------
-- WHY A TRIGGER
-- ---------------------------------------------------------------------------
-- The insert policy "media bucket: insert own" checks the allowance once, in a
-- permission check Storage runs and rolls back before it reads the body. Two
-- ways round it, both measured on storage-api v1.77.5 (2026-10-03):
--
--   * Parallel uploads. Each is measured against the same stored total,
--     because nothing is written until an upload completes, so each can take
--     the folder past 70 MB by a file.
--   * Signed upload links. The policy runs when the link is made, and sees the
--     link request's own size (2 bytes) and type (application/json), never the
--     file's. The upload itself runs as Storage's superuser, with no policy.
--     A link made with 1,000 bytes left carried 20 MB; three such links left
--     the allowance at -60 MB.
--
-- Every way of uploading (a raw body, a form, a signed link, TUS, signed or
-- not) ends in completeUpload, which writes the kept row as Storage's
-- superuser, after the bytes are stored, with the stored file's real `size` in
-- `metadata` and the owner set. A BEFORE trigger sees that row. When it raises,
-- Storage answers 403 AccessDenied with this function's message and deletes the
-- bytes it stored (seen locally for all five ways; TUS also leaves its own
-- ~300-byte upload record, as it does after a success).
--
-- ---------------------------------------------------------------------------
-- WHAT IT CHECKS
-- ---------------------------------------------------------------------------
-- Only rows in the media bucket that carry `size`. Storage's permission-check
-- rows carry `{mimetype, contentLength}` and are rolled back anyway; the policy
-- still checks those, unchanged, as a second layer. On UPDATE, only when `size`
-- changes.
--
-- The sum is taken under an advisory lock for the folder, held until the
-- writing transaction ends, and Storage writes at READ COMMITTED: the next
-- writer to the same folder waits, and its sum, a new statement, sees the row
-- the first one committed. Without the lock, five parallel 1 MB uploads with
-- 1.5 MB left went over in 7 runs of 10; with it, 15 of 15 were exact.
--
-- Folders share 256 locks, by a hash of the folder: a folder always takes the
-- same one, which is all exactness needs. One lock per folder was tried first,
-- and an INSERT of 20,000 rows into 20,000 folders in one transaction (the
-- seeds in tests/rls/usage.test.ts) ran out of shared memory, since an xact
-- lock is held to the end and the lock table holds max_locks_per_transaction
-- (64) times max_connections. Storage writes one row per transaction, so no
-- upload ever came near that; a bulk backfill would have. Two people share a
-- lock one time in 256, and then wait only for the other's commit. The
-- two-integer form is a key space of its own, apart from remove_unused_media's
-- single-key lock.
--
-- The folder is a range, not LIKE, so the sum can be an index scan; see
-- 20260923120000_media_usage. The row being written is left out of the sum: on
-- an upsert it replaces the row of the same name.
--
-- `enable_seqscan = off` for this function alone, because the range is not
-- enough. PL/pgSQL keeps its plan for the connection, and Storage's
-- connections are long-lived; planned while the table's statistics say it is
-- small (it had never been analysed locally, and hosted holds a handful of
-- files), the sum is a sequential scan, and stays one. Measured: one
-- sequential scan per inserted row, and an INSERT of 20,000 rows taking 100 s,
-- quadratic; with the setting, 0 scans and 4.3 s. idx_objects_bucket_id_name
-- covers (bucket_id, name COLLATE "C"), so there is always an index to use.
--
-- And `plan_cache_mode = force_custom_plan`, because that was not enough
-- either: on a table just made by `supabase db reset` (relpages 0) the cached
-- generic plan chose idx_objects_bucket_id_name_lower with `bucket_id` alone
-- as its condition, reading every media row per insert: no sequential scan,
-- and still quadratic (the same 20,000 rows, 75 to 122 s). Planned for each
-- call, with the folder as a value, the range is an index condition on
-- idx_objects_bucket_id_name: 2.7 s on that fresh table. The planning costs a
-- fraction of a millisecond, once per stored file.
--
-- SECURITY DEFINER, so the sum sees the whole folder whatever the writer's
-- select policy shows. Never called directly: no client holds EXECUTE, and a
-- trigger does not need the writer to.
--
-- 73400320 is ALLOWANCE_BYTES in src/lib/media/limits.ts, the same figure
-- media_allowance_remaining() subtracts from; tests/rls/allowance.test.ts
-- fails if they part.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS CHANGES FOR EXISTING USERS
-- ---------------------------------------------------------------------------
-- Nothing for an upload within the allowance, on `main` or `dev`. No folder on
-- hosted was over 70 MB, and no media row lacked `size`, on 2026-10-03.

DROP TRIGGER IF EXISTS trg_media_allowance_insert ON storage.objects;
DROP TRIGGER IF EXISTS trg_media_allowance_update ON storage.objects;
DROP FUNCTION IF EXISTS public.fn_media_allowance_enforce();

CREATE FUNCTION public.fn_media_allowance_enforce()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  SET enable_seqscan = off
  SET plan_cache_mode = force_custom_plan
AS $function$
DECLARE
  folder text := pg_catalog.split_part(NEW.name, '/', 1);
  incoming bigint := (NEW.metadata->>'size')::bigint;
  used bigint;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('nw_media_allowance'),
    pg_catalog.hashtext(folder) & 255
  );

  SELECT coalesce(pg_catalog.sum((o.metadata->>'size')::bigint), 0)
  INTO used
  FROM storage.objects o
  WHERE o.bucket_id = 'media'
    AND o.name COLLATE "C" >= folder || '/'
    AND o.name COLLATE "C" < folder || '0'
    AND o.name <> NEW.name
    AND o.id IS DISTINCT FROM NEW.id;

  IF used + incoming > 73400320 THEN
    RAISE EXCEPTION 'This file would take the folder past the media allowance'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_media_allowance_enforce() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.fn_media_allowance_enforce() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_media_allowance_insert
  BEFORE INSERT ON storage.objects
  FOR EACH ROW
  WHEN (NEW.bucket_id = 'media' AND NEW.metadata ? 'size')
  EXECUTE FUNCTION public.fn_media_allowance_enforce();

CREATE TRIGGER trg_media_allowance_update
  BEFORE UPDATE ON storage.objects
  FOR EACH ROW
  WHEN (
    NEW.bucket_id = 'media'
    AND NEW.metadata ? 'size'
    AND (NEW.metadata->'size') IS DISTINCT FROM (OLD.metadata->'size')
  )
  EXECUTE FUNCTION public.fn_media_allowance_enforce();
