-- Server-side aggregates for the manager dashboard cards.
--
-- get_orders_by_source matches OrdersBySourceCard:
--   status <> 'cancelled', created_at >= p_from when p_from is not null,
--   source key = btrim(source) with blank/null -> 'غير محدد', ordered by count desc.
--   There is no end date and no row cap (the card paged until a short page).
--
-- get_report_aggregates matches useReportsData:
--   status <> 'cancelled', created_at between p_from and p_to (inclusive),
--   net sales = sum(orders.total) with null total as 0,
--   month key = created_at in Africa/Cairo as YYYY-MM,
--   at most 40,000 rows ordered by created_at, id (the client cap),
--   city / source / shipping_company / moderator / product_name use
--   empty-string -> 'غير محدد' and do NOT trim (the source card does trim).
--   Slices: governorates 10, sources 15, shipping 5, moderators 7, products 10.
--   Displayed sales and quantities are rounded; percents are round(x*1000)/10.
--   Month-over-month uses the unrounded month sum. A zero previous month
--   yields 0 here; the old client produced Infinity, which JSON cannot store.
--
-- Both functions are SECURITY INVOKER so RLS is unchanged.
-- Customer count stays a separate head count on the client (it is not date-filtered).

CREATE OR REPLACE FUNCTION public.get_orders_by_source(p_from timestamptz DEFAULT NULL)
RETURNS TABLE (source text, order_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COALESCE(NULLIF(btrim(o.source), ''), 'غير محدد') AS source,
    count(*)::bigint AS order_count
  FROM public.orders o
  WHERE o.status <> 'cancelled'
    AND (p_from IS NULL OR o.created_at >= p_from)
  GROUP BY 1
  ORDER BY 2 DESC, 1;
$$;

CREATE OR REPLACE FUNCTION public.get_report_aggregates(p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH capped AS (
    SELECT
      o.id,
      COALESCE(o.total, 0)::numeric AS total,
      o.created_at,
      o.source,
      o.shipping_company,
      o.moderator,
      cust.city
    FROM (
      SELECT id, total, created_at, source, shipping_company, moderator, customer_id
      FROM public.orders
      WHERE status <> 'cancelled'
        AND created_at >= p_from
        AND created_at <= p_to
      ORDER BY created_at ASC, id ASC
      LIMIT 40000
    ) o
    LEFT JOIN public.customers cust ON cust.id = o.customer_id
  ),
  totals AS (
    SELECT
      COALESCE(sum(total), 0) AS total_sales,
      count(*)::int AS total_orders
    FROM capped
  ),
  months AS (
    SELECT
      to_char(created_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM') AS key,
      sum(total) AS sales,
      count(*)::int AS orders
    FROM capped
    GROUP BY 1
  ),
  months_ranked AS (
    SELECT
      key,
      sales,
      orders,
      row_number() OVER (ORDER BY key) AS rn,
      lag(sales) OVER (ORDER BY key) AS prev_sales
    FROM months
  ),
  gov AS (
    SELECT
      COALESCE(NULLIF(city, ''), 'غير محدد') AS name,
      sum(total) AS sales,
      count(*)::int AS orders
    FROM capped
    GROUP BY 1
  ),
  src AS (
    SELECT COALESCE(NULLIF(source, ''), 'غير محدد') AS name, count(*)::int AS orders
    FROM capped
    GROUP BY 1
  ),
  ship AS (
    SELECT COALESCE(NULLIF(shipping_company, ''), 'غير محدد') AS name, count(*)::int AS orders
    FROM capped
    GROUP BY 1
  ),
  mods AS (
    SELECT
      COALESCE(NULLIF(moderator, ''), 'غير محدد') AS name,
      sum(total) AS sales,
      count(*)::int AS orders
    FROM capped
    GROUP BY 1
  ),
  prod AS (
    SELECT
      COALESCE(NULLIF(i.product_name, ''), 'غير محدد') AS name,
      sum(COALESCE(i.quantity, 0)) AS quantity
    FROM public.order_items i
    JOIN capped c ON c.id = i.order_id
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'totalSales', (SELECT total_sales FROM totals),
    'totalOrders', (SELECT total_orders FROM totals),
    'avgOrderValue', (
      SELECT CASE WHEN total_orders > 0 THEN round(total_sales / total_orders) ELSE 0 END
      FROM totals
    ),
    'monthlySales', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'month', (ARRAY[
          'يناير','فبراير','مارس','أبريل','مايو','يونيو',
          'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'
        ])[substring(key from 6 for 2)::int],
        'sales', round(sales),
        'orders', orders,
        'momPercent', CASE
          WHEN rn = 1 THEN 0
          WHEN COALESCE(prev_sales, 0) = 0 THEN 0
          ELSE round(((sales - prev_sales) / prev_sales) * 1000) / 10
        END
      ) ORDER BY key)
      FROM months_ranked
    ), '[]'::jsonb),
    'governorateData', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', name,
        'sales', round(sales),
        'orders', orders
      ) ORDER BY round(sales) DESC, name)
      FROM (SELECT * FROM gov ORDER BY round(sales) DESC, name LIMIT 10) g
    ), '[]'::jsonb),
    'sourceData', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', name,
        'value', CASE
          WHEN (SELECT total_orders FROM totals) > 0
            THEN round((orders::numeric / (SELECT total_orders FROM totals)) * 1000) / 10
          ELSE 0
        END,
        'orders', orders
      ) ORDER BY orders DESC, name)
      FROM (SELECT * FROM src ORDER BY orders DESC, name LIMIT 15) s
    ), '[]'::jsonb),
    'shippingData', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', name,
        'value', CASE
          WHEN (SELECT total_orders FROM totals) > 0
            THEN round((orders::numeric / (SELECT total_orders FROM totals)) * 1000) / 10
          ELSE 0
        END,
        'orders', orders
      ) ORDER BY orders DESC, name)
      FROM (SELECT * FROM ship ORDER BY orders DESC, name LIMIT 5) s
    ), '[]'::jsonb),
    'moderatorData', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', name,
        'sales', round(sales),
        'orders', orders,
        'percent', CASE
          WHEN (SELECT total_sales FROM totals) > 0
            THEN round((sales / (SELECT total_sales FROM totals)) * 1000) / 10
          ELSE 0
        END
      ) ORDER BY round(sales) DESC, name)
      FROM (SELECT * FROM mods ORDER BY round(sales) DESC, name LIMIT 7) m
    ), '[]'::jsonb),
    'productData', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', name,
        'quantity', round(quantity)
      ) ORDER BY round(quantity) DESC, name)
      FROM (SELECT * FROM prod ORDER BY round(quantity) DESC, name LIMIT 10) p
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.get_orders_by_source(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_orders_by_source(timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_orders_by_source(timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.get_report_aggregates(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_report_aggregates(timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_report_aggregates(timestamptz, timestamptz) TO authenticated;
