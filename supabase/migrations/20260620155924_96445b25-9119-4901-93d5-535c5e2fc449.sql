
-- Add a shared transfer_batch_id to farm_transfers so all rows from a single
-- "transfer" click can be grouped as one logical batch in the egg-transfer log.
ALTER TABLE public.farm_transfers
  ADD COLUMN IF NOT EXISTS transfer_batch_id uuid;

CREATE INDEX IF NOT EXISTS idx_farm_transfers_transfer_batch_id
  ON public.farm_transfers(transfer_batch_id);

-- Backfill: group existing rows by (notes, created_at truncated to the second)
-- — that matches one click — and assign a shared uuid per group.
WITH groups AS (
  SELECT
    COALESCE(notes, '') AS notes_key,
    date_trunc('second', created_at) AS sec_key,
    gen_random_uuid() AS new_id
  FROM public.farm_transfers
  WHERE transfer_batch_id IS NULL
  GROUP BY 1, 2
)
UPDATE public.farm_transfers t
SET transfer_batch_id = g.new_id
FROM groups g
WHERE t.transfer_batch_id IS NULL
  AND COALESCE(t.notes, '') = g.notes_key
  AND date_trunc('second', t.created_at) = g.sec_key;

-- Try to align existing shipments to the same batch id when their underlying
-- farm_transfers can be matched by (production_date, family_id, quantity, ±5 min).
WITH matched AS (
  SELECT DISTINCT ON (s.id)
    s.id AS shipment_id,
    t.transfer_batch_id AS new_batch_id
  FROM public.farm_to_hatchery_shipments s
  JOIN public.farm_transfers t
    ON t.transfer_date = s.production_date
   AND t.family_id     = s.family_id
   AND t.quantity      = s.egg_count
   AND abs(extract(epoch FROM (t.created_at - s.created_at))) <= 300
  WHERE s.transfer_batch_id IS NULL OR s.farm_transfer_id IS NULL
  ORDER BY s.id, abs(extract(epoch FROM (t.created_at - s.created_at)))
)
UPDATE public.farm_to_hatchery_shipments s
SET transfer_batch_id = COALESCE(s.transfer_batch_id, m.new_batch_id)
FROM matched m
WHERE s.id = m.shipment_id;
