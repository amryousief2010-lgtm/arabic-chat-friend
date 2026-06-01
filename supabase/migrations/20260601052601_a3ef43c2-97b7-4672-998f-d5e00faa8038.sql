CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status_created_at ON public.orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_created_by_created_at ON public.orders (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_source_warehouse_id ON public.orders (source_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items (order_id);