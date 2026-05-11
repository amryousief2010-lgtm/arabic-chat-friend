CREATE OR REPLACE FUNCTION public.get_dashboard_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := current_date;
  v_month_start date := date_trunc('month', current_date)::date;
  v_year_start date := date_trunc('year', current_date)::date;
  v_sales_today numeric; v_orders_today int;
  v_sales_month numeric; v_orders_month int;
  v_sales_year numeric; v_orders_year int;
  v_sales_total numeric; v_orders_total int;
  v_customers int; v_low_stock int;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN created_at::date = v_today THEN total END),0),
    COUNT(*) FILTER (WHERE created_at::date = v_today),
    COALESCE(SUM(CASE WHEN created_at::date >= v_month_start THEN total END),0),
    COUNT(*) FILTER (WHERE created_at::date >= v_month_start),
    COALESCE(SUM(CASE WHEN created_at::date >= v_year_start THEN total END),0),
    COUNT(*) FILTER (WHERE created_at::date >= v_year_start),
    COALESCE(SUM(total),0),
    COUNT(*)
  INTO v_sales_today, v_orders_today, v_sales_month, v_orders_month,
       v_sales_year, v_orders_year, v_sales_total, v_orders_total
  FROM orders WHERE status <> 'cancelled';

  SELECT COUNT(*) INTO v_customers FROM customers;
  SELECT COUNT(*) INTO v_low_stock FROM products WHERE stock <= low_stock_threshold AND is_active = true;

  RETURN jsonb_build_object(
    'today',  jsonb_build_object('sales', v_sales_today, 'orders', v_orders_today),
    'month',  jsonb_build_object('sales', v_sales_month, 'orders', v_orders_month),
    'year',   jsonb_build_object('sales', v_sales_year,  'orders', v_orders_year),
    'total',  jsonb_build_object('sales', v_sales_total, 'orders', v_orders_total),
    'avg_order_value', CASE WHEN v_orders_total > 0 THEN ROUND(v_sales_total / v_orders_total) ELSE 0 END,
    'customers', v_customers,
    'low_stock', v_low_stock
  );
END;
$$;