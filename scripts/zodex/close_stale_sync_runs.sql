-- MANUAL, NOT A MIGRATION. Do not run without المدير العام approval.
-- Closes zodex_sync_runs rows stuck in "running" for more than 30 minutes
-- (killed edge workers). Touches zodex_sync_runs only — no orders/stock/ledger.
-- Marker text lets the rollback find exactly these rows.
BEGIN;
SELECT count(*) AS will_close
  FROM public.zodex_sync_runs
 WHERE status = 'running' AND started_at < now() - interval '30 minutes';

UPDATE public.zodex_sync_runs
   SET status = 'error',
       finished_at = now(),
       error_message = '[stale_close_20261028] worker ended without closing the run (stuck >30 min)'
 WHERE status = 'running'
   AND started_at < now() - interval '30 minutes';
COMMIT;
