-- Remaining open items. Rolls back.
BEGIN;

DO $$
DECLARE
  v_gm uuid := gen_random_uuid();
  v_wh uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_item2 uuid := gen_random_uuid();
  v_key uuid := gen_random_uuid();
  v_engine uuid := gen_random_uuid();
  v_res jsonb;
  v_n int;
  v_stock numeric;
  v_totals record;
  v_sub uuid := gen_random_uuid();
  v_prod uuid := gen_random_uuid();
  v_card uuid := gen_random_uuid();
  v_fin uuid := gen_random_uuid();
  v_xfer uuid := gen_random_uuid();
  v_pack uuid := gen_random_uuid();
  v_inv uuid := gen_random_uuid();
  v_move uuid := gen_random_uuid();
  v_factory uuid := gen_random_uuid();
  v_pack_card uuid;
  v_prod2 uuid := gen_random_uuid();
  v_def text;
  v_order uuid;
  v_line uuid;
  i int;
  v_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  INSERT INTO auth.users (id, email, aud, role)
  VALUES (v_gm, 'remain-' || v_gm::text || '@test.local', 'authenticated', 'authenticated');
  INSERT INTO public.user_roles (user_id, role) VALUES (v_gm, 'general_manager');
  INSERT INTO public.warehouses (id, name) VALUES (v_wh, 'مخزن إغلاق ' || left(v_wh::text, 8));
  INSERT INTO public.inventory_items (id, warehouse_id, name, unit, stock)
  VALUES (v_item, v_wh, 'صنف مفتاح', 'كجم', 0),
         (v_item2, v_wh, 'صنف ثان', 'كجم', 0);
  PERFORM set_config('request.jwt.claim.sub', v_gm::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- 2. Two identical manual posts, one movement.
  v_res := public.post_manual_inventory_movement(
    v_item, 'in', 4, 'توريد بمفتاح', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, v_key
  );
  IF v_res->>'status' IS DISTINCT FROM 'posted' THEN
    RAISE EXCEPTION 'first manual post %', v_res;
  END IF;
  v_res := public.post_manual_inventory_movement(
    v_item, 'in', 4, 'توريد بمفتاح', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, v_key
  );
  IF v_res->>'status' IS DISTINCT FROM 'already_posted' THEN
    RAISE EXCEPTION 'second manual post should be already_posted, got %', v_res;
  END IF;
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_item;
  IF v_stock IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'manual stock doubled: %', v_stock;
  END IF;
  SELECT count(*) INTO v_n FROM public.inventory_movements
   WHERE source_id = v_key AND item_id = v_item;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'manual movements %', v_n;
  END IF;

  v_res := public.post_manual_inventory_movement(
    v_item2, 'in', 1, 'سطر ثان بنفس المفتاح', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, v_key
  );
  IF v_res->>'status' IS DISTINCT FROM 'posted' THEN
    RAISE EXCEPTION 'second item on the same form key %', v_res;
  END IF;

  PERFORM set_config('app.inventory_internal_post', 'on', true);
  PERFORM public.inv_post_movement(v_item, v_wh, 'stock_in', 2, NULL, NULL, NULL, 'test', 'وارد محرك', false, v_engine);
  PERFORM public.inv_post_movement(v_item, v_wh, 'stock_in', 2, NULL, NULL, NULL, 'test', 'وارد محرك', false, v_engine);
  PERFORM set_config('app.inventory_internal_post', 'off', true);
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_item;
  IF v_stock IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION 'engine stock %', v_stock;
  END IF;

  -- 3. Mirror is not added to the daily report or reconciliation.
  INSERT INTO public.products (id, name, price, is_active)
  VALUES (v_prod, 'منتج مرآة ' || left(v_prod::text, 6), 10, true);
  UPDATE public.inventory_items SET product_id = v_prod WHERE id = v_item;
  INSERT INTO public.warehouse_sublocations (id, warehouse_id, code, name_ar)
  VALUES (v_sub, v_wh, 'FRIDGE', 'ثلاجة اختبار');
  INSERT INTO public.inventory_sublocation_items (sublocation_id, product_id, stock, is_card_mirror)
  VALUES (v_sub, v_prod, 6, true);
  SELECT * INTO v_totals FROM public.stock_report_totals(v_wh);
  IF v_totals.card_kg IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'card total %', v_totals.card_kg;
  END IF;
  IF v_totals.mirror_kg IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION 'mirror total %', v_totals.mirror_kg;
  END IF;
  IF v_totals.daily_report_kg IS DISTINCT FROM v_totals.card_kg
     OR v_totals.reconciliation_kg IS DISTINCT FROM v_totals.card_kg THEN
    RAISE EXCEPTION 'report counted the mirror %', v_totals;
  END IF;
  IF v_totals.daily_report_kg = v_totals.card_kg + v_totals.mirror_kg THEN
    RAISE EXCEPTION 'daily report doubled the freezer';
  END IF;

  -- 4. Stopped functions raise and do not change stock.
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_item;
  BEGIN
    PERFORM public.approve_meat_manufacturing(gen_random_uuid());
    RAISE EXCEPTION 'approve_meat_manufacturing still runs';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%هذه الدالة موقوفة%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.post_mf_sale(gen_random_uuid());
    RAISE EXCEPTION 'post_mf_sale still runs';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%هذه الدالة موقوفة%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.reject_mf_transfer(gen_random_uuid(), 'سبب');
    RAISE EXCEPTION 'reject_mf_transfer still runs';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%هذه الدالة موقوفة%' THEN RAISE; END IF;
  END;
  IF has_function_privilege('authenticated', 'public.post_mf_sale(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can still execute post_mf_sale';
  END IF;
  IF (SELECT stock FROM public.inventory_items WHERE id = v_item) IS DISTINCT FROM v_stock THEN
    RAISE EXCEPTION 'stopped function changed stock';
  END IF;

  -- 5. Receipt without a product card does not open one.
  INSERT INTO public.meat_finished_inventory (id, code, name_ar, unit, stock)
  VALUES (v_fin, 'MF-' || left(v_fin::text, 8), 'منتج بلا بطاقة', 'كجم', 0);
  INSERT INTO public.mf_transfers (id, destination_warehouse_id, status, transfer_no)
  VALUES (v_xfer, v_wh, 'awaiting_receipt', 'MFX-' || left(v_xfer::text, 8));
  INSERT INTO public.mf_transfer_lines (transfer_id, finished_id, qty)
  VALUES (v_xfer, v_fin, 2);
  BEGIN
    PERFORM public.receive_mf_transfer(v_xfer, 'اختبار');
    RAISE EXCEPTION 'orphan card was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%CANONICAL_CARD_REQUIRED%' THEN RAISE; END IF;
  END;
  SELECT count(*) INTO v_n FROM public.inventory_items
   WHERE warehouse_id = v_wh AND name = 'منتج بلا بطاقة';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'a card was opened by item code';
  END IF;
  INSERT INTO public.products (id, name, price, is_active)
  VALUES (v_prod2, 'منتج استلام ' || left(v_prod2::text, 6), 10, true);
  INSERT INTO public.inventory_items (id, warehouse_id, name, unit, stock, product_id, item_code)
  VALUES (v_card, v_wh, 'منتج بلا بطاقة', 'كجم', 0, v_prod2, 'MF-' || left(v_fin::text, 8));
  PERFORM public.receive_mf_transfer(v_xfer, 'اختبار');
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_card;
  IF v_stock IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'mapped receipt stock %', v_stock;
  END IF;

  -- 6. Finished current_stock is read-only.
  BEGIN
    INSERT INTO public.meat_factory_finished_items (name, unit, current_stock)
    VALUES ('تام قديم', 'كجم', 5);
    RAISE EXCEPTION 'finished stock insert was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%STALE_STORE_READONLY%' THEN RAISE; END IF;
  END;

  -- 7. Second custody return line is rejected by the unique key.
  v_order := gen_random_uuid();
  INSERT INTO public.orders (id, order_number, status) VALUES (v_order, 'RET-' || left(v_order::text, 8), 'pending');
  INSERT INTO public.courier_goods_custodies (id, courier_name)
  VALUES (v_sub, 'مندوب اختبار');
  INSERT INTO public.courier_goods_custody_lines (
    custody_id, line_type, order_id, inventory_item_id, product_name, quantity
  ) VALUES (
    v_sub, 'return', v_order, v_item, 'صنف مفتاح', 1
  );
  BEGIN
    INSERT INTO public.courier_goods_custody_lines (
      custody_id, line_type, order_id, inventory_item_id, product_name, quantity
    ) VALUES (
      v_sub, 'return', v_order, v_item, 'صنف مفتاح', 1
    );
    RAISE EXCEPTION 'second custody return line was inserted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  -- 8. Old packaging deduction returns once to the packaging warehouse.
  INSERT INTO public.warehouses (id, name) VALUES (v_factory, 'مصنع قديم ' || left(v_factory::text, 8));
  INSERT INTO public.meat_factory_raw_items (id, name, kind, unit, current_stock)
  VALUES (v_pack, 'كيس فاتورة قديمة', 'packaging', 'كيس', 0);
  INSERT INTO public.meat_manufacturing_invoices (
    id, invoice_no, factory_warehouse_id, product_name, finished_qty, status
  ) VALUES (
    v_inv, 'OLD-' || left(v_inv::text, 8), v_factory, 'منتج قديم', 1, 'approved'
  );
  PERFORM set_config('app.meat_raw_stock_write', 'on', true);
  INSERT INTO public.meat_factory_inventory_moves (
    id, item_kind, item_id, item_name, direction, quantity, unit_cost, reason, ref_table, ref_id
  ) VALUES (
    v_move, 'packaging', v_pack, 'كيس فاتورة قديمة', 'OUT', 3, 1,
    'استهلاك تغليف قديم', 'meat_manufacturing_invoices', v_inv
  );
  PERFORM set_config('app.meat_raw_stock_write', 'off', true);
  v_res := public.cancel_meat_manufacturing_invoice(v_inv, 'إلغاء فاتورة قديمة', false);
  IF COALESCE(v_res->>'success', '') <> 'true' THEN
    RAISE EXCEPTION 'old cancel failed %', v_res;
  END IF;
  v_pack_card := public.resolve_packaging_card(v_pack, 'كيس فاتورة قديمة', false);
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_pack_card;
  IF v_stock IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'packaging was not returned: %', v_stock;
  END IF;
  SELECT current_stock INTO v_stock FROM public.meat_factory_raw_items WHERE id = v_pack;
  IF v_stock IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'factory packaging stock was written: %', v_stock;
  END IF;
  SELECT count(*) INTO v_n FROM public.inventory_movements
   WHERE source_type = 'reversal' AND source_id = v_inv AND source_line_id = 'pkg:' || v_move::text;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'packaging return movements %', v_n;
  END IF;
  v_res := public.cancel_meat_manufacturing_invoice(v_inv, 'إلغاء مرة ثانية', false);
  IF v_res->>'already_cancelled' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'second cancel %', v_res;
  END IF;
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_pack_card;
  IF v_stock IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'packaging returned twice: %', v_stock;
  END IF;

  -- 9. Service role / postgres may deliver more than 20. Users may not.
  -- Each real order still deducts once.
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'enforce_bulk_delivery_cap';
  IF v_def NOT LIKE '%service_role%' OR v_def NOT LIKE '%supabase_admin%' OR v_def NOT LIKE '%postgres%' THEN
    RAISE EXCEPTION 'bulk cap exemption condition missing: %', left(v_def, 500);
  END IF;
  IF v_def NOT LIKE '%v_count > 20%' AND v_def NOT LIKE '%v_count > 20 %' THEN
    RAISE EXCEPTION 'bulk cap threshold missing';
  END IF;

  FOR i IN 1..21 LOOP
    v_ids := v_ids || gen_random_uuid();
  END LOOP;
  INSERT INTO public.orders (id, order_number, status, source_warehouse_id)
  SELECT u, 'CAP-' || left(u::text, 8), 'pending', NULL
    FROM unnest(v_ids) AS u;
  UPDATE public.orders SET status = 'delivered' WHERE id = ANY (v_ids);
  SELECT count(*) INTO v_n FROM public.orders WHERE id = ANY (v_ids) AND status = 'delivered';
  IF v_n <> 21 THEN
    RAISE EXCEPTION 'postgres bulk deliver count %', v_n;
  END IF;

  v_order := gen_random_uuid();
  UPDATE public.products SET barcode = 'BC' || left(v_prod2::text, 8), is_active = true WHERE id = v_prod2;
  INSERT INTO public.orders (id, order_number, status, source_warehouse_id, stock_status)
  VALUES (v_order, 'ONCE-' || left(v_order::text, 8), 'pending', v_wh, 'not_dispatched');
  INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price)
  VALUES (v_order, v_prod2, 'منتج استلام', 1, 10, 10);
  UPDATE public.orders SET status = 'delivered' WHERE id = v_order;
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_card;
  SELECT count(*) INTO v_n FROM public.inventory_movements
   WHERE source_type = 'order_delivery' AND source_id = v_order;
  IF v_stock IS DISTINCT FROM 1 OR v_n <> 1 THEN
    RAISE EXCEPTION 'first delivery stock % movements %', v_stock, v_n;
  END IF;
  UPDATE public.orders SET status = 'pending', stock_status = 'not_dispatched' WHERE id = v_order;
  UPDATE public.orders SET status = 'delivered' WHERE id = v_order;
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_card;
  SELECT count(*) INTO v_n FROM public.inventory_movements
   WHERE source_type = 'order_delivery' AND source_id = v_order AND COALESCE(approval_status, 'posted') = 'posted';
  IF v_stock IS DISTINCT FROM 1 OR v_n <> 1 THEN
    RAISE EXCEPTION 'second delivery stock % movements %', v_stock, v_n;
  END IF;

  v_ids := ARRAY[]::uuid[];
  FOR i IN 1..21 LOOP
    v_ids := v_ids || gen_random_uuid();
  END LOOP;
  INSERT INTO public.orders (id, order_number, status)
  SELECT u, 'USER-' || left(u::text, 8), 'pending' FROM unnest(v_ids) AS u;
  GRANT SELECT, UPDATE ON public.orders TO authenticated;
  ALTER TABLE public.orders DISABLE ROW LEVEL SECURITY;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE public.orders SET status = 'delivered' WHERE id = ANY (v_ids);
    RAISE EXCEPTION 'user bulk cap did not fire';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%20%' THEN
      RAISE;
    END IF;
  END;
  EXECUTE 'RESET ROLE';

  -- Stopped list is empty.
  SELECT count(*) INTO v_n FROM public.closed_loop_open_items();
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'open items remain';
  END IF;
  RAISE NOTICE 'REMAINING_OPEN_OK';
END
$$;

ROLLBACK;
