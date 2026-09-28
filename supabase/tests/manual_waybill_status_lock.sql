-- Delivery status on a manual waybill is not applied for service_role when
-- app.manual_waybill_rpc was never defined. This file is a new psql session
-- and must not RESET that GUC: RESET stores '' and hides the NULL hole.
-- Rolls back every row it inserts.
BEGIN;

DO $$
DECLARE
  v_alaa uuid := '77b71c5f-cfa8-42bc-85de-ae536a3ec1c1';
  v_gm uuid := '7bda161e-9622-49f0-925f-5d613a6fb6c1';
  v_mod uuid := 'c0ffee00-0000-4000-8000-000000000001';
  v_customer uuid;
BEGIN
  IF current_setting('app.manual_waybill_rpc', true) IS NOT NULL THEN
    RAISE EXCEPTION 'app.manual_waybill_rpc is already defined (%)', current_setting('app.manual_waybill_rpc', true);
  END IF;

  INSERT INTO auth.users (id, email) VALUES
    (v_alaa, 'alaa-status-lock@example.test'),
    (v_gm, 'gm-status-lock@example.test'),
    (v_mod, 'mod-status-lock@example.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, full_name, email) VALUES
    (v_alaa, 'آلاء', 'alaa-status-lock@example.test'),
    (v_gm, 'مدير', 'gm-status-lock@example.test'),
    (v_mod, 'موديريتور', 'mod-status-lock@example.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_gm, 'general_manager'),
    (v_mod, 'sales_moderator')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.customers (name, phone, governorate)
  VALUES ('عميل حالة يدوية', '01000000090', 'القاهرة')
  RETURNING id INTO v_customer;

  INSERT INTO public.orders (
    order_number, customer_id, created_by, fulfillment_type, shipping_company,
    shipping_bill_no, shipping_bill_source, status
  ) VALUES (
    'WB-STATUS-MANUAL', v_customer, v_mod, 'delivery', 'zodex',
    'STATUS-MANUAL', 'manual', 'pending'
  );

  INSERT INTO public.orders (
    order_number, customer_id, shipping_bill_no, status
  ) VALUES (
    'WB-STATUS-PLAIN', v_customer, 'STATUS-PLAIN', 'pending'
  );

  INSERT INTO public.orders (
    order_number, customer_id, shipping_bill_no, shipping_bill_source, status, total
  ) VALUES (
    'WB-STATUS-BOSTTA', v_customer, 'STATUS-BOSTTA', 'manual', 'pending', 10
  );

  INSERT INTO public.orders (
    order_number, customer_id, shipping_bill_no, shipping_bill_source, status, notes
  ) VALUES (
    'WB-STATUS-SHIP', v_customer, 'STATUS-SHIP', 'manual', 'pending', 'ملاحظة قديمة'
  );
END;
$$;

ALTER ROLE service_role BYPASSRLS;
GRANT SELECT, UPDATE ON public.orders TO service_role;
GRANT SELECT ON public.inventory_movements, public.order_items TO service_role;
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
   SET shipping_bill_no = 'STATUS-FROM-SERVICE',
       status = 'delivered',
       collection_status = 'collected',
       delivered_at = now(),
       total_at_delivery = 125,
       zodex_return_amount = 10,
       update_status_marker = 'cancelled',
       update_status_updated_at = now(),
       zodex_synced_at = now()
 WHERE order_number = 'WB-STATUS-MANUAL';

UPDATE public.orders
   SET shipping_bill_no = 'STATUS-FROM-SERVICE',
       status = 'delivered',
       collection_status = 'collected',
       delivered_at = now(),
       total_at_delivery = 125,
       zodex_return_amount = 10,
       update_status_marker = 'cancelled',
       update_status_updated_at = now()
 WHERE order_number = 'WB-STATUS-MANUAL';

UPDATE public.orders
   SET status = 'delivered'
 WHERE order_number = 'WB-STATUS-PLAIN';

-- Bostta: status, stock, and total, with no Zodex column.
UPDATE public.orders
   SET status = 'delivered',
       stock_status = 'dispatched',
       total = 50,
       delivered_at = now()
 WHERE order_number = 'WB-STATUS-BOSTTA';

-- Shipments cancel: no zodex_synced_at, but the marker columns mark it as Zodex.
UPDATE public.orders
   SET status = 'cancelled',
       notes = E'ملاحظة قديمة\n[مرتجع] من زودكس',
       update_status_marker = 'cancelled',
       update_status_updated_at = now()
 WHERE order_number = 'WB-STATUS-SHIP';

RESET ROLE;

DO $$
DECLARE
  v_gm uuid := '7bda161e-9622-49f0-925f-5d613a6fb6c1';
  v_mod uuid := 'c0ffee00-0000-4000-8000-000000000001';
  v_bill text;
  v_status text;
  v_collection text;
  v_delivered timestamptz;
  v_total numeric;
  v_return numeric;
  v_marker text;
  v_marker_at timestamptz;
  v_synced timestamptz;
  v_conflicts int;
  v_ignored text;
  v_plain text;
  v_bostta_status text;
  v_bostta_stock text;
  v_bostta_total numeric;
  v_bostta_conflicts int;
  v_ship_status text;
  v_ship_notes text;
  v_ship_conflicts int;
BEGIN
  SELECT shipping_bill_no, status, collection_status, delivered_at, total_at_delivery,
         zodex_return_amount, update_status_marker, update_status_updated_at, zodex_synced_at
    INTO v_bill, v_status, v_collection, v_delivered, v_total, v_return, v_marker, v_marker_at, v_synced
    FROM public.orders
   WHERE order_number = 'WB-STATUS-MANUAL';
  IF v_bill IS DISTINCT FROM 'STATUS-MANUAL'
     OR v_status IS DISTINCT FROM 'pending'
     OR v_collection IS DISTINCT FROM 'not_collected'
     OR v_delivered IS NOT NULL
     OR v_total IS NOT NULL
     OR v_return IS NOT NULL
     OR v_marker IS NOT NULL
     OR v_marker_at IS NOT NULL
     OR v_synced IS NULL THEN
    RAISE EXCEPTION 'service_role delivery write was not kept (bill=%, status=%, collection=%, synced=%)',
      v_bill, v_status, v_collection, v_synced;
  END IF;

  SELECT count(*), max(details->>'ignored_status')
    INTO v_conflicts, v_ignored
    FROM public.waybill_sync_conflicts c
    JOIN public.orders o ON o.id = c.order_id
   WHERE o.order_number = 'WB-STATUS-MANUAL'
     AND c.incoming_bill_no = 'STATUS-FROM-SERVICE'
     AND c.resolved_at IS NULL;
  IF v_conflicts <> 1 OR v_ignored IS DISTINCT FROM 'delivered' THEN
    RAISE EXCEPTION 'expected 1 conflict noting delivered, got % / %', v_conflicts, v_ignored;
  END IF;

  SELECT status INTO v_plain FROM public.orders WHERE order_number = 'WB-STATUS-PLAIN';
  IF v_plain IS DISTINCT FROM 'delivered' THEN
    RAISE EXCEPTION 'service_role could not deliver a non-manual order (status=%)', v_plain;
  END IF;

  SELECT status, stock_status, total
    INTO v_bostta_status, v_bostta_stock, v_bostta_total
    FROM public.orders
   WHERE order_number = 'WB-STATUS-BOSTTA';
  SELECT count(*) INTO v_bostta_conflicts
    FROM public.waybill_sync_conflicts c
    JOIN public.orders o ON o.id = c.order_id
   WHERE o.order_number = 'WB-STATUS-BOSTTA';
  IF v_bostta_status IS DISTINCT FROM 'delivered'
     OR v_bostta_stock IS DISTINCT FROM 'dispatched'
     OR v_bostta_total IS DISTINCT FROM 50
     OR v_bostta_conflicts <> 0 THEN
    RAISE EXCEPTION 'Bostta update on a manual order was blocked (status=%, stock=%, total=%, conflicts=%)',
      v_bostta_status, v_bostta_stock, v_bostta_total, v_bostta_conflicts;
  END IF;

  SELECT status, notes INTO v_ship_status, v_ship_notes
    FROM public.orders
   WHERE order_number = 'WB-STATUS-SHIP';
  SELECT count(*) INTO v_ship_conflicts
    FROM public.waybill_sync_conflicts c
    JOIN public.orders o ON o.id = c.order_id
   WHERE o.order_number = 'WB-STATUS-SHIP'
     AND c.resolved_at IS NULL
     AND c.details->>'ignored_status' = 'cancelled';
  IF v_ship_status IS DISTINCT FROM 'pending'
     OR v_ship_notes IS DISTINCT FROM E'ملاحظة قديمة\n[مرتجع] من زودكس'
     OR v_ship_conflicts <> 1 THEN
    RAISE EXCEPTION 'shipments cancel was not locked (status=%, notes=%, conflicts=%)',
      v_ship_status, v_ship_notes, v_ship_conflicts;
  END IF;

  -- Staff JWTs. The session user stays the table owner, same as the other
  -- waybill tests; the trigger is what would newly block a manual status.
  PERFORM set_config('request.jwt.claim.sub', v_gm::text, true);
  UPDATE public.orders
     SET status = 'processing'
   WHERE order_number = 'WB-STATUS-MANUAL';
  SELECT status INTO v_status FROM public.orders WHERE order_number = 'WB-STATUS-MANUAL';
  IF v_status IS DISTINCT FROM 'processing' THEN
    RAISE EXCEPTION 'GM status update did not apply (%)', v_status;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_mod::text, true);
  UPDATE public.orders
     SET status = 'confirmed'
   WHERE order_number = 'WB-STATUS-MANUAL'
     AND created_by = v_mod;
  SELECT status INTO v_status FROM public.orders WHERE order_number = 'WB-STATUS-MANUAL';
  IF v_status IS DISTINCT FROM 'confirmed' THEN
    RAISE EXCEPTION 'moderator status update did not apply (%)', v_status;
  END IF;
END;
$$;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.lock_manual_waybill()', 'EXECUTE')
     OR has_function_privilege('public', 'public.lock_manual_waybill()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.lock_manual_waybill()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.lock_manual_waybill()', 'EXECUTE') THEN
    RAISE EXCEPTION 'lock_manual_waybill grants are wrong';
  END IF;
END;
$$;

ROLLBACK;
