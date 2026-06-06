-- Lock operational stage of hatch batches to match real-world status as of 2026-06-06:
-- Batches 1-16 are fully hatched, exited and customer-billed → mark as completed/exited
-- Batch 17 is currently in the hatcher → mark as in_hatcher
-- Batches 18+ keep their natural computed stage (pending → auto by dates)
-- IMPORTANT: temporarily disable trg_sync_completed_batch_to_chicks so we DO NOT
-- create new chick_movements rows for historical imported batches (their chicks
-- were already accounted for in legacy records).

ALTER TABLE public.hatch_batches DISABLE TRIGGER trg_sync_completed_batch_to_chicks;

-- 1) Force batches 1..16 to completed + ensure exit_date is set
UPDATE public.hatch_batches
SET status = 'completed',
    exit_date = COALESCE(exit_date, entry_date + INTERVAL '42 days', receive_date + INTERVAL '42 days', CURRENT_DATE)
WHERE is_test IS NOT TRUE
  AND (customer_id IS NOT NULL OR entry_date IS NOT NULL OR machine IS NOT NULL)
  AND operational_batch_no BETWEEN 1 AND 16;

-- 2) Force batch 17 to in_hatcher, clear any stale exit_date
UPDATE public.hatch_batches
SET status = 'in_hatcher',
    exit_date = NULL
WHERE is_test IS NOT TRUE
  AND (customer_id IS NOT NULL OR entry_date IS NOT NULL OR machine IS NOT NULL)
  AND operational_batch_no = 17;

ALTER TABLE public.hatch_batches ENABLE TRIGGER trg_sync_completed_batch_to_chicks;