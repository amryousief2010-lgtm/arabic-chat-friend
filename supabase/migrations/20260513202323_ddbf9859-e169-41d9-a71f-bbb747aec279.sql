ALTER TABLE public.order_items
ADD COLUMN IF NOT EXISTS is_half_kg BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.order_items.is_half_kg IS 'إذا كان true فالكمية تمثل عدد وحدات نصف الكيلو (2 = 1 كيلو)';