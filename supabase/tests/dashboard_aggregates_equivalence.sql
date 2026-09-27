-- Compare get_orders_by_source / get_report_aggregates with the client rules
-- on a few date ranges. Fixture rows use 2099 so seeded orders stay out of the window.
-- Rolled back. Triggers skipped.

BEGIN;
SET LOCAL session_replication_role = replica;

INSERT INTO public.customers (id, name, phone, city) VALUES
  ('00000000-0000-0000-0000-000000000c01', 'عميل القاهرة', '01000000001', 'القاهرة'),
  ('00000000-0000-0000-0000-000000000c02', 'عميل فاضي', '01000000002', ''),
  ('00000000-0000-0000-0000-000000000c03', 'عميل ملغي', '01000000003', 'الجيزة');

INSERT INTO public.orders (
  id, order_number, customer_id, status, total, source, shipping_company, moderator, created_at
) VALUES
  ('00000000-0000-0000-0000-000000000d01', 'AGG-2099-1', '00000000-0000-0000-0000-000000000c01',
   'pending', 100, 'فيسبوك', 'بوسطا', 'نور', '2099-03-15 10:00:00+00'),
  ('00000000-0000-0000-0000-000000000d02', 'AGG-2099-2', '00000000-0000-0000-0000-000000000c02',
   'delivered', 50.4, '  ', NULL, NULL, '2099-03-20 10:00:00+00'),
  ('00000000-0000-0000-0000-000000000d03', 'AGG-2099-3', '00000000-0000-0000-0000-000000000c03',
   'cancelled', 10, 'فيسبوك', 'بوسطا', 'نور', '2099-03-18 10:00:00+00'),
  ('00000000-0000-0000-0000-000000000d04', 'AGG-2099-4', '00000000-0000-0000-0000-000000000c01',
   'pending', 999, 'متجر', 'بوسطا', 'نور', '2099-02-01 10:00:00+00');

INSERT INTO public.order_items (order_id, product_name, quantity, unit_price, total_price) VALUES
  ('00000000-0000-0000-0000-000000000d01', 'لحم', 2.5, 40, 100),
  ('00000000-0000-0000-0000-000000000d02', 'لحم', 1, 50.4, 50.4);

DO $$
DECLARE
  march_from timestamptz := '2099-03-01 00:00:00+00';
  march_to timestamptz := '2099-03-31 12:00:00+00';
  empty_from timestamptz := '2098-01-01 00:00:00+00';
  empty_to timestamptz := '2098-01-02 00:00:00+00';
  agg jsonb;
  empty_agg jsonb;
  client_sales numeric;
  client_orders int;
  src_facebook bigint;
  src_blank bigint;
BEGIN
  -- Client-style scan for March 2099: net total, cancelled excluded, no trim on source.
  SELECT COALESCE(sum(COALESCE(total, 0)), 0), count(*)::int
  INTO client_sales, client_orders
  FROM public.orders
  WHERE status <> 'cancelled'
    AND created_at >= march_from
    AND created_at <= march_to
    AND id IN (
      '00000000-0000-0000-0000-000000000d01',
      '00000000-0000-0000-0000-000000000d02',
      '00000000-0000-0000-0000-000000000d03',
      '00000000-0000-0000-0000-000000000d04'
    );

  IF client_sales <> 150.4 OR client_orders <> 2 THEN
    RAISE EXCEPTION 'fixture scan expected 150.4/2, got %/%', client_sales, client_orders;
  END IF;

  agg := public.get_report_aggregates(march_from, march_to);
  IF (agg->>'totalSales')::numeric <> 150.4 THEN
    RAISE EXCEPTION 'totalSales %', agg->>'totalSales';
  END IF;
  IF (agg->>'totalOrders')::int <> 2 THEN
    RAISE EXCEPTION 'totalOrders %', agg->>'totalOrders';
  END IF;
  IF (agg->>'avgOrderValue')::numeric <> 75 THEN
    RAISE EXCEPTION 'avgOrderValue %', agg->>'avgOrderValue';
  END IF;
  IF (agg->'monthlySales'->0->>'month') <> 'مارس'
     OR (agg->'monthlySales'->0->>'sales')::numeric <> 150
     OR (agg->'monthlySales'->0->>'orders')::int <> 2
     OR (agg->'monthlySales'->0->>'momPercent')::numeric <> 0
  THEN
    RAISE EXCEPTION 'monthlySales %', agg->'monthlySales';
  END IF;
  IF jsonb_array_length(agg->'monthlySales') <> 1 THEN
    RAISE EXCEPTION 'expected one Cairo month, got %', agg->'monthlySales';
  END IF;

  -- Blank source is kept (no trim) on the report; empty city becomes غير محدد.
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(agg->'sourceData') e
    WHERE e->>'name' = '  ' AND (e->>'orders')::int = 1 AND (e->>'value')::numeric = 50
  ) THEN
    RAISE EXCEPTION 'report source did not keep the untrimmed blank: %', agg->'sourceData';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(agg->'governorateData') e
    WHERE e->>'name' = 'القاهرة' AND (e->>'sales')::numeric = 100
  ) OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(agg->'governorateData') e
    WHERE e->>'name' = 'غير محدد' AND (e->>'sales')::numeric = 50
  ) THEN
    RAISE EXCEPTION 'governorates %', agg->'governorateData';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(agg->'productData') e
    WHERE e->>'name' = 'لحم' AND (e->>'quantity')::numeric = 4
  ) THEN
    RAISE EXCEPTION 'products %', agg->'productData';
  END IF;
  IF (agg->'moderatorData'->0->>'percent')::numeric
     + (agg->'moderatorData'->1->>'percent')::numeric <> 100
  THEN
    RAISE EXCEPTION 'moderator percents %', agg->'moderatorData';
  END IF;

  -- Cancelled and February rows are outside this window.
  IF (agg->>'totalOrders')::int <> client_orders
     OR (agg->>'totalSales')::numeric <> client_sales
  THEN
    RAISE EXCEPTION 'rpc disagrees with client scan';
  END IF;

  empty_agg := public.get_report_aggregates(empty_from, empty_to);
  IF (empty_agg->>'totalOrders')::int <> 0
     OR (empty_agg->>'totalSales')::numeric <> 0
     OR jsonb_array_length(empty_agg->'monthlySales') <> 0
  THEN
    RAISE EXCEPTION 'empty range %', empty_agg;
  END IF;

  -- Source card trims. March-start includes the two net March rows only
  -- (the April-less cancelled row and the February row are out).
  SELECT order_count INTO src_facebook
  FROM public.get_orders_by_source(march_from)
  WHERE source = 'فيسبوك';
  SELECT order_count INTO src_blank
  FROM public.get_orders_by_source(march_from)
  WHERE source = 'غير محدد';
  IF src_facebook <> 1 OR src_blank <> 1 THEN
    RAISE EXCEPTION 'source card expected فيسبوك=1 and غير محدد=1 (trimmed blank), got % / %',
      src_facebook, src_blank;
  END IF;

  -- Same predicate written like the card, limited to the fixture ids so other
  -- rows in the database do not have to be empty.
  IF (
    SELECT count(*) FROM public.orders
    WHERE id = '00000000-0000-0000-0000-000000000d03'
      AND status <> 'cancelled'
  ) <> 0 THEN
    RAISE EXCEPTION 'cancelled fixture was not excluded by the predicate';
  END IF;
END $$;

ROLLBACK;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.get_orders_by_source(timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute get_orders_by_source';
  END IF;
  IF has_function_privilege('public', 'public.get_orders_by_source(timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC can execute get_orders_by_source';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_orders_by_source(timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute get_orders_by_source';
  END IF;
  IF has_function_privilege('anon', 'public.get_report_aggregates(timestamptz, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute get_report_aggregates';
  END IF;
  IF has_function_privilege('public', 'public.get_report_aggregates(timestamptz, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC can execute get_report_aggregates';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_report_aggregates(timestamptz, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute get_report_aggregates';
  END IF;
END $$;
