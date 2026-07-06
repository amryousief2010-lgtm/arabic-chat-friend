-- Speed up frequent unread notification counters used by the app header.
CREATE INDEX IF NOT EXISTS idx_notifications_unread_id
  ON public.notifications (id)
  WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_notifications_unread_type
  ON public.notifications (type)
  WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_notifications_unread_order_type
  ON public.notifications (order_id, type)
  WHERE is_read = false AND order_id IS NOT NULL;

-- Speed up offer/product aggregations over order items.
CREATE INDEX IF NOT EXISTS idx_order_items_offer_order_id
  ON public.order_items (offer_name, order_id)
  WHERE offer_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_order_product
  ON public.order_items (order_id, product_id);

-- Fast dashboard/top-products aggregation without PostgREST embedded join scans.
CREATE OR REPLACE FUNCTION public.get_top_products_by_days(
  p_days integer DEFAULT 3,
  p_limit integer DEFAULT 5
)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  unit text,
  quantity numeric,
  orders_count bigint,
  total_sales numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT
      (((now() AT TIME ZONE 'Africa/Cairo')::date - (GREATEST(1, LEAST(COALESCE(p_days, 3), 30)) - 1))::timestamp AT TIME ZONE 'Africa/Cairo') AS start_at,
      ((((now() AT TIME ZONE 'Africa/Cairo')::date + 1)::timestamp AT TIME ZONE 'Africa/Cairo') + interval '2 hours') AS end_at
  )
  SELECT
    oi.product_id,
    oi.product_name,
    MAX(p.unit) AS unit,
    ROUND(COALESCE(SUM(oi.quantity), 0)::numeric, 2) AS quantity,
    COUNT(DISTINCT oi.order_id) AS orders_count,
    ROUND(COALESCE(SUM(oi.total_price), 0)::numeric, 2) AS total_sales
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  LEFT JOIN public.products p ON p.id = oi.product_id
  CROSS JOIN bounds b
  WHERE o.created_at >= b.start_at
    AND o.created_at < b.end_at
    AND o.status <> 'cancelled'
    AND COALESCE(oi.is_gift, false) = false
  GROUP BY COALESCE(oi.product_id::text, 'name:' || oi.product_name), oi.product_id, oi.product_name
  ORDER BY COALESCE(SUM(oi.quantity), 0) DESC, COUNT(DISTINCT oi.order_id) DESC, COALESCE(SUM(oi.total_price), 0) DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 5), 50));
$$;

GRANT EXECUTE ON FUNCTION public.get_top_products_by_days(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_products_by_days(integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.get_top_offer_boxes_by_days(
  p_days integer DEFAULT 3,
  p_limit integer DEFAULT 5
)
RETURNS TABLE (
  offer_name text,
  orders_count bigint,
  items_count bigint,
  total_sales numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT
      (((now() AT TIME ZONE 'Africa/Cairo')::date - (GREATEST(1, LEAST(COALESCE(p_days, 3), 30)) - 1))::timestamp AT TIME ZONE 'Africa/Cairo') AS start_at,
      ((((now() AT TIME ZONE 'Africa/Cairo')::date + 1)::timestamp AT TIME ZONE 'Africa/Cairo') + interval '2 hours') AS end_at
  )
  SELECT
    oi.offer_name,
    COUNT(DISTINCT oi.order_id) AS orders_count,
    COUNT(*) AS items_count,
    ROUND(COALESCE(SUM(oi.total_price), 0)::numeric, 2) AS total_sales
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  CROSS JOIN bounds b
  WHERE o.created_at >= b.start_at
    AND o.created_at < b.end_at
    AND o.status <> 'cancelled'
    AND oi.offer_name IS NOT NULL
  GROUP BY oi.offer_name
  ORDER BY COUNT(DISTINCT oi.order_id) DESC, COALESCE(SUM(oi.total_price), 0) DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 5), 50));
$$;

GRANT EXECUTE ON FUNCTION public.get_top_offer_boxes_by_days(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_offer_boxes_by_days(integer, integer) TO service_role;