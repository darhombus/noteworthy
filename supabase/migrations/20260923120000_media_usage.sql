-- Storage usage: what a person's files add up to, and which of them no entry
-- uses any more.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS CHANGES FOR EXISTING USERS
-- ---------------------------------------------------------------------------
-- Two new functions, both callable by authenticated, and a faster body for an
-- existing one. No table, policy or grant changes. `main` calls none of the
-- three — nothing on it touches the bucket — so nothing it does is affected.
--
--   1. public.entry_media_paths(jsonb) — the storage paths an entry body refers
--      to. The one definition of "referenced", for this section's "Waiting to be
--      cleared" row and for the Section 5 cleanup job.
--   2. public.media_usage() — the caller's usage, broken down by kind, with the
--      files no live entry refers to in a row of their own.
--   3. public.media_allowance_remaining() — same signature, same answer, same
--      grants; it now reads the caller's folder through an index instead of
--      scanning the whole bucket. See the next part.
--
-- ---------------------------------------------------------------------------
-- WHY `LIKE` SCANNED THE WHOLE BUCKET
-- ---------------------------------------------------------------------------
-- media_allowance_remaining() found the caller's folder with
-- `name LIKE uid || '/%'`, expecting Storage's `name` indexes to serve it. They
-- cannot, as the caller. Row-level security evaluates the policy's own
-- conditions before any condition of the query's that is not LEAKPROOF, and
-- `~~` (textlike) is not, so the planner may not use it to choose rows — it
-- would see rows the policy has not yet passed. Every row in the bucket, every
-- account's, was read and put through `storage.foldername()`. With 51,500
-- objects in the bucket, 1,500 of them the caller's: 360 ms, locally, per call
-- — and the insert policy calls it on every upload.
--
-- The text comparisons are LEAKPROOF. In the "C" collation, byte order, the
-- names beginning `<uid>/` are exactly those from `<uid>/` up to but not
-- including `<uid>0`, because '0' is the byte after '/'. Written that way, the
-- range goes into an index scan on `idx_objects_bucket_id_name`
-- (bucket_id, name COLLATE "C"), and the same call takes 13 ms, nearly all of
-- it the policy's foldername() on the caller's own 1,500 rows.

-- ---------------------------------------------------------------------------
-- 0. The allowance, through the index
-- ---------------------------------------------------------------------------
-- Everything but the folder condition is as 20260922120000_private_media wrote
-- it, and that file's comment still holds, bar its claim about the index.

CREATE OR REPLACE FUNCTION public.media_allowance_remaining()
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

  -- Names starting `<caller>/`, as a range the planner can use under RLS; see
  -- the top of 20260923120000_media_usage.
  RETURN 73400320 - (
    SELECT coalesce(sum((o.metadata->>'size')::bigint), 0)
    FROM storage.objects o
    WHERE o.bucket_id = 'media'
      AND o.name COLLATE "C" >= caller::text || '/'
      AND o.name COLLATE "C" < caller::text || '0'
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 1. Which paths an entry refers to
-- ---------------------------------------------------------------------------
-- Every `image`, `video` and `audio` node's `attrs.path`, anywhere in the
-- document, as text. The node types are MEDIA_NODE_TYPES in
-- src/lib/entries/media.ts; a test compares this with that module's
-- `mediaPaths` over the same documents.
--
-- It looks everywhere (`.**`), not only down `content` as the TypeScript walk
-- does. The sanitiser rebuilds every stored body, so the two agree on anything
-- the app wrote; where they could differ — a body written some other way — this
-- one finds more, and for a cleanup job "referenced" is the safe side to err on.
--
-- `strict`, because lax mode's automatic array unwrapping makes `.**` visit
-- some items twice. Inside the filter strict mode's errors — `.type` on a string
-- or a number, say — count as false rather than raising, so only objects with a
-- media type and a string path get through, and `.attrs.path` then exists.
--
-- IMMUTABLE: the answer depends on the argument alone.
--
-- NO `SET search_path`, deliberately, unlike every other function here. A SET
-- clause stops Postgres inlining a SQL function and makes it save and restore
-- the setting on every call: media_usage() calls this once per entry, and with
-- the SET it cost about 25 µs a call, 90 ms for 3,500 entries. Instead every
-- name is qualified, the operator included, so there is nothing for a
-- search_path to redirect. It is SECURITY INVOKER and reads nothing but its
-- argument, so it runs with no rights its caller lacks either way.

CREATE FUNCTION public.entry_media_paths(body jsonb)
  RETURNS SETOF text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  -- The planner's default guess for a set-returning function is 1,000 rows.
  -- Most entries hold no media and none more than 20.
  ROWS 2
AS $function$
  SELECT path OPERATOR(pg_catalog.#>>) '{}'::text[]
  FROM pg_catalog.jsonb_path_query(
    body,
    'strict $.** ? ((@.type == "image" || @.type == "video" || @.type == "audio") && @.attrs.path.type() == "string").attrs.path'
  ) AS path
  -- A quicker question first: is there an `attrs.path` anywhere at all? Most
  -- bodies are text alone and stop here, at about half the cost of the walk
  -- above. It cannot reject a body the walk would have found something in.
  WHERE body OPERATOR(pg_catalog.@?) 'strict $.**.attrs.path'::pg_catalog.jsonpath;
$function$;

ALTER FUNCTION public.entry_media_paths(jsonb) OWNER TO postgres;

-- media_usage() runs as the caller and calls this, so the caller needs it.
-- It reads nothing but its argument.
REVOKE EXECUTE ON FUNCTION public.entry_media_paths(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.entry_media_paths(jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. The caller's usage
-- ---------------------------------------------------------------------------
-- One row: `total`, and the same bytes split four ways.
--
--   waiting — files no live entry refers to: files of deleted entries (and of
--             entries in deleted journals), media removed from an entry, and
--             uploads for a new entry that was never saved. Counted here
--             whatever their type, so deleting an entry moves its files out of
--             their kind and into this row.
--   images, video, audio — everything else, by the stored type's top level.
--             A hidden entry is live: its files count under their kind, and
--             nothing here says that hidden entries exist.
--
-- `total` is the sum `media_allowance_remaining()` subtracts from 70 MB — the
-- same rows (every object in the caller's folder) and the same `size` field —
-- so the page shows the figure an upload is held to. A test asserts the two
-- agree. The four parts add up to `total` because the bucket accepts only
-- image/, video/ and audio/ types; a test asserts that too.
--
-- SECURITY INVOKER, like media_allowance_remaining() and for the same reason:
-- RLS shows the caller exactly their own folder and their own entries, which is
-- what the WHERE clauses ask for, so a mistake in a filter still cannot count
-- another person's files. The same caveat applies to both reads: narrow the
-- select policy on storage.objects and hidden files stop counting in `total`;
-- narrow the one on entries (a vault hiding entries from their owner's own
-- session) and the files of hidden entries move to `waiting`. Whoever narrows
-- either makes this SECURITY DEFINER in the same change.
--
-- A caller with no identity matches no folder and gets a row of zeros.

CREATE FUNCTION public.media_usage()
  RETURNS TABLE (total bigint, images bigint, video bigint, audio bigint, waiting bigint)
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = ''
AS $function$
  WITH files AS (
    SELECT o.name,
           coalesce((o.metadata->>'size')::bigint, 0) AS size,
           o.metadata->>'mimetype' AS type
    FROM storage.objects o
    WHERE o.bucket_id = 'media'
      -- The caller's folder, as in media_allowance_remaining() above.
      AND o.name COLLATE "C" >= (SELECT auth.uid())::text || '/'
      AND o.name COLLATE "C" < (SELECT auth.uid())::text || '0'
  ),
  referenced AS (
    SELECT p.path
    FROM public.entries e
    JOIN public.journals j ON j.journal_id = e.journal_id
    CROSS JOIN LATERAL public.entry_media_paths(e.content) AS p(path)
    WHERE j.user_id = (SELECT auth.uid())
      AND e.deleted_at IS NULL
      AND j.deleted_at IS NULL
  ),
  -- `IN`, not a join. RLS leaves the planner guessing one row for `files`,
  -- and on that guess it chose a nested loop that compared every file with
  -- every referenced path: a million comparisons for 1,500 files. `IN` here
  -- becomes one hash of the referenced paths, probed once per file.
  -- MATERIALIZED so `unused` is worked out once per file: inlined, the
  -- expression was copied into each FILTER below and the hash built twice.
  classified AS MATERIALIZED (
    SELECT f.size,
           f.type,
           f.name NOT IN (SELECT r.path FROM referenced r WHERE r.path IS NOT NULL) AS unused
    FROM files f
  )
  SELECT
    coalesce(sum(size), 0)::bigint,
    coalesce(sum(size) FILTER (WHERE NOT unused AND type LIKE 'image/%'), 0)::bigint,
    coalesce(sum(size) FILTER (WHERE NOT unused AND type LIKE 'video/%'), 0)::bigint,
    coalesce(sum(size) FILTER (WHERE NOT unused AND type LIKE 'audio/%'), 0)::bigint,
    coalesce(sum(size) FILTER (WHERE unused), 0)::bigint
  FROM classified;
$function$;

ALTER FUNCTION public.media_usage() OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.media_usage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_usage() TO authenticated;
