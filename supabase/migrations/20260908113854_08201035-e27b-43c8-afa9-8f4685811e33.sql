CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON public.customers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_phone_trgm ON public.customers USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_phone2_trgm ON public.customers USING gin (phone2 gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_email_trgm ON public.customers USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_governorate_trgm ON public.customers USING gin (governorate gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_created_at ON public.customers (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_order_number_trgm ON public.orders USING gin (order_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_orders_shipping_bill_no_trgm ON public.orders USING gin (shipping_bill_no gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_address_trgm ON public.orders USING gin (delivery_address gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON public.orders (customer_id);

CREATE INDEX IF NOT EXISTS idx_order_items_product_name ON public.order_items (product_name);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items (order_id);