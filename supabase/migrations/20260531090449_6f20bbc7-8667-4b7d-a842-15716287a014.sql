ALTER TABLE public.delivery_collection_batches
  ADD COLUMN IF NOT EXISTS cash_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vodafone_cash_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS instapay_amount numeric NOT NULL DEFAULT 0;