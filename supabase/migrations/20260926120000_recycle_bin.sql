-- The Recycle Bin: restoring, deleting for good, emptying, and the files that
-- are waiting to be cleared.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS CHANGES FOR EXISTING USERS
-- ---------------------------------------------------------------------------
-- `main` and `dev` share one database, so this reaches production on `db push`.
-- When it was written `main` and `dev` were the same commit (733480a), and
-- nothing on either calls any function below.
--
--   1. anon and authenticated lose DELETE on `entries` and `journals`. Nothing
--      in the app issues one: deleting sets `deleted_at`, and the only hard
--      delete was the nightly purge, run as `postgres`. Until now a signed-in
--      client could hard-delete its own live rows over the API, skipping the
--      bin; permanent deletion now runs only in the functions below, which
--      take only rows already in the bin. The "delete own" policies stay, with
--      no grant to reach them, as the second layer should one come back.
--   2. New functions, each callable by authenticated alone:
--        restore_entry(entry), restore_journal(journal)
--        delete_entry_forever(entry), delete_journal_forever(journal)
--        empty_bin()
--        waiting_files(), is_waiting_file(file)
--        bin_items(), media_breakdown()
--      and two helpers no client may call.
--
-- Unchanged, deliberately: media_usage() (production's Storage page reads its
-- `waiting` column; media_breakdown() is the new one), the journal-delete
-- cascade and its trigger, every table's select policy, the storage policies
-- (the owner's own-folder DELETE policy from 20260101000002_storage already
-- lets the owner remove their files through the Storage API), and the client's
-- UPDATE grant on `deleted_at`, which is how the app soft-deletes.
--
-- Undone by dropping the functions and `GRANT DELETE ON public.entries,
-- public.journals TO anon, authenticated;`. Rows deleted for good stay deleted.
--
-- ---------------------------------------------------------------------------
-- WHAT THE BIN IS
-- ---------------------------------------------------------------------------
-- A journal is in the bin when its `deleted_at` is set. An entry is in the bin
-- when its `deleted_at` is set, as a row of its own unless it went down with a
-- journal that is still in the bin (`deleted_with_journal`), in which case it is
-- part of that journal's row. An entry deleted on its own keeps its own row and
-- its own 30 days even when its journal is deleted afterwards.
--
-- Rows first, then files. The functions that delete for good remove the rows
-- and return the paths the server should then ask Storage to remove, with the
-- person's own session. The entries' delete trigger
-- (trg_entries_release_media_delete) records every one of those paths in
-- `media_released` in the same transaction, so if the Storage step fails the
-- files are released and named by nothing: they show under Waiting to be
-- cleared, and remove-unused-media takes them within 2 days (at the first
-- 04:00 UTC run after they have been released for more than 24 hours).
--
-- "Waiting" here is narrower than in media_usage(): a file in the caller's
-- folder, with a release record, that none of the caller's entry rows names —
-- live, hidden or soft-deleted. A file with no release record and no entry is
-- an upload whose new entry has not saved yet; nothing here touches it.
--
-- "Names" is public.entry_media_paths(), the one definition, over the
-- caller's own entries. Not every account's: a path in somebody else's folder
-- cannot be saved (the sanitiser refuses it, and the insert policy refuses a
-- file outside the uploader's folder), and asking every entry in the database
-- would be a full scan of `entries` on every call. The nightly job, which asks
-- every entry, stays the backstop.

-- ---------------------------------------------------------------------------
-- 1. No client deletes rows for good
-- ---------------------------------------------------------------------------

REVOKE DELETE ON public.entries, public.journals FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Helpers: which paths nothing names, and which files are waiting
-- ---------------------------------------------------------------------------
-- They take an account's id, so no client may call them: every caller below
-- passes auth.uid().
--
-- Every parameter is written with the function's name in front. In a SQL
-- function a column of the same name wins over a parameter, silently, and
-- storage.objects has a column `owner` (the uploader). With the parameter
-- first called `owner`, fn_bin_waiting() compared each file with its own
-- uploader, and showed every account every real upload with a release record.
-- bin.test.ts caught it.

-- The candidates that are in `account`'s folder and that none of `account`'s
-- entry rows names, whatever its state. `IN (subquery)`, hashed, for the reason
-- media_usage() gives.
CREATE FUNCTION public.fn_bin_unnamed(account uuid, candidates text[])
  RETURNS SETOF text
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = ''
AS $function$
  SELECT DISTINCT c.path
  FROM pg_catalog.unnest(fn_bin_unnamed.candidates) AS c(path)
  WHERE c.path COLLATE "C" >= fn_bin_unnamed.account::text || '/'
    AND c.path COLLATE "C" < fn_bin_unnamed.account::text || '0'
    AND c.path NOT IN (
      SELECT p.path
      FROM public.entries e
      JOIN public.journals j ON j.journal_id = e.journal_id
      CROSS JOIN LATERAL public.entry_media_paths(e.content) AS p(path)
      WHERE j.user_id = fn_bin_unnamed.account
        AND p.path IS NOT NULL
    );
$function$;

ALTER FUNCTION public.fn_bin_unnamed(uuid, text[]) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.fn_bin_unnamed(uuid, text[]) FROM PUBLIC, anon, authenticated, service_role;

-- `account`'s waiting files. Read as the definer of whichever function calls it
-- (media_released has no client grant). The folder is a range on
-- idx_objects_bucket_id_name; see "Under RLS, `LIKE` cannot use an index".
CREATE FUNCTION public.fn_bin_waiting(account uuid)
  RETURNS TABLE (path text, type text, size bigint, released_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = ''
AS $function$
  SELECT o.name,
         o.metadata->>'mimetype',
         coalesce((o.metadata->>'size')::bigint, 0),
         r.released_at
  FROM storage.objects o
  JOIN public.media_released r ON r.path = o.name
  WHERE o.bucket_id = 'media'
    AND o.name COLLATE "C" >= fn_bin_waiting.account::text || '/'
    AND o.name COLLATE "C" < fn_bin_waiting.account::text || '0'
    AND o.name NOT IN (
      SELECT p.path
      FROM public.entries e
      JOIN public.journals j ON j.journal_id = e.journal_id
      CROSS JOIN LATERAL public.entry_media_paths(e.content) AS p(path)
      WHERE j.user_id = fn_bin_waiting.account
        AND p.path IS NOT NULL
    );
$function$;

ALTER FUNCTION public.fn_bin_waiting(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.fn_bin_waiting(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Restoring
-- ---------------------------------------------------------------------------
-- In functions, not over the client's UPDATE grant on `deleted_at`, because a
-- restore must clear `deleted_with_journal`, which no client is granted, and
-- must do it for several rows in one transaction.
--
-- SECURITY DEFINER for that column. The caller comes from auth.uid() alone and
-- every statement names it; an id that is not a row in the caller's bin —
-- another person's, a live one, one already purged — raises P0002 and changes
-- nothing.
--
-- The journal is locked before its entries, the order the journal-delete
-- cascade takes them in. Restoring fires the rollup once per entry; each
-- recomputes the journal's counters from every live entry, so the order the
-- rows come back in does not change the result.

-- Restores an entry. If its journal is in the bin, restores the journal too,
-- with every entry that went down with it; an entry deleted from that journal
-- on its own, other than this one, stays in the bin.
CREATE FUNCTION public.restore_entry(entry uuid)
  RETURNS TABLE (journal_restored boolean, entries_restored integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = ''
AS $function$
DECLARE
  caller uuid := auth.uid();
  parent uuid;
  parent_deleted boolean;
  restored integer;
BEGIN
  SELECT j.journal_id INTO parent
  FROM public.entries e
  JOIN public.journals j ON j.journal_id = e.journal_id
  WHERE e.entry_id = restore_entry.entry
    AND j.user_id = caller;

  SELECT j.deleted_at IS NOT NULL INTO parent_deleted
  FROM public.journals j
  WHERE j.journal_id = parent
    AND j.user_id = caller
  FOR UPDATE;

  PERFORM 1
  FROM public.entries e
  WHERE e.entry_id = restore_entry.entry
    AND e.journal_id = parent
    AND e.deleted_at IS NOT NULL
  FOR UPDATE;

  IF parent IS NULL OR NOT FOUND THEN
    RAISE EXCEPTION 'entry % is not in your bin', restore_entry.entry
      USING ERRCODE = 'P0002';
  END IF;

  IF parent_deleted THEN
    UPDATE public.journals SET deleted_at = NULL WHERE journal_id = parent;

    UPDATE public.entries
       SET deleted_at = NULL, deleted_with_journal = false
     WHERE journal_id = parent
       AND deleted_at IS NOT NULL
       AND (deleted_with_journal OR entry_id = restore_entry.entry);
    GET DIAGNOSTICS restored = ROW_COUNT;
  ELSE
    UPDATE public.entries
       SET deleted_at = NULL, deleted_with_journal = false
     WHERE entry_id = restore_entry.entry;
    GET DIAGNOSTICS restored = ROW_COUNT;
  END IF;

  journal_restored := parent_deleted;
  entries_restored := restored;
  RETURN NEXT;
END;
$function$;

ALTER FUNCTION public.restore_entry(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.restore_entry(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_entry(uuid) TO authenticated;

-- Restores a journal and exactly the entries that went down with it. Returns
-- how many entries came back. Entries deleted from it on their own stay in the
-- bin, each with its own row and its own 30 days.
CREATE FUNCTION public.restore_journal(journal uuid)
  RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = ''
AS $function$
DECLARE
  caller uuid := auth.uid();
  restored integer;
BEGIN
  PERFORM 1
  FROM public.journals j
  WHERE j.journal_id = restore_journal.journal
    AND j.user_id = caller
    AND j.deleted_at IS NOT NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'journal % is not in your bin', restore_journal.journal
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.journals SET deleted_at = NULL WHERE journal_id = restore_journal.journal;

  UPDATE public.entries
     SET deleted_at = NULL, deleted_with_journal = false
   WHERE journal_id = restore_journal.journal
     AND deleted_with_journal;
  GET DIAGNOSTICS restored = ROW_COUNT;

  RETURN restored;
END;
$function$;

ALTER FUNCTION public.restore_journal(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.restore_journal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_journal(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Deleting for good
-- ---------------------------------------------------------------------------
-- Each returns the paths the server should ask Storage to remove: files the
-- deleted rows named that no remaining entry row of the caller's names, in the
-- caller's folder. A path may have no file behind it (already removed);
-- Storage leaves such a name out of its answer rather than failing.
--
-- A journal in the bin that still holds a live entry is not deleted. Nothing in
-- the app makes one on purpose, but an entry saved from a tab opened before the
-- journal was deleted in another lands live in a deleted journal, and nobody
-- has seen it go into the bin. Restoring the journal shows it.

CREATE FUNCTION public.delete_entry_forever(entry uuid)
  RETURNS SETOF text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = ''
AS $function$
DECLARE
  caller uuid := auth.uid();
  parent uuid;
  body jsonb;
BEGIN
  SELECT j.journal_id INTO parent
  FROM public.entries e
  JOIN public.journals j ON j.journal_id = e.journal_id
  WHERE e.entry_id = delete_entry_forever.entry
    AND j.user_id = caller;

  PERFORM 1 FROM public.journals j
  WHERE j.journal_id = parent AND j.user_id = caller
  FOR UPDATE;

  DELETE FROM public.entries e
   WHERE e.entry_id = delete_entry_forever.entry
     AND e.journal_id = parent
     AND e.deleted_at IS NOT NULL
  RETURNING e.content INTO body;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'entry % is not in your bin', delete_entry_forever.entry
      USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT u.path
  FROM public.fn_bin_unnamed(
    caller,
    ARRAY(SELECT p FROM public.entry_media_paths(body) AS p WHERE p IS NOT NULL)
  ) AS u(path);
END;
$function$;

ALTER FUNCTION public.delete_entry_forever(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.delete_entry_forever(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_entry_forever(uuid) TO authenticated;

-- Deletes a journal in the bin and every entry in it: those that went down with
-- it and those deleted from it on their own earlier.
CREATE FUNCTION public.delete_journal_forever(journal uuid)
  RETURNS SETOF text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = ''
AS $function$
DECLARE
  caller uuid := auth.uid();
  candidates text[];
BEGIN
  PERFORM 1
  FROM public.journals j
  WHERE j.journal_id = delete_journal_forever.journal
    AND j.user_id = caller
    AND j.deleted_at IS NOT NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'journal % is not in your bin', delete_journal_forever.journal
      USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.entries e
    WHERE e.journal_id = delete_journal_forever.journal
      AND e.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'journal % holds an entry that is not in the bin; restore the journal to see it',
      delete_journal_forever.journal
      USING ERRCODE = '55000';
  END IF;

  WITH gone AS (
    DELETE FROM public.entries e
     WHERE e.journal_id = delete_journal_forever.journal
    RETURNING e.content
  )
  SELECT pg_catalog.array_agg(p.path) INTO candidates
  FROM gone
  CROSS JOIN LATERAL public.entry_media_paths(gone.content) AS p(path)
  WHERE p.path IS NOT NULL;

  DELETE FROM public.journals j WHERE j.journal_id = delete_journal_forever.journal;

  RETURN QUERY
  SELECT u.path FROM public.fn_bin_unnamed(caller, coalesce(candidates, '{}')) AS u(path);
END;
$function$;

ALTER FUNCTION public.delete_journal_forever(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.delete_journal_forever(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_journal_forever(uuid) TO authenticated;

-- Deletes every entry and journal of the caller's that is in the bin, and
-- returns what to remove: the files those rows alone named, and every file
-- already waiting to be cleared. The two overlap — the delete trigger has just
-- released the first set — and the answer holds each path once.
CREATE FUNCTION public.empty_bin()
  RETURNS SETOF text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = ''
AS $function$
DECLARE
  caller uuid := auth.uid();
  candidates text[];
BEGIN
  IF caller IS NULL THEN
    RETURN;
  END IF;

  PERFORM 1 FROM public.journals j
  WHERE j.user_id = caller AND j.deleted_at IS NOT NULL
  FOR UPDATE;

  WITH gone AS (
    DELETE FROM public.entries e
     USING public.journals j
     WHERE j.journal_id = e.journal_id
       AND j.user_id = caller
       AND e.deleted_at IS NOT NULL
    RETURNING e.content
  )
  SELECT pg_catalog.array_agg(p.path) INTO candidates
  FROM gone
  CROSS JOIN LATERAL public.entry_media_paths(gone.content) AS p(path)
  WHERE p.path IS NOT NULL;

  DELETE FROM public.journals j
   WHERE j.user_id = caller
     AND j.deleted_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.entries e WHERE e.journal_id = j.journal_id);

  RETURN QUERY
  SELECT u.path FROM public.fn_bin_unnamed(caller, coalesce(candidates, '{}')) AS u(path)
  UNION
  SELECT w.path FROM public.fn_bin_waiting(caller) AS w;
END;
$function$;

ALTER FUNCTION public.empty_bin() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.empty_bin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.empty_bin() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Waiting to be cleared
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because media_released has no client grant, and should
-- keep none. Both take the caller from auth.uid() and pass it to the helper.

CREATE FUNCTION public.waiting_files()
  RETURNS TABLE (path text, type text, size bigint, released_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
AS $function$
  SELECT w.path, w.type, w.size, w.released_at
  FROM public.fn_bin_waiting((SELECT auth.uid())) AS w
  ORDER BY w.released_at DESC, w.path;
$function$;

ALTER FUNCTION public.waiting_files() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.waiting_files() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waiting_files() TO authenticated;

-- Whether `file` is still one of the caller's waiting files, asked just before
-- the server removes it. Not a lock: Storage removes in its own transaction.
-- And not the boundary either — the owner's own-folder DELETE policy lets their
-- session remove any file of theirs through Storage directly. It is what keeps
-- the app from removing a file an entry has named again since the list was
-- drawn.
CREATE FUNCTION public.is_waiting_file(file text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.fn_bin_waiting((SELECT auth.uid())) AS w
    WHERE w.path = is_waiting_file.file
  );
$function$;

ALTER FUNCTION public.is_waiting_file(text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.is_waiting_file(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_waiting_file(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. What is in the bin
-- ---------------------------------------------------------------------------
-- One row per bin item, newest first, each with the count and size of the
-- files it names. One function rather than a listing plus a sizing call: one
-- round trip (about 250 ms each from the person's side of the world), and the
-- rows and their sizes come from one snapshot. A file shared by two items
-- counts in both rows; media_breakdown()'s `bin` counts it once.
--
--   kind 'journal'  a journal in the bin. `entries` is how many entries went
--                   down with it: what restoring it brings back.
--   kind 'entry'    an entry in the bin in its own right. `entries` is 0.
--                   `journal_deleted` says whether restoring it brings its
--                   journal back as well.
--
-- A journal row's files are those of the entries that went down with it.
-- Entries deleted from it on their own are rows of their own, with their own.
--
-- SECURITY INVOKER: it needs nothing the owner's own select policies do not
-- already show them, so RLS stays a second layer under the explicit filters.
-- Each path is looked up by itself in the (bucket_id, name COLLATE "C") index,
-- so the cost follows the bin, not the size of the folder.

CREATE FUNCTION public.bin_items()
  RETURNS TABLE (
    kind text,
    id uuid,
    title text,
    journal_id uuid,
    journal_title text,
    journal_deleted boolean,
    deleted_at timestamptz,
    entries integer,
    files integer,
    bytes bigint
  )
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = ''
AS $function$
  WITH binned AS MATERIALIZED (
    -- Every entry row in the bin, and the item it belongs to.
    SELECT e.entry_id,
           e.content,
           CASE WHEN e.deleted_with_journal AND j.deleted_at IS NOT NULL
                THEN 'journal' ELSE 'entry' END AS kind,
           CASE WHEN e.deleted_with_journal AND j.deleted_at IS NOT NULL
                THEN j.journal_id ELSE e.entry_id END AS item
    FROM public.entries e
    JOIN public.journals j ON j.journal_id = e.journal_id
    WHERE j.user_id = (SELECT auth.uid())
      AND e.deleted_at IS NOT NULL
  ),
  named AS (
    SELECT DISTINCT b.kind, b.item, p.path
    FROM binned b
    CROSS JOIN LATERAL public.entry_media_paths(b.content) AS p(path)
    WHERE p.path IS NOT NULL
  ),
  sized AS (
    SELECT n.kind, n.item, count(*)::integer AS files, sum(f.size)::bigint AS bytes
    FROM named n
    CROSS JOIN LATERAL (
      SELECT coalesce(sum((o.metadata->>'size')::bigint), 0) AS size
      FROM storage.objects o
      WHERE o.bucket_id = 'media'
        AND o.name COLLATE "C" = n.path
      HAVING count(*) > 0
    ) AS f
    GROUP BY n.kind, n.item
  ),
  items AS (
    SELECT 'journal'::text AS kind, j.journal_id AS id, j.title, j.journal_id,
           j.title AS journal_title, true AS journal_deleted, j.deleted_at,
           (SELECT count(*)::integer FROM binned b
             WHERE b.kind = 'journal' AND b.item = j.journal_id) AS entries
    FROM public.journals j
    WHERE j.user_id = (SELECT auth.uid())
      AND j.deleted_at IS NOT NULL
    UNION ALL
    SELECT 'entry', e.entry_id, e.title, j.journal_id,
           j.title, j.deleted_at IS NOT NULL, e.deleted_at, 0
    FROM binned b
    JOIN public.entries e ON e.entry_id = b.entry_id
    JOIN public.journals j ON j.journal_id = e.journal_id
    WHERE b.kind = 'entry'
  )
  SELECT i.kind, i.id, i.title, i.journal_id, i.journal_title, i.journal_deleted,
         i.deleted_at, i.entries,
         coalesce(s.files, 0), coalesce(s.bytes, 0)::bigint
  FROM items i
  LEFT JOIN sized s ON s.kind = i.kind AND s.item = i.id
  ORDER BY i.deleted_at DESC, i.kind, i.id;
$function$;

ALTER FUNCTION public.bin_items() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.bin_items() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bin_items() TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. The Storage page's breakdown
-- ---------------------------------------------------------------------------
-- One row. Each file counts once, under the first of these that holds:
--
--   a live entry names it (hidden entries are live)   → its kind
--   an entry in the bin names it, or an entry in a
--   journal that is in the bin                        → bin
--   it has a release record                           → waiting
--   otherwise (an upload whose entry hasn't saved)    → its kind
--
-- `total` sums every object in the caller's folder with the same `size` field
-- as media_allowance_remaining(), and a test asserts the two agree and that
-- the five parts add up to it. media_usage() is left exactly as it is: `main`
-- calls it.
--
-- SECURITY DEFINER, unlike media_usage(), because the waiting row reads
-- media_released, which clients hold nothing on. The caller is auth.uid(),
-- named in every read; a caller with no identity matches no folder and gets
-- zeros.
--
-- The plan notes from media_usage() apply: the folder as a range, `IN
-- (subquery)` so each set is one hash probed once per file, and MATERIALIZED
-- where a CTE feeds several filters.

CREATE FUNCTION public.media_breakdown()
  RETURNS TABLE (total bigint, images bigint, video bigint, audio bigint, bin bigint, waiting bigint)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
AS $function$
  WITH files AS (
    SELECT o.name,
           coalesce((o.metadata->>'size')::bigint, 0) AS size,
           o.metadata->>'mimetype' AS type
    FROM storage.objects o
    WHERE o.bucket_id = 'media'
      AND o.name COLLATE "C" >= (SELECT auth.uid())::text || '/'
      AND o.name COLLATE "C" < (SELECT auth.uid())::text || '0'
  ),
  named AS MATERIALIZED (
    SELECT p.path, (e.deleted_at IS NULL AND j.deleted_at IS NULL) AS live
    FROM public.entries e
    JOIN public.journals j ON j.journal_id = e.journal_id
    CROSS JOIN LATERAL public.entry_media_paths(e.content) AS p(path)
    WHERE j.user_id = (SELECT auth.uid())
      AND p.path IS NOT NULL
  ),
  classified AS MATERIALIZED (
    SELECT f.size,
           f.type,
           CASE
             WHEN f.name IN (SELECT n.path FROM named n WHERE n.live) THEN 'kind'
             WHEN f.name IN (SELECT n.path FROM named n WHERE NOT n.live) THEN 'bin'
             WHEN f.name IN (
               SELECT r.path FROM public.media_released r
               WHERE r.path COLLATE "C" >= (SELECT auth.uid())::text || '/'
                 AND r.path COLLATE "C" < (SELECT auth.uid())::text || '0'
             ) THEN 'waiting'
             ELSE 'kind'
           END AS place
    FROM files f
  )
  SELECT
    coalesce(sum(size), 0)::bigint,
    coalesce(sum(size) FILTER (WHERE place = 'kind' AND type LIKE 'image/%'), 0)::bigint,
    coalesce(sum(size) FILTER (WHERE place = 'kind' AND type LIKE 'video/%'), 0)::bigint,
    coalesce(sum(size) FILTER (WHERE place = 'kind' AND type LIKE 'audio/%'), 0)::bigint,
    coalesce(sum(size) FILTER (WHERE place = 'bin'), 0)::bigint,
    coalesce(sum(size) FILTER (WHERE place = 'waiting'), 0)::bigint
  FROM classified;
$function$;

ALTER FUNCTION public.media_breakdown() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.media_breakdown() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_breakdown() TO authenticated;
