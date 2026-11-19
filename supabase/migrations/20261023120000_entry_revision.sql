-- One entry open in two places (PRD 13, Section 1): a revision for every
-- entry, moved by the database, so that the app can apply a save only if it was
-- made from the entry as it now stands.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS CHANGES FOR EXISTING USERS
-- ---------------------------------------------------------------------------
-- `main` and `dev` share one database, so this reaches production on `db push`.
-- When it was written `main` and `dev` were the same commit (fa22b68). Every
-- write `main` makes to `entries` names its columns (`updateEntry`,
-- `createEntry`, `createEntryOnce`, `deleteEntry` in src/lib/data/entries.ts)
-- and none filters on a revision, so none is ever refused; the trigger below
-- moves the revision for them. Nothing selects `*` from `entries`, and no
-- function returns its row type.
--
--   1. Two columns:
--        revision      integer NOT NULL DEFAULT 1. Existing rows read 1. A
--                      constant default is stored in the catalog, so adding
--                      it rewrites no row and fires no trigger.
--        last_save_id  uuid, NULL. The id of the app save that made this
--                      revision, or NULL when anything else did.
--   2. A trigger, trg_entries_revision, that sets both on every INSERT and
--      UPDATE, whoever makes it.
--   3. INSERT and UPDATE on `last_save_id` for anon and authenticated. Nothing
--      on `revision`, which no role writes: the trigger overwrites it.
--
-- Unchanged: every other trigger, policy and grant. SELECT on `entries` is
-- granted on the table, so both new columns are readable as every other
-- column is; the save's WHERE clause needs nothing more. Both tables are in
-- the supabase_realtime publication; adding a column broadcasts nothing.
--
-- Undone by dropping the trigger and its function, revoking the two column
-- grants, and dropping both columns.
--
-- ---------------------------------------------------------------------------
-- THE CHECK THIS SERVES
-- ---------------------------------------------------------------------------
-- An app save (the autosave endpoint and the edit page's form) is one UPDATE:
--
--   UPDATE entries SET title, content, entry_date, last_save_id = <fresh id>
--    WHERE entry_id = $id AND deleted_at IS NULL
--      AND (revision = $expected OR last_save_id = ANY($unanswered))
--
-- `$unanswered` is the ids of the tab's own saves that were never answered.
-- A save applies at the revision the tab knew, or on top of one of the tab's
-- own saves that landed after the tab gave up on it. Every revision a tab
-- knows holds what that tab sent or loaded, so neither replaces a change made
-- elsewhere. A refused save matches no row: no row trigger fires, so nothing
-- is written (no updated_at, no journal bump, no media release, no broadcast).
-- docs/constraints.md, "One entry in two places", has the rest.
--
-- ---------------------------------------------------------------------------
-- WHEN THE REVISION MOVES
-- ---------------------------------------------------------------------------
-- When title, content or entry_date IS DISTINCT FROM its old value, as for
-- updated_at (fn_entries_set_updated_at), or when the statement carries a new
-- last_save_id. So every app save moves it, even one that changes nothing:
-- otherwise typing and then undoing would leave the revision where it was,
-- and an abandoned earlier save made at that revision could land late and
-- write the undone text back. updated_at does not move for such a save.
--
-- A write that changes one of the three without a new save id (rename from a
-- journal's page, `main`'s saves, anything as `postgres`) also sets
-- last_save_id to NULL. Without that, the row would still name the last app
-- save, and the tab that made it could save over the rename as if the row were
-- still its own.
--
-- Delete, restore, the journal cascade, the purge, the flags and a word_count
-- recompute change none of the four, so none moves it.
--
-- ---------------------------------------------------------------------------
-- THE TRIGGERS AN UPDATE OF ENTRIES FIRES, AND THIS ONE'S PLACE AMONG THEM
-- ---------------------------------------------------------------------------
-- BEFORE triggers run in name order:
--
--   trg_entries_pinned_at    BEFORE INSERT OR UPDATE: pinned_at from is_pinned.
--   trg_entries_revision     BEFORE INSERT OR UPDATE: this one. Reads title,
--                            content, entry_date and last_save_id, which no
--                            BEFORE trigger changes, so the order is immaterial.
--   trg_entries_updated_at   BEFORE UPDATE: stamps updated_at when one of the
--                            three changed. It does not read last_save_id or
--                            revision, so a save that changes nothing leaves
--                            updated_at alone, as before.
--   trg_entries_word_count   BEFORE INSERT OR UPDATE OF content, word_count.
--
-- AFTER triggers, unchanged and unaffected:
--
--   trg_journals_bump_on_entry_edit   AFTER UPDATE: bumps the journal only when
--                                     updated_at moved, so not for a no-op save.
--   trg_entries_release_media_update  AFTER UPDATE OF content WHEN the body held
--                                     a path and changed.
--   trg_journals_rollup_update        AFTER UPDATE OF deleted_at, word_count,
--                                     is_hidden: an app save names none.
--   trg_tags_usage_on_entry_hidden    AFTER UPDATE OF is_hidden, deleted_at:
--                                     not named.
--   trg_journals_rollup_insert, trg_journals_rollup_delete,
--   trg_entries_release_media_delete  INSERT and DELETE, as before.
--
-- `UPDATE OF` keys on the columns a statement names. An app save now also
-- names last_save_id, which no `UPDATE OF` list includes.

ALTER TABLE public.entries
  ADD COLUMN revision integer NOT NULL DEFAULT 1,
  ADD COLUMN last_save_id uuid;

COMMENT ON COLUMN public.entries.revision IS
  'Moves on every change to title, content or entry_date, and on every app save. Set only by trg_entries_revision. See 20261023120000_entry_revision.';
COMMENT ON COLUMN public.entries.last_save_id IS
  'The app save that made this revision, or NULL when anything else did. See 20261023120000_entry_revision.';

CREATE FUNCTION public.fn_entries_revision()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.revision := 1;
    RETURN NEW;
  END IF;

  IF NEW.title IS DISTINCT FROM OLD.title
     OR NEW.content IS DISTINCT FROM OLD.content
     OR NEW.entry_date IS DISTINCT FROM OLD.entry_date
     OR NEW.last_save_id IS DISTINCT FROM OLD.last_save_id
  THEN
    NEW.revision := OLD.revision + 1;
    -- A change made without a new save id is nobody's app save.
    IF NEW.last_save_id IS NOT DISTINCT FROM OLD.last_save_id THEN
      NEW.last_save_id := NULL;
    END IF;
  ELSE
    NEW.revision := OLD.revision;
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_entries_revision() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.fn_entries_revision() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_entries_revision
  BEFORE INSERT OR UPDATE ON public.entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_entries_revision();

-- Added to the lists in 20260921120000_narrow_client_writes. `revision` is in
-- neither, and must stay out: the WHERE clause above is only a check if the
-- client cannot set the value it is checked against.
GRANT INSERT (last_save_id) ON public.entries TO anon, authenticated;
GRANT UPDATE (last_save_id) ON public.entries TO anon, authenticated;
