-- Caller lookup: phone formats match, unknown numbers are new customers,
-- and a role that cannot see customers gets no customer payload.
-- A role outside sales_moderator and the all-orders policies cannot call it.
-- A known customer also returns spend, open/last order, address, moderator,
-- and the top products, excluding cancelled/canceled/void/rejected.
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
  v_keys text[];
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

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (v_mod, 'caller-lookup-mod@example.com', 'آية محمد');

  INSERT INTO public.profile_directory (id, full_name)
  VALUES (v_mod, 'آية محمد');

  INSERT INTO public.customers (id, name, phone, phone2, area, governorate, address)
  VALUES
    (v_customer, 'منى أحمد', '0100 123 4567', NULL, 'مدينة نصر', 'القاهرة', '15 شارع عباس العقاد'),
    (v_other, 'سامي حسن', '01500000000', '+20 122-333-4455', NULL, 'الجيزة', NULL);

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

  UPDATE public.orders
  SET moderator = 'نورا',
      created_by = v_mod,
      delivery_address = 'عنوان الطلب لا يُستخدم'
  WHERE order_number = 'CL-NEW-1';

  INSERT INTO public.orders (order_number, customer_id, status, total, created_at, moderator) VALUES
    ('CL-VOID-1', v_customer, 'VOID', 1000, timestamptz '2025-06-01 08:00:00+00', 'لا تظهر'),
    ('CL-REJ-1', v_customer, 'Rejected', 2000, timestamptz '2025-05-01 08:00:00+00', 'لا تظهر'),
    ('CL-US-1', v_customer, 'Canceled', 3000, timestamptz '2025-04-01 08:00:00+00', 'لا تظهر');

  INSERT INTO public.orders (
    order_number, customer_id, status, total, created_at, delivery_address, created_by
  ) VALUES (
    'CL-SAMI-1', v_other, 'pending', 40, timestamptz '2026-04-01 09:00:00+00', '22 شارع الهرم', v_mod
  );

  INSERT INTO public.order_items (order_id, product_name, quantity, unit_price, total_price)
  SELECT o.id, x.product_name, x.quantity, 10, x.quantity * 10
  FROM (
    VALUES
      ('CL-NEW-1'::text, 'فيليه'::text, 2::numeric),
      ('CL-MID-1'::text, 'فيليه'::text, 4::numeric),
      ('CL-OLD-1'::text, 'ستيك'::text, 4::numeric),
      ('CL-MID-1'::text, 'مفروم'::text, 2::numeric),
      ('CL-OLD-2'::text, 'كبدة'::text, 1::numeric),
      ('CL-OLD-7'::text, 'فيليه'::text, 50::numeric),
      ('CL-VOID-1'::text, 'فيليه'::text, 80::numeric),
      ('CL-REJ-1'::text, 'ستيك'::text, 80::numeric),
      ('CL-US-1'::text, 'مفروم'::text, 80::numeric)
  ) AS x(order_number, product_name, quantity)
  JOIN public.orders o ON o.order_number = x.order_number;

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

  IF (v_hit->>'total_spent')::numeric IS DISTINCT FROM 415
     OR (v_hit->>'orders_count')::integer IS DISTINCT FROM 8
     OR v_hit->'last_order'->>'order_number' IS DISTINCT FROM 'CL-NEW-1'
     OR v_hit->'last_order'->>'status' IS DISTINCT FROM 'delivered'
     OR (v_hit->'last_order'->>'total')::numeric IS DISTINCT FROM 250
     OR (v_hit->'last_order'->>'created_at')::timestamptz IS DISTINCT FROM timestamptz '2026-03-15 14:30:00+00'
     OR v_hit->'open_order'->>'order_number' IS DISTINCT FROM 'CL-MID-1'
     OR v_hit->'open_order'->>'status' IS DISTINCT FROM 'shipped'
     OR (v_hit->'open_order'->>'total')::numeric IS DISTINCT FROM 10
     OR (v_hit->'open_order'->>'created_at')::timestamptz IS DISTINCT FROM timestamptz '2026-02-01 08:00:00+00'
     OR v_hit->>'address' IS DISTINCT FROM '15 شارع عباس العقاد'
     OR v_hit->>'governorate' IS DISTINCT FROM 'القاهرة'
     OR v_hit->>'moderator' IS DISTINCT FROM 'نورا'
     OR jsonb_array_length(v_hit->'top_products') IS DISTINCT FROM 3
     OR v_hit->'top_products'->0->>'name' IS DISTINCT FROM 'فيليه'
     OR (v_hit->'top_products'->0->>'qty')::numeric IS DISTINCT FROM 6
     OR v_hit->'top_products'->1->>'name' IS DISTINCT FROM 'ستيك'
     OR (v_hit->'top_products'->1->>'qty')::numeric IS DISTINCT FROM 4
     OR v_hit->'top_products'->2->>'name' IS DISTINCT FROM 'مفروم'
     OR (v_hit->'top_products'->2->>'qty')::numeric IS DISTINCT FROM 2
     OR v_hit::text ILIKE '%عنوان الطلب لا يُستخدم%'
     OR v_hit::text ILIKE '%CL-VOID%'
     OR v_hit::text ILIKE '%CL-REJ%'
     OR v_hit::text ILIKE '%CL-US%'
     OR v_hit::text ILIKE '%لا تظهر%'
     OR v_hit::text ILIKE '%كبدة%'
     OR v_hit::text ILIKE '%آية%'
  THEN
    RAISE EXCEPTION 'known customer summary mismatch: %', v_hit;
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
     OR v_hit->>'address' IS DISTINCT FROM '22 شارع الهرم'
     OR v_hit->>'governorate' IS DISTINCT FROM 'الجيزة'
     OR v_hit->>'moderator' IS DISTINCT FROM 'آية محمد'
     OR v_hit->'last_order'->>'order_number' IS DISTINCT FROM 'CL-SAMI-1'
     OR v_hit->'open_order'->>'order_number' IS DISTINCT FROM 'CL-SAMI-1'
     OR v_hit->'open_order'->>'status' IS DISTINCT FROM 'pending'
     OR (v_hit->>'total_spent')::numeric IS DISTINCT FROM 40
     OR (v_hit->>'orders_count')::integer IS DISTINCT FROM 1
     OR v_hit->'top_products' IS DISTINCT FROM '[]'::jsonb
  THEN
    RAISE EXCEPTION 'phone2 international form did not match: %', v_hit;
  END IF;

  v_hit := public.lookup_caller_by_phone('01055554444');
  SELECT array_agg(k ORDER BY k) INTO v_keys FROM jsonb_object_keys(v_hit) AS k;
  IF v_hit->>'match' IS DISTINCT FROM 'new'
     OR v_hit->'customer' IS DISTINCT FROM 'null'::jsonb
     OR v_hit->'orders' IS DISTINCT FROM '[]'::jsonb
     OR v_keys IS DISTINCT FROM ARRAY['customer', 'match', 'orders']
     OR v_hit::text ILIKE '%منى%'
     OR v_hit::text ILIKE '%سامي%'
  THEN
    RAISE EXCEPTION 'unknown number leaked or was not new: %', v_hit;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  v_hit := public.lookup_caller_by_phone('01001234567');
  IF v_hit->'customer'->>'name' IS DISTINCT FROM 'منى أحمد'
     OR (v_hit->>'orders_count')::integer IS DISTINCT FROM 8
     OR v_hit->>'moderator' IS DISTINCT FROM 'نورا'
  THEN
    RAISE EXCEPTION 'general_manager cannot see the customer: %', v_hit;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_viewer::text, true);
  v_hit := public.lookup_caller_by_phone('01001234567');
  IF v_hit->'customer'->>'name' IS DISTINCT FROM 'منى أحمد' THEN
    RAISE EXCEPTION 'marketing_sales_viewer cannot see the customer: %', v_hit;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_social::text, true);
  v_hit := public.lookup_caller_by_phone('01001234567');
  SELECT array_agg(k ORDER BY k) INTO v_keys FROM jsonb_object_keys(v_hit) AS k;
  IF v_hit->>'match' IS DISTINCT FROM 'none'
     OR v_hit->'customer' IS DISTINCT FROM 'null'::jsonb
     OR v_hit->'orders' IS DISTINCT FROM '[]'::jsonb
     OR v_keys IS DISTINCT FROM ARRAY['customer', 'match', 'orders']
     OR v_hit::text ILIKE '%منى%'
     OR v_hit::text ILIKE '%مدينة%'
     OR v_hit::text ILIKE '%250%'
     OR v_hit::text ILIKE '%نورا%'
     OR v_hit::text ILIKE '%فيليه%'
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
