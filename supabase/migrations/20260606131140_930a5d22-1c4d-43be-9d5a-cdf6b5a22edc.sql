ALTER TABLE public.hatch_batches ADD COLUMN IF NOT EXISTS operational_batch_no integer;

-- Backfill: per machine, dense_rank by entry_date asc (matches sheet ordering)
WITH ranked AS (
  SELECT id,
         DENSE_RANK() OVER (PARTITION BY COALESCE(machine,'—') ORDER BY entry_date NULLS LAST, receive_date) AS rk
  FROM public.hatch_batches
  WHERE operational_batch_no IS NULL
)
UPDATE public.hatch_batches b
SET operational_batch_no = r.rk
FROM ranked r
WHERE b.id = r.id AND b.operational_batch_no IS NULL;

CREATE INDEX IF NOT EXISTS idx_hatch_batches_op_no ON public.hatch_batches(machine, operational_batch_no);