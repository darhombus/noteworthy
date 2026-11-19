-- Fixes to apply to schema-baseline.sql before it becomes migration 0001
-- of the new project. Six known defects, found by reading the catalog rather
-- than the code. Three are exact and written below. Two need one read first.
-- One is already fixed in the dump and needs nothing.

-- ---------------------------------------------------------------------------
-- READ THIS FIRST
-- ---------------------------------------------------------------------------
-- Policy names below are my best guess from how they were described. Confirm
-- them before running, or the DROP silently targets nothing:
--
--   \d public.profiles
--
-- And check whether anon holds any grant on profiles, which decides whether
-- the REVOKE lines need anon as well as authenticated:
--
--   SELECT grantee, privilege_type, column_name
--   FROM information_schema.column_privileges
--   WHERE table_name = 'profiles'
--   UNION ALL
--   SELECT grantee, privilege_type, NULL
--   FROM information_schema.table_privileges
--   WHERE table_name = 'profiles';

-- ---------------------------------------------------------------------------
-- 1. profiles INSERT: a policy that can never be satisfied
-- ---------------------------------------------------------------------------
-- fn_handle_new_user is the only thing that creates profile rows, and it runs
-- as the trigger owner. So the INSERT policy only ever gets tried against a row
-- the primary key already refuses. Dropping the policy without revoking the
-- grant would leave a grant with nothing behind it, which records no decision —
-- an absent grant and a never-considered grant look identical in the catalog.

DROP POLICY IF EXISTS "profiles: insert own" ON public.profiles;
REVOKE INSERT ON public.profiles FROM anon, authenticated;

COMMENT ON TABLE public.profiles IS
  'Rows are created only by fn_handle_new_user on auth.users insert. Clients '
  'have no INSERT path by design: the policy was dropped and the grant revoked '
  'together, so the absence is a decision rather than an oversight.';

-- ---------------------------------------------------------------------------
-- 2. Credential material readable alongside display fields
-- ---------------------------------------------------------------------------
-- profiles carries privacy_pin_hash and vault_secret_hash on the same row as
-- full_name and avatar_url. RLS scopes the row to its owner; it does not scope
-- the column, so a select('*') on any server-side render pulls a PIN hash into
-- the page. A column-level REVOKE does nothing here because the table-level
-- grant covers everything — it has to be revoked at the table and re-granted
-- per column.

REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (
  user_id,
  full_name,
  avatar_url,
  preferences,
  created_at,
  updated_at,
  privacy_pin_type,
  vault_secret_type,
  vault_auto_lock_minutes
) ON public.profiles TO authenticated;

-- Nine of eleven columns. privacy_pin_hash and vault_secret_hash are withheld.
-- Consequence: the vault check cannot read the hash as the logged-in user. See
-- the constraints page — it needs a SECURITY DEFINER function that takes a
-- candidate secret and returns a boolean, never the hash itself.

-- ---------------------------------------------------------------------------
-- 3. No table forces RLS
-- ---------------------------------------------------------------------------
-- This changes nothing today: the tables are owned by postgres, which holds
-- BYPASSRLS, and such roles skip RLS even when it is forced. It matters the
-- first time anything runs as a non-bypassing owner. Cheap now, easy to forget
-- later.

ALTER TABLE public.journals    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.entries     FORCE ROW LEVEL SECURITY;
ALTER TABLE public.media       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tags        FORCE ROW LEVEL SECURITY;
ALTER TABLE public.entry_tags  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles    FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4 and 5. The two counter defects — NOT WRITTEN, needs one read
-- ---------------------------------------------------------------------------
-- 7-A: editing an entry body leaves journals.total_word_count stale.
-- 7-B: moving an entry between journals updates neither journal's counters.
--
-- Both live in the rollup trigger. I am not writing this SQL blind: the counter
-- pairs (public and hidden) interact with soft-delete and with journal-level
-- hiding, and a wrong fix here corrupts counts silently rather than erroring.
--
-- Print the current definitions:
--
--   SELECT p.proname, pg_get_functiondef(p.oid)
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname LIKE '%rollup%';
--
--   SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--   WHERE tgrelid = 'public.entries'::regclass AND NOT tgisinternal;
--
-- What has to change, in substance:
--   7-A — the UPDATE branch must recompute word count when the body changes,
--         not only when hidden-ness or journal membership changes.
--   7-B — a change of journal_id is a move: decrement the old journal's pair
--         and increment the new one's, in the same statement.
--
-- The RLS suite already has failing-by-design assertions for both, named
-- "FINDING 7-A" and "FINDING 7-B". Those going green is the acceptance test.
-- Do not edit the assertions to match the implementation.

-- ---------------------------------------------------------------------------
-- 6. Grants with no policy behind them — ALREADY FIXED
-- ---------------------------------------------------------------------------
-- profiles DELETE, entry_tags UPDATE and media UPDATE were granted with no
-- policy covering them, so each was a silent no-op that neither succeeded nor
-- errored. All three were revoked in the old project and the dump carries that
-- state. Nothing to do — recorded so it is not rediscovered as a defect.
--
-- media UPDATE is the one worth remembering: the old app's orphan-media cleanup
-- on entry save calls it, and has never worked on any database. When you build
-- media handling, that path needs a policy written deliberately, not restored
-- by reflex.
