
ALTER TABLE public.products 
  ADD COLUMN IF NOT EXISTS cost_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS old_price numeric;

CREATE UNIQUE INDEX IF NOT EXISTS products_name_unique ON public.products (name);
