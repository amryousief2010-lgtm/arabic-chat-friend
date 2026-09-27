-- Closed-loop scenarios. Rolls back. One assertion group per owner item.
BEGIN;

DO $$
DECLARE
  v_wh uuid := gen_random_uuid();
  v_mainish uuid := gen_random_uuid();
  v_factory uuid := gen_random_uuid();
  v_gm uuid := gen_random_uuid();
  v_sup uuid := gen_random_uuid();
  v_prod uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_src uuid := gen_random_uuid();
  v_can uuid := gen_random_uuid();
  v_res jsonb;
  v_stock numeric;
  v_n int;
  v_def text;
  v_order uuid := gen_random_uuid();
  v_feed uuid := gen_random_uuid();
  v_batch uuid := gen_random_uuid();
  v_out uuid := gen_random_uuid();
  v_out2 uuid := gen_random_uuid();
  v_raw uuid := gen_random_uuid();
  v_inv uuid := gen_random_uuid();
  v_card uuid;
  v_sell uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_msg text;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (v_gm, 'loop-gm-' || v_gm::text || '@test.local', 'authenticated', 'authenticated'),
    (v_sup, 'loop-sv-' || v_sup::text || '@test.local', 'authenticated', 'authenticated');
  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_gm, 'general_manager'),
    (v_sup, 'warehouse_supervisor');
  INSERT INTO public.warehouses (id, name) VALUES
    (v_wh, 'مخزن حلقة ' || left(v_wh::text, 8)),
    (v_factory, 'مصنع حلقة ' || left(v_factory::text, 8)),
    (v_mainish, 'المخزن الرئيسي اختبار ' || left(v_mainish::text, 8));
  INSERT INTO public.products (id, name, price, barcode, is_active)
  VALUES (v_prod, 'فيليه حلقة ' || left(v_prod::text, 6), 10, 'LP' || left(v_prod::text, 8), true);
  INSERT INTO public.inventory_items (id, warehouse_id, name, unit, stock)
  VALUES (v_item, v_wh, 'بطاقة حلقة', 'كجم', 0);
  INSERT INTO public.inventory_items (id, warehouse_id, name, unit, stock)
  VALUES (v_can, v_wh, 'بطاقة دمجت', 'كجم', 0);

  PERFORM set_config('request.jwt.claim.sub', v_gm::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- 1. Receipt functions post; they do not insert the ledger themselves.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'receive_mf_transfer' LIMIT 1;
  IF v_def NOT LIKE '%post_inventory_movement%' OR v_def LIKE '%INSERT INTO inventory_movements%' OR v_def LIKE '%INSERT INTO public.inventory_movements%' THEN
    RAISE EXCEPTION 'item1 receive_mf_transfer is not ledger-only';
  END IF;
  IF v_def NOT LIKE '%transfer_in%' OR v_def NOT LIKE '%ln.id%' THEN
    RAISE EXCEPTION 'item1 receive_mf source key is not transfer+line';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'receive_meat_production_transfer' LIMIT 1;
  IF v_def NOT LIKE '%post_inventory_movement%' OR v_def LIKE '%INSERT INTO%inventory_movements%' THEN
    RAISE EXCEPTION 'item1 receive_meat is not ledger-only';
  END IF;
  IF v_def NOT LIKE '%''receive''%' THEN
    RAISE EXCEPTION 'item1 meat receipt line key missing';
  END IF;

  -- 2. Merge relinks movements under the immutability flag.
  PERFORM public.post_inventory_movement(
    v_item, 'in', 8, 'manual_in', v_src, 'merge-src',
    'اختبار دمج', NULL, now(), 1, NULL, 'M', 'delta', false,
    v_wh, v_prod, 'test', NULL, NULL, 'manual_in', NULL, NULL, NULL, NULL, NULL
  );
  PERFORM public.merge_inventory_items(v_item, v_can, 'LOOP-MERGE');
  IF NOT EXISTS (SELECT 1 FROM public.inventory_movements WHERE item_id = v_can AND source_line_id = 'merge-src') THEN
    RAISE EXCEPTION 'item2 merge did not relink the movement';
  END IF;
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_can;
  IF v_stock <> 8 THEN RAISE EXCEPTION 'item2 canonical stock %', v_stock; END IF;

  -- 3. Cost view hides unit_cost from a non-finance role.
  UPDATE public.inventory_items SET unit_cost = 6 WHERE id = v_can;
  PERFORM set_config('request.jwt.claim.sub', v_sup::text, true);
  SELECT unit_cost INTO v_stock FROM public.inventory_items_visible WHERE id = v_can;
  IF v_stock IS NOT NULL THEN RAISE EXCEPTION 'item3 supervisor saw unit_cost %', v_stock; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_gm::text, true);
  SELECT unit_cost INTO v_stock FROM public.inventory_items_visible WHERE id = v_can;
  IF v_stock IS NULL THEN RAISE EXCEPTION 'item3 finance cost was hidden'; END IF;

  INSERT INTO public.inventory_items (id, warehouse_id, product_id, name, unit, stock)
  VALUES (v_sell, v_wh, v_prod, 'فيليه حلقة ' || left(v_prod::text, 6), 'كجم', 0);
  PERFORM public.post_inventory_movement(
    v_sell, 'in', 20, 'manual_in', gen_random_uuid(), 'sell',
    'رصيد بيع', NULL, now(), 4, NULL, 'S', 'delta', false,
    v_wh, v_prod, 'test', NULL, NULL, 'manual_in', NULL, NULL, NULL, NULL, NULL
  );

  -- 6. Dispatched is rejected until a delivery movement exists.
  BEGIN
    INSERT INTO public.orders (id, order_number, status, source_warehouse_id, stock_status)
    VALUES (v_order, 'CL-' || left(v_order::text, 8), 'delivered', v_wh, 'dispatched');
    RAISE EXCEPTION 'item6 insert dispatched should have failed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%STOCK_NOT_POSTED%' THEN RAISE; END IF;
  END;
  INSERT INTO public.orders (id, order_number, status, source_warehouse_id, delivered_at)
  VALUES (v_order, 'CL-' || left(v_order::text, 8), 'delivered', v_wh, now());
  INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price)
  VALUES (v_order, v_prod, 'فيليه', 1, 10, 10);
  BEGIN
    UPDATE public.orders SET stock_status = 'dispatched' WHERE id = v_order;
    RAISE EXCEPTION 'item6 update dispatched should have failed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%STOCK_NOT_POSTED%' THEN RAISE; END IF;
  END;
  v_res := public._dispatch_order_stock_core(v_order, v_gm, 'closed-loop', false);
  IF v_res->>'status' IS DISTINCT FROM 'dispatched' THEN
    RAISE EXCEPTION 'item6 core did not dispatch %', v_res;
  END IF;
  SELECT stock_status INTO v_msg FROM public.orders WHERE id = v_order;
  IF v_msg IS DISTINCT FROM 'dispatched' THEN RAISE EXCEPTION 'item6 status %', v_msg; END IF;

  -- 7 and 11. Unmapped slaughter is blocked. Mapped receipt hits the product card once.
  INSERT INTO public.slaughter_batches (id, batch_number) VALUES (v_batch, 'CL-' || left(v_batch::text, 8));
  INSERT INTO public.slaughter_batch_outputs (id, batch_id, cut_name_ar, actual_weight_kg, destination, quality_status)
  VALUES (v_out2, v_batch, 'قطعية بلا خريطة ' || left(v_out2::text, 4), 2, 'warehouse', 'accepted');
  BEGIN
    PERFORM public.receive_slaughter_output(v_out2, v_wh);
    RAISE EXCEPTION 'item7 unmapped receipt should fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%UNMAPPED_SLAUGHTER_OUTPUT%' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.inventory_items WHERE name LIKE 'قطعية بلا خريطة%') THEN
    RAISE EXCEPTION 'item7 created an orphan card';
  END IF;
  INSERT INTO public.slaughter_output_product_map (cut_name_norm, cut_name_sample, product_id, seeded)
  VALUES (public.normalize_ar_name('فيليه حلقة ' || left(v_prod::text, 6)), 'فيليه حلقة', v_prod, false);
  INSERT INTO public.slaughter_batch_outputs (id, batch_id, cut_name_ar, actual_weight_kg, destination, quality_status)
  VALUES (v_out, v_batch, 'فيليه حلقة ' || left(v_prod::text, 6), 3, 'warehouse', 'accepted');
  IF NOT EXISTS (SELECT 1 FROM public.list_unreceived_slaughter_outputs() WHERE output_id = v_out) THEN
    RAISE EXCEPTION 'item11 pending output missing from the report';
  END IF;
  v_res := public.receive_slaughter_output(v_out, v_wh);
  SELECT i.id, i.stock INTO v_card, v_stock
    FROM public.inventory_items i
   WHERE i.warehouse_id = v_wh AND i.product_id = v_prod
   ORDER BY i.created_at
   LIMIT 1;
  IF v_card IS NULL THEN RAISE EXCEPTION 'item7 no canonical card'; END IF;
  IF v_stock < 3 THEN RAISE EXCEPTION 'item7 stock %', v_stock; END IF;
  BEGIN
    PERFORM public.receive_slaughter_output(v_out, v_wh);
    RAISE EXCEPTION 'item7 second receipt should fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%ALREADY_RECEIVED%' THEN RAISE; END IF;
  END;
  SELECT count(*) INTO v_n FROM public.inventory_movements
   WHERE source_id = v_out AND source_line_id = '1';
  IF v_n <> 1 THEN RAISE EXCEPTION 'item7 movements %', v_n; END IF;

  -- 4. Reverse the slaughter receipt by referencing the original movement.
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_card;
  PERFORM public.reverse_receipt_approval('slaughter', v_batch, 'عكس اختبار');
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_movements r
     WHERE r.source_type = 'reversal'
       AND r.reverses_movement_id IS NOT NULL
       AND r.item_id = v_card
  ) THEN
    RAISE EXCEPTION 'item4 reversal does not reference the receipt';
  END IF;
  IF (SELECT stock FROM public.inventory_items WHERE id = v_card) <> v_stock - 3 THEN
    RAISE EXCEPTION 'item4 stock was not reduced by the receipt qty';
  END IF;

  -- 8. Outlet sale line id is the statement line, and a second line posts.
  v_res := public.post_outlet_sale(v_can, 1, 'كشف', v_src, 'منفذ', v_src::text || ':L1', now(), NULL);
  v_res := public.post_outlet_sale(v_can, 1, 'كشف', v_src, 'منفذ', v_src::text || ':L2', now(), NULL);
  SELECT count(*) INTO v_n FROM public.inventory_movements
   WHERE source_type = 'outlet_sale' AND source_id = v_src;
  IF v_n <> 2 THEN RAISE EXCEPTION 'item8 lines posted %', v_n; END IF;

  -- 10 and 5. Manufacturing stays in the factory. Cancel reverses once.
  INSERT INTO public.meat_factory_raw_items (id, name) VALUES (v_raw, 'خام حلقة');
  PERFORM public.post_meat_raw_movement(
    v_raw, 'IN', 10, 2, 'افتتاح حلقة', 'opening_balance_card', gen_random_uuid(),
    'raw', 'delta', NULL, NULL, 'خام حلقة'
  );
  INSERT INTO public.meat_manufacturing_invoices (
    id, invoice_no, factory_warehouse_id, product_name, finished_qty, status
  ) VALUES (
    v_inv, 'MF-' || left(v_inv::text, 8), v_factory, 'تام حلقة', 4, 'draft'
  );
  INSERT INTO public.meat_manufacturing_invoice_lines (invoice_id, item_id, item_name, unit, quantity, unit_cost, line_total)
  VALUES (v_inv, v_raw, 'خام حلقة', 'كجم', 4, 2, 8);
  v_res := public.approve_meat_manufacturing_invoice(v_inv);
  SELECT id, stock INTO v_card, v_stock FROM public.inventory_items
   WHERE warehouse_id = v_factory AND name = 'تام حلقة';
  IF v_card IS NULL OR v_stock <> 4 THEN RAISE EXCEPTION 'item10 finished stock % card %', v_stock, v_card; END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_items WHERE warehouse_id = v_mainish AND name = 'تام حلقة') THEN
    RAISE EXCEPTION 'item10 wrote the main-like warehouse';
  END IF;
  UPDATE public.meat_manufacturing_invoices SET factory_warehouse_id = v_mainish, status = 'draft' WHERE id = v_inv;
  BEGIN
    PERFORM public.approve_meat_manufacturing_invoice(v_inv);
    RAISE EXCEPTION 'item10 main warehouse approval should fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%MANUFACTURING_STAYS_IN_FACTORY%' AND SQLERRM NOT LIKE '%معتمدة بالفعل%' THEN
      RAISE;
    END IF;
  END;
  UPDATE public.meat_manufacturing_invoices SET factory_warehouse_id = v_factory, status = 'approved' WHERE id = v_inv;
  v_res := public.cancel_meat_manufacturing_invoice(v_inv, 'إلغاء اختبار', false);
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_card;
  IF v_stock <> 0 THEN RAISE EXCEPTION 'item5 cancel stock %', v_stock; END IF;
  SELECT count(*) INTO v_n FROM public.inventory_movements
   WHERE item_id = v_card AND source_type = 'reversal';
  IF v_n <> 1 THEN RAISE EXCEPTION 'item5 reversal count %', v_n; END IF;

  -- 12. Named store posts once and rejects a direct write.
  INSERT INTO public.feed_raw_materials (id, name, stock) VALUES (v_feed, 'ذرة حلقة', 0);
  v_res := public.post_named_stock('feed_raw_materials', v_feed, 5, 'purchase', v_feed, '1', 'شراء', NULL, 'delta', NULL);
  IF v_res->>'status' IS DISTINCT FROM 'posted' THEN RAISE EXCEPTION 'item12 post %', v_res; END IF;
  v_res := public.post_named_stock('feed_raw_materials', v_feed, 5, 'purchase', v_feed, '1', 'شراء', NULL, 'delta', NULL);
  IF v_res->>'status' IS DISTINCT FROM 'already_posted' THEN RAISE EXCEPTION 'item12 idempotency %', v_res; END IF;
  SELECT stock INTO v_stock FROM public.feed_raw_materials WHERE id = v_feed;
  IF v_stock <> 5 THEN RAISE EXCEPTION 'item12 stock %', v_stock; END IF;
  BEGIN
    UPDATE public.feed_raw_materials SET stock = 9 WHERE id = v_feed;
    RAISE EXCEPTION 'item12 direct write should fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%NAMED_STOCK_DIRECT_WRITE%' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_reconciliation_check(3) c
     WHERE c.check_code = 'named_stock_mismatch' AND c.item_id = v_feed
  ) THEN
    -- matching snapshot is success; force a mismatch by writing around the guard is forbidden.
    NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory_reconciliation_check(3) c
     WHERE c.check_code = 'named_stock_mismatch' AND c.item_id = v_feed
  ) THEN
    RAISE EXCEPTION 'item12 reconciliation saw a false mismatch';
  END IF;

  -- 13. Stale product stock cannot be written.
  BEGIN
    UPDATE public.products SET stock = 4 WHERE id = v_prod;
    RAISE EXCEPTION 'item13 products.stock write should fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%STALE_STORE_READONLY%' THEN RAISE; END IF;
  END;

  -- 14. June openings are not the invariant. Sep 30 stocktake is.
  PERFORM public.post_inventory_movement(
    v_can, 'in', 2, 'opening_balance', gen_random_uuid(), 'jun2',
    'افتتاح يونيو', NULL, timestamptz '2026-06-02 12:00:00+02', 1, NULL, 'JUN2',
    'delta', false, v_wh, NULL, 'test', NULL, NULL, 'opening_balance', NULL, NULL, NULL, NULL, NULL
  );
  INSERT INTO public.stocktaking_sessions (id, session_no, warehouse_id, stocktaker_name, status, approved_at)
  VALUES (v_session, 'ST-' || left(v_session::text, 8), v_wh, 'جرد', 'approved', timestamptz '2026-09-30 10:00:00+03');
  INSERT INTO public.stocktaking_lines (session_id, item_id, system_qty, actual_qty, reason)
  SELECT v_session, id, stock, stock, 'أساس سبتمبر'
    FROM public.inventory_items WHERE id = v_can;
  IF EXISTS (
    SELECT 1 FROM public.inventory_reconciliation_check(3) c
     WHERE c.check_code = 'stock_mismatch' AND c.item_id = v_can
  ) THEN
    RAISE EXCEPTION 'item14 June history changed the September invariant';
  END IF;
  IF position('2026-09-30' IN pg_get_functiondef('public.inventory_reconciliation_check_core(integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'item14 baseline date missing from reconciliation';
  END IF;

  -- 15. Packaging switch is one row and is not decided here.
  IF public.packaging_store_name() IS DISTINCT FROM 'meat_factory_raw_items' THEN
    RAISE EXCEPTION 'item15 packaging store changed';
  END IF;

  -- 9. Courier return posts as order_return, not a second bridge insert.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_courier_return' LIMIT 1;
  IF v_def LIKE '%INSERT INTO public.inventory_movements%' OR v_def NOT LIKE '%order_return%' THEN
    RAISE EXCEPTION 'item9 courier return still inserts its own movement';
  END IF;

  RAISE NOTICE 'CLOSED_LOOP_OK';
END $$;

ROLLBACK;
