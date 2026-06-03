ALTER TABLE public.brooding_batches
  ADD COLUMN IF NOT EXISTS rearing_location text NOT NULL DEFAULT 'chick_nursery'
  CHECK (rearing_location IN ('chick_nursery','fattening_farm'));

-- Apply user's stated mapping to existing batches
UPDATE public.brooding_batches SET rearing_location = 'fattening_farm' WHERE batch_number = 'BRD-001';
UPDATE public.brooding_batches SET rearing_location = 'chick_nursery' WHERE batch_number IN ('BRD-002','BRD-003');