ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_delivered_by ON public.orders(delivered_by);