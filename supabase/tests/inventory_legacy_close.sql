-- Closing a legacy document by the Sep 30 stocktake moves no stock and drops it from reports.
BEGIN;

DO $$
DECLARE
  v_wh uuid := gen_random_uuid();
  v_gm uuid := gen_random_uuid();
  v_exec uuid := gen_random_uuid();
  v_sup uuid := gen_random_uuid();
  v_prod uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_inv uuid := gen_random_uuid();
  v_late uuid := gen_random_uuid();
  v_tr uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_res jsonb;
  v_stock numeric;
  v_stock2 numeric;
  v_mov int;
  v_mov2 int;
  v_audit int;
  v_ids uuid[];
  i int;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (v_gm, 'close-gm-' || v_gm::text || '@test.local', 'authenticated', 'authenticated'),
    (v_exec, 'close-ex-' || v_exec::text || '@test.local', 'authenticated', 'authenticated'),
    (v_sup, 'close-sv-' || v_sup::text || '@test.local', 'authenticated', 'authenticated');
  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_gm, 'general_manager'),
    (v_exec, 'executive_manager'),
    (v_sup, 'warehouse_supervisor');

  INSERT INTO public.warehouses (id, name) VALUES (v_wh, 'مخزن إغلاق قديم ' || left(v_wh::text, 8));
  INSERT INTO public.warehouses (id, name) VALUES (v_other, 'وجهة إغلاق قديم ' || left(v_other::text, 8));
  INSERT INTO public.products (id, name, price, barcode, is_active)
  VALUES (v_prod, 'صنف إغلاق قديم', 10, 'CL' || left(v_prod::text, 8), true);
  INSERT INTO public.inventory_items (id, warehouse_id, product_id, name, unit, stock)
  VALUES (v_item, v_wh, v_prod, 'بطاقة إغلاق قديم', 'كجم', 0);

  PERFORM set_config('request.jwt.claim.sub', v_gm::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  v_res := public.post_inventory_movement(
    v_item, 'in', 5, 'manual_in', v_item, 'seed',
    'رصيد قبل الإغلاق', NULL, now(), 2, NULL, 'CLOSE', 'delta', false,
    v_wh, v_prod, 'test', NULL, NULL, 'manual_in', NULL, NULL, NULL, NULL, NULL
  );
  IF v_res->>'status' IS DISTINCT FROM 'posted' THEN
    RAISE EXCEPTION 'seed post %', v_res;
  END IF;

  INSERT INTO public.meat_manufacturing_invoices (
    id, invoice_no, product_name, finished_qty, factory_warehouse_id, status, approved_at, approved_by
  ) VALUES (
    v_inv, 'MFG-LEGACY-' || left(v_inv::text, 8), 'تام قديم', 4, v_wh, 'approved',
    timestamptz '2026-09-01 10:00:00+03', v_gm
  );
  INSERT INTO public.meat_manufacturing_invoices (
    id, invoice_no, product_name, finished_qty, factory_warehouse_id, status, approved_at, approved_by
  ) VALUES (
    v_late, 'MFG-LATE-' || left(v_late::text, 8), 'تام بعد الجرد', 1, v_wh, 'approved',
    timestamptz '2026-10-02 10:00:00+03', v_gm
  );
  INSERT INTO public.warehouse_transfers (
    id, transfer_no, source_warehouse_id, destination_warehouse_id, status, created_at, sent_at
  ) VALUES (
    v_tr, 'TR-LEGACY-' || left(v_tr::text, 8), v_wh, v_other, 'pending_receipt',
    timestamptz '2026-09-01 10:00:00+03', timestamptz '2026-09-01 11:00:00+03'
  );

  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_item;
  SELECT count(*) INTO v_mov FROM public.inventory_movements;
  IF NOT EXISTS (SELECT 1 FROM public.list_untransferred_production() WHERE doc_id = v_inv) THEN
    RAISE EXCEPTION 'invoice missing from untransferred report';
  END IF;

  BEGIN
    PERFORM public.close_legacy_doc_by_stocktake('meat_manufacturing_invoice', v_inv, 'إغلاق قبل الجرد');
    RAISE EXCEPTION 'close without stocktake was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%NO_STOCKTAKE_BASELINE%' THEN RAISE; END IF;
  END;

  INSERT INTO public.stocktaking_sessions (
    session_no, warehouse_id, stocktaker_name, status, approved_at, approved_by
  ) VALUES (
    'ST-LEGACY-' || left(v_wh::text, 8), v_wh, 'جرد', 'approved',
    timestamptz '2026-09-30 12:00:00+03', v_gm
  );

  PERFORM set_config('request.jwt.claim.sub', v_sup::text, true);
  BEGIN
    PERFORM public.close_legacy_doc_by_stocktake('meat_manufacturing_invoice', v_inv, 'محاولة مشرف');
    RAISE EXCEPTION 'supervisor close was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%NOT_AUTHORIZED%' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_gm::text, true);
  BEGIN
    PERFORM public.close_legacy_doc_by_stocktake('meat_manufacturing_invoice', v_late, 'بعد الأساس');
    RAISE EXCEPTION 'post-baseline close was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%AFTER_BASELINE%' THEN RAISE; END IF;
  END;

  v_res := public.close_legacy_doc_by_stocktake('meat_manufacturing_invoice', v_inv, 'أُغلق بجرد 30 سبتمبر');
  IF v_res->>'status' IS DISTINCT FROM 'closed' THEN
    RAISE EXCEPTION 'invoice close %', v_res;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.meat_manufacturing_invoices
     WHERE id = v_inv AND status = 'closed_by_stocktake'
       AND closed_by = v_gm AND closed_at IS NOT NULL
       AND closed_reason = 'أُغلق بجرد 30 سبتمبر'
  ) THEN
    RAISE EXCEPTION 'invoice close columns missing';
  END IF;
  SELECT count(*) INTO v_audit FROM public.legacy_doc_close_audit WHERE doc_id = v_inv;
  IF v_audit <> 1 THEN RAISE EXCEPTION 'audit rows %', v_audit; END IF;
  IF EXISTS (SELECT 1 FROM public.list_untransferred_production() WHERE doc_id = v_inv) THEN
    RAISE EXCEPTION 'closed invoice still on untransferred report';
  END IF;

  v_res := public.close_legacy_doc_by_stocktake('meat_manufacturing_invoice', v_inv, 'أُغلق بجرد 30 سبتمبر');
  IF v_res->>'status' IS DISTINCT FROM 'already_closed' THEN
    RAISE EXCEPTION 'second close %', v_res;
  END IF;
  SELECT count(*) INTO v_audit FROM public.legacy_doc_close_audit WHERE doc_id = v_inv;
  IF v_audit <> 1 THEN RAISE EXCEPTION 'second close wrote another audit row'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_reconciliation_check(1)
     WHERE check_code = 'transfer_in_transit' AND source_ref LIKE 'TR-LEGACY-%'
  ) THEN
    RAISE EXCEPTION 'open transfer missing from reconciliation';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_exec::text, true);
  v_res := public.close_legacy_doc_by_stocktake('warehouse_transfer', v_tr, 'تحويل أُغلق بالجرد');
  IF v_res->>'status' IS DISTINCT FROM 'closed' THEN
    RAISE EXCEPTION 'transfer close %', v_res;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory_reconciliation_check(1)
     WHERE check_code = 'transfer_in_transit' AND source_ref LIKE 'TR-LEGACY-%'
  ) THEN
    RAISE EXCEPTION 'closed transfer still in reconciliation';
  END IF;

  SELECT stock INTO v_stock2 FROM public.inventory_items WHERE id = v_item;
  SELECT count(*) INTO v_mov2 FROM public.inventory_movements;
  IF v_stock2 IS DISTINCT FROM v_stock OR v_stock2 IS DISTINCT FROM 5 OR v_mov2 IS DISTINCT FROM v_mov THEN
    RAISE EXCEPTION 'close changed stock % -> % movements % -> %', v_stock, v_stock2, v_mov, v_mov2;
  END IF;

  v_ids := ARRAY[]::uuid[];
  FOR i IN 1..101 LOOP
    v_ids := v_ids || gen_random_uuid();
  END LOOP;
  BEGIN
    PERFORM public.close_legacy_docs_by_stocktake('warehouse_transfer', v_ids, 'دفعة فوق الحد');
    RAISE EXCEPTION 'bulk over 100 was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%BULK_CAP%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'LEGACY_CLOSE_OK';
END $$;

ROLLBACK;
