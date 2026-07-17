CREATE INDEX IF NOT EXISTS idx_orders_created_at_perf ON public.orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer_created_perf ON public.orders (customer_id, created_at DESC) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_source_created_perf ON public.orders (source, created_at DESC) WHERE source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_items_order_id_perf ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_perf ON public.order_items (product_name, order_id);
CREATE INDEX IF NOT EXISTS idx_social_media_expenses_date_perf ON public.social_media_expenses (expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_social_media_daily_reports_date_perf ON public.social_media_daily_reports (report_date DESC);
CREATE INDEX IF NOT EXISTS idx_social_media_weekly_reports_dates_perf ON public.social_media_weekly_reports (week_start_date DESC, week_end_date DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread_perf ON public.notifications (is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_unread_order_type_perf ON public.notifications (order_id, type) WHERE is_read = false;

CREATE OR REPLACE FUNCTION public.marketing_dashboard_summary(
  p_from timestamptz,
  p_to timestamptz,
  p_include_top_products boolean DEFAULT false
)
RETURNS TABLE (
  total_orders bigint,
  total_sales numeric,
  delivered_orders bigint,
  delivered_sales numeric,
  cancelled_orders bigint,
  gift_orders bigint,
  gift_original_value numeric,
  avg_order_value numeric,
  approved_expenses numeric,
  pending_expenses numeric,
  total_expenses numeric,
  new_customers_count bigint,
  repeat_customers_count bigint,
  top_source jsonb,
  top_area jsonb,
  top_products_summary jsonb,
  date_from timestamptz,
  date_to timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH ranged_orders AS (
  SELECT
    o.id,
    o.customer_id,
    o.total::numeric AS total,
    o.status,
    o.update_status_marker,
    o.collection_method,
    COALESCE(NULLIF(trim(c.source), ''), NULLIF(trim(o.source), ''), 'غير محدد') AS source_label,
    COALESCE(NULLIF(trim(c.governorate), ''), 'غير محدد') AS area_label,
    o.created_at
  FROM public.orders o
  LEFT JOIN public.customers c ON c.id = o.customer_id
  WHERE o.created_at >= p_from
    AND o.created_at <= p_to
), revenue_orders AS (
  SELECT *
  FROM ranged_orders
  WHERE status <> 'cancelled'
    AND NOT (update_status_marker = 'gift' OR collection_method = 'none')
), gift_orders_cte AS (
  SELECT *
  FROM ranged_orders
  WHERE status <> 'cancelled'
    AND (update_status_marker = 'gift' OR collection_method = 'none')
), delivered_orders_cte AS (
  SELECT *
  FROM revenue_orders
  WHERE status IN ('delivered', 'completed', 'تم التسليم')
), expenses AS (
  SELECT
    COALESCE(sum(amount) FILTER (WHERE is_approved), 0)::numeric AS approved,
    COALESCE(sum(amount) FILTER (WHERE NOT is_approved), 0)::numeric AS pending
  FROM public.social_media_expenses
  WHERE expense_date >= p_from::date
    AND expense_date <= p_to::date
), customer_counts AS (
  SELECT customer_id, count(*) AS order_count
  FROM revenue_orders
  WHERE customer_id IS NOT NULL
  GROUP BY customer_id
), previous_customers AS (
  SELECT DISTINCT o.customer_id
  FROM public.orders o
  WHERE o.customer_id IS NOT NULL
    AND o.created_at < p_from
    AND EXISTS (
      SELECT 1 FROM customer_counts cc WHERE cc.customer_id = o.customer_id
    )
), source_stats AS (
  SELECT source_label AS key, count(*) AS orders, COALESCE(sum(total), 0)::numeric AS value
  FROM revenue_orders
  GROUP BY source_label
  ORDER BY value DESC
  LIMIT 1
), area_stats AS (
  SELECT area_label AS key, count(*) AS orders, COALESCE(sum(total), 0)::numeric AS value
  FROM revenue_orders
  GROUP BY area_label
  ORDER BY value DESC
  LIMIT 1
), product_stats AS (
  SELECT oi.product_name AS name, COALESCE(sum(oi.quantity), 0)::numeric AS qty, COALESCE(sum(oi.total_price), 0)::numeric AS revenue, count(DISTINCT oi.order_id) AS orders_count
  FROM public.order_items oi
  JOIN revenue_orders ro ON ro.id = oi.order_id
  WHERE p_include_top_products
    AND COALESCE(oi.is_gift, false) = false
  GROUP BY oi.product_name
  ORDER BY revenue DESC
  LIMIT 5
)
SELECT
  (SELECT count(*) FROM ranged_orders)::bigint AS total_orders,
  COALESCE((SELECT sum(total) FROM revenue_orders), 0)::numeric AS total_sales,
  (SELECT count(*) FROM delivered_orders_cte)::bigint AS delivered_orders,
  COALESCE((SELECT sum(total) FROM delivered_orders_cte), 0)::numeric AS delivered_sales,
  (SELECT count(*) FROM ranged_orders WHERE status = 'cancelled')::bigint AS cancelled_orders,
  (SELECT count(*) FROM gift_orders_cte)::bigint AS gift_orders,
  COALESCE((SELECT sum(total) FROM gift_orders_cte), 0)::numeric AS gift_original_value,
  COALESCE((SELECT avg(total) FROM revenue_orders), 0)::numeric AS avg_order_value,
  (SELECT approved FROM expenses) AS approved_expenses,
  (SELECT pending FROM expenses) AS pending_expenses,
  (SELECT approved + pending FROM expenses) AS total_expenses,
  (SELECT count(*) FROM customer_counts cc WHERE NOT EXISTS (SELECT 1 FROM previous_customers pc WHERE pc.customer_id = cc.customer_id))::bigint AS new_customers_count,
  (SELECT count(*) FROM customer_counts WHERE order_count > 1)::bigint AS repeat_customers_count,
  COALESCE((SELECT jsonb_build_object('key', key, 'count', orders, 'value', value) FROM source_stats), '{}'::jsonb) AS top_source,
  COALESCE((SELECT jsonb_build_object('key', key, 'count', orders, 'value', value) FROM area_stats), '{}'::jsonb) AS top_area,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'revenue', revenue, 'ordersCount', orders_count)) FROM product_stats), '[]'::jsonb) AS top_products_summary,
  p_from AS date_from,
  p_to AS date_to;
$$;

GRANT EXECUTE ON FUNCTION public.marketing_dashboard_summary(timestamptz, timestamptz, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_dashboard_summary(timestamptz, timestamptz, boolean) TO service_role;