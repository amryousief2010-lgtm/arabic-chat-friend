ALTER TABLE public.slaughter_live_receipts DROP CONSTRAINT IF EXISTS slaughter_live_receipts_source_type_check;
ALTER TABLE public.slaughter_live_receipts ADD CONSTRAINT slaughter_live_receipts_source_type_check
  CHECK (source_type = ANY (ARRAY['internal_farm'::text, 'external_supplier'::text, 'opening_balance'::text]));