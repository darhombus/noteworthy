-- Search: find_journals() and find_entries(), replacing the old search
-- functions and the two indexes nothing could use.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS CHANGES FOR EXISTING USERS
-- ---------------------------------------------------------------------------
-- `main` and `dev` share one database, so this reaches production on `db push`.
-- When it was written `main` and `dev` were the same commit (9e0b55a). On it,
-- nothing in src/ calls search_entries, search_index_entries or
-- build_prefix_tsquery (they appear only in the generated types and in
-- comments), and nothing queries `search_text` with a text-search or LIKE
-- filter. In the database, pg_depend showed nothing depending on either index or
-- on build_prefix_tsquery, and no function body naming them but
-- search_entries'.
--
--   1. New, each callable by authenticated alone:
--        find_journals(query_text)
--        find_entries(query_text, in_journal, from_day, to_day, after_row)
--        search_words(query_text), which both of those call
--   2. Dropped: search_entries(), search_index_entries(), build_prefix_tsquery(),
--      and the indexes fts_entries and trgm_entries_search.
--   3. extract_tiptap_text() and fn_compute_word_count() read the text inside a
--      block without inventing spaces (section 5). Same signatures, owner and
--      grants.
--   4. Every stored value they feed is recomputed (section 6): each entry's
--      `search_text` and `word_count`, and each journal's four counters. No
--      entry's or journal's `updated_at` moves, nothing is written to
--      `media_released`, and no other column changes.
--
-- What production shows differently afterwards. `main` reads `search_text`
-- nowhere, and loads `word_count`, `total_word_count` and `hidden_word_count`
-- without displaying them. It shows `entry_count` (journal cards, the delete
-- dialog), which the recompute changes only where it had drifted, which
-- FINDING 7-B (moving an entry) is the only known way to cause. Both tables are
-- in the supabase_realtime publication, so every row section 6 updates is
-- broadcast; `main` subscribes to nothing.
--
-- Unchanged, deliberately: the pg_trgm extension (anon's two pg_trgm functions
-- are asserted in widened.test.ts), every trigger (section 6 disables two for
-- the length of one statement each, inside this migration's transaction, and
-- turns them back on), and every policy and grant on the tables.
--
-- Undone by recreating the three functions from 20260101000000_baseline with
-- their EXECUTE grants from 20260101000005_privileges, recreating the two
-- indexes from the baseline, dropping the three functions below, restoring
-- extract_tiptap_text() from 20260924150000_search_text_walk_once and
-- fn_compute_word_count() from the baseline, and running section 6 again.
--
-- ---------------------------------------------------------------------------
-- WHY NO INDEX
-- ---------------------------------------------------------------------------
-- Under RLS the planner may not use an operator that is not LEAKPROOF to choose
-- rows (see docs/constraints.md, "Media and Storage"). `@@` (ts_match_vq) and
-- `~~` (textlike) are not, so for a signed-in caller neither fts_entries nor
-- trgm_entries_search could ever be used: every old search read all of the
-- account's entries and computed to_tsvector on each, about 280 ms per 1,000
-- entries. Both indexes only cost writes (52 MB of them at 21,000 entries).
--
-- These functions read the account's visible entries through the journal
-- indexes the uuid join can use, and test each with strpos() on lowered text.
--
-- ---------------------------------------------------------------------------
-- MATCHING
-- ---------------------------------------------------------------------------
-- A query is split into words on whitespace. An entry matches when every word
-- is in its title or its text, ignoring case: a part of a word counts, and
-- there is no stemming, no stop word and no accent folding. Every character is
-- matched literally, `%`, `_` and `\` included, because strpos() has no
-- wildcards at all.
--
-- Case is ignored with lower(... COLLATE pg_catalog.pg_c_utf8), on the text and
-- on the query alike. That is Postgres's own C.UTF-8 collation: Unicode simple
-- case mapping, one code point in and one out, the same on every host running
-- the same Postgres. The database's default collation is ICU, whose lower()
-- turns "İ" into two code points and lowers a final "Σ" by context. Positions in
-- text lowered that way no longer line up with the original, which would put
-- the snippet window in the wrong place. The app lowers each code point on its
-- own and keeps the first code point of the result: over every code point
-- Unicode 15.1 assigns (the database's version), that agrees with pg_c_utf8
-- exactly.
--
-- The whitespace a query splits on is [[:space:]] under pg_c_utf8, plus U+FEFF,
-- which JavaScript's \s includes and [[:space:]] does not. (The app adds
-- U+0085, which [[:space:]] includes and \s does not.)
--
-- A query counts up to its first 200 characters and its first 10 words. A
-- pasted essay costs the same as a sentence, and the app's input can hold no
-- more than that.
--
-- Every parameter is written with the function's name in front, and none is a
-- column name anywhere in the database: in a SQL function a column of the same
-- name wins over a parameter, silently (docs/constraints.md, "Database and
-- tooling").

-- ---------------------------------------------------------------------------
-- 1. The old search
-- ---------------------------------------------------------------------------

DROP FUNCTION public.search_entries(uuid, text, text, uuid, date, date, boolean, uuid[]);
DROP FUNCTION public.search_index_entries(uuid, text);

-- Called by search_entries and by nothing else, here or in the app. Left in
-- place it would be a function authenticated can call that serves nothing.
DROP FUNCTION public.build_prefix_tsquery(text);

DROP INDEX public.fts_entries;
DROP INDEX public.trgm_entries_search;

-- ---------------------------------------------------------------------------
-- 2. The words of a query
-- ---------------------------------------------------------------------------
-- Lowered, in the order typed, empty words dropped. A query of only whitespace
-- has no words, and neither has NULL: both mean "no query".
--
-- One definition for both functions below, so the two cannot disagree about
-- what a word is. Authenticated must hold EXECUTE on it, because the functions
-- that call it run as the caller.

CREATE FUNCTION public.search_words(query_text text)
  RETURNS text[]
  LANGUAGE sql
  IMMUTABLE
  SECURITY INVOKER
  SET search_path = ''
AS $function$
  SELECT coalesce(array_agg(t.word ORDER BY t.n), '{}'::text[])
  FROM (
    SELECT s.word, s.n
    FROM regexp_split_to_table(
           lower(left(coalesce(search_words.query_text, ''), 200) COLLATE pg_catalog.pg_c_utf8),
           '[[:space:]\uFEFF]+'
         ) WITH ORDINALITY AS s(word, n)
    WHERE s.word <> ''
    ORDER BY s.n
    LIMIT 10
  ) AS t;
$function$;

ALTER FUNCTION public.search_words(text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.search_words(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_words(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Journals
-- ---------------------------------------------------------------------------
-- The caller's visible journals whose title holds every word, most recently
-- updated first. With no query, every visible journal. `entry_count` is the
-- column the journal cards show.
--
-- At most 50, with `total` the count of every match: no account is near 50
-- journals, and nothing returns more than a page. The id breaks ties, so the
-- order is total.
--
-- SECURITY INVOKER: RLS stays in force, under the explicit user filter.

CREATE FUNCTION public.find_journals(query_text text DEFAULT NULL)
  RETURNS TABLE (
    journal_id uuid,
    title text,
    color text,
    icon text,
    entry_count integer,
    total bigint
  )
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = ''
AS $function$
  WITH q AS (
    SELECT public.search_words(find_journals.query_text) AS words
  )
  SELECT j.journal_id, j.title, j.color, j.icon, j.entry_count, count(*) OVER ()
  FROM public.journals j
  CROSS JOIN q
  WHERE j.user_id = (SELECT auth.uid())
    AND j.deleted_at IS NULL
    AND NOT j.is_hidden
    AND NOT EXISTS (
      SELECT 1 FROM unnest(q.words) AS w(word)
      WHERE strpos(lower(j.title COLLATE pg_catalog.pg_c_utf8), w.word) = 0
    )
  ORDER BY j.updated_at DESC, j.journal_id DESC
  LIMIT 50;
$function$;

ALTER FUNCTION public.find_journals(text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.find_journals(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_journals(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Entries
-- ---------------------------------------------------------------------------
-- The caller's visible entries that match, 50 at a time: visible as
-- `visible()` in src/lib/data/entries.ts means it, the entry and its journal
-- neither deleted nor hidden. `in_journal`, the two days and the query may each
-- be NULL; with no query, every entry that passes the filters matches.
--
-- The days are inclusive, on `entry_date`, as plain dates. Nothing here
-- interprets a date in any time zone; the browser decides what "this week"
-- is.
--
-- TIERS. 1: every word is in the title. 2: every other match. With no query
-- nothing was found in a title, so every row is tier 2. Within a tier:
-- `entry_date` newest first, then `created_at` newest first, then `entry_id`
-- descending, so the order is total and never shuffles between calls.
--
-- PAGING is by cursor over exactly that order. Every row carries `row_cursor`;
-- passing the last row's as `after_row` gives the next 50. It is
-- "tier|entry_date|created_at in UTC|entry_id", written and read in fixed ISO
-- formats that no session setting changes, and a malformed one raises rather
-- than silently returning a short page. `total` counts every match, whatever the
-- page.
--
-- THE SNIPPET WINDOW is up to 200 characters of the body's text (not
-- `search_text`, whose title may itself hold the words), starting 60 before the
-- earliest place any word is found in it, or at the start when no word is in
-- the body. `snippet_at_start` and `snippet_at_end` say whether the window
-- reaches either end of the text. The app turns it into the final snippet and
-- highlights it. The body is read only for the rows on the page.
--
-- COST follows the account's own visible entries, read through the journal
-- indexes: lowering and testing each one's `search_text` is the whole of it.
-- The lowering sits in a LATERAL with OFFSET 0 so that it runs once per row
-- rather than once per word, and not at all when there is no query.

CREATE FUNCTION public.find_entries(
    query_text text DEFAULT NULL,
    in_journal uuid DEFAULT NULL,
    from_day date DEFAULT NULL,
    to_day date DEFAULT NULL,
    after_row text DEFAULT NULL
  )
  RETURNS TABLE (
    entry_id uuid,
    journal_id uuid,
    journal_title text,
    journal_color text,
    title text,
    entry_date date,
    tier integer,
    snippet text,
    snippet_at_start boolean,
    snippet_at_end boolean,
    total bigint,
    row_cursor text
  )
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  SET search_path = ''
AS $function$
  WITH q AS MATERIALIZED (
    SELECT public.search_words(find_entries.query_text) AS words
  ),
  resume AS (
    SELECT split_part(find_entries.after_row, '|', 1)::integer AS tier,
           split_part(find_entries.after_row, '|', 2)::date AS entry_date,
           split_part(find_entries.after_row, '|', 3)::timestamptz AS created_at,
           split_part(find_entries.after_row, '|', 4)::uuid AS entry_id
    WHERE find_entries.after_row IS NOT NULL
  ),
  matched AS (
    SELECT e.entry_id,
           e.journal_id,
           j.title AS journal_title,
           j.color AS journal_color,
           e.title,
           e.entry_date,
           e.created_at,
           CASE
             WHEN cardinality(q.words) > 0 AND NOT EXISTS (
               SELECT 1 FROM unnest(q.words) AS w(word)
               WHERE strpos(lower(coalesce(e.title, '') COLLATE pg_catalog.pg_c_utf8), w.word) = 0
             ) THEN 1
             ELSE 2
           END AS tier
    FROM public.entries e
    JOIN public.journals j ON j.journal_id = e.journal_id
    CROSS JOIN q
    CROSS JOIN LATERAL (
      SELECT CASE WHEN cardinality(q.words) > 0
                  THEN lower(e.search_text COLLATE pg_catalog.pg_c_utf8) END AS text
      OFFSET 0
    ) AS h
    WHERE j.user_id = (SELECT auth.uid())
      AND j.deleted_at IS NULL
      AND NOT j.is_hidden
      AND e.deleted_at IS NULL
      AND NOT e.is_hidden
      AND (find_entries.in_journal IS NULL OR e.journal_id = find_entries.in_journal)
      AND (find_entries.from_day IS NULL OR e.entry_date >= find_entries.from_day)
      AND (find_entries.to_day IS NULL OR e.entry_date <= find_entries.to_day)
      AND NOT EXISTS (
        SELECT 1 FROM unnest(q.words) AS w(word)
        WHERE strpos(h.text, w.word) = 0
      )
  ),
  counted AS (
    SELECT m.*, count(*) OVER () AS total
    FROM matched m
  ),
  page AS (
    SELECT c.*
    FROM counted c
    WHERE NOT EXISTS (SELECT 1 FROM resume)
       OR EXISTS (
         SELECT 1 FROM resume r
         WHERE c.tier > r.tier
            OR (c.tier = r.tier
                AND (c.entry_date, c.created_at, c.entry_id) < (r.entry_date, r.created_at, r.entry_id))
       )
    ORDER BY c.tier, c.entry_date DESC, c.created_at DESC, c.entry_id DESC
    LIMIT 50
  )
  SELECT p.entry_id,
         p.journal_id,
         p.journal_title,
         p.journal_color,
         p.title,
         p.entry_date,
         p.tier,
         substr(b.body, s.start, 200),
         s.start = 1,
         s.start + 200 > length(b.body),
         p.total,
         p.tier || '|' || to_char(p.entry_date, 'YYYY-MM-DD') || '|'
           || to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|'
           || p.entry_id
  FROM page p
  JOIN public.entries e ON e.entry_id = p.entry_id
  CROSS JOIN q
  CROSS JOIN LATERAL (SELECT public.extract_tiptap_text(e.content) AS body) AS b
  CROSS JOIN LATERAL (
    SELECT coalesce(greatest(1, (
             SELECT min(f.at)
             FROM (
               SELECT strpos(lower(b.body COLLATE pg_catalog.pg_c_utf8), w.word) AS at
               FROM unnest(q.words) AS w(word)
             ) AS f
             WHERE f.at > 0
           ) - 60), 1) AS start
  ) AS s
  ORDER BY p.tier, p.entry_date DESC, p.created_at DESC, p.entry_id DESC;
$function$;

ALTER FUNCTION public.find_entries(text, uuid, date, date, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.find_entries(text, uuid, date, date, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_entries(text, uuid, date, date, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. The text of a body: nothing between the runs of one block
-- ---------------------------------------------------------------------------
-- Until now both readers of a body joined every text node with a space. A
-- block's text is split into several text nodes wherever its formatting
-- changes, so bold inside a word ("un" + bold "believable") was read as two
-- words: search could not find "unbelievable", the snippet said "un
-- believable", and `word_count` counted one word too many.
--
-- The vocabulary (NODES in src/lib/entries/document.ts), and what each node
-- gives:
--
--   paragraph, heading    a block. Its runs are joined with nothing.
--   text                  its `text`, when that is a string.
--   hardBreak             a space, inside a block. Outside one, nothing.
--   doc, blockquote,      containers: they hold blocks and give nothing of
--   bulletList,           their own, so the blocks inside them stay separate.
--   orderedList,
--   listItem
--   image, video, audio   block atoms with no text: nothing. Their `path` is an
--                         attribute, and attributes are never read.
--
-- Blocks are joined with one space, in reading order. A block that gives only
-- spaces (a paragraph holding only a hard break) is left out. A `text` node
-- outside any paragraph or heading is its own block: the editor never makes
-- one, but the sanitiser does not refuse it, and the walk this replaces found
-- it, so leaving it out would silently lose words.
--
-- The walk is still `strict`, as docs/constraints.md ("Entry bodies")
-- requires: a recursive query that steps from each node to its children with
-- the strict path `$.content[*]`, so each node is visited once, in order, with
-- no automatic unwrapping. The path to each node is kept, which is what orders
-- the text and tells the walk which block a node is inside.
--
-- fn_compute_word_count() now counts the words of extract_tiptap_text() rather
-- than walking the body a second time, so the two readers cannot part: a word
-- is what search sees as one. It keeps its parameter name (`content`), as
-- CREATE OR REPLACE requires, and its whitespace rule (\s+).

CREATE OR REPLACE FUNCTION public.extract_tiptap_text(doc jsonb)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'pg_catalog'
AS $$
  WITH RECURSIVE walk(node, path, block) AS (
    SELECT coalesce(doc, '{}'::jsonb), ARRAY[]::bigint[], NULL::bigint[]
    UNION ALL
    SELECT c.child,
           w.path || c.n,
           CASE
             WHEN w.block IS NOT NULL THEN w.block
             WHEN c.child ->> 'type' IN ('paragraph', 'heading') THEN w.path || c.n
           END
    FROM walk w
    CROSS JOIN LATERAL jsonb_path_query(w.node, 'strict $.content[*]', '{}', true)
      WITH ORDINALITY AS c(child, n)
  ),
  pieces AS (
    SELECT coalesce(w.block, w.path) AS unit,
           w.path,
           CASE w.node ->> 'type'
             WHEN 'text' THEN
               CASE WHEN jsonb_typeof(w.node -> 'text') = 'string' THEN w.node ->> 'text' END
             WHEN 'hardBreak' THEN
               CASE WHEN w.block IS NOT NULL THEN ' ' END
           END AS piece
    FROM walk w
  ),
  blocks AS (
    SELECT p.unit, string_agg(p.piece, '' ORDER BY p.path) AS text
    FROM pieces p
    WHERE p.piece IS NOT NULL
    GROUP BY p.unit
    HAVING btrim(string_agg(p.piece, '' ORDER BY p.path)) <> ''
  )
  SELECT coalesce(string_agg(b.text, ' ' ORDER BY b.unit), '')
  FROM blocks b;
$$;

CREATE OR REPLACE FUNCTION public.fn_compute_word_count(content jsonb)
  RETURNS integer
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'pg_catalog'
AS $$
  SELECT count(*)::integer
  FROM regexp_split_to_table(public.extract_tiptap_text(fn_compute_word_count.content), '\s+') AS w(word)
  WHERE w.word <> '';
$$;

-- ---------------------------------------------------------------------------
-- 6. Recomputing what is stored
-- ---------------------------------------------------------------------------
-- A stored value is computed when its row is written, so replacing the two
-- functions changes nothing already stored. Three things are recomputed, and
-- nothing else is touched. This runs on production when it is pushed.
--
-- `search_text`: SET EXPRESSION with the column's own, unchanged expression,
-- as 20260924150000_search_text_walk_once did. It rewrites the table under an
-- ACCESS EXCLUSIVE lock and fires no row trigger.
--
-- `word_count`: an UPDATE of the rows whose count changes. It fires these
-- triggers on `entries`, each accounted for:
--
--   trg_entries_pinned_at            BEFORE UPDATE. Touches pinned_at only
--                                    when is_pinned changes; it does not.
--   trg_entries_updated_at           BEFORE UPDATE. Keeps OLD.updated_at unless
--                                    title, content or entry_date changes;
--                                    none does.
--   trg_entries_word_count           BEFORE UPDATE OF content, word_count.
--                                    Sets word_count from content: the value
--                                    this statement writes anyway.
--   trg_journals_bump_on_entry_edit  AFTER UPDATE. Returns at once when
--                                    updated_at did not move, which it does not.
--   trg_journals_rollup_update       AFTER UPDATE OF deleted_at, word_count,
--                                    is_hidden. DISABLED for this statement:
--                                    it would recount the journal once per
--                                    entry, and its UPDATE of the journal fires
--                                    trg_journals_updated_at, which stamps
--                                    updated_at whenever total_word_count moves.
--   trg_entries_release_media_update AFTER UPDATE OF content: not named, so it
--                                    does not fire, and media_released is not
--                                    written.
--   trg_tags_usage_on_entry_hidden   AFTER UPDATE OF is_hidden, deleted_at:
--                                    not named, does not fire.
--
-- The four journal counters: one UPDATE of the journals whose counters differ,
-- counting exactly as fn_journals_rollup() does (entries not deleted; visible
-- when neither the entry nor its journal is hidden). This also corrects any
-- that had drifted (FINDING 7-A, 7-B); the triggers that cause the drift are
-- left as they are. It fires on `journals`:
--
--   trg_journals_updated_at          BEFORE UPDATE. DISABLED for this
--                                    statement: it stamps updated_at when
--                                    entry_count or total_word_count changes,
--                                    and a recount is not an edit.
--   trg_journals_rollup_on_hidden    AFTER UPDATE OF is_hidden: not named.
--   trg_journals_soft_delete_cascade AFTER UPDATE OF deleted_at: not named.
--   trg_tags_usage_on_journal_hidden AFTER UPDATE OF is_hidden, deleted_at:
--                                    not named.
--
-- Disabling a trigger is a catalog change inside this migration's transaction
-- (the CLI runs each migration file as one), turned back on before it ends. No
-- other session ever sees the trigger off: ALTER TABLE ... DISABLE TRIGGER
-- takes a SHARE ROW EXCLUSIVE lock, so writes to the table wait until the
-- migration commits, and a failure anywhere rolls all of it back.

ALTER TABLE public.entries
  ALTER COLUMN search_text
  SET EXPRESSION AS ((COALESCE(title, ''::text) || ' '::text) || public.extract_tiptap_text(content));

ALTER TABLE public.entries DISABLE TRIGGER trg_journals_rollup_update;

UPDATE public.entries e
   SET word_count = public.fn_compute_word_count(e.content)
 WHERE e.word_count IS DISTINCT FROM public.fn_compute_word_count(e.content);

ALTER TABLE public.entries ENABLE TRIGGER trg_journals_rollup_update;

ALTER TABLE public.journals DISABLE TRIGGER trg_journals_updated_at;

UPDATE public.journals j
   SET entry_count = c.entry_count,
       total_word_count = c.total_word_count,
       hidden_entry_count = c.hidden_entry_count,
       hidden_word_count = c.hidden_word_count
  FROM (
    SELECT o.journal_id,
           count(e.entry_id) FILTER (WHERE NOT (e.is_hidden OR o.is_hidden))::integer AS entry_count,
           coalesce(sum(e.word_count) FILTER (WHERE NOT (e.is_hidden OR o.is_hidden)), 0)::integer AS total_word_count,
           count(e.entry_id) FILTER (WHERE e.is_hidden OR o.is_hidden)::integer AS hidden_entry_count,
           coalesce(sum(e.word_count) FILTER (WHERE e.is_hidden OR o.is_hidden), 0)::integer AS hidden_word_count
    FROM public.journals o
    LEFT JOIN public.entries e ON e.journal_id = o.journal_id AND e.deleted_at IS NULL
    GROUP BY o.journal_id, o.is_hidden
  ) AS c
 WHERE c.journal_id = j.journal_id
   AND (j.entry_count, j.total_word_count, j.hidden_entry_count, j.hidden_word_count)
       IS DISTINCT FROM (c.entry_count, c.total_word_count, c.hidden_entry_count, c.hidden_word_count);

ALTER TABLE public.journals ENABLE TRIGGER trg_journals_updated_at;
