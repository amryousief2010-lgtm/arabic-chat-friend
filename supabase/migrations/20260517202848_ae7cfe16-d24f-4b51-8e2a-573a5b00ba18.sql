ALTER TABLE public.slaughter_batch_outputs
  ADD COLUMN IF NOT EXISTS damaged_weight_kg numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quarantined_weight_kg numeric NOT NULL DEFAULT 0;