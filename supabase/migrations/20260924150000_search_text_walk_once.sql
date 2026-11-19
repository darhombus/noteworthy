-- `search_text` held every entry's body twice. This makes it hold it once, and
-- recomputes the value already stored on every row.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG
-- ---------------------------------------------------------------------------
-- `entries.search_text` is a stored generated column:
--
--   COALESCE(title, '') || ' ' || public.extract_tiptap_text(content)
--
-- `extract_tiptap_text` walked the body with `$.** ? (@.type == "text")` in
-- lax jsonpath mode. Lax mode unwraps arrays automatically, so `.**` reached
-- each `content` array's text nodes twice, and each block's text came out
-- twice in a row: paragraphs A, B, C were stored as "A A B B C C", and one
-- paragraph of two formatted runs as "P1 P2 P1 P2". The title was not doubled.
-- `fn_compute_word_count` does the same walk in `strict` mode, with a comment
-- saying that is what stops the doubling, so `word_count` was always right.
--
-- It was known, and recorded as harmless: "search matches on the same terms,
-- only ts_rank is affected". That was wrong for the search functions already
-- in this database, though nothing in the app calls them yet:
--
--   search_entries   also matches `lower(search_text) LIKE '%query%'`. With
--                    each block repeated, a block's last words run into its
--                    own first words, so a body "garden gate" matched the
--                    query "te ga", and "one two" matched the substring
--                    "two one". Its snippet, `LEFT(search_text, 200)`, showed
--                    a short entry's text twice. It does not use ts_rank.
--   search_index_entries
--                    returns `search_text` to the browser, so it sent every
--                    body twice.
--
-- Full-text matching (`to_tsvector @@ build_prefix_tsquery`) ANDs the query's
-- words, so the repetition never changed what that path matched.
--
-- On hosted, when this was written (2026-09-24), 4 of the 6 entry rows had
-- body text (1 live, 3 soft-deleted), and all 4 were doubled.
--
-- ---------------------------------------------------------------------------
-- 1. THE WALK, ONCE
-- ---------------------------------------------------------------------------
-- The same path, mode and silent flag as `fn_compute_word_count`, so the two
-- readers of a body cannot disagree about what text it holds. `strict` makes
-- `.**` visit each node once; `silent => true` turns strict mode's structural
-- errors (`.type` on a string, say) into "no match" instead of an exception.
-- `.text` is read in the path, and `#>> '{}'` takes the bare string. Text
-- anywhere but a `text` node's `text` (an href, a node type) is still left out.
--
-- The signature is unchanged, so this is CREATE OR REPLACE: no second
-- overload, and the owner, grants and generated types stay as they are.
-- Still IMMUTABLE, as a generated column requires, and still with its
-- search_path pinned.

CREATE OR REPLACE FUNCTION public.extract_tiptap_text(doc jsonb)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'pg_catalog'
AS $$
  SELECT coalesce(string_agg(val #>> '{}', ' '), '')
  FROM jsonb_path_query(
    coalesce(doc, '{}'::jsonb),
    'strict $.** ? (@.type == "text").text',
    '{}',
    true
  ) AS val;
$$;

-- ---------------------------------------------------------------------------
-- 2. RECOMPUTING WHAT IS ALREADY STORED
-- ---------------------------------------------------------------------------
-- A stored generated column is computed when a row is written, not when it is
-- read. Replacing the function changes nothing already stored: every existing
-- row would keep its doubled text until its body was next saved, and entries
-- nobody edits again, soft-deleted ones included, would keep it for good.
-- Checked on the local stack: after the replace alone, the old value was still
-- there.
--
-- SET EXPRESSION (Postgres 17; hosted and local both run 17.6) with the
-- column's own, unchanged expression is how to make Postgres recompute it.
--
-- WHAT IT DOES: it REWRITES THE TABLE. `entries` is copied into a new file
-- with every row's `search_text` computed afresh. Both indexes built on the
-- column (`fts_entries`, the full-text GIN, and `trgm_entries_search`, the
-- trigram GIN) are rebuilt with it, along with the table's other indexes. It
-- holds an ACCESS EXCLUSIVE lock on `entries` until it finishes, so every read
-- and write of an entry waits for it, on `main` and `dev` alike since they
-- share this database. On hosted's 6 rows that is milliseconds (16 ms locally
-- in a dry run on a comparable table).
--
-- WHAT IT DOES NOT DO: it is DDL, not an UPDATE, so no row trigger fires.
-- `updated_at` keeps its value (`fn_entries_set_updated_at` never runs, so
-- lists are not reordered), `word_count` is not recomputed, the journal
-- rollup and journal bump do not run, and no media is released.
--
-- Why not `UPDATE entries SET content = content`: that would recompute the
-- column too, but it runs every row trigger on every row, and it only reaches
-- rows the UPDATE's own conditions select, which is easy to get subtly wrong.

ALTER TABLE public.entries
  ALTER COLUMN search_text
  SET EXPRESSION AS ((COALESCE(title, ''::text) || ' '::text) || public.extract_tiptap_text(content));
