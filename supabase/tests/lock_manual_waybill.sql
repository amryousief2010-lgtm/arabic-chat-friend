-- Manual waybill lock. Run after migrations. Rolls back everything it inserts.
BEGIN;

DO $$
DECLARE
  v_alaa uuid := '77b71c5f-cfa8-42bc-85de-ae536a3ec1c1';
  v_gm uuid := '7bda161e-9622-49f0-925f-5d613a6fb6c1';
  v_customer uuid;
  v_manual uuid;
  v_plain uuid;
  v_bill text;
  v_source text;
  v_by uuid;
  v_notes text;
  v_conflicts int;
  v_incoming text;
  v_who text;
BEGIN
  INSERT INTO auth.users (id, email)
  VALUES (v_alaa, 'alaa-waybill-lock@example.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, full_name, email)
  VALUES (v_alaa, 'آلاء', 'alaa-waybill-lock@example.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.customers (name, phone, governorate)
  VALUES ('عميل قفل البوليصة', '01000000077', 'القاهرة')
  RETURNING id INTO v_customer;

  INSERT INTO public.orders (order_number, customer_id, shipping_bill_no, shipping_bill_source, shipping_bill_manual_by)
  VALUES ('WB-LOCK-MANUAL', v_customer, 'OLD-MANUAL', 'manual', v_alaa)
  RETURNING id INTO v_manual;

  INSERT INTO public.orders (order_number, customer_id, shipping_bill_no)
  VALUES ('WB-LOCK-PLAIN', v_customer, 'OLD-PLAIN')
  RETURNING id INTO v_plain;

  PERFORM set_config('request.jwt.claim.sub', v_alaa::text, true);
  PERFORM set_config('app.manual_waybill_rpc', '', true);

  PERFORM public.set_order_waybill_manual(v_manual, 'RPC-ALAA-1');

  SELECT shipping_bill_no, shipping_bill_source, shipping_bill_manual_by
    INTO v_bill, v_source, v_by
    FROM public.orders
   WHERE id = v_manual;
  IF v_bill IS DISTINCT FROM 'RPC-ALAA-1' OR v_source IS DISTINCT FROM 'manual' OR v_by IS DISTINCT FROM v_alaa THEN
    RAISE EXCEPTION 'Alaa RPC did not set the manual waybill (bill=%, source=%, by=%)', v_bill, v_source, v_by;
  END IF;

  -- The RPC leaves the flag on for the rest of this transaction. Direct updates must not inherit it.
  PERFORM set_config('app.manual_waybill_rpc', '', true);

  BEGIN
    UPDATE public.orders
       SET shipping_bill_no = 'DIRECT-ALAA'
     WHERE id = v_manual;
    RAISE EXCEPTION 'Alaa direct update was not blocked';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  SELECT shipping_bill_no INTO v_bill FROM public.orders WHERE id = v_manual;
  IF v_bill IS DISTINCT FROM 'RPC-ALAA-1' THEN
    RAISE EXCEPTION 'Alaa direct update changed the bill to %', v_bill;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_gm::text, true);

  BEGIN
    UPDATE public.orders
       SET shipping_bill_no = 'GM-BILL'
     WHERE id = v_manual;
    RAISE EXCEPTION 'GM direct update was not blocked';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  SELECT shipping_bill_no INTO v_bill FROM public.orders WHERE id = v_manual;
  IF v_bill IS DISTINCT FROM 'RPC-ALAA-1' THEN
    RAISE EXCEPTION 'GM direct update changed the bill to %', v_bill;
  END IF;

  UPDATE public.orders
     SET shipping_bill_no = NULL,
         notes = 'address-still-saved'
   WHERE id = v_manual;

  SELECT shipping_bill_no, notes INTO v_bill, v_notes FROM public.orders WHERE id = v_manual;
  IF v_bill IS DISTINCT FROM 'RPC-ALAA-1' OR v_notes IS DISTINCT FROM 'address-still-saved' THEN
    RAISE EXCEPTION 'clear did not keep the bill (bill=%, notes=%)', v_bill, v_notes;
  END IF;

  SELECT count(*), max(incoming_bill_no)
    INTO v_conflicts, v_incoming
    FROM public.waybill_sync_conflicts
   WHERE order_id = v_manual
     AND source = 'direct_update_blocked'
     AND incoming_bill_no IS NULL;
  IF v_conflicts < 1 THEN
    RAISE EXCEPTION 'clear was not logged';
  END IF;

  UPDATE public.orders
     SET shipping_bill_no = 'PLAIN-NEW'
   WHERE id = v_plain;
  SELECT shipping_bill_no, shipping_bill_source INTO v_bill, v_source FROM public.orders WHERE id = v_plain;
  IF v_bill IS DISTINCT FROM 'PLAIN-NEW' OR v_source IS NOT NULL THEN
    RAISE EXCEPTION 'non-manual order was affected (bill=%, source=%)', v_bill, v_source;
  END IF;

  UPDATE public.orders
     SET shipping_bill_source = 'manual',
         shipping_bill_manual_by = v_gm,
         shipping_bill_manual_at = now()
   WHERE id = v_plain;
  SELECT shipping_bill_source, shipping_bill_manual_by, shipping_bill_no
    INTO v_source, v_by, v_bill
    FROM public.orders
   WHERE id = v_plain;
  IF v_source IS NOT NULL OR v_by IS NOT NULL OR v_bill IS DISTINCT FROM 'PLAIN-NEW' THEN
    RAISE EXCEPTION 'non-Alaa set the manual flag (source=%, by=%, bill=%)', v_source, v_by, v_bill;
  END IF;
END $$;

-- service_role replacing a manual number is kept and logged, even when the new number is not blank.
-- Hosted service_role bypasses RLS. The CI role does not, until this transaction says so.
ALTER ROLE service_role BYPASSRLS;
GRANT SELECT, UPDATE ON public.orders TO service_role;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('app.manual_waybill_rpc', '', true);
SET LOCAL ROLE service_role;

UPDATE public.orders
   SET shipping_bill_no = 'FROM-SERVICE'
 WHERE order_number = 'WB-LOCK-MANUAL';

RESET ROLE;

DO $$
DECLARE
  v_bill text;
  v_who text;
  v_incoming text;
BEGIN
  SELECT shipping_bill_no INTO v_bill
    FROM public.orders
   WHERE order_number = 'WB-LOCK-MANUAL';
  IF v_bill IS DISTINCT FROM 'RPC-ALAA-1' THEN
    RAISE EXCEPTION 'service_role changed the manual bill to %', v_bill;
  END IF;

  SELECT incoming_bill_no, details->>'current_user'
    INTO v_incoming, v_who
    FROM public.waybill_sync_conflicts
   WHERE source = 'direct_update_blocked'
     AND incoming_bill_no = 'FROM-SERVICE'
   ORDER BY created_at DESC
   LIMIT 1;
  IF v_incoming IS DISTINCT FROM 'FROM-SERVICE' OR v_who IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role block was not logged (incoming=%, who=%)', v_incoming, v_who;
  END IF;
END $$;

ROLLBACK;
