
ALTER TABLE public.lab_treasury_movements
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subtotal_amount numeric;
