-- The manual-waybill lock must hold on a connection that never defined
-- app.manual_waybill_rpc. This file is a new psql session and must not RESET
-- that GUC first: RESET and DISCARD ALL materialize an unknown custom variable
-- as '', and '' = 'on' is already false. The live hole is current_setting
-- returning NULL because the variable was never defined at all.
-- Rolls back every row it inserts.
BEGIN;

CREATE TEMP TABLE wb_fresh_ids (
  k text PRIMARY KEY,
  id uuid
);

DO $$
DECLARE
  v_alaa uuid := '77b71c5f-cfa8-42bc-85de-ae536a3ec1c1';
  v_customer uuid;
  v_manual uuid;
  v_plain uuid;
  v_maint uuid;
BEGIN
  IF current_setting('app.manual_waybill_rpc', true) IS NOT NULL THEN
    RAISE EXCEPTION 'app.manual_waybill_rpc is already defined (%)', current_setting('app.manual_waybill_rpc', true);
  END IF;

  INSERT INTO auth.users (id, email)
  VALUES (v_alaa, 'alaa-waybill-fresh@example.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, full_name, email)
  VALUES (v_alaa, 'آلاء', 'alaa-waybill-fresh@example.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.customers (name, phone, governorate)
  VALUES ('عميل قفل غير معرّف', '01000000089', 'القاهرة')
  RETURNING id INTO v_customer;

  INSERT INTO public.orders (order_number, customer_id, shipping_bill_no, shipping_bill_source, shipping_bill_manual_by, status)
  VALUES ('WB-FRESH-MANUAL', v_customer, 'FRESH-MANUAL', 'manual', v_alaa, 'pending')
  RETURNING id INTO v_manual;

  INSERT INTO public.orders (order_number, customer_id, shipping_bill_no, status)
  VALUES ('WB-FRESH-PLAIN', v_customer, 'FRESH-PLAIN', 'pending')
  RETURNING id INTO v_plain;

  INSERT INTO public.orders (order_number, customer_id, shipping_bill_no, shipping_bill_source, status)
  VALUES ('WB-FRESH-MAINT', v_customer, 'FRESH-MAINT', 'manual', 'pending')
  RETURNING id INTO v_maint;

  INSERT INTO wb_fresh_ids VALUES ('manual', v_manual), ('plain', v_plain), ('maint', v_maint);
END;
$$;

-- postgres with no JWT still applies a maintenance update.
UPDATE public.orders
   SET shipping_bill_no = 'FRESH-MAINT-2'
 WHERE order_number = 'WB-FRESH-MAINT';

DO $$
DECLARE
  v_bill text;
  v_conflicts int;
BEGIN
  SELECT shipping_bill_no INTO v_bill FROM public.orders WHERE order_number = 'WB-FRESH-MAINT';
  SELECT count(*) INTO v_conflicts FROM public.waybill_sync_conflicts c
    JOIN public.orders o ON o.id = c.order_id
   WHERE o.order_number = 'WB-FRESH-MAINT';
  IF v_bill IS DISTINCT FROM 'FRESH-MAINT-2' OR v_conflicts <> 0 THEN
    RAISE EXCEPTION 'postgres maintenance update was blocked (bill=%, conflicts=%)', v_bill, v_conflicts;
  END IF;
END;
$$;

ALTER ROLE service_role BYPASSRLS;
GRANT SELECT, UPDATE ON public.orders TO service_role;
SELECT set_config('request.jwt.claim.sub', '', true);

DO $$
BEGIN
  IF current_setting('app.manual_waybill_rpc', true) IS NOT NULL THEN
    RAISE EXCEPTION 'GUC must still be undefined before the service_role update, got %', current_setting('app.manual_waybill_rpc', true);
  END IF;
END;
$$;

SET LOCAL ROLE service_role;

UPDATE public.orders
   SET shipping_bill_no = 'FROM-SERVICE-FRESH',
       shipping_bill_source = 'zodex',
       status = 'confirmed'
 WHERE order_number = 'WB-FRESH-MANUAL';

UPDATE public.orders
   SET shipping_bill_no = 'FROM-SERVICE-FRESH',
       shipping_bill_source = 'zodex'
 WHERE order_number = 'WB-FRESH-MANUAL';

UPDATE public.orders
   SET shipping_bill_no = 'PLAIN-SERVICE-FRESH'
 WHERE order_number = 'WB-FRESH-PLAIN';

RESET ROLE;

DO $$
DECLARE
  v_gm uuid := '7bda161e-9622-49f0-925f-5d613a6fb6c1';
  v_bill text;
  v_source text;
  v_by uuid;
  v_status text;
  v_conflicts int;
  v_plain text;
  v_plain_source text;
BEGIN
  SELECT o.shipping_bill_no, o.shipping_bill_source, o.shipping_bill_manual_by, o.status
    INTO v_bill, v_source, v_by, v_status
    FROM public.orders o
   WHERE o.order_number = 'WB-FRESH-MANUAL';
  IF v_bill IS DISTINCT FROM 'FRESH-MANUAL'
     OR v_source IS DISTINCT FROM 'manual'
     OR v_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'service_role manual update was not kept (bill=%, source=%, status=%)', v_bill, v_source, v_status;
  END IF;

  SELECT count(*) INTO v_conflicts
    FROM public.waybill_sync_conflicts c
    JOIN public.orders o ON o.id = c.order_id
   WHERE o.order_number = 'WB-FRESH-MANUAL'
     AND c.incoming_bill_no = 'FROM-SERVICE-FRESH'
     AND c.source = 'direct_update_blocked'
     AND c.resolved_at IS NULL;
  IF v_conflicts <> 1 THEN
    RAISE EXCEPTION 'expected 1 unresolved conflict after two service_role updates, got %', v_conflicts;
  END IF;

  SELECT shipping_bill_no, shipping_bill_source
    INTO v_plain, v_plain_source
    FROM public.orders
   WHERE order_number = 'WB-FRESH-PLAIN';
  IF v_plain IS DISTINCT FROM 'PLAIN-SERVICE-FRESH' OR v_plain_source IS NOT NULL THEN
    RAISE EXCEPTION 'service_role changed a non-manual order unexpectedly (bill=%, source=%)', v_plain, v_plain_source;
  END IF;

  IF current_setting('app.manual_waybill_rpc', true) IS NOT NULL THEN
    RAISE EXCEPTION 'GUC became defined before the GM update';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_gm::text, true);

  BEGIN
    UPDATE public.orders
       SET shipping_bill_no = 'GM-FRESH',
           shipping_bill_source = 'zodex'
     WHERE order_number = 'WB-FRESH-MANUAL';
    RAISE EXCEPTION 'GM direct update was not blocked';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  SELECT shipping_bill_no, shipping_bill_source, status
    INTO v_bill, v_source, v_status
    FROM public.orders
   WHERE order_number = 'WB-FRESH-MANUAL';
  IF v_bill IS DISTINCT FROM 'FRESH-MANUAL' OR v_source IS DISTINCT FROM 'manual' OR v_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'GM update changed the manual order (bill=%, source=%, status=%)', v_bill, v_source, v_status;
  END IF;

  UPDATE public.orders
     SET shipping_bill_no = 'PLAIN-GM-FRESH'
   WHERE order_number = 'WB-FRESH-PLAIN';
  SELECT shipping_bill_no, shipping_bill_source
    INTO v_plain, v_plain_source
    FROM public.orders
   WHERE order_number = 'WB-FRESH-PLAIN';
  IF v_plain IS DISTINCT FROM 'PLAIN-GM-FRESH' OR v_plain_source IS NOT NULL THEN
    RAISE EXCEPTION 'GM could not update a non-manual order (bill=%, source=%)', v_plain, v_plain_source;
  END IF;
END;
$$;

DO $$
DECLARE
  v_alaa uuid := '77b71c5f-cfa8-42bc-85de-ae536a3ec1c1';
  v_bill text;
  v_source text;
  v_by uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_alaa::text, true);
  PERFORM set_config('app.manual_waybill_rpc', '', true);
  PERFORM public.set_order_waybill_manual(
    (SELECT id FROM public.orders WHERE order_number = 'WB-FRESH-MANUAL'),
    'RPC-FRESH-1'
  );
  SELECT shipping_bill_no, shipping_bill_source, shipping_bill_manual_by
    INTO v_bill, v_source, v_by
    FROM public.orders
   WHERE order_number = 'WB-FRESH-MANUAL';
  IF v_bill IS DISTINCT FROM 'RPC-FRESH-1' OR v_source IS DISTINCT FROM 'manual' OR v_by IS DISTINCT FROM v_alaa THEN
    RAISE EXCEPTION 'Alaa RPC did not set the manual waybill (bill=%, source=%, by=%)', v_bill, v_source, v_by;
  END IF;
END;
$$;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.lock_manual_waybill()', 'EXECUTE')
     OR has_function_privilege('public', 'public.lock_manual_waybill()', 'EXECUTE') THEN
    RAISE EXCEPTION 'lock_manual_waybill is executable by anon or public';
  END IF;
  IF has_function_privilege('anon', 'public.insert_waybill_sync_conflict(uuid,text,text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('public', 'public.insert_waybill_sync_conflict(uuid,text,text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.insert_waybill_sync_conflict(uuid,text,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'insert_waybill_sync_conflict grants are wrong';
  END IF;
  IF has_function_privilege('anon', 'public.sync_zodex_bill_no_to_order()', 'EXECUTE')
     OR has_function_privilege('public', 'public.sync_zodex_bill_no_to_order()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.sync_zodex_bill_no_to_order()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.sync_zodex_bill_no_to_order()', 'EXECUTE') THEN
    RAISE EXCEPTION 'sync_zodex_bill_no_to_order grants are wrong';
  END IF;
END;
$$;

ROLLBACK;
