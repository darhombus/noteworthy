-- purge-deleted, without the step that made it fail every night.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG
-- ---------------------------------------------------------------------------
-- The job (20260101000003_cron_purge) began with a DELETE FROM storage.objects,
-- to clear the files of media about to be purged. Storage no longer allows
-- that: `storage.protect_objects_delete` is a BEFORE DELETE ... FOR EACH
-- STATEMENT trigger that raises 42501, "Direct deletion from storage tables is
-- not allowed", unless the transaction has set `storage.allow_delete_query`.
-- Being statement-level, it fires even when the DELETE matches no row, and the
-- error aborts the rest of the job. On the hosted project every run from
-- 2026-09-17 to 2026-09-22 failed that way, so no soft-deleted entry, journal or
-- media row has ever been purged.
--
-- Setting `storage.allow_delete_query` would make the statement run, and would
-- be wrong: it deletes the row and leaves the stored bytes behind, where nothing
-- can find them. Files are deleted through the Storage API or not at all.
--
-- ---------------------------------------------------------------------------
-- WHAT THE JOB DOES NOW
-- ---------------------------------------------------------------------------
-- The rows only: media rows soft-deleted over thirty days ago, then entries,
-- then journals. Removing an entry or journal takes its entry_tags and media
-- rows with it (ON DELETE CASCADE). Names are schema-qualified; the job used to
-- rely on the search_path it happened to run with.
--
-- Files are no longer this job's business. A purged entry's files become files
-- no entry refers to, and the Section 5 cleanup job — which goes through the
-- Storage API — removes those. Until it exists they stay, and keep counting
-- against their owner's 70 MB allowance.
--
-- The job keeps its name, id, schedule (03:00 UTC), owner and run history:
-- cron.alter_job changes the command and nothing else. SELECT ... INTO STRICT
-- fails the migration unless there is exactly one job by this name, and
-- alter_job refuses a job the migrating role does not own, so neither a
-- missing job nor a second one can pass quietly.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS CHANGES FOR EXISTING USERS
-- ---------------------------------------------------------------------------
-- The thirty-day retention the app has always described starts happening: from
-- the next 03:00 UTC after this is pushed, anything soft-deleted more than thirty
-- days earlier is removed for good. On the hosted project the oldest soft-delete
-- was 2026-09-21 when this was written, so nothing is removed before 2026-10-21.

DO $$
DECLARE
  job bigint;
BEGIN
  SELECT jobid INTO STRICT job FROM cron.job WHERE jobname = 'purge-deleted';

  PERFORM cron.alter_job(
    job,
    command := $job$
  -- media rows soft-deleted over thirty days ago. Nothing writes this table
  -- since 20260922120000_private_media; the step stays while the table does.
  DELETE FROM public.media WHERE deleted_at < now() - interval '30 days';

  -- Entries, then journals. Their entry_tags and media rows go with them.
  DELETE FROM public.entries WHERE deleted_at < now() - interval '30 days';
  DELETE FROM public.journals WHERE deleted_at < now() - interval '30 days';
$job$
  );
END;
$$;
