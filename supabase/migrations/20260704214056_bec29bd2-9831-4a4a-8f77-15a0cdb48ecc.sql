
ALTER TABLE public.zodex_missing_orders
  ADD COLUMN IF NOT EXISTS alaa_notified_at TIMESTAMPTZ;
