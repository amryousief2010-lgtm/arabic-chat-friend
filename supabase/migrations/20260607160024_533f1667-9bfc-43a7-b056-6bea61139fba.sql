
ALTER TABLE public.lab_treasury_movements
  ADD COLUMN IF NOT EXISTS batch_number text,
  ADD COLUMN IF NOT EXISTS lais_eggs_count integer,
  ADD COLUMN IF NOT EXISTS lais_eggs_amount numeric,
  ADD COLUMN IF NOT EXISTS candle2_eggs_count integer,
  ADD COLUMN IF NOT EXISTS candle2_eggs_amount numeric,
  ADD COLUMN IF NOT EXISTS chicks_count integer,
  ADD COLUMN IF NOT EXISTS chicks_amount numeric,
  ADD COLUMN IF NOT EXISTS brooding_chicks_count integer,
  ADD COLUMN IF NOT EXISTS brooding_days integer,
  ADD COLUMN IF NOT EXISTS brooding_amount numeric,
  ADD COLUMN IF NOT EXISTS invoice_total numeric,
  ADD COLUMN IF NOT EXISTS collected_amount numeric,
  ADD COLUMN IF NOT EXISTS remaining_amount numeric,
  ADD COLUMN IF NOT EXISTS payment_status text;

CREATE INDEX IF NOT EXISTS idx_lab_treasury_movements_batch_number
  ON public.lab_treasury_movements(batch_number);
