CREATE OR REPLACE FUNCTION public.get_top_products_by_days(p_days integer DEFAULT 3, p_limit integer DEFAULT 5)
 RETURNS TABLE(product_id uuid, product_name text, unit text, quantity numeric, orders_count bigint, total_sales numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH bounds AS (
    SELECT
      (((now() AT TIME ZONE 'Africa/Cairo')::date - (GREATEST(1, LEAST(COALESCE(p_days, 3), 30)) - 1))::timestamp AT TIME ZONE 'Africa/Cairo') AS start_at,
      ((((now() AT TIME ZONE 'Africa/Cairo')::date + 1)::timestamp AT TIME ZONE 'Africa/Cairo') + interval '2 hours') AS end_at
  )
  SELECT
    oi.product_id,
    btrim(oi.product_name) AS product_name,
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
  GROUP BY COALESCE(oi.product_id::text, 'name:' || btrim(oi.product_name)), oi.product_id, btrim(oi.product_name)
  ORDER BY COALESCE(SUM(oi.quantity), 0) DESC, COUNT(DISTINCT oi.order_id) DESC, COALESCE(SUM(oi.total_price), 0) DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 5), 50));
$function$;
