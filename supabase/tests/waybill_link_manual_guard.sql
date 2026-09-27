-- link_zodex_bill_to_order must not overwrite a non-empty manual waybill.
-- Rolls back every row it inserts. Privilege checks read the catalog only.
BEGIN;

DO $$
DECLARE
  v_gm uuid := '7bda161e-9622-49f0-925f-5d613a6fb6c1';
  v_customer uuid;
  v_manual uuid;
  v_plain uuid;
  v_empty uuid;
  v_missing uuid;
  v_res jsonb;
  v_bill text;
  v_source text;
  v_conflicts int;
  v_missing_status text;
  v_audit int;
  v_def boolean;
BEGIN
  INSERT INTO auth.users (id, email)
  VALUES (v_gm, 'gm-waybill-link@example.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_gm, 'general_manager')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.customers (name, phone, governorate)
  VALUES ('عميل حارس الربط', '01000000088', 'القاهرة')
  RETURNING id INTO v_customer;

  INSERT INTO public.orders (order_number, customer_id, shipping_bill_no, shipping_bill_source)
  VALUES ('WB-LINK-MANUAL', v_customer, 'OLD-MANUAL-LINK', 'manual')
  RETURNING id INTO v_manual;

  INSERT INTO public.orders (order_number, customer_id, shipping_bill_no)
  VALUES ('WB-LINK-PLAIN', v_customer, 'OLD-PLAIN-LINK')
  RETURNING id INTO v_plain;

  INSERT INTO public.orders (order_number, customer_id, shipping_bill_no, shipping_bill_source)
  VALUES ('WB-LINK-EMPTY', v_customer, '   ', 'manual')
  RETURNING id INTO v_empty;

  INSERT INTO public.zodex_missing_orders (bill_no, status)
  VALUES ('INCOMING-LINK-1', 'pending')
  RETURNING id INTO v_missing;

  PERFORM set_config('request.jwt.claim.sub', '', true);

  v_res := public.link_zodex_bill_to_order('INCOMING-LINK-1', v_manual, v_missing, 90, 'test');
  IF v_res->>'ok' IS DISTINCT FROM 'false'
     OR v_res->>'status' IS DISTINCT FROM 'manual_bill_kept'
     OR v_res->>'error' IS DISTINCT FROM 'رقم البوليصة متسجل يدويًا ولا يعدله إلا م. آلاء'
     OR v_res->>'bill_no' IS DISTINCT FROM 'OLD-MANUAL-LINK'
     OR v_res->>'incoming_bill_no' IS DISTINCT FROM 'INCOMING-LINK-1' THEN
    RAISE EXCEPTION 'service_role link did not refuse the manual bill: %', v_res;
  END IF;

  SELECT shipping_bill_no, shipping_bill_source
    INTO v_bill, v_source
    FROM public.orders
   WHERE id = v_manual;
  IF v_bill IS DISTINCT FROM 'OLD-MANUAL-LINK' OR v_source IS DISTINCT FROM 'manual' THEN
    RAISE EXCEPTION 'manual bill changed to % / %', v_bill, v_source;
  END IF;

  SELECT status INTO v_missing_status FROM public.zodex_missing_orders WHERE id = v_missing;
  IF v_missing_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'refused link resolved the missing row (%)', v_missing_status;
  END IF;

  SELECT count(*) INTO v_audit
    FROM public.zodex_bill_link_audit
   WHERE order_id = v_manual;
  IF v_audit <> 0 THEN
    RAISE EXCEPTION 'refused link wrote % audit rows', v_audit;
  END IF;

  SELECT count(*) INTO v_conflicts
    FROM public.waybill_sync_conflicts
   WHERE order_id = v_manual
     AND incoming_bill_no = 'INCOMING-LINK-1'
     AND source = 'link_zodex_bill_to_order'
     AND resolved_at IS NULL;
  IF v_conflicts <> 1 THEN
    RAISE EXCEPTION 'expected 1 conflict, got %', v_conflicts;
  END IF;

  v_res := public.link_zodex_bill_to_order('INCOMING-LINK-1', v_manual, NULL, NULL, NULL);
  SELECT count(*) INTO v_conflicts
    FROM public.waybill_sync_conflicts
   WHERE order_id = v_manual
     AND incoming_bill_no = 'INCOMING-LINK-1'
     AND resolved_at IS NULL;
  IF v_conflicts <> 1 OR v_res->>'status' IS DISTINCT FROM 'manual_bill_kept' THEN
    RAISE EXCEPTION 'duplicate conflict inserted (% rows, %)', v_conflicts, v_res;
  END IF;

  PERFORM public.link_zodex_bill_to_order('INCOMING-LINK-2', v_manual, NULL, NULL, NULL);
  SELECT count(*) INTO v_conflicts
    FROM public.waybill_sync_conflicts
   WHERE order_id = v_manual AND resolved_at IS NULL;
  IF v_conflicts <> 2 THEN
    RAISE EXCEPTION 'a different incoming bill should log another conflict, got %', v_conflicts;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_gm::text, true);
  v_res := public.link_zodex_bill_to_order('INCOMING-LINK-GM', v_manual, NULL, NULL, NULL);
  IF v_res->>'status' IS DISTINCT FROM 'manual_bill_kept' THEN
    RAISE EXCEPTION 'authenticated caller overwrote or failed differently: %', v_res;
  END IF;
  SELECT shipping_bill_no INTO v_bill FROM public.orders WHERE id = v_manual;
  IF v_bill IS DISTINCT FROM 'OLD-MANUAL-LINK' THEN
    RAISE EXCEPTION 'authenticated caller changed the manual bill to %', v_bill;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_res := public.link_zodex_bill_to_order('OLD-MANUAL-LINK', v_manual, NULL, NULL, NULL);
  IF v_res->>'ok' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'linking the same manual bill should succeed: %', v_res;
  END IF;
  SELECT count(*) INTO v_conflicts
    FROM public.waybill_sync_conflicts
   WHERE order_id = v_manual AND resolved_at IS NULL;
  IF v_conflicts <> 3 THEN
    RAISE EXCEPTION 'same-bill link should not add a conflict (got %)', v_conflicts;
  END IF;

  v_res := public.link_zodex_bill_to_order('NEW-PLAIN-LINK', v_plain, NULL, NULL, NULL);
  SELECT shipping_bill_no INTO v_bill FROM public.orders WHERE id = v_plain;
  IF v_res->>'ok' IS DISTINCT FROM 'true' OR v_bill IS DISTINCT FROM 'NEW-PLAIN-LINK' THEN
    RAISE EXCEPTION 'non-manual link failed (res=%, bill=%)', v_res, v_bill;
  END IF;

  v_res := public.link_zodex_bill_to_order('NEW-EMPTY-LINK', v_empty, NULL, NULL, NULL);
  SELECT shipping_bill_no INTO v_bill FROM public.orders WHERE id = v_empty;
  IF v_res->>'ok' IS DISTINCT FROM 'true' OR v_bill IS DISTINCT FROM 'NEW-EMPTY-LINK' THEN
    RAISE EXCEPTION 'empty manual bill should still be linked (res=%, bill=%)', v_res, v_bill;
  END IF;

  IF has_function_privilege('anon', 'public.insert_waybill_sync_conflict(uuid,text,text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.insert_waybill_sync_conflict(uuid,text,text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('public', 'public.insert_waybill_sync_conflict(uuid,text,text,text,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.insert_waybill_sync_conflict(uuid,text,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'insert_waybill_sync_conflict grants are wrong';
  END IF;

  IF has_function_privilege('anon', 'public.link_zodex_bill_to_order(text,uuid,uuid,numeric,text)', 'EXECUTE')
     OR has_function_privilege('public', 'public.link_zodex_bill_to_order(text,uuid,uuid,numeric,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.link_zodex_bill_to_order(text,uuid,uuid,numeric,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.link_zodex_bill_to_order(text,uuid,uuid,numeric,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'link_zodex_bill_to_order grants are wrong';
  END IF;

  IF has_function_privilege('anon', 'public.lock_manual_waybill()', 'EXECUTE')
     OR has_function_privilege('public', 'public.lock_manual_waybill()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.lock_manual_waybill()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.lock_manual_waybill()', 'EXECUTE') THEN
    RAISE EXCEPTION 'lock_manual_waybill grants are wrong';
  END IF;

  SELECT p.prosecdef INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'lock_manual_waybill';
  IF v_def IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'lock_manual_waybill must be security definer';
  END IF;
END;
$$;

ROLLBACK;
