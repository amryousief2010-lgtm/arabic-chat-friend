-- Anon has no EXECUTE on ledger/posting/admin stock functions.
-- The packaging-history guard fires before post_meat_raw_movement writes stock.
BEGIN;

DO $$
DECLARE
  r record;
  v_def text;
  v_pack uuid := gen_random_uuid();
  v_stock numeric;
  v_moves int;
  v_check int;
  v_update int;
  v_names text[] := ARRAY[
    'close_legacy_doc_by_stocktake',
    'close_legacy_docs_by_stocktake',
    'post_inventory_movement',
    'post_meat_raw_movement',
    'post_named_stock',
    'post_manual_inventory_movement',
    'set_inventory_item_stock',
    'reverse_posted_inventory_movement',
    'post_purchase_in_packs',
    'post_waste_movement',
    'post_outlet_sale',
    'post_production_movement',
    'post_packaging_consumption',
    'post_packaging_warehouse_move',
    'post_outlet_sales_statement',
    'reverse_outlet_sales_statement',
    'save_outlet_sales_statement',
    'inv_post_movement',
    'inv_transfer',
    'ledger_apply_card_stock',
    '_dispatch_order_stock_core',
    '_return_order_dispatched_stock',
    'commit_agouza_stock_on_delivery',
    'adjust_main_warehouse_stock',
    'return_order_stock',
    'retry_failed_order_dispatches',
    'approve_stocktaking_session',
    'submit_stock_adjustment',
    'approve_warehouse_opening_balance',
    'upsert_stocktaking_line',
    'create_and_send_transfer',
    'confirm_transfer_receipt',
    'merge_duplicate_inventory_cards',
    'merge_inventory_items',
    'mr_reconcile_negative_stock',
    'reverse_receipt_approval',
    'receive_meat_production_transfer',
    'receive_mf_transfer',
    'receive_slaughter_output',
    'receive_slaughter_output_to_meat_factory',
    'approve_meat_manufacturing_invoice',
    'cancel_meat_manufacturing_invoice',
    'apply_meat_stocktake',
    'approve_meat_manufacturing',
    'approve_meat_purchase',
    'meat_factory_adjust_stock',
    'record_courier_return',
    'sync_main_stock_to_sublocations',
    'approve_meat_factory_batch',
    'approve_meat_sale',
    'approve_meat_sales_return',
    'cancel_meat_sales_return',
    'post_mf_raw_purchase',
    'post_mf_pack_purchase',
    'post_mf_manufacturing',
    'post_mf_sale',
    'post_mf_return',
    'post_mf_transfer',
    'reject_mf_transfer',
    'ensure_packaging_warehouse',
    'resolve_packaging_card'
  ];
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = ANY (v_names)
  LOOP
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can execute %', r.sig;
    END IF;
  END LOOP;

  IF NOT has_function_privilege('authenticated', 'public.post_inventory_movement(uuid, text, numeric, text, uuid, text, text, text, timestamptz, numeric, text, text, text, boolean, uuid, uuid, text, uuid, text, text, text, uuid, numeric, numeric, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.post_inventory_movement(uuid, text, numeric, text, uuid, text, text, text, timestamptz, numeric, text, text, text, boolean, uuid, uuid, text, uuid, text, text, text, uuid, numeric, numeric, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'post_inventory_movement lost authenticated or service_role';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.post_meat_raw_movement(uuid, text, numeric, numeric, text, text, uuid, text, text, numeric, numeric, text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.post_meat_raw_movement(uuid, text, numeric, numeric, text, text, uuid, text, text, numeric, numeric, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'post_meat_raw_movement lost authenticated or service_role';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.post_named_stock(text, uuid, numeric, text, uuid, text, text, numeric, text, numeric)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.post_named_stock(text, uuid, numeric, text, uuid, text, text, numeric, text, numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'post_named_stock lost authenticated or service_role';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.close_legacy_doc_by_stocktake(text, uuid, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.close_legacy_docs_by_stocktake(text, uuid[], text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.close_legacy_doc_by_stocktake(text, uuid, text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.close_legacy_docs_by_stocktake(text, uuid[], text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'legacy close lost authenticated or service_role';
  END IF;
  IF has_function_privilege('authenticated', 'public.post_mf_sale(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.post_mf_sale(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'post_mf_sale is executable again';
  END IF;
  IF has_function_privilege('authenticated', 'public.ledger_apply_card_stock(uuid, numeric)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.ledger_apply_card_stock(uuid, numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ledger_apply_card_stock is executable again';
  END IF;
  IF has_function_privilege('authenticated', 'public._dispatch_order_stock_core(uuid, uuid, text, boolean)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public._dispatch_order_stock_core(uuid, uuid, text, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'dispatch core privileges changed';
  END IF;

  v_def := pg_get_functiondef('public.post_meat_raw_movement(uuid, text, numeric, numeric, text, text, uuid, text, text, numeric, numeric, text)'::regprocedure);
  v_check := position('PACKAGING_HISTORY_READONLY' in v_def);
  v_update := position('SET current_stock' in v_def);
  IF v_check = 0 OR v_update = 0 OR v_check > v_update THEN
    RAISE EXCEPTION 'PACKAGING_HISTORY_READONLY is not before the stock write';
  END IF;
  IF position('app.meat_raw_stock_write' in v_def) = 0
     OR position('''off''' in v_def) = 0 THEN
    RAISE EXCEPTION 'meat raw session flag reset is missing';
  END IF;

  INSERT INTO public.meat_factory_raw_items (id, name, kind, unit, current_stock)
  VALUES (v_pack, 'تغليف ممنوع', 'packaging', 'علبة', 0);
  BEGIN
    PERFORM public.post_meat_raw_movement(
      v_pack, 'IN', 2, 1, 'اختبار قراءة فقط', 'manual', gen_random_uuid(),
      'packaging', 'delta', NULL, NULL, 'تغليف ممنوع'
    );
    RAISE EXCEPTION 'packaging post was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%PACKAGING_HISTORY_READONLY%' THEN
      RAISE;
    END IF;
  END;
  SELECT current_stock INTO v_stock FROM public.meat_factory_raw_items WHERE id = v_pack;
  SELECT count(*) INTO v_moves FROM public.meat_factory_inventory_moves WHERE item_id = v_pack;
  IF v_stock IS DISTINCT FROM 0 OR v_moves <> 0 THEN
    RAISE EXCEPTION 'packaging check wrote stock % moves %', v_stock, v_moves;
  END IF;
END
$$;

ROLLBACK;

DO $$ BEGIN RAISE NOTICE 'ANON_LEDGER_OK'; END $$;
