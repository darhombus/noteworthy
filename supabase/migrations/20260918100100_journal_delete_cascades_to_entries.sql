-- Soft-deleting a journal soft-deletes its entries.
--
-- WHAT THE SCHEMA DID BEFORE THIS: nothing. entries.journal_id carries
-- ON DELETE CASCADE, which is real and correct-looking in the schema, but it
-- fires on a hard DELETE and this app never issues one — deleting sets
-- deleted_at. The only hard delete is the nightly purge, thirty days later.
-- Established by doing it rather than by reading the constraint: soft-deleting
-- a journal with two entries over the API left both entries with deleted_at
-- NULL, live under a journal that was gone. No trigger or rule on either table
-- touched them.
--
-- A trigger rather than application code, because a journal can be soft-deleted
-- from more paths than the one somebody remembers to patch: a form action
-- today, the recycle bin's purge later, an admin script in between. Application
-- code covers the paths it knows about; this covers the column.

-- ---------------------------------------------------------------------------
-- The marker
-- ---------------------------------------------------------------------------
-- Nothing in this migration, and nothing in the PRD it belongs to, reads this
-- column. It is written now because it cannot be written later: once a cascade
-- has happened without it, the information it would hold is gone, and a
-- retrofit would be a migration guessing at rows that are already deleted.

ALTER TABLE public.entries
  ADD COLUMN IF NOT EXISTS deleted_with_journal boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.entries.deleted_with_journal IS
  'True when this entry was deleted because its journal was, rather than on its '
  'own. Nothing reads it yet. It exists so the Recycle Bin can tell those two '
  'cases apart when restoring a journal: the restore must bring back the '
  'entries that went down with it and leave alone an entry the person deleted '
  'separately a week earlier, and once both are just a deleted_at timestamp '
  'they are indistinguishable. Retrofitting it later is a migration against '
  'rows whose history is already lost. Maintained by '
  'trg_journals_soft_delete_cascade — not written from application code. Note '
  'that this is convention, not enforcement: the table-level UPDATE grant on '
  'entries still covers this column, and narrowing it means revoking UPDATE on '
  'the table and re-granting per column, the way 20260101000005 does for the '
  'journals counters. That is the Recycle Bin PRD''s call to make, once it '
  'depends on the value.';

-- The marker only means anything on a row that is actually deleted, and the
-- expensive mistake is a restore that clears deleted_at and leaves the flag
-- behind: the row then looks like a live entry carrying a claim about a
-- deletion that no longer exists, and the next cascade cannot tell whether it
-- was already down. The constraint makes that a loud failure at the moment a
-- future restore forgets, rather than a quiet wrong answer months later.
ALTER TABLE public.entries
  DROP CONSTRAINT IF EXISTS entries_cascade_marker_needs_deletion;

ALTER TABLE public.entries
  ADD CONSTRAINT entries_cascade_marker_needs_deletion
  CHECK (NOT deleted_with_journal OR deleted_at IS NOT NULL);

-- ---------------------------------------------------------------------------
-- The cascade
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, as fn_journals_rollup is and for the same reason: the
-- cascade has to complete whoever ran the delete. A caller who can reach the
-- journal but not every one of its entries would otherwise leave exactly the
-- orphan this exists to prevent — half the entries live under a journal that is
-- gone — and would do it without erroring. search_path is pinned to pg_catalog
-- and every reference is schema-qualified, matching the other trigger functions
-- here; an unqualified name in a SECURITY DEFINER function is how the account
-- deletion failure in fixture-teardown.test.ts happened.
--
-- Entries that were already deleted are left alone. That is the whole point of
-- the WHERE clause: they keep their own timestamp and their own false marker,
-- so a later restore can put back what the journal took and nothing else.
--
-- Only the live-to-deleted direction is handled. Un-deleting a journal is a
-- restore, and what a restore should do with these rows is the Recycle Bin
-- PRD's decision, not this one's.

CREATE OR REPLACE FUNCTION public.fn_entries_cascade_journal_delete()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  UPDATE public.entries
     SET deleted_at           = NEW.deleted_at,
         deleted_with_journal = true
   WHERE journal_id = NEW.journal_id
     AND deleted_at IS NULL;

  RETURN NULL;
END;
$function$;

ALTER FUNCTION public.fn_entries_cascade_journal_delete() OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.fn_entries_cascade_journal_delete()
  FROM PUBLIC, anon, authenticated;

-- AFTER UPDATE OF deleted_at, with the transition spelled out in WHEN so the
-- function is not entered for a restore or for a re-stamped timestamp.
--
-- The UPDATE this fires names deleted_at and deleted_with_journal on entries,
-- which is enough for trg_journals_rollup_update (AFTER UPDATE OF deleted_at,
-- word_count, is_hidden) to recompute the journal's counters — so a deleted
-- journal's counters fall to zero rather than describing rows nobody can see.
-- It does not re-enter this trigger: the rollup's own UPDATE on journals names
-- only the four counter columns, and the WHEN clause would refuse it anyway.
CREATE OR REPLACE TRIGGER trg_journals_soft_delete_cascade
  AFTER UPDATE OF deleted_at ON public.journals
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION public.fn_entries_cascade_journal_delete();
