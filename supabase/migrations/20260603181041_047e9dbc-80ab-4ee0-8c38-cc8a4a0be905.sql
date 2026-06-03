
CREATE OR REPLACE FUNCTION public.executive_dashboard_summary(
  p_from timestamptz DEFAULT date_trunc('month', now()),
  p_to   timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today_start timestamptz := date_trunc('day', now());
  v_week_start  timestamptz := date_trunc('week', now());
  v_month_start timestamptz := date_trunc('month', now());
  v_year_start  timestamptz := date_trunc('year', now());
  v_result jsonb;

  v_mother jsonb;
  v_hatch  jsonb;
  v_brood  jsonb;
  v_feed   jsonb;
  v_meat   jsonb;
  v_main   jsonb;
  v_sales  jsonb;
  v_treas  jsonb;
  v_alerts jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF NOT (
    public.has_role(v_uid, 'general_manager'::app_role)
    OR public.has_role(v_uid, 'executive_manager'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden: executive dashboard restricted to general/executive manager';
  END IF;

  -- ============ مزرعة الأمهات ============
  WITH today_eggs AS (
    SELECT COALESCE(SUM(egg_count),0) c FROM farm_egg_production WHERE production_date >= v_today_start::date
  ),
  week_eggs AS (
    SELECT COALESCE(SUM(egg_count),0) c FROM farm_egg_production WHERE production_date >= v_week_start::date
  ),
  month_eggs AS (
    SELECT COALESCE(SUM(egg_count),0) c FROM farm_egg_production WHERE production_date >= v_month_start::date
  ),
  range_eggs AS (
    SELECT COALESCE(SUM(egg_count),0) c FROM farm_egg_production WHERE production_date >= p_from::date AND production_date <= p_to::date
  ),
  by_family AS (
    SELECT family_id, COALESCE(SUM(egg_count),0) c
    FROM farm_egg_production
    WHERE production_date >= v_month_start::date
    GROUP BY family_id
  ),
  top_fam AS (
    SELECT bf.family_id, bf.c, ff.family_number FROM by_family bf
    LEFT JOIN farm_families ff ON ff.id = bf.family_id
    ORDER BY bf.c DESC NULLS LAST LIMIT 1
  ),
  low_fam AS (
    SELECT bf.family_id, bf.c, ff.family_number FROM by_family bf
    LEFT JOIN farm_families ff ON ff.id = bf.family_id
    ORDER BY bf.c ASC NULLS LAST LIMIT 1
  ),
  waste_month AS (
    SELECT COALESCE(SUM(egg_count),0) c FROM farm_egg_waste WHERE waste_date >= v_month_start::date
  ),
  shipped_month AS (
    SELECT COALESCE(SUM(egg_count),0) c FROM farm_to_hatchery_shipments WHERE shipment_date >= v_month_start::date
  )
  SELECT jsonb_build_object(
    'eggs_today',  (SELECT c FROM today_eggs),
    'eggs_week',   (SELECT c FROM week_eggs),
    'eggs_month',  (SELECT c FROM month_eggs),
    'eggs_range',  (SELECT c FROM range_eggs),
    'top_family',  (SELECT jsonb_build_object('family_number', family_number, 'eggs', c) FROM top_fam),
    'low_family',  (SELECT jsonb_build_object('family_number', family_number, 'eggs', c) FROM low_fam),
    'waste_month', (SELECT c FROM waste_month),
    'waste_pct',   CASE WHEN (SELECT c FROM month_eggs) > 0 THEN
                     ROUND(((SELECT c FROM waste_month)::numeric / (SELECT c FROM month_eggs)::numeric) * 100, 2)
                   ELSE 0 END,
    'shipped_month', (SELECT c FROM shipped_month)
  ) INTO v_mother;

  -- ============ معمل التفريخ ============
  WITH customers_active AS (
    SELECT COUNT(*) c FROM hatch_customers WHERE is_active = true
  ),
  eggs_in_month AS (
    SELECT COALESCE(SUM(net_eggs),0) c FROM hatch_batches WHERE receive_date >= v_month_start::date
  ),
  eggs_in_machine AS (
    SELECT COALESCE(SUM(net_eggs),0) c FROM hatch_batches WHERE status IN ('in_incubator','in_hatcher','active','candling')
  ),
  current_batches AS (
    SELECT COUNT(*) c FROM hatch_batches WHERE status NOT IN ('completed','cancelled')
  ),
  next_hatch AS (
    SELECT batch_number, exit_date FROM hatch_batches
    WHERE exit_date IS NOT NULL AND exit_date >= CURRENT_DATE AND status NOT IN ('completed','cancelled')
    ORDER BY exit_date ASC LIMIT 1
  ),
  capital_cust AS (
    SELECT id FROM hatch_customers WHERE name ILIKE '%عاصمة%' OR name ILIKE '%capital%' LIMIT 1
  ),
  capital_chicks_month AS (
    SELECT COALESCE(SUM(hatched_chicks),0) c FROM hatch_batches
    WHERE customer_id = (SELECT id FROM capital_cust)
      AND exit_date >= v_month_start::date
  ),
  capital_chicks_year AS (
    SELECT COALESCE(SUM(hatched_chicks),0) c FROM hatch_batches
    WHERE customer_id = (SELECT id FROM capital_cust)
      AND exit_date >= v_year_start::date
  ),
  capital_fert AS (
    SELECT
      COALESCE(SUM(candle2_fertile),0)::numeric f,
      COALESCE(SUM(net_eggs),0)::numeric n
    FROM hatch_batches
    WHERE customer_id = (SELECT id FROM capital_cust)
      AND exit_date >= v_year_start::date
  ),
  hatch_treas AS (
    SELECT
      COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) bal
    FROM feed_factory_treasury_txns
  )
  SELECT jsonb_build_object(
    'customers',       (SELECT c FROM customers_active),
    'eggs_in_month',   (SELECT c FROM eggs_in_month),
    'eggs_in_machine', (SELECT c FROM eggs_in_machine),
    'current_batches', (SELECT c FROM current_batches),
    'next_hatch',      (SELECT jsonb_build_object('batch_number', batch_number, 'date', exit_date) FROM next_hatch),
    'capital_chicks_month', (SELECT c FROM capital_chicks_month),
    'capital_chicks_year',  (SELECT c FROM capital_chicks_year),
    'capital_fert_pct', CASE WHEN (SELECT n FROM capital_fert) > 0
                          THEN ROUND(((SELECT f FROM capital_fert)/(SELECT n FROM capital_fert))*100,2)
                          ELSE 0 END,
    'treasury_balance', 0,
    'net_profit_month', 0
  ) INTO v_hatch;

  -- ============ التحضين والتسمين ============
  WITH stat AS (
    SELECT
      COALESCE(SUM(current_count),0)::int total_birds,
      COALESCE(SUM(current_count * cost_per_bird),0)::numeric cost_value
    FROM brooding_batches WHERE status NOT IN ('closed','sold','transferred')
  ),
  mort AS (
    SELECT COALESCE(SUM(mortality_count),0)::int m,
           COALESCE(SUM(original_count),0)::int o
    FROM brooding_batches
  ),
  mort_month AS (
    SELECT COALESCE(SUM(count),0)::int c FROM brooding_mortality WHERE mortality_date >= v_month_start::date
  ),
  feed_inv AS (
    SELECT COALESCE(SUM(current_kg),0)::numeric kg,
           COALESCE(SUM(current_kg * last_unit_cost),0)::numeric val
    FROM brooding_feed_inventory
  ),
  feed_out AS (
    SELECT COALESCE(SUM(total_cost),0)::numeric c
    FROM brooding_feed_stock_movements
    WHERE movement_type = 'out' AND created_at >= v_month_start
  ),
  next_slaughter AS (
    SELECT bb.batch_number, bb.received_date + (180 - bb.age_at_receipt_days) * INTERVAL '1 day' AS est_date
    FROM brooding_batches bb
    WHERE bb.status NOT IN ('closed','sold','transferred')
    ORDER BY est_date ASC NULLS LAST LIMIT 1
  ),
  market AS (
    SELECT AVG(market_price_per_bird)::numeric p FROM brooding_market_prices WHERE active = true
  )
  SELECT jsonb_build_object(
    'total_birds',  (SELECT total_birds FROM stat),
    'cost_value',   (SELECT cost_value FROM stat),
    'market_value', (SELECT total_birds FROM stat) * COALESCE((SELECT p FROM market),0),
    'expected_profit', (SELECT total_birds FROM stat) * COALESCE((SELECT p FROM market),0) - (SELECT cost_value FROM stat),
    'mortality_total', (SELECT m FROM mort),
    'mortality_pct',   CASE WHEN (SELECT o FROM mort) > 0 THEN ROUND(((SELECT m FROM mort)::numeric/(SELECT o FROM mort))*100,2) ELSE 0 END,
    'mortality_month', (SELECT c FROM mort_month),
    'feed_stock_kg',   (SELECT kg FROM feed_inv),
    'feed_stock_value',(SELECT val FROM feed_inv),
    'feed_issued_cost_month', (SELECT c FROM feed_out),
    'next_slaughter',  (SELECT jsonb_build_object('batch_number', batch_number, 'date', est_date) FROM next_slaughter)
  ) INTO v_brood;

  -- ============ مصنع الأعلاف ============
  WITH feed_stock AS (
    SELECT COALESCE(SUM(current_stock),0)::numeric kg,
           COALESCE(SUM(current_stock * latest_unit_cost),0)::numeric val
    FROM feed_products WHERE archived_at IS NULL
  ),
  fs_today AS (SELECT COALESCE(SUM(total_amount),0) v FROM feed_sales WHERE sale_date >= v_today_start::date),
  fs_month AS (SELECT COALESCE(SUM(total_amount),0) v, COALESCE(SUM(profit),0) p FROM feed_sales WHERE sale_date >= v_month_start::date),
  fp_today AS (SELECT COALESCE(SUM(total_amount),0) v FROM feed_raw_purchases WHERE purchase_date >= v_today_start::date),
  fp_month AS (SELECT COALESCE(SUM(total_amount),0) v FROM feed_raw_purchases WHERE purchase_date >= v_month_start::date),
  fr_month AS (SELECT COALESCE(SUM(total_amount),0) v FROM feed_sales_returns WHERE return_date >= v_month_start::date AND status='approved'),
  ftres AS (
    SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) bal FROM feed_factory_treasury_txns
  ),
  low_feed AS (
    SELECT COUNT(*) c FROM feed_products WHERE archived_at IS NULL AND current_stock < 50
  )
  SELECT jsonb_build_object(
    'stock_kg',    (SELECT kg FROM feed_stock),
    'stock_value', (SELECT val FROM feed_stock),
    'sales_today', (SELECT v FROM fs_today),
    'sales_month', (SELECT v FROM fs_month),
    'profit_month',(SELECT p FROM fs_month),
    'purchases_today',(SELECT v FROM fp_today),
    'purchases_month',(SELECT v FROM fp_month),
    'returns_month',  (SELECT v FROM fr_month),
    'treasury_balance',(SELECT bal FROM ftres),
    'low_stock_count', (SELECT c FROM low_feed)
  ) INTO v_feed;

  -- ============ مصنع اللحوم ============
  WITH raw_v AS (SELECT COALESCE(SUM(stock*avg_cost),0) v FROM meat_raw_inventory),
  pack_v AS (SELECT COALESCE(SUM(stock*avg_cost),0) v FROM meat_packaging_inventory),
  fin_v  AS (SELECT COALESCE(SUM(stock*avg_prod_cost),0) v FROM meat_finished_inventory),
  ms_today AS (SELECT COALESCE(SUM(total_amount),0) v FROM mf_sales WHERE invoice_date >= v_today_start::date AND status='posted' AND is_test=false),
  ms_month AS (SELECT COALESCE(SUM(total_amount),0) v, COALESCE(SUM(profit),0) p FROM mf_sales WHERE invoice_date >= v_month_start::date AND status='posted' AND is_test=false),
  mr_today AS (SELECT COALESCE(SUM(total_amount),0) v FROM mf_raw_purchases WHERE invoice_date >= v_today_start::date AND status='posted' AND is_test=false),
  mr_month AS (SELECT COALESCE(SUM(total_amount),0) v FROM mf_raw_purchases WHERE invoice_date >= v_month_start::date AND status='posted' AND is_test=false),
  mp_today AS (SELECT COALESCE(SUM(total_amount),0) v FROM mf_pack_purchases WHERE invoice_date >= v_today_start::date AND status='posted' AND is_test=false),
  mp_month AS (SELECT COALESCE(SUM(total_amount),0) v FROM mf_pack_purchases WHERE invoice_date >= v_month_start::date AND status='posted' AND is_test=false),
  mret_month AS (SELECT COALESCE(SUM(total_amount),0) v FROM mf_returns WHERE return_date >= v_month_start::date AND status='posted' AND is_test=false),
  mtres AS (SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) bal FROM mf_treasury WHERE is_test=false),
  last_mfg AS (
    SELECT invoice_no, invoice_date, produced_qty
    FROM mf_manufacturing WHERE status='posted' AND is_test=false
    ORDER BY invoice_date DESC, created_at DESC LIMIT 5
  ),
  low_meat AS (
    SELECT COUNT(*) c FROM meat_finished_inventory WHERE stock < COALESCE(reorder_level,0) AND reorder_level > 0
  )
  SELECT jsonb_build_object(
    'raw_value',       (SELECT v FROM raw_v),
    'packaging_value', (SELECT v FROM pack_v),
    'finished_value',  (SELECT v FROM fin_v),
    'sales_today',     (SELECT v FROM ms_today),
    'sales_month',     (SELECT v FROM ms_month),
    'profit_month',    (SELECT p FROM ms_month),
    'raw_purch_today', (SELECT v FROM mr_today),
    'raw_purch_month', (SELECT v FROM mr_month),
    'pack_purch_today',(SELECT v FROM mp_today),
    'pack_purch_month',(SELECT v FROM mp_month),
    'returns_month',   (SELECT v FROM mret_month),
    'treasury_balance',(SELECT bal FROM mtres),
    'last_manufacturing', COALESCE((SELECT jsonb_agg(jsonb_build_object('invoice_no', invoice_no, 'date', invoice_date, 'qty', produced_qty)) FROM last_mfg), '[]'::jsonb),
    'low_stock_count', (SELECT c FROM low_meat)
  ) INTO v_meat;

  -- ============ المخزن الرئيسي ============
  WITH main_wh AS (
    SELECT id FROM warehouses WHERE name ILIKE '%رئيس%' OR name ILIKE '%main%' ORDER BY created_at LIMIT 1
  ),
  inv_v AS (
    SELECT COALESCE(SUM(stock*unit_cost),0) v FROM inventory_items
    WHERE is_active=true AND warehouse_id = (SELECT id FROM main_wh)
  ),
  in_today AS (
    SELECT COALESCE(SUM(quantity),0) q FROM inventory_movements
    WHERE warehouse_id = (SELECT id FROM main_wh)
      AND movement_type IN ('in','transfer_in','adjustment_in','return_in','purchase')
      AND performed_at >= v_today_start
  ),
  out_today AS (
    SELECT COALESCE(SUM(quantity),0) q FROM inventory_movements
    WHERE warehouse_id = (SELECT id FROM main_wh)
      AND movement_type IN ('out','transfer_out','adjustment_out','sale')
      AND performed_at >= v_today_start
  ),
  transfers_today AS (
    SELECT COUNT(*) c FROM inventory_movements
    WHERE source_warehouse_id = (SELECT id FROM main_wh) AND movement_type='transfer_out' AND performed_at >= v_today_start
  ),
  low_main AS (
    SELECT COUNT(*) c FROM inventory_items
    WHERE is_active=true AND warehouse_id = (SELECT id FROM main_wh)
      AND stock < COALESCE(low_stock_threshold,0) AND low_stock_threshold > 0
  ),
  reserved_main AS (
    SELECT COALESCE(SUM(reserved_qty),0) q FROM inventory_items
    WHERE is_active=true AND warehouse_id = (SELECT id FROM main_wh)
  )
  SELECT jsonb_build_object(
    'inventory_value', (SELECT v FROM inv_v),
    'in_today',        (SELECT q FROM in_today),
    'out_today',       (SELECT q FROM out_today),
    'transfers_today', (SELECT c FROM transfers_today),
    'low_stock_count', (SELECT c FROM low_main),
    'reserved_qty',    (SELECT q FROM reserved_main)
  ) INTO v_main;

  -- ============ المبيعات العامة (orders) ============
  WITH s_today AS (SELECT COALESCE(SUM(total),0) v, COUNT(*) c FROM orders WHERE created_at >= v_today_start),
  s_month AS (SELECT COALESCE(SUM(total),0) v, COUNT(*) c FROM orders WHERE created_at >= v_month_start),
  s_year  AS (SELECT COALESCE(SUM(total),0) v, COUNT(*) c FROM orders WHERE created_at >= v_year_start),
  s_range AS (SELECT COALESCE(SUM(total),0) v, COUNT(*) c FROM orders WHERE created_at >= p_from AND created_at <= p_to),
  top_prod AS (
    SELECT product_name, SUM(quantity) q FROM order_items
    WHERE created_at >= v_month_start GROUP BY product_name ORDER BY q DESC LIMIT 1
  ),
  top_src AS (
    SELECT source, COUNT(*) c FROM orders
    WHERE created_at >= v_month_start AND source IS NOT NULL GROUP BY source ORDER BY c DESC LIMIT 1
  )
  SELECT jsonb_build_object(
    'sales_today', (SELECT v FROM s_today), 'orders_today', (SELECT c FROM s_today),
    'sales_month', (SELECT v FROM s_month), 'orders_month', (SELECT c FROM s_month),
    'sales_year',  (SELECT v FROM s_year),
    'sales_range', (SELECT v FROM s_range), 'orders_range', (SELECT c FROM s_range),
    'top_product', (SELECT jsonb_build_object('name', product_name, 'qty', q) FROM top_prod),
    'top_source',  (SELECT jsonb_build_object('name', source, 'count', c) FROM top_src)
  ) INTO v_sales;

  -- ============ الخزن ============
  v_treas := jsonb_build_object(
    'feed_factory',  (SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) FROM feed_factory_treasury_txns),
    'meat_factory',  (SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) FROM mf_treasury WHERE is_test=false),
    'hatchery',      0,
    'in_today',      (SELECT COALESCE(SUM(amount),0) FROM mf_treasury WHERE direction='in' AND is_test=false AND created_at >= v_today_start)
                   + (SELECT COALESCE(SUM(amount),0) FROM feed_factory_treasury_txns WHERE direction='in' AND created_at >= v_today_start),
    'out_today',     (SELECT COALESCE(SUM(amount),0) FROM mf_treasury WHERE direction='out' AND is_test=false AND created_at >= v_today_start)
                   + (SELECT COALESCE(SUM(amount),0) FROM feed_factory_treasury_txns WHERE direction='out' AND created_at >= v_today_start)
  );
  v_treas := v_treas || jsonb_build_object(
    'total_cash', (v_treas->>'feed_factory')::numeric + (v_treas->>'meat_factory')::numeric
  );

  -- ============ التنبيهات ============
  WITH alerts AS (
    SELECT 'low_meat_raw' AS code, 'نقص خامات مصنع اللحوم: ' || name_ar AS msg, 'warning' AS level
    FROM meat_raw_inventory WHERE reorder_level > 0 AND stock < reorder_level
    UNION ALL
    SELECT 'low_meat_pack', 'نقص علب تغليف: ' || name_ar, 'warning'
    FROM meat_packaging_inventory WHERE reorder_level > 0 AND stock < reorder_level
    UNION ALL
    SELECT 'low_meat_finished', 'منتج جاهز تحت الحد: ' || name_ar, 'warning'
    FROM meat_finished_inventory WHERE reorder_level > 0 AND stock < reorder_level
    UNION ALL
    SELECT 'low_feed_product', 'نقص علف: ' || name, 'warning'
    FROM feed_products WHERE archived_at IS NULL AND current_stock < 50
    UNION ALL
    SELECT 'low_brooding_feed', 'نقص علف كتاكيت: ' || feed_name, 'warning'
    FROM brooding_feed_inventory WHERE current_kg < 100
    UNION ALL
    SELECT 'negative_treasury_meat', 'خزنة مصنع اللحوم سالبة', 'destructive'
    WHERE (SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) FROM mf_treasury WHERE is_test=false) < 0
    UNION ALL
    SELECT 'negative_treasury_feed', 'خزنة مصنع الأعلاف سالبة', 'destructive'
    WHERE (SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) FROM feed_factory_treasury_txns) < 0
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('code',code,'message',msg,'level',level)), '[]'::jsonb)
  INTO v_alerts FROM alerts;

  v_result := jsonb_build_object(
    'generated_at', now(),
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'mother_farm', v_mother,
    'hatchery',    v_hatch,
    'brooding',    v_brood,
    'feed_factory',v_feed,
    'meat_factory',v_meat,
    'main_warehouse', v_main,
    'sales',       v_sales,
    'treasuries',  v_treas,
    'alerts',      v_alerts
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.executive_dashboard_summary(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.executive_dashboard_summary(timestamptz, timestamptz) TO authenticated;
