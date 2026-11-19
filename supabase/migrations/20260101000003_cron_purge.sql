-- 30-day retention. Nightly at 03:00: clear storage objects for media about to
-- be removed, then the media rows, then soft-deleted entries and journals.
-- cron jobs live in the cron schema and are NOT carried by `supabase db dump`.
-- Rescued from the old project's cron.job table (jobid 2, 'purge-deleted').
--
-- Requires pg_cron, which the baseline migration creates. Run this after it.

SELECT cron.schedule(
  'purge-deleted',
  '0 3 * * *',
  $job$


  -- Step A: Delete storage.objects rows for every media file that
  -- will be removed in this cron run, BEFORE row-level cascades fire.
  -- Covers three cases:
  --   (i)  Media explicitly soft-deleted by the reconcile-on-save logic
  --        (orphaned images the user removed from an entry and saved).
  --   (ii) Media belonging to entries that are about to be hard-purged.
  --   (iii)Media belonging to journals (via their entries) about to be
  --        hard-purged.
  DELETE FROM storage.objects
  WHERE bucket_id = 'media'
    AND name IN (
      SELECT m.object_path
      FROM   media m
      WHERE  m.object_path IS NOT NULL
        AND (
          -- (i) Soft-deleted orphan past its 30-day grace period
          m.deleted_at < NOW() - INTERVAL '30 days'

          -- (ii) Entry about to be hard-purged
          OR m.entry_id IN (
            SELECT entry_id
            FROM   entries
            WHERE  deleted_at < NOW() - INTERVAL '30 days'
          )

          -- (iii) Entry belonging to a journal about to be hard-purged
          OR m.entry_id IN (
            SELECT e.entry_id
            FROM   entries  e
            JOIN   journals j ON j.journal_id = e.journal_id
            WHERE  j.deleted_at < NOW() - INTERVAL '30 days'
          )
        )
    );

  -- Step B: Hard-delete soft-deleted media rows whose storage objects
  -- were cleared above.
  DELETE FROM media
  WHERE deleted_at < NOW() - INTERVAL '30 days';

  -- Step C: Purge old entries and journals.  Any remaining media rows
  -- for these entries are removed by ON DELETE CASCADE; their storage
  -- objects were already cleared in Step A.
  DELETE FROM entries  WHERE deleted_at < NOW() - INTERVAL '30 days';
  DELETE FROM journals WHERE deleted_at < NOW() - INTERVAL '30 days';



  $job$
);