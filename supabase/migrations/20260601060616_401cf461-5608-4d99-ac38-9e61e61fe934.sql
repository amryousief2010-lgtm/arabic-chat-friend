CREATE INDEX IF NOT EXISTS idx_orders_customer_created_at
  ON public.orders (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_items_product_id
  ON public.order_items (product_id);

CREATE INDEX IF NOT EXISTS idx_wti_source_item
  ON public.warehouse_transfer_items (source_item_id);

CREATE INDEX IF NOT EXISTS idx_wti_destination_item
  ON public.warehouse_transfer_items (destination_item_id);

CREATE INDEX IF NOT EXISTS idx_wt_created_at
  ON public.warehouse_transfers (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_movements_warehouse_date
  ON public.inventory_movements (warehouse_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_customers_created_at
  ON public.customers (created_at DESC);