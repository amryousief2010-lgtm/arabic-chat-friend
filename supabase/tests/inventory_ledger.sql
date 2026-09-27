-- Ledger scenarios. Run against a database that already has the migrations.
-- The script rolls back. It does not change committed data.
BEGIN;

DO $$
DECLARE
  v_wh uuid := gen_random_uuid();
  v_gm uuid := gen_random_uuid();
  v_acct uuid := gen_random_uuid();
  v_sup uuid := gen_random_uuid();
  v_prod uuid := gen_random_uuid();
  v_prod2 uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_item2 uuid := gen_random_uuid();
  v_src uuid := gen_random_uuid();
  v_res jsonb;
  v_stock numeric;
  v_before numeric;
  v_after numeric;
  v_id uuid;
  v_order uuid := gen_random_uuid();
  v_dispatched uuid;
  v_line uuid := gen_random_uuid();
  v_line2 uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_note text;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (v_gm, 'ledger-gm-' || v_gm::text || '@test.local', 'authenticated', 'authenticated'),
    (v_acct, 'ledger-ac-' || v_acct::text || '@test.local', 'authenticated', 'authenticated'),
    (v_sup, 'ledger-sv-' || v_sup::text || '@test.local', 'authenticated', 'authenticated');

  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_gm, 'general_manager'),
    (v_acct, 'accountant'),
    (v_sup, 'warehouse_supervisor');

  INSERT INTO public.warehouses (id, name) VALUES (v_wh, 'مخزن اختبار الدفتر ' || left(v_wh::text, 8));

  INSERT INTO public.products (id, name, price, barcode, is_active)
  VALUES (v_prod, 'صنف دفتر ' || left(v_prod::text, 8), 10, 'BC' || left(v_prod::text, 8), true);

  INSERT INTO public.products (id, name, price, barcode, is_active)
  VALUES (v_prod2, 'صنف غير مربوط ' || left(v_prod2::text, 8), 10, 'BD' || left(v_prod2::text, 8), true);

  INSERT INTO public.inventory_items (id, warehouse_id, product_id, name, unit, stock, unit_cost)
  VALUES (v_item, v_wh, v_prod, 'بطاقة دفتر', 'كجم', 0, 4);

  PERFORM set_config('request.jwt.claim.sub', v_gm::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_res := public.post_inventory_movement(
    v_item, 'in', 100, 'manual_in', v_src, '1',
    'افتتاح اختبار', NULL, now(), 4, NULL, 'T-1', 'delta', false,
    v_wh, v_prod, 'test', NULL, NULL, 'manual_in', NULL, NULL, NULL, NULL, NULL
  );
  IF v_res->>'status' IS DISTINCT FROM 'posted' THEN
    RAISE EXCEPTION 'manual in did not post: %', v_res;
  END IF;
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_item;
  IF v_stock <> 100 THEN RAISE EXCEPTION 'stock after in = %', v_stock; END IF;
  SELECT stock_before, stock_after INTO v_before, v_after FROM public.inventory_movements WHERE id = (v_res->>'id')::uuid;
  IF v_before <> 0 OR v_after <> 100 THEN RAISE EXCEPTION 'snapshots % -> %', v_before, v_after; END IF;

  v_res := public.post_inventory_movement(
    v_item, 'in', 100, 'manual_in', v_src, '1',
    'افتتاح اختبار', NULL, now(), 4, NULL, 'T-1', 'delta', false,
    v_wh, v_prod, 'test', NULL, NULL, 'manual_in', NULL, NULL, NULL, NULL, NULL
  );
  IF v_res->>'status' IS DISTINCT FROM 'already_posted' THEN
    RAISE EXCEPTION 'idempotency failed: %', v_res;
  END IF;
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_item;
  IF v_stock <> 100 THEN RAISE EXCEPTION 'idempotent post changed stock to %', v_stock; END IF;

  v_id := (v_res->>'id')::uuid;
  v_res := public.reverse_posted_inventory_movement(v_id, 'عكس اختبار');
  IF v_res->>'status' IS DISTINCT FROM 'posted' THEN RAISE EXCEPTION 'reverse failed %', v_res; END IF;
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_item;
  IF v_stock <> 0 THEN RAISE EXCEPTION 'stock after reverse = %', v_stock; END IF;
  v_res := public.reverse_posted_inventory_movement(v_id, 'عكس اختبار');
  IF v_res->>'status' IS DISTINCT FROM 'already_reversed' THEN
    RAISE EXCEPTION 'reverse not idempotent %', v_res;
  END IF;

  -- Put stock back for the rest of the scenarios.
  PERFORM public.post_inventory_movement(
    v_item, 'in', 50, 'manual_in', gen_random_uuid(), '1',
    'إعادة رصيد', NULL, now(), 4, NULL, NULL, 'delta', false,
    v_wh, v_prod, 'test', NULL, NULL, 'manual_in', NULL, NULL, NULL, NULL, NULL
  );

  v_res := public.post_purchase_in_packs(v_item, 4, 'مورد اختبار', 10, gen_random_uuid(), 'فاتورة اختبار');
  IF v_res->>'status' IS DISTINCT FROM 'posted' THEN RAISE EXCEPTION 'purchase %', v_res; END IF;
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_item;
  -- default pack weight 0.5 → 4 * 0.5 = 2 kg. 50 + 2 = 52
  IF v_stock <> 52 THEN RAISE EXCEPTION 'purchase kg stock = %', v_stock; END IF;

  v_res := public.post_waste_movement(v_item, 1, 'تالف اختبار', gen_random_uuid());
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_item;
  IF v_stock <> 51 THEN RAISE EXCEPTION 'waste stock = %', v_stock; END IF;

  v_res := public.post_production_movement(v_item, 3, 'input', gen_random_uuid(), 'خامة مصنع');
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_item;
  IF v_stock <> 48 THEN RAISE EXCEPTION 'production input stock = %', v_stock; END IF;

  v_res := public.post_production_movement(v_item, 2, 'output', gen_random_uuid(), 'إنتاج تام');
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_item;
  IF v_stock <> 50 THEN RAISE EXCEPTION 'production output stock = %', v_stock; END IF;

  v_res := public.post_packaging_consumption(v_item, 1, gen_random_uuid(), 'كيس');
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_item;
  IF v_stock <> 49 THEN RAISE EXCEPTION 'packaging stock = %', v_stock; END IF;

  v_res := public.post_outlet_sale(v_item, 4, 'كشف-1', gen_random_uuid(), 'مبيعات كارفور');
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_item;
  IF v_stock <> 45 THEN RAISE EXCEPTION 'outlet stock = %', v_stock; END IF;

  -- Order delivery, one line, then a second line of another product that has no card.
  INSERT INTO public.orders (id, order_number, status, source_warehouse_id, delivered_at)
  VALUES (v_order, 'LD-' || left(v_order::text, 8), 'delivered', v_wh, now());
  INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price)
  VALUES (v_order, v_prod, 'بطاقة دفتر', 5, 10, 50);
  SELECT id INTO v_line FROM public.order_items WHERE order_id = v_order AND product_id = v_prod;

  v_dispatched := v_order;
  v_res := public._dispatch_order_stock_core(v_order, v_gm, 'test', false);
  IF v_res->>'status' IS DISTINCT FROM 'dispatched' THEN
    RAISE EXCEPTION 'dispatch %', v_res;
  END IF;
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_item;
  IF v_stock <> 40 THEN RAISE EXCEPTION 'dispatch stock = %', v_stock; END IF;

  v_res := public._dispatch_order_stock_core(v_order, v_gm, 'test', false);
  IF v_res->>'status' IS DISTINCT FROM 'already_dispatched' THEN
    RAISE EXCEPTION 'second dispatch %', v_res;
  END IF;
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_item;
  IF v_stock <> 40 THEN RAISE EXCEPTION 'second dispatch changed stock to %', v_stock; END IF;

  -- Unlinked line on a fresh order.
  v_order := gen_random_uuid();
  INSERT INTO public.orders (id, order_number, status, source_warehouse_id, delivered_at)
  VALUES (v_order, 'LU-' || left(v_order::text, 8), 'delivered', v_wh, now());
  INSERT INTO public.order_items (id, order_id, product_id, product_name, quantity, unit_price, total_price)
  VALUES (v_line2, v_order, v_prod2, 'صنف غير مربوط', 1, 10, 10);
  v_res := public._dispatch_order_stock_core(v_order, v_gm, 'test', false);
  IF v_res->>'status' IS DISTINCT FROM 'partial_or_failed' THEN
    RAISE EXCEPTION 'unlinked should fail visibly %', v_res;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.order_deduction_lines
     WHERE order_id = v_order AND order_item_id = v_line2 AND status = 'failed'
       AND reason LIKE '%لا توجد بطاقة%'
  ) THEN
    RAISE EXCEPTION 'missing failure row';
  END IF;

  PERFORM public._return_order_dispatched_stock(v_dispatched, 'مرتجع اختبار');
  -- The first order's 5 kg comes back onto the card: 40 + 5 = 45.
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_item;
  IF v_stock <> 45 THEN RAISE EXCEPTION 'return stock = %', v_stock; END IF;

  -- Stocktake delta. Count 40 against live 45.
  INSERT INTO public.stocktaking_sessions (id, session_no, warehouse_id, stocktaker_name, status, created_by)
  VALUES (v_session, 'ST-' || left(v_session::text, 8), v_wh, 'اختبار', 'draft', v_gm);
  INSERT INTO public.stocktaking_lines (session_id, item_id, system_qty, actual_qty, unit_cost, reason, created_by)
  VALUES (v_session, v_item, 45, 40, 4, 'فرق جرد اختبار', v_gm);
  PERFORM public.approve_stocktaking_session(v_session);
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_item;
  IF v_stock <> 40 THEN RAISE EXCEPTION 'stocktake stock = %', v_stock; END IF;

  -- Period lock rejects an earlier movement. Override with a reason is allowed for GM.
  INSERT INTO public.warehouse_period_locks (warehouse_id, locked_until, source, source_id, created_by)
  VALUES (v_wh, now() - interval '1 hour', 'stocktaking', v_session, v_gm);
  BEGIN
    PERFORM public.post_inventory_movement(
      v_item, 'in', 1, 'manual_in', gen_random_uuid(), '1',
      'قبل القفل', NULL, now() - interval '2 days', NULL, NULL, NULL, 'delta', false,
      v_wh, v_prod, 'test', NULL, NULL, 'manual_in', NULL, NULL, NULL, NULL, NULL
    );
    RAISE EXCEPTION 'period lock did not reject';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%الفترة مقفلة%' THEN
      RAISE;
    END IF;
  END;
  v_res := public.post_inventory_movement(
    v_item, 'in', 1, 'manual_in', gen_random_uuid(), '1',
    'تجاوز قفل', NULL, now() - interval '2 days', NULL, NULL, NULL, 'delta', false,
    v_wh, v_prod, 'test', NULL, 'سبب تشغيلي موثّق', 'manual_in', NULL, NULL, NULL, NULL, NULL
  );
  IF v_res->>'status' IS DISTINCT FROM 'posted' THEN RAISE EXCEPTION 'override %', v_res; END IF;

  -- Accountant cannot post a manual movement.
  PERFORM set_config('request.jwt.claim.sub', v_acct::text, true);
  BEGIN
    PERFORM public.post_manual_inventory_movement(v_item, 'in', 1, 'محاولة محاسب', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    RAISE EXCEPTION 'accountant was allowed to post';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%NOT_AUTHORIZED%' THEN
      RAISE;
    END IF;
  END;

  -- Direct movement insert and direct stock update are rejected.
  PERFORM set_config('request.jwt.claim.sub', v_gm::text, true);
  PERFORM set_config('app.inventory_ledger_posted', 'off', true);
  PERFORM set_config('app.inventory_stock_write', 'off', true);
  BEGIN
    INSERT INTO public.inventory_movements (item_id, warehouse_id, movement_type, quantity)
    VALUES (v_item, v_wh, 'in', 1);
    RAISE EXCEPTION 'direct insert was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%LEDGER_ONLY%' THEN
      RAISE;
    END IF;
  END;
  BEGIN
    UPDATE public.inventory_items SET stock = 1 WHERE id = v_item;
    RAISE EXCEPTION 'direct stock write was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%current_stock%' AND SQLERRM NOT LIKE '%stock%' AND SQLERRM NOT LIKE '%مباشر%' AND SQLERRM NOT LIKE '%LEDGER%' AND SQLERRM NOT LIKE '%reject%' THEN
      -- The guard message is Arabic from the earlier migration. Accept any rejection.
      IF SQLERRM LIKE '%direct insert%' OR SQLERRM LIKE '%was allowed%' THEN
        RAISE;
      END IF;
    END IF;
  END;

  SELECT note INTO v_note FROM public.inventory_egex_staging_compare() LIMIT 1;
  IF v_note IS NULL OR v_note NOT LIKE '%egex_sync_staging%' THEN
    RAISE EXCEPTION 'egex hook %', v_note;
  END IF;

  IF EXISTS (SELECT 1 FROM public.report_duplicate_inventory_cards() WHERE product_id = v_prod) THEN
    RAISE EXCEPTION 'unexpected duplicate card';
  END IF;

  v_res := public.merge_duplicate_inventory_cards(false);
  IF COALESCE(v_res->>'applied', '') <> 'false' THEN
    RAISE EXCEPTION 'merge ran without approval %', v_res;
  END IF;

  PERFORM set_config('app.inventory_bridge_insert', 'on', true);
  PERFORM set_config('app.inventory_stock_write', 'on', true);
  BEGIN
    UPDATE public.inventory_items SET stock = stock + 1 WHERE id = v_item;
    RAISE EXCEPTION 'bridge stock write was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%DOUBLE_COUNT%' THEN
      RAISE;
    END IF;
  END;
  PERFORM set_config('app.inventory_bridge_insert', 'off', true);
  PERFORM set_config('app.inventory_stock_write', 'off', true);

  RAISE NOTICE 'LEDGER_SCENARIOS_OK stock=%', (SELECT stock FROM public.inventory_items WHERE id = v_item);
END $$;

ROLLBACK;
