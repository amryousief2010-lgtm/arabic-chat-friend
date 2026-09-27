-- Packaging lives only in مخزن أدوات التغليف. Rolls back.
BEGIN;

DO $$
DECLARE
  v_gm uuid := gen_random_uuid();
  v_factory uuid := gen_random_uuid();
  v_main uuid := gen_random_uuid();
  v_raw uuid := gen_random_uuid();
  v_pack uuid := gen_random_uuid();
  v_pack2 uuid := gen_random_uuid();
  v_orphan uuid := gen_random_uuid();
  v_inv uuid := gen_random_uuid();
  v_line uuid := gen_random_uuid();
  v_pur uuid := gen_random_uuid();
  v_pline uuid := gen_random_uuid();
  v_wh uuid;
  v_card uuid;
  v_stock numeric;
  v_factory_stock numeric;
  v_n int;
  v_res jsonb;
  v_msg text;
BEGIN
  INSERT INTO auth.users (id, email, aud, role)
  VALUES (v_gm, 'pack-gm-' || v_gm::text || '@test.local', 'authenticated', 'authenticated');
  INSERT INTO public.user_roles (user_id, role) VALUES (v_gm, 'general_manager');
  INSERT INTO public.warehouses (id, name) VALUES
    (v_factory, 'مصنع تغليف ' || left(v_factory::text, 8)),
    (v_main, 'المخزن الرئيسي تغليف ' || left(v_main::text, 8));
  PERFORM set_config('request.jwt.claim.sub', v_gm::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_wh := public.packaging_warehouse_id();
  IF v_wh IS NULL OR public.packaging_store_name() NOT LIKE '%تغليف%' THEN
    RAISE EXCEPTION 'packaging warehouse was not resolved';
  END IF;

  INSERT INTO public.meat_factory_raw_items (id, name, kind, unit)
  VALUES (v_raw, 'خام تغليف اختبار', 'raw', 'كجم'),
         (v_pack, 'علبة اختبار حلقة', 'packaging', 'علبة'),
         (v_orphan, 'كيس غير مربوط', 'packaging', 'كيس');
  PERFORM public.post_meat_raw_movement(
    v_raw, 'IN', 10, 2, 'افتتاح خام', 'opening_balance_card', gen_random_uuid(),
    'raw', 'delta', NULL, NULL, 'خام تغليف اختبار'
  );

  INSERT INTO public.meat_manufacturing_invoices (
    id, invoice_no, factory_warehouse_id, product_name, finished_qty, status
  ) VALUES (
    v_inv, 'PK-' || left(v_inv::text, 8), v_factory, 'منتج تغليف', 4, 'draft'
  );
  INSERT INTO public.meat_manufacturing_invoice_lines (
    id, invoice_id, item_id, item_name, unit, quantity, unit_cost, line_total, kind
  ) VALUES
    (gen_random_uuid(), v_inv, v_raw, 'خام تغليف اختبار', 'كجم', 4, 2, 8, 'raw'),
    (v_line, v_inv, v_pack, 'علبة اختبار حلقة', 'علبة', 2, 1, 2, 'packaging');

  BEGIN
    PERFORM public.approve_meat_manufacturing_invoice(v_inv);
    RAISE EXCEPTION 'unmapped packaging approval should fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%تغليف غير مربوط%' OR SQLERRM NOT LIKE '%علبة اختبار حلقة%' THEN
      RAISE;
    END IF;
  END;
  IF (SELECT current_stock FROM public.meat_factory_raw_items WHERE id = v_pack) <> 0 THEN
    RAISE EXCEPTION 'unmapped approval changed factory packaging stock';
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_movements WHERE source_id = v_inv) THEN
    RAISE EXCEPTION 'unmapped approval posted a movement';
  END IF;

  INSERT INTO public.inventory_items (name, warehouse_id, category, unit, stock)
  VALUES ('علبة اختبار حلقة', v_wh, 'تغليف', 'علبة', 0)
  RETURNING id INTO v_card;
  PERFORM public.post_inventory_movement(
    v_card, 'in', 10, 'manual_in', gen_random_uuid(), 'open',
    'رصيد تغليف', NULL, now(), 1, NULL, 'OPEN',
    'delta', false, v_wh, NULL, 'packaging', NULL, NULL, 'manual_in', NULL, NULL, NULL, NULL, NULL
  );

  v_res := public.approve_meat_manufacturing_invoice(v_inv);
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_card;
  SELECT current_stock INTO v_factory_stock FROM public.meat_factory_raw_items WHERE id = v_pack;
  IF v_stock <> 8 OR v_factory_stock <> 0 THEN
    RAISE EXCEPTION 'consumption stock card % factory %', v_stock, v_factory_stock;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_movements
     WHERE source_type = 'packaging_consumption'
       AND source_id = v_inv
       AND source_line_id = v_line::text
       AND movement_type = 'packaging_consumption'
       AND item_id = v_card
  ) THEN
    RAISE EXCEPTION 'consumption was not posted on the packaging card with the line key';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory_items
     WHERE warehouse_id = v_main AND name = 'منتج تغليف'
  ) THEN
    RAISE EXCEPTION 'manufacturing wrote a main-warehouse card';
  END IF;

  v_res := public.approve_meat_manufacturing_invoice(v_inv);
  IF COALESCE(v_res->>'already_approved', '') <> 'true' THEN
    RAISE EXCEPTION 'second approval did not short-circuit %', v_res;
  END IF;
  UPDATE public.meat_manufacturing_invoices SET status = 'draft' WHERE id = v_inv;
  PERFORM public.approve_meat_manufacturing_invoice(v_inv);
  IF (SELECT stock FROM public.inventory_items WHERE id = v_card) <> 8 THEN
    RAISE EXCEPTION 'replayed approval deducted packaging again';
  END IF;

  PERFORM public.cancel_meat_manufacturing_invoice(v_inv, 'إلغاء تغليف', false);
  IF (SELECT stock FROM public.inventory_items WHERE id = v_card) <> 10 THEN
    RAISE EXCEPTION 'cancel did not restore packaging stock';
  END IF;
  IF (SELECT current_stock FROM public.meat_factory_raw_items WHERE id = v_pack) <> 0 THEN
    RAISE EXCEPTION 'cancel wrote factory packaging stock';
  END IF;
  SELECT count(*) INTO v_n
    FROM public.inventory_movements
   WHERE source_type = 'reversal'
     AND reverses_movement_id IN (
       SELECT id FROM public.inventory_movements
        WHERE source_type = 'packaging_consumption' AND source_id = v_inv
     );
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'packaging reversal count %', v_n;
  END IF;
  v_res := public.cancel_meat_manufacturing_invoice(v_inv, 'إلغاء ثان', false);
  IF COALESCE(v_res->>'already_cancelled', '') <> 'true' THEN
    RAISE EXCEPTION 'second cancel was not idempotent %', v_res;
  END IF;
  SELECT count(*) INTO v_n
    FROM public.inventory_movements
   WHERE source_type = 'reversal'
     AND reverses_movement_id IN (
       SELECT id FROM public.inventory_movements
        WHERE source_type = 'packaging_consumption' AND source_id = v_inv
     );
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'second cancel added a reversal';
  END IF;

  INSERT INTO public.meat_factory_raw_items (id, name, kind, unit)
  VALUES (v_pack2, 'طبق شراء', 'packaging', 'طبق');
  INSERT INTO public.meat_factory_purchases (id, supplier, total_amount, payment_method, status, invoice_type)
  VALUES (v_pur, 'مورد', 15, 'credit', 'draft', 'packaging');
  INSERT INTO public.meat_factory_purchase_lines (
    id, purchase_id, raw_item_id, raw_item_name, quantity, unit_price, line_total, kind, unit
  ) VALUES (v_pline, v_pur, v_pack2, 'طبق شراء', 5, 3, 15, 'packaging', 'طبق');
  PERFORM public.approve_meat_purchase(v_pur);
  IF (SELECT current_stock FROM public.meat_factory_raw_items WHERE id = v_pack2) <> 0 THEN
    RAISE EXCEPTION 'purchase wrote factory packaging stock';
  END IF;
  SELECT i.stock INTO v_stock
    FROM public.inventory_items i
    JOIN public.packaging_card_map m ON m.inventory_item_id = i.id
   WHERE m.source_kind = 'meat_factory_raw_item' AND m.source_id = v_pack2;
  IF v_stock <> 5 OR (SELECT warehouse_id FROM public.inventory_items i
                        JOIN public.packaging_card_map m ON m.inventory_item_id = i.id
                       WHERE m.source_id = v_pack2) IS DISTINCT FROM v_wh THEN
    RAISE EXCEPTION 'purchase did not land in the packaging warehouse, stock %', v_stock;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_movements
     WHERE source_type = 'purchase' AND source_id = v_pur AND source_line_id = v_pline::text
  ) THEN
    RAISE EXCEPTION 'purchase line key missing';
  END IF;

  BEGIN
    UPDATE public.meat_factory_raw_items SET current_stock = 4 WHERE id = v_pack;
    RAISE EXCEPTION 'factory packaging write should fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%PACKAGING_HISTORY_READONLY%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.post_meat_raw_movement(
      v_pack, 'IN', 1, 1, 'ممنوع', 'manual', gen_random_uuid(),
      'packaging', 'delta', NULL, NULL, 'علبة اختبار حلقة'
    );
    RAISE EXCEPTION 'factory packaging ledger should fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%PACKAGING_HISTORY_READONLY%' THEN RAISE; END IF;
  END;

  INSERT INTO public.packaging_materials (name_ar, stock) VALUES ('تاريخ تغليف', 0);
  BEGIN
    UPDATE public.packaging_materials SET stock = 3 WHERE name_ar = 'تاريخ تغليف';
    RAISE EXCEPTION 'packaging_materials write should fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%STALE_STORE_READONLY%' THEN RAISE; END IF;
  END;
  INSERT INTO public.meat_packaging_inventory (code, name_ar, product_type, stock)
  VALUES ('PKTEST', 'تاريخ علب', 'علبة', 0);
  BEGIN
    UPDATE public.meat_packaging_inventory SET stock = 3 WHERE code = 'PKTEST';
    RAISE EXCEPTION 'meat_packaging_inventory write should fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%STALE_STORE_READONLY%' THEN RAISE; END IF;
  END;

  INSERT INTO public.inventory_items (name, warehouse_id, category, unit, stock)
  VALUES ('بطاقة رئيسي تغليف', v_main, 'تغليف', 'علبة', 0);
  BEGIN
    UPDATE public.inventory_items SET stock = 6
     WHERE warehouse_id = v_main AND name = 'بطاقة رئيسي تغليف';
    RAISE EXCEPTION 'main packaging card write should fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%PACKAGING_HISTORY_READONLY%' THEN RAISE; END IF;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_reconciliation_check(3)
     WHERE check_code = 'packaging_unmapped' AND detail LIKE '%كيس غير مربوط%'
  ) THEN
    RAISE EXCEPTION 'reconciliation missed the unmapped packaging item';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory_reconciliation_check(3)
     WHERE check_code = 'packaging_posted_outside' AND source_ref = v_inv::text
  ) THEN
    RAISE EXCEPTION 'reconciliation flagged a consumption inside the packaging warehouse';
  END IF;

  RAISE NOTICE 'PACKAGING_WAREHOUSE_OK';
END $$;

ROLLBACK;
