-- Narrow what anon and authenticated may write on entries and journals.
--
-- Before this migration a signed-in client, with its own session and the
-- publishable key, could choose the value of `entries.word_count` and of every
-- journal counter:
--
--   entries   held table-wide INSERT and UPDATE, so any column was writable.
--             `fn_entries_word_count` recomputes on INSERT and on UPDATE OF
--             content, but an UPDATE naming `word_count` alone fired nothing,
--             kept the client's figure, and — because `trg_journals_rollup_update`
--             fires on UPDATE OF word_count — carried it into the journal's
--             `total_word_count` too. Negative values included.
--
--   journals  held table-wide INSERT, and nothing on the table resets the
--             counters at creation, so a journal could be born with any four
--             counters it liked and keep them until some entry operation
--             re-derived them.
--
-- RLS confined all of it to the caller's own rows; it was never a cross-user
-- leak. It was an integrity hole in figures the schema treats as derived.
--
-- ---------------------------------------------------------------------------
-- A CORRECTION TO 20260101000005_privileges.sql
-- ---------------------------------------------------------------------------
-- Its section 2 says the columns it leaves out of the journals UPDATE grant —
-- "the counter columns and user_id" — are "maintained by triggers and not the
-- client's to set". Two parts of that were not true:
--
--   It narrowed UPDATE only. Table-wide INSERT stayed, so the client could set
--   every counter at creation. Closed below.
--
--   `user_id` is not maintained by any trigger. The client supplies it on
--   INSERT, and the insert policy's WITH CHECK requires it to equal
--   auth.uid(). That is still how it works; it is granted for INSERT below
--   because the app sends it, and never for UPDATE.
--
-- Its UPDATE list was also wider than anything writes: it granted `journal_id`
-- and `created_at`, which let a client renumber its own journal or backdate
-- it. Neither has ever been sent. Both are dropped below.
--
-- That migration also never narrowed `entries` at all, which is the larger of
-- the two holes. It is left unedited; this is the record.
--
-- ---------------------------------------------------------------------------
-- THE GRANTS
-- ---------------------------------------------------------------------------
-- Each list is exactly what application code writes — on `main` and on `dev`,
-- because both run against one database and `main` meets these grants the
-- moment they are pushed. Every write goes through `src/lib/data/`:
--
--   entries INSERT   journal_id, title, content, entry_date  (createEntry)
--                    entry_id                                 (createEntryOnce)
--   entries UPDATE   title, content, entry_date               (updateEntry,
--                                                              createEntryOnce)
--                    deleted_at                               (deleteEntry)
--   journals INSERT  user_id, title, description, color, icon (createJournal)
--   journals UPDATE  title, description, color, icon          (updateJournal)
--                    is_favorite                              (JournalEdit offers
--                                                              it; no form sends
--                                                              it yet)
--                    deleted_at                               (deleteJournal)
--                    updated_at                               (the journal bump —
--                                                              see below)
--
-- Never granted, whatever a future feature wants: `word_count`, `search_text`
-- (generated; Postgres refuses it anyway), the four journal counters, and
-- `deleted_with_journal`, which only the journal-delete cascade sets. UPDATE is
-- never granted on `entry_id`, `journal_id` (on entries, moving is FINDING 7-B;
-- on journals, it would renumber one), `created_at`, or on `user_id`.
--
-- Deliberately not granted because nothing writes them yet: `is_hidden`,
-- `is_pinned`, `is_favorite` on entries. The feature that first writes one
-- adds its grant in the same change — and `is_hidden` should arrive through
-- the vault's own server-side check rather than as a column grant, or the
-- grant would be a way round the vault.
--
-- Unaffected: the functions that write these tables as `postgres`
-- (fn_handle_new_user, fn_entries_cascade_journal_delete, fn_journals_rollup,
-- the purge job), and the BEFORE triggers, which change NEW and need no
-- privilege. The one exception is fn_journals_bump_from_entry_edit: it is not
-- SECURITY DEFINER, so when somebody edits an entry it writes
-- `journals.updated_at` as that person. That is the only reason `updated_at` is
-- in the journals UPDATE grant, and taking it out would make every entry edit
-- fail. `service_role` keeps ALL.
--
-- Revoking a table-level privilege also removes it from every column, so the
-- REVOKE clears the ground and the GRANTs name what comes back.

REVOKE INSERT, UPDATE ON public.entries FROM anon, authenticated;

GRANT INSERT (entry_id, journal_id, title, content, entry_date)
  ON public.entries TO anon, authenticated;

GRANT UPDATE (title, content, entry_date, deleted_at)
  ON public.entries TO anon, authenticated;

-- UPDATE on journals was already column-level; this replaces the list rather
-- than adding to it. Revoking UPDATE on the table takes the old column grants
-- with it.
REVOKE INSERT, UPDATE ON public.journals FROM anon, authenticated;

GRANT INSERT (user_id, title, description, color, icon)
  ON public.journals TO anon, authenticated;

GRANT UPDATE (title, description, color, icon, is_favorite, deleted_at, updated_at)
  ON public.journals TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- A SECOND LAYER UNDER THE GRANTS
-- ---------------------------------------------------------------------------
-- `word_count` is recomputed on any UPDATE that names it, not only on one that
-- names `content`. For anon and authenticated this branch is now unreachable —
-- they cannot name the column at all — so it guards the roles the grants do
-- not: `service_role`, `postgres`, and any SECURITY DEFINER function written
-- later. It changes nothing for FINDING 7-A, which is about UPDATEs that name
-- `content` and not `word_count`.
CREATE OR REPLACE TRIGGER trg_entries_word_count
  BEFORE INSERT OR UPDATE OF content, word_count ON public.entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_entries_word_count();
