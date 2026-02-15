
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_company text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS moderator text;
