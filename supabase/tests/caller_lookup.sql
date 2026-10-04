-- Caller lookup: phone formats match, unknown numbers are new customers,
-- and a role that cannot see customers gets no customer payload.
-- A role outside sales_moderator and the all-orders policies cannot call it.
-- Inserts roll back. Triggers stay off so the fixture does not move stock.

BEGIN;
SET LOCAL session_replication_role = replica;

DO $$
DECLARE
  v_mod uuid := '00000000-0000-4000-8000-0000000000c1';
  v_mgr uuid := '00000000-0000-4000-8000-0000000000c2';
  v_viewer uuid := '00000000-0000-4000-8000-0000000000c3';
  v_social uuid := '00000000-0000-4000-8000-0000000000c4';
  v_farm uuid := '00000000-0000-4000-8000-0000000000c5';
  v_finance uuid := '00000000-0000-4000-8000-0000000000c6';
  v_agouza uuid := '00000000-0000-4000-8000-0000000000c7';
  v_quality uuid := '00000000-0000-4000-8000-0000000000c8';
  v_customer uuid := '00000000-0000-4000-8000-0000000000d1';
  v_other uuid := '00000000-0000-4000-8000-0000000000d2';
  v_hit jsonb;
  v_uid uuid;
BEGIN
  IF has_function_privilege('anon', 'public.lookup_caller_by_phone(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute lookup_caller_by_phone';
  END IF;
  IF has_function_privilege('public', 'public.lookup_caller_by_phone(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC can execute lookup_caller_by_phone';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.lookup_caller_by_phone(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute lookup_caller_by_phone';
  END IF;

  INSERT INTO auth.users (id, email) VALUES
    (v_mod, 'caller-lookup-mod@example.com'),
    (v_mgr, 'caller-lookup-mgr@example.com'),
    (v_viewer, 'caller-lookup-viewer@example.com'),
    (v_social, 'caller-lookup-social@example.com'),
    (v_farm, 'caller-lookup-farm@example.com'),
    (v_finance, 'caller-lookup-finance@example.com'),
    (v_agouza, 'caller-lookup-agouza@example.com'),
    (v_quality, 'caller-lookup-quality@example.com');

  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_mod, 'sales_moderator'),
    (v_mgr, 'general_manager'),
    (v_viewer, 'marketing_sales_viewer'),
    (v_social, 'social_media_manager'),
    (v_farm, 'farm_manager'),
    (v_finance, 'financial_manager'),
    (v_agouza, 'agouza_warehouse_keeper'),
    (v_quality, 'quality_manager');

  INSERT INTO public.customers (id, name, phone, phone2, area, governorate)
  VALUES
    (v_customer, 'منى أحمد', '0100 123 4567', NULL, 'مدينة نصر', 'القاهرة'),
    (v_other, 'سامي حسن', '01500000000', '+20 122-333-4455', NULL, 'الجيزة');

  INSERT INTO public.orders (order_number, customer_id, status, total, created_at) VALUES
    ('CL-OLD-1', v_customer, 'pending', 90, timestamptz '2026-01-01 08:00:00+00'),
    ('CL-NEW-1', v_customer, 'delivered', 250, timestamptz '2026-03-15 14:30:00+00'),
    ('CL-MID-1', v_customer, 'shipped', 10, timestamptz '2026-02-01 08:00:00+00'),
    ('CL-OLD-2', v_customer, 'pending', 11, timestamptz '2025-12-01 08:00:00+00'),
    ('CL-OLD-3', v_customer, 'pending', 12, timestamptz '2025-11-01 08:00:00+00'),
    ('CL-OLD-4', v_customer, 'pending', 13, timestamptz '2025-10-01 08:00:00+00'),
    ('CL-OLD-5', v_customer, 'pending', 14, timestamptz '2025-09-01 08:00:00+00'),
    ('CL-OLD-6', v_customer, 'pending', 15, timestamptz '2025-08-01 08:00:00+00'),
    ('CL-OLD-7', v_customer, 'cancelled', 16, timestamptz '2025-07-01 08:00:00+00');

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_mod::text, true);
  SET LOCAL ROLE authenticated;

  v_hit := public.lookup_caller_by_phone('0020-100-123-4567');
  IF v_hit->>'match' IS DISTINCT FROM 'customer'
     OR v_hit->'customer'->>'name' IS DISTINCT FROM 'منى أحمد'
     OR v_hit->'customer'->>'area' IS DISTINCT FROM 'مدينة نصر'
     OR v_hit->'customer'->'last_contact' IS DISTINCT FROM 'null'::jsonb
     OR jsonb_array_length(v_hit->'orders') IS DISTINCT FROM 8
     OR v_hit->'orders'->0->>'status' IS DISTINCT FROM 'delivered'
     OR (v_hit->'orders'->0->>'total')::numeric IS DISTINCT FROM 250
     OR v_hit->'orders'->7->>'status' IS DISTINCT FROM 'pending'
     OR (v_hit->'orders'->7->>'total')::numeric IS DISTINCT FROM 15
  THEN
    RAISE EXCEPTION 'moderator lookup mismatch: %', v_hit;
  END IF;

  IF (v_hit::text ILIKE '%CL-OLD-7%') THEN
    RAISE EXCEPTION 'lookup returned more than the recent orders';
  END IF;

  v_hit := public.lookup_caller_by_phone('+20 100 123 4567');
  IF v_hit->'customer'->>'name' IS DISTINCT FROM 'منى أحمد' THEN
    RAISE EXCEPTION '+20 form missed stored spaced phone: %', v_hit;
  END IF;

  v_hit := public.lookup_caller_by_phone('٠١٠٠١٢٣٤٥٦٧');
  IF v_hit->'customer'->>'name' IS DISTINCT FROM 'منى أحمد' THEN
    RAISE EXCEPTION 'Arabic digits missed stored phone: %', v_hit;
  END IF;

  v_hit := public.lookup_caller_by_phone('0122 333 4455');
  IF v_hit->>'match' IS DISTINCT FROM 'customer'
     OR v_hit->'customer'->>'name' IS DISTINCT FROM 'سامي حسن'
     OR v_hit->'customer'->'area' IS DISTINCT FROM 'null'::jsonb
     OR v_hit->'customer'->>'governorate' IS DISTINCT FROM 'الجيزة'
  THEN
    RAISE EXCEPTION 'phone2 international form did not match: %', v_hit;
  END IF;

  v_hit := public.lookup_caller_by_phone('01055554444');
  IF v_hit->>'match' IS DISTINCT FROM 'new'
     OR v_hit->'customer' IS DISTINCT FROM 'null'::jsonb
     OR v_hit->'orders' IS DISTINCT FROM '[]'::jsonb
     OR v_hit::text ILIKE '%منى%'
     OR v_hit::text ILIKE '%سامي%'
  THEN
    RAISE EXCEPTION 'unknown number leaked or was not new: %', v_hit;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  v_hit := public.lookup_caller_by_phone('01001234567');
  IF v_hit->'customer'->>'name' IS DISTINCT FROM 'منى أحمد' THEN
    RAISE EXCEPTION 'general_manager cannot see the customer: %', v_hit;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_viewer::text, true);
  v_hit := public.lookup_caller_by_phone('01001234567');
  IF v_hit->'customer'->>'name' IS DISTINCT FROM 'منى أحمد' THEN
    RAISE EXCEPTION 'marketing_sales_viewer cannot see the customer: %', v_hit;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_social::text, true);
  v_hit := public.lookup_caller_by_phone('01001234567');
  IF v_hit->>'match' IS DISTINCT FROM 'none'
     OR v_hit->'customer' IS DISTINCT FROM 'null'::jsonb
     OR v_hit->'orders' IS DISTINCT FROM '[]'::jsonb
     OR v_hit::text ILIKE '%منى%'
     OR v_hit::text ILIKE '%مدينة%'
     OR v_hit::text ILIKE '%250%'
  THEN
    RAISE EXCEPTION 'social_media_manager received customer data: %', v_hit;
  END IF;

  FOREACH v_uid IN ARRAY ARRAY[v_farm, v_finance, v_agouza, v_quality]
  LOOP
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    BEGIN
      PERFORM public.lookup_caller_by_phone('01001234567');
      RAISE EXCEPTION 'role % called lookup_caller_by_phone', v_uid;
    EXCEPTION
      WHEN insufficient_privilege THEN
        NULL;
    END;
  END LOOP;
END $$;

ROLLBACK;
