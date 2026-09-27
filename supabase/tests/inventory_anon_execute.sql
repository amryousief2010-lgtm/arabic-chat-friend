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

-- The nine stock RPCs: anon has no EXECUTE, a role outside the screen is
-- rejected, an allowed role passes the gate, and a card mirror cannot move.
DO $$
DECLARE
  r record;
  v_gm uuid := gen_random_uuid();
  v_ship uuid := gen_random_uuid();
  v_sales uuid := gen_random_uuid();
  v_fin uuid := gen_random_uuid();
  v_wh uuid := gen_random_uuid();
  v_prod uuid := gen_random_uuid();
  v_feed uuid := gen_random_uuid();
  v_raw uuid := gen_random_uuid();
  v_from uuid := gen_random_uuid();
  v_to uuid := gen_random_uuid();
  v_mirror uuid := gen_random_uuid();
  v_plain uuid := gen_random_uuid();
  v_id uuid;
  v_stock numeric;
  v_other numeric;
  v_def text;
  v_names text[] := ARRAY[
    'approve_distribution_dispatch',
    'meat_production_transfer_to_main',
    'finalize_meat_production',
    'transfer_between_sublocations',
    'get_or_create_wh_item',
    'ensure_brooding_feed_row',
    'ensure_slaughter_feed_row',
    'ensure_slaughter_feed_raw_row'
  ];
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = ANY (v_names)
  LOOP
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can execute %', r.sig;
    END IF;
    IF NOT has_function_privilege('authenticated', r.oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '% lost authenticated or service_role', r.sig;
    END IF;
    v_def := pg_get_functiondef(r.oid);
    IF position('NOT_AUTHORIZED' in v_def) = 0
       OR position('auth.uid()' in v_def) = 0
       OR position('pg_trigger_depth()' in v_def) = 0 THEN
      RAISE EXCEPTION '% is missing the auth gate', r.sig;
    END IF;
  END LOOP;

  IF has_function_privilege('anon', 'public.is_manual_stock_warehouse(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute is_manual_stock_warehouse';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.is_manual_stock_warehouse(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.is_manual_stock_warehouse(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'is_manual_stock_warehouse lost authenticated or service_role';
  END IF;
  IF NOT has_function_privilege('anon', 'public.product_sale_price(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'product_sale_price lost its anon grant';
  END IF;

  CREATE FUNCTION public._inv_default_acl_probe() RETURNS integer
  LANGUAGE sql AS $probe$ SELECT 1 $probe$;
  IF has_function_privilege('anon', 'public._inv_default_acl_probe()', 'EXECUTE') THEN
    RAISE EXCEPTION 'a new function is still executable by anon';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(p.proacl) a
     WHERE n.nspname = 'public'
       AND p.proname = '_inv_default_acl_probe'
       AND a.grantee = 0
       AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'a new function is still executable by PUBLIC';
  END IF;
  DROP FUNCTION public._inv_default_acl_probe();

  INSERT INTO auth.users (id, email, aud, role) VALUES
    (v_gm, 'rpc-gm-' || v_gm::text || '@test.local', 'authenticated', 'authenticated'),
    (v_ship, 'rpc-ship-' || v_ship::text || '@test.local', 'authenticated', 'authenticated'),
    (v_sales, 'rpc-sales-' || v_sales::text || '@test.local', 'authenticated', 'authenticated'),
    (v_fin, 'rpc-fin-' || v_fin::text || '@test.local', 'authenticated', 'authenticated');
  -- New-user trigger grants sales_moderator. Drop it so each fixture has one role.
  DELETE FROM public.user_roles
   WHERE user_id IN (v_gm, v_ship, v_sales, v_fin);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_gm, 'general_manager'),
    (v_ship, 'shipping_company'),
    (v_sales, 'sales_moderator'),
    (v_fin, 'financial_manager');

  PERFORM set_config('request.jwt.claim.sub', v_ship::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  BEGIN
    PERFORM public.ensure_brooding_feed_row('علف مرفوض');
    RAISE EXCEPTION 'shipping ensure_brooding was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%NOT_AUTHORIZED%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.approve_distribution_dispatch(NULL::uuid, NULL::uuid, NULL::uuid[], NULL::text, false);
    RAISE EXCEPTION 'shipping dispatch was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%NOT_AUTHORIZED%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.finalize_meat_production(NULL);
    RAISE EXCEPTION 'shipping finalize was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%NOT_AUTHORIZED%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.meat_production_transfer_to_main(NULL, NULL, NULL, NULL);
    RAISE EXCEPTION 'shipping meat transfer was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%NOT_AUTHORIZED%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.get_or_create_wh_item(NULL, 'x', 'كجم', NULL, NULL, NULL);
    RAISE EXCEPTION 'shipping get_or_create was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%NOT_AUTHORIZED%' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_gm::text, true);
  v_id := public.ensure_brooding_feed_row('علف اختبار الصلاحية');
  SELECT current_kg INTO v_stock FROM public.brooding_feed_inventory WHERE id = v_id;
  IF v_id IS NULL OR v_stock IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'allowed brooding row failed % %', v_id, v_stock;
  END IF;

  INSERT INTO public.feed_products (id, feed_code, name)
  VALUES (v_feed, 'T' || left(v_feed::text, 12), 'علف اختبار');
  v_id := public.ensure_slaughter_feed_row(v_feed, 'علف مجزر اختبار');
  SELECT current_kg INTO v_stock FROM public.slaughterhouse_feed_inventory WHERE id = v_id;
  IF v_stock IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'allowed slaughter feed row failed %', v_stock;
  END IF;

  INSERT INTO public.feed_raw_materials (id, name) VALUES (v_raw, 'خامة اختبار صلاحية');
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    SET LOCAL ROLE service_role;
    v_id := public.ensure_slaughter_feed_raw_row(v_raw, 'خامة من service_role');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE;
  END;
  SELECT current_kg INTO v_stock FROM public.slaughterhouse_feed_inventory WHERE id = v_id;
  IF v_stock IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'service_role raw row failed %', v_stock;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_ship::text, true);
  CREATE TEMP TABLE rpc_auth_probe (id int) ON COMMIT DROP;
  CREATE FUNCTION public._rpc_auth_probe_trg() RETURNS trigger
  LANGUAGE plpgsql AS $trg$
  BEGIN
    PERFORM public.ensure_brooding_feed_row('علف من تريغر');
    RETURN NEW;
  END;
  $trg$;
  CREATE TRIGGER rpc_auth_probe_trg
    BEFORE INSERT ON rpc_auth_probe
    FOR EACH ROW EXECUTE FUNCTION public._rpc_auth_probe_trg();
  INSERT INTO rpc_auth_probe VALUES (1);
  IF NOT EXISTS (
    SELECT 1 FROM public.brooding_feed_inventory WHERE feed_name = 'علف من تريغر'
  ) THEN
    RAISE EXCEPTION 'trigger caller was rejected';
  END IF;
  DROP TRIGGER rpc_auth_probe_trg ON rpc_auth_probe;
  DROP FUNCTION public._rpc_auth_probe_trg();

  PERFORM set_config('request.jwt.claim.sub', v_sales::text, true);
  BEGIN
    PERFORM public.approve_distribution_dispatch(NULL::uuid, NULL::uuid, NULL::uuid[], NULL::text, false);
    RAISE EXCEPTION 'sales dispatch returned without the custody check';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%NOT_AUTHORIZED%' OR SQLERRM NOT LIKE '%custody_id is required%' THEN
      RAISE;
    END IF;
  END;
  BEGIN
    PERFORM public.transfer_between_sublocations(NULL, NULL, NULL, 1, NULL);
    RAISE EXCEPTION 'sales sublocation transfer was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%NOT_AUTHORIZED%' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_fin::text, true);
  PERFORM public.finalize_meat_production(NULL);
  BEGIN
    PERFORM public.meat_production_transfer_to_main(gen_random_uuid(), NULL, NULL, NULL);
    RAISE EXCEPTION 'null meat qty was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%NOT_AUTHORIZED%' OR SQLERRM NOT LIKE '%أكبر من صفر%' THEN
      RAISE;
    END IF;
  END;
  BEGIN
    PERFORM public.get_or_create_wh_item(NULL, 'بطاقة مالية', 'كجم', NULL, NULL, NULL);
    RAISE EXCEPTION 'financial get_or_create was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%NOT_AUTHORIZED%' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_gm::text, true);
  INSERT INTO public.warehouses (id, name) VALUES (v_wh, 'مخزن اختبار مواقع ' || left(v_wh::text, 8));
  v_id := public.get_or_create_wh_item(v_wh, 'بطاقة اختبار صلاحية', 'كجم', NULL, NULL, NULL);
  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_id;
  IF v_stock IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'allowed card stock %', v_stock;
  END IF;

  INSERT INTO public.products (id, name, price, barcode, is_active)
  VALUES (v_prod, 'صنف مواقع', 10, 'SL' || left(v_prod::text, 8), true);
  INSERT INTO public.warehouse_sublocations (id, warehouse_id, code, name_ar) VALUES
    (v_from, v_wh, 'A', 'موقع أ'),
    (v_to, v_wh, 'B', 'موقع ب'),
    (v_mirror, v_wh, 'M', 'مرآة'),
    (v_plain, v_wh, 'P', 'عادي');
  INSERT INTO public.inventory_sublocation_items (sublocation_id, product_id, stock, is_card_mirror) VALUES
    (v_from, v_prod, 5, false),
    (v_to, v_prod, 0, false),
    (v_mirror, v_prod, 5, true),
    (v_plain, v_prod, 1, false);

  v_id := public.transfer_between_sublocations(v_prod, v_from, v_to, 1, NULL);
  IF v_id IS NULL THEN RAISE EXCEPTION 'allowed transfer returned null'; END IF;
  SELECT stock INTO v_stock FROM public.inventory_sublocation_items
   WHERE sublocation_id = v_from AND product_id = v_prod;
  SELECT stock INTO v_other FROM public.inventory_sublocation_items
   WHERE sublocation_id = v_to AND product_id = v_prod;
  IF v_stock IS DISTINCT FROM 4 OR v_other IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'transfer stocks % %', v_stock, v_other;
  END IF;

  BEGIN
    PERFORM public.transfer_between_sublocations(v_prod, v_mirror, v_plain, 1, NULL);
    RAISE EXCEPTION 'mirror source transfer was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%CARD_MIRROR%' THEN RAISE; END IF;
  END;
  SELECT stock INTO v_stock FROM public.inventory_sublocation_items
   WHERE sublocation_id = v_mirror AND product_id = v_prod;
  IF v_stock IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'mirror source stock changed %', v_stock;
  END IF;

  BEGIN
    PERFORM public.transfer_between_sublocations(v_prod, v_from, v_mirror, 1, NULL);
    RAISE EXCEPTION 'mirror destination transfer was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%CARD_MIRROR%' THEN RAISE; END IF;
  END;
  SELECT stock INTO v_stock FROM public.inventory_sublocation_items
   WHERE sublocation_id = v_from AND product_id = v_prod;
  SELECT stock INTO v_other FROM public.inventory_sublocation_items
   WHERE sublocation_id = v_mirror AND product_id = v_prod;
  IF v_stock IS DISTINCT FROM 4 OR v_other IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'mirror destination changed stocks % %', v_stock, v_other;
  END IF;

  v_def := pg_get_functiondef('public.transfer_between_sublocations(uuid,uuid,uuid,numeric,text)'::regprocedure);
  IF position('CARD_MIRROR' in v_def) = 0
     OR position('CARD_MIRROR' in v_def) > position('SET stock = stock - p_qty' in v_def) THEN
    RAISE EXCEPTION 'mirror check is not before the stock write';
  END IF;
  v_def := pg_get_functiondef('public.approve_distribution_dispatch(uuid,uuid,uuid[],text)'::regprocedure);
  IF position('NOT_AUTHORIZED' in v_def) = 0 OR position('sales_moderator' in v_def) = 0 THEN
    RAISE EXCEPTION '4-arg dispatch gate missing';
  END IF;
END
$$;

ROLLBACK;

DO $$ BEGIN RAISE NOTICE 'ANON_LEDGER_OK'; END $$;
