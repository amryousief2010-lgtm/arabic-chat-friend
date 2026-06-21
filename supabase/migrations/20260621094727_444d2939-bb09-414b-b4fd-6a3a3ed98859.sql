ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS package_count numeric,
  ADD COLUMN IF NOT EXISTS package_weight_kg numeric,
  ADD COLUMN IF NOT EXISTS quantity_kg numeric;