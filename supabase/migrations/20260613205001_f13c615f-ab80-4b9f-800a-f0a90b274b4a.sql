ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS is_gift boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_order_items_is_gift ON public.order_items(is_gift) WHERE is_gift = true;