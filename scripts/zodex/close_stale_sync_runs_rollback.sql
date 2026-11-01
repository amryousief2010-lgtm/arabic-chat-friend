-- MANUAL ROLLBACK for close_stale_sync_runs.sql. Restores only rows it closed.
BEGIN;
UPDATE public.zodex_sync_runs
   SET status = 'running',
       finished_at = NULL,
       error_message = NULL
 WHERE error_message LIKE '[stale_close_20261028]%';
COMMIT;
