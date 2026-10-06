-- Caller lookup: a number from the company hotline arrives as 02 + the full
-- mobile (0201xxxxxxxxx), or +20 2 01xxxxxxxxx. It must find the same
-- customer as the plain mobile. A real Cairo landline (02 + 8 digits) and a
-- short 02 number stay invalid. Permissions are unchanged.
-- Inserts roll back. Triggers stay off so the fixture does not move stock.

BEGIN;
SET LOCAL session_replication_role = replica;

DO $$
DECLARE
  v_mod uuid := '00000000-0000-4000-8000-0000000002c1';
  v_farm uuid := '00000000-0000-4000-8000-0000000002c5';
  v_customer uuid := '00000000-0000-4000-8000-0000000002d1';
  v_plain jsonb;
  v_hit jsonb;
  v_phone text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_mod, 'caller-hotline-mod@example.com'),
    (v_farm, 'caller-hotline-farm@example.com');

  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_mod, 'sales_moderator'),
    (v_farm, 'farm_manager');

  INSERT INTO public.customers (id, name, phone, phone2, area, governorate)
  VALUES (v_customer, 'عميلة الخط الساخن', '01009871234', '01009875678', NULL, 'القاهرة');

  INSERT INTO public.orders (order_number, customer_id, status, total, created_at)
  VALUES ('CL-HOT-1', v_customer, 'pending', 2060, timestamptz '2026-10-01 10:00:00+00');

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_mod::text, true);
  SET LOCAL ROLE authenticated;

  v_plain := public.lookup_caller_by_phone('01009875678');
  IF v_plain->>'match' IS DISTINCT FROM 'customer'
     OR v_plain->'customer'->>'name' IS DISTINCT FROM 'عميلة الخط الساخن'
  THEN
    RAISE EXCEPTION 'plain phone2 lookup mismatch: %', v_plain;
  END IF;

  FOREACH v_phone IN ARRAY ARRAY[
    '0201009875678',
    '02 0100 987 5678',
    '020-1009-875-678',
    '٠٢٠١٠٠٩٨٧٥٦٧٨',
    '+20 2 01009875678',
    '00202 01009875678'
  ]
  LOOP
    v_hit := public.lookup_caller_by_phone(v_phone);
    IF v_hit IS DISTINCT FROM v_plain THEN
      RAISE EXCEPTION 'hotline form % did not match the plain mobile: %', v_phone, v_hit;
    END IF;
  END LOOP;

  v_hit := public.lookup_caller_by_phone('0201009871234');
  IF v_hit->'customer'->>'name' IS DISTINCT FROM 'عميلة الخط الساخن' THEN
    RAISE EXCEPTION 'hotline form of the primary phone missed: %', v_hit;
  END IF;

  FOREACH v_phone IN ARRAY ARRAY['+201009875678', '201009875678', '00201009875678']
  LOOP
    v_hit := public.lookup_caller_by_phone(v_phone);
    IF v_hit IS DISTINCT FROM v_plain THEN
      RAISE EXCEPTION 'existing international form % changed: %', v_phone, v_hit;
    END IF;
  END LOOP;

  FOREACH v_phone IN ARRAY ARRAY['0223456789', '02-2345-6789', '02012345678', '0200123456789', '123']
  LOOP
    v_hit := public.lookup_caller_by_phone(v_phone);
    IF v_hit->>'match' IS DISTINCT FROM 'invalid' OR v_hit->'customer' IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION 'non-mobile % was not invalid: %', v_phone, v_hit;
    END IF;
  END LOOP;

  PERFORM set_config('request.jwt.claim.sub', v_farm::text, true);
  BEGIN
    PERFORM public.lookup_caller_by_phone('0201009875678');
    RAISE EXCEPTION 'farm_manager called lookup_caller_by_phone';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.lookup_caller_by_phone('0201009875678');
    RAISE EXCEPTION 'a call without a signed-in user was allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END $$;

ROLLBACK;
