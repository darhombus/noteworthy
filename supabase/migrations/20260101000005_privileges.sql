-- Privileges. `supabase db dump` carries tables, policies and functions but not
-- the privilege posture: it emits grants, and Supabase's pg_default_acl grants
-- broadly on object creation, so a dumped schema arrives with anon and
-- authenticated holding everything the old project had deliberately revoked.
--
-- Every statement below is copied from the old project's chain — the 20260714
-- baseline grants and the 20260912 revokes layered on top — not reconstructed.
-- Order matters: the broad grants come first, the narrowing after.

-- ---------------------------------------------------------------------------
-- 1. Baseline API access (from 20260714145121_grant_public_api_access.sql)
-- ---------------------------------------------------------------------------
-- Mostly redundant with pg_default_acl on a fresh project, but stated
-- explicitly so the posture is readable here rather than inherited invisibly.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  TO anon, authenticated, service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
  TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES
  TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. journals: column-level UPDATE (NW-58)
-- ---------------------------------------------------------------------------
-- A table-level UPDATE grant leaves the rollup counters and user_id writable by
-- the client. Revoke the table grant and name the columns a client may write.
-- Everything omitted here — the counter columns and user_id — is maintained by
-- triggers and is not the client's to set.

REVOKE UPDATE ON public.journals FROM anon, authenticated;

GRANT UPDATE (
  journal_id,
  title,
  description,
  color,
  icon,
  is_favorite,
  deleted_at,
  created_at,
  updated_at
) ON public.journals TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. EXECUTE, stated for every chain-authored function (NW-60)
-- ---------------------------------------------------------------------------
-- PUBLIC is named alongside anon and authenticated in every REVOKE below. The
-- old project's migration 029 revoked from PUBLIC alone, which left the role
-- grants pg_default_acl had attached at creation time — which is why that
-- revocation was never in effect on any database.

REVOKE EXECUTE ON FUNCTION public.build_prefix_tsquery(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.extract_tiptap_text(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_compute_word_count(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_entries_pinned_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_entries_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_entries_word_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_journals_bump_from_entry_edit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_journals_rollup() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_journals_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_tags_usage_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_tags_usage_count_for_entry() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_tags_usage_count_for_journal() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.search_entries(uuid, text, text, uuid, date, date, boolean, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.search_index_entries(uuid, text) FROM PUBLIC, anon, authenticated;

-- The three RPCs the app actually calls, granted back deliberately.
GRANT EXECUTE ON FUNCTION public.get_dashboard_snapshot() TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_entries(uuid, text, text, uuid, date, date, boolean, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_index_entries(uuid, text) TO authenticated;

-- Three helpers the app calls directly.
GRANT EXECUTE ON FUNCTION public.fn_compute_word_count(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.extract_tiptap_text(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.build_prefix_tsquery(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Future functions are not granted by default
-- ---------------------------------------------------------------------------
-- Without this, every function created from here is auto-granted to anon and
-- authenticated at creation time and has to be revoked one at a time — which is
-- exactly how the old project accumulated eighteen of them.
--
-- ALTER DEFAULT PRIVILEGES is owner-scoped: it alters the row belonging to the
-- role that runs it. Migrations apply as postgres, which owns that row and
-- every function here, so this reaches the row that matters.

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Grants with no policy behind them (NW-64)
-- ---------------------------------------------------------------------------
-- Each of these was a silent no-op: the grant existed, no policy covered it, so
-- the operation neither succeeded nor errored. Revoked so the catalog records a
-- decision rather than an oversight.
--
-- media UPDATE is the one to remember: the old app's orphan-media cleanup on
-- entry save calls it and has never worked on any database. When media handling
-- is built, that path needs a policy written deliberately.

REVOKE DELETE ON public.profiles FROM anon, authenticated;
REVOKE UPDATE ON public.entry_tags FROM anon, authenticated;
REVOKE UPDATE ON public.media FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Verbs no client should ever hold
-- ---------------------------------------------------------------------------
-- pg_default_acl grants TRUNCATE, TRIGGER and REFERENCES alongside the four
-- verbs the API needs. The old project never revoked these; this is new, and it
-- is the one statement here without a precedent in the old chain.

REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;
