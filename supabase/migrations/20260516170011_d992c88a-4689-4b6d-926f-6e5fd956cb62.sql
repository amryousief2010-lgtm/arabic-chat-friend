ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS extra_charge numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_charge_reason text;