
DROP INDEX IF EXISTS public.uniq_chick_movements_source_batch;
-- Remove any duplicate source_batch_id rows first
DELETE FROM public.chick_movements a USING public.chick_movements b
  WHERE a.ctid < b.ctid AND a.source_batch_id = b.source_batch_id AND a.source_batch_id IS NOT NULL;
ALTER TABLE public.chick_movements ADD CONSTRAINT chick_movements_source_batch_id_key UNIQUE (source_batch_id);
