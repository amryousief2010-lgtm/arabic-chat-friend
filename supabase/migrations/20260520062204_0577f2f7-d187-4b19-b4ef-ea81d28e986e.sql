CREATE OR REPLACE FUNCTION public.get_dashboard_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
  v_month_start date := date_trunc('month', (now() AT TIME ZONE 'Africa/Cairo'))::date;
  v_year_start date := date_trunc('year', (now() AT TIME ZONE 'Africa/Cairo'))::date;
  v_sales_today numeric; v_orders_today int;
  v_sales_month numeric; v_orders_month int;
  v_sales_year numeric; v_orders_year int;
  v_sales_total numeric; v_orders_total int;
  v_customers int; v_low_stock int;
  v_monthly jsonb; v_daily jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,
    'accountant'::app_role,'warehouse_supervisor'::app_role,
    'shipping_company'::app_role,'marketing_sales_manager'::app_role,'financial_manager'::app_role
  ]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN (created_at AT TIME ZONE 'Africa/Cairo')::date = v_today THEN total END),0),
    COUNT(*) FILTER (WHERE (created_at AT TIME ZONE 'Africa/Cairo')::date = v_today),
    COALESCE(SUM(CASE WHEN (created_at AT TIME ZONE 'Africa/Cairo')::date >= v_month_start THEN total END),0),
    COUNT(*) FILTER (WHERE (created_at AT TIME ZONE 'Africa/Cairo')::date >= v_month_start),
    COALESCE(SUM(CASE WHEN (created_at AT TIME ZONE 'Africa/Cairo')::date >= v_year_start THEN total END),0),
    COUNT(*) FILTER (WHERE (created_at AT TIME ZONE 'Africa/Cairo')::date >= v_year_start),
    COALESCE(SUM(total),0),
    COUNT(*)
  INTO v_sales_today, v_orders_today, v_sales_month, v_orders_month,
       v_sales_year, v_orders_year, v_sales_total, v_orders_total
  FROM orders WHERE status <> 'cancelled';

  SELECT COUNT(*) INTO v_customers FROM customers;
  SELECT COUNT(*) INTO v_low_stock FROM products WHERE stock <= low_stock_threshold AND is_active = true;

  WITH months AS (
    SELECT generate_series(v_year_start, v_today, '1 month'::interval)::date AS m
  ),
  agg AS (
    SELECT date_trunc('month', (created_at AT TIME ZONE 'Africa/Cairo'))::date AS m,
           SUM(total)::numeric AS sales, COUNT(*)::int AS orders
    FROM orders WHERE status <> 'cancelled' AND (created_at AT TIME ZONE 'Africa/Cairo')::date >= v_year_start
    GROUP BY 1
  )
  SELECT jsonb_agg(jsonb_build_object(
    'month', to_char(months.m, 'YYYY-MM'),
    'sales', COALESCE(agg.sales,0),
    'orders', COALESCE(agg.orders,0)
  ) ORDER BY months.m)
  INTO v_monthly
  FROM months LEFT JOIN agg ON agg.m = months.m;

  WITH days AS (
    SELECT generate_series(v_month_start, v_today, '1 day'::interval)::date AS d
  ),
  agg AS (
    SELECT (created_at AT TIME ZONE 'Africa/Cairo')::date AS d, SUM(total)::numeric AS sales, COUNT(*)::int AS orders
    FROM orders WHERE status <> 'cancelled' AND (created_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN v_month_start AND v_today
    GROUP BY 1
  )
  SELECT jsonb_agg(jsonb_build_object(
    'date', to_char(days.d, 'YYYY-MM-DD'),
    'sales', COALESCE(agg.sales,0),
    'orders', COALESCE(agg.orders,0)
  ) ORDER BY days.d)
  INTO v_daily
  FROM days LEFT JOIN agg ON agg.d = days.d;

  RETURN jsonb_build_object(
    'today',  jsonb_build_object('sales', v_sales_today, 'orders', v_orders_today),
    'month',  jsonb_build_object('sales', v_sales_month, 'orders', v_orders_month),
    'year',   jsonb_build_object('sales', v_sales_year,  'orders', v_orders_year),
    'total',  jsonb_build_object('sales', v_sales_total, 'orders', v_orders_total),
    'avg_order_value', CASE WHEN v_orders_total > 0 THEN ROUND(v_sales_total / v_orders_total) ELSE 0 END,
    'customers', v_customers,
    'low_stock', v_low_stock,
    'monthly', COALESCE(v_monthly, '[]'::jsonb),
    'daily',   COALESCE(v_daily,   '[]'::jsonb)
  );
END;
$function$;