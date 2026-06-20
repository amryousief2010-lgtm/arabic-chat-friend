
ALTER TABLE public.farm_to_hatchery_shipments
  ADD COLUMN IF NOT EXISTS transfer_batch_id uuid;

CREATE INDEX IF NOT EXISTS idx_fth_transfer_batch ON public.farm_to_hatchery_shipments(transfer_batch_id);

-- Backfill: group existing rows by created_at second (each click historically clustered there)
WITH groups AS (
  SELECT date_trunc('second', created_at) AS bucket, gen_random_uuid() AS bid
  FROM public.farm_to_hatchery_shipments
  WHERE transfer_batch_id IS NULL
  GROUP BY 1
)
UPDATE public.farm_to_hatchery_shipments s
SET transfer_batch_id = g.bid
FROM groups g
WHERE s.transfer_batch_id IS NULL
  AND date_trunc('second', s.created_at) = g.bucket;
