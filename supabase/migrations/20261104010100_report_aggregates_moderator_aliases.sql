CREATE OR REPLACE FUNCTION public.get_report_aggregates(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH capped AS (
    SELECT
      o.id,
      COALESCE(o.total, 0)::numeric AS total,
      o.created_at,
      o.source,
      o.shipping_company,
      o.moderator,
      o.created_by,
      cust.city
    FROM (
      SELECT id, total, created_at, source, shipping_company, moderator, created_by, customer_id
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
  mod_src AS (
    -- المسوقة: orders.moderator، ولو فاضي اسم منشئ الأوردر (نفس منطق العداد/التسجيل اليومي)
    SELECT c.total,
      COALESCE(NULLIF(btrim(c.moderator), ''), NULLIF(btrim(pd.full_name), '')) AS raw
    FROM capped c
    LEFT JOIN public.profile_directory pd ON pd.id = c.created_by
  ),
  mod_norm AS (
    SELECT total, raw,
      translate(COALESCE(raw, ''), 'أإآةى', 'اااهي') AS n
    FROM mod_src
  ),
  mods_all AS (
    SELECT
      CASE
        WHEN raw IS NULL THEN 'غير محدد'
        WHEN n LIKE '%ايه%' THEN 'آية'
        WHEN n LIKE '%نور%' THEN 'نورا'
        WHEN n LIKE '%منال%' OR n LIKE '%هاجر%' THEN 'هاجر'
        WHEN n LIKE '%مريم%' OR n LIKE '%مريام%' THEN 'مريم'
        WHEN n LIKE '%سها%' THEN 'سها'
        WHEN n LIKE '%فاطمه%' THEN 'فاطمة'
        ELSE raw
      END AS name,
      sum(total) AS sales,
      count(*)::int AS orders
    FROM mod_norm
    GROUP BY 1
  ),
  mods_ranked AS (
    SELECT *, row_number() OVER (ORDER BY round(sales) DESC, name) AS rn FROM mods_all
  ),
  mods AS (
    SELECT name, sales, orders, rn FROM mods_ranked WHERE rn <= 7
    UNION ALL
    SELECT 'أخرى', sum(sales), sum(orders)::int, 8 FROM mods_ranked WHERE rn > 7 HAVING count(*) > 0
  ),
  prod AS (
    SELECT
      COALESCE(NULLIF(btrim(i.product_name), ''), 'غير محدد') AS name,
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
      ) ORDER BY rn)
      FROM mods m
    ), '[]'::jsonb),
    'productData', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', name,
        'quantity', round(quantity)
      ) ORDER BY round(quantity) DESC, name)
      FROM (SELECT * FROM prod ORDER BY round(quantity) DESC, name LIMIT 10) p
    ), '[]'::jsonb)
  );
$function$;
