ALTER TABLE public.hatch_batches DISABLE TRIGGER trg_sync_completed_batch_to_chicks;

UPDATE public.hatch_batches
SET status = 'pending',
    exit_date = NULL
WHERE is_test IS NOT TRUE
  AND (customer_id IS NOT NULL OR entry_date IS NOT NULL OR machine IS NOT NULL)
  AND operational_batch_no = 19;

ALTER TABLE public.hatch_batches ENABLE TRIGGER trg_sync_completed_batch_to_chicks;