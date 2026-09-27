-- After migrations 7-20: the seeded history is still there and stock did not move.
DO $$
DECLARE
  v_store text;
  v_n bigint;
  v_qty numeric;
  v_now_n bigint;
  v_now_qty numeric;
BEGIN
  FOR v_store, v_n, v_qty IN
    SELECT store, n, qty FROM public.dirty_history_stock
  LOOP
    IF v_store = 'inventory_items' THEN
      SELECT count(*)::bigint, round(COALESCE(sum(stock), 0), 3) INTO v_now_n, v_now_qty
        FROM public.inventory_items;
    ELSIF v_store = 'feed_raw_materials' THEN
      SELECT count(*)::bigint, round(COALESCE(sum(stock), 0), 3) INTO v_now_n, v_now_qty
        FROM public.feed_raw_materials;
    ELSIF v_store = 'sales_dispatch_rows' THEN
      SELECT count(*)::bigint, round(COALESCE(sum(quantity), 0), 3) INTO v_now_n, v_now_qty
        FROM public.inventory_movements WHERE movement_type = 'sales_dispatch';
    ELSIF v_store = 'opening_rows' THEN
      SELECT count(*)::bigint, round(COALESCE(sum(quantity), 0), 3) INTO v_now_n, v_now_qty
        FROM public.inventory_movements WHERE movement_type = 'opening_balance';
    END IF;
    IF v_store IN ('inventory_items', 'feed_raw_materials') THEN
      IF v_now_qty IS DISTINCT FROM v_qty THEN
        RAISE EXCEPTION 'stock changed % before % after %', v_store, v_qty, v_now_qty;
      END IF;
    ELSIF v_now_n IS DISTINCT FROM v_n OR v_now_qty IS DISTINCT FROM v_qty THEN
      RAISE EXCEPTION 'dirty history changed % before %/% after %/%', v_store, v_n, v_qty, v_now_n, v_now_qty;
    END IF;
  END LOOP;

  IF (SELECT round(sum(stock), 3) FROM public.feed_raw_materials WHERE name LIKE 'علف سالب %')
     IS DISTINCT FROM -306 THEN
    RAISE EXCEPTION 'negative feed total changed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.inventory_movements
     WHERE reference_type = 'slaughter_output'
        OR (notes LIKE '%قطعية مستلمة بلا حركة%')
  ) THEN
    RAISE EXCEPTION 'apply posted a movement for a received slaughter output';
  END IF;

  IF (SELECT count(*) FROM public.meat_factory_inventory_moves WHERE ref_table = 'mf_dup') <> 2 THEN
    RAISE EXCEPTION 'mf history rows were merged';
  END IF;

  IF (SELECT count(*) FROM public.courier_goods_custody_lines
       WHERE order_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1' AND line_type = 'return') <> 2 THEN
    RAISE EXCEPTION 'historical courier return lines were merged';
  END IF;

  IF to_regclass('public.inventory_movements_order_item_dispatch_uidx') IS NOT NULL THEN
    RAISE EXCEPTION 'per-card dispatch unique index is still present';
  END IF;
  IF to_regclass('public.inventory_movements_order_line_dispatch_uidx') IS NULL THEN
    RAISE EXCEPTION 'per-line dispatch unique index is missing';
  END IF;
END $$;

-- Two lines of one product deduct both, once. Rolled back so the checksum stays.
BEGIN;
DO $$
DECLARE
  v_wh uuid := '11111111-1111-4111-8111-111111111111';
  v_prod uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  v_item uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  v_order uuid := '12121212-1212-4121-8121-121212121212';
  v_a uuid := '13131313-1313-4131-8131-131313131313';
  v_b uuid := '14141414-1414-4141-8141-141414141414';
  v_gm uuid := '15151515-1515-4151-8151-151515151515';
  v_res jsonb;
  v_stock numeric;
  v_n int;
BEGIN
  INSERT INTO auth.users (id, email, aud, role)
  VALUES (v_gm, 'dirty-lines@test.local', 'authenticated', 'authenticated');
  INSERT INTO public.user_roles (user_id, role) VALUES (v_gm, 'general_manager');
  PERFORM set_config('request.jwt.claim.sub', v_gm::text, true);
  INSERT INTO public.products (id, name, price, is_active, barcode)
  VALUES (v_prod, 'منتج خصم سطرين', 10, true, 'BC-LINES');
  INSERT INTO public.inventory_items (id, warehouse_id, name, unit, stock, product_id)
  VALUES (v_item, v_wh, 'بطاقة خصم سطرين', 'كجم', 0, v_prod);
  PERFORM set_config('app.inventory_internal_post', 'on', true);
  PERFORM public.post_inventory_movement(
    v_item, 'in', 10, 'manual_in', v_item, 'seed', 'رصيد اختبار', NULL, now(),
    0, NULL, NULL, 'delta', false, v_wh, v_prod, 'test', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  );
  PERFORM set_config('app.inventory_internal_post', 'off', true);

  INSERT INTO public.orders (id, order_number, status, source_warehouse_id, stock_status)
  VALUES (v_order, 'ORD-TWO-LINES', 'delivered', v_wh, 'not_dispatched');
  INSERT INTO public.order_items (id, order_id, product_id, product_name, quantity, unit_price, total_price)
  VALUES (v_a, v_order, v_prod, 'منتج خصم سطرين', 2, 10, 20),
         (v_b, v_order, v_prod, 'منتج خصم سطرين', 3, 10, 30);

  v_res := public._dispatch_order_stock_core(v_order, v_gm, 'two-lines', false);
  IF v_res->>'status' IS DISTINCT FROM 'dispatched' THEN
    RAISE EXCEPTION 'two-line dispatch %', v_res;
  END IF;
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_item;
  SELECT count(*) INTO v_n FROM public.inventory_movements
   WHERE source_type = 'order_delivery' AND source_id = v_order;
  IF v_stock IS DISTINCT FROM 5 OR v_n <> 2 THEN
    RAISE EXCEPTION 'two lines stock % movements %', v_stock, v_n;
  END IF;

  v_res := public._dispatch_order_stock_core(v_order, v_gm, 'two-lines', false);
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_item;
  SELECT count(*) INTO v_n FROM public.inventory_movements
   WHERE source_type = 'order_delivery' AND source_id = v_order
     AND COALESCE(approval_status, 'posted') = 'posted';
  IF v_res->>'status' IS DISTINCT FROM 'already_dispatched' OR v_stock IS DISTINCT FROM 5 OR v_n <> 2 THEN
    RAISE EXCEPTION 'retry stock % movements % status %', v_stock, v_n, v_res;
  END IF;
END $$;
ROLLBACK;

SELECT 'DIRTY_HISTORY_OK' AS result;
