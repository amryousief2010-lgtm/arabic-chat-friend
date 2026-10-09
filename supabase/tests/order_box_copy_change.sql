-- Per-copy box replace/delete. Scratch schema only. Run with psql -d boxcopy.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM (
    'general_manager',
    'executive_manager',
    'sales_manager',
    'marketing_sales_manager',
    'shipping_company',
    'sales_moderator',
    'warehouse_supervisor'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  PRIMARY KEY (user_id, role)
);

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id AND ur.role = ANY (_roles)
  );
$$;

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text,
  customer_id uuid,
  created_by uuid,
  status text NOT NULL DEFAULT 'new',
  stock_status text,
  source_warehouse_id uuid,
  subtotal numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  extra_charge numeric NOT NULL DEFAULT 0,
  delivery_fee numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  delivery_address text,
  collection_method text,
  courier_cash_due numeric NOT NULL DEFAULT 0,
  vodafone_cash_amount numeric NOT NULL DEFAULT 0,
  instapay_amount numeric NOT NULL DEFAULT 0,
  bank_transfer_amount numeric NOT NULL DEFAULT 0,
  other_amount numeric NOT NULL DEFAULT 0,
  free_amount numeric NOT NULL DEFAULT 0,
  deposit_amount numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.offer_boxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  shipping_cost numeric,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_offer_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  offer_box_id uuid REFERENCES public.offer_boxes(id) ON DELETE SET NULL,
  offer_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, offer_name)
);

CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid,
  product_name text NOT NULL,
  quantity numeric NOT NULL,
  unit_price numeric NOT NULL,
  total_price numeric NOT NULL,
  offer_name text,
  is_gift boolean NOT NULL DEFAULT false,
  is_half_kg boolean NOT NULL DEFAULT false
);

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

\ir ../migrations/20261009120000_order_box_copy_change.sql

CREATE OR REPLACE FUNCTION public.validate_mixed_payment_breakdown()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.collection_method = 'mixed_payment' THEN
    IF abs(
      coalesce(NEW.courier_cash_due, 0)
      + coalesce(NEW.vodafone_cash_amount, 0)
      + coalesce(NEW.instapay_amount, 0)
      + coalesce(NEW.bank_transfer_amount, 0)
      + coalesce(NEW.other_amount, 0)
      + coalesce(NEW.free_amount, 0)
      + coalesce(NEW.deposit_amount, 0)
      - coalesce(NEW.total, 0)
    ) > 0.01 THEN
      RAISE EXCEPTION 'mixed breakdown does not match total';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_mixed_payment ON public.orders;
CREATE TRIGGER trg_validate_mixed_payment
BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.validate_mixed_payment_breakdown();

CREATE TABLE IF NOT EXISTS public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL,
  product_id uuid,
  stock numeric NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.agouza_stock_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  product_id uuid,
  quantity numeric NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'active',
  reserved_at timestamptz NOT NULL DEFAULT now(),
  reserved_by uuid,
  released_at timestamptz,
  released_by uuid,
  release_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE
  v_staff uuid := 'ff165c36-6390-4700-a880-e3894762693b';
  v_wh uuid := 'c47d1804-1423-4f33-81fa-294a34ed7a16';
  v_customer uuid := '11111111-1111-4111-8111-111111111111';
  v_month uuid;
  v_necks_box uuid;
  v_plain_box uuid;
  v_one uuid;
  v_eight uuid;
  v_ag uuid;
  v_manual uuid;
  v_mixed uuid;
  v_inst uuid;
  v_one_inst uuid;
  v_list jsonb;
  v_token text;
  v_result jsonb;
  v_key text;
  v_price numeric;
  v_sum numeric;
  v_n int;
  v_qty numeric;
  v_fee numeric;
  v_total numeric;
  v_cash numeric;
  v_voda numeric;
  v_p1 uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  v_p2 uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  v_p3 uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
  v_p4 uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
  v_neck uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
  v_kilo uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6';
  v_month_box uuid;
  v_copy2 uuid;
  v_item uuid;
  v_reg uuid;
  v_inv1 uuid;
  v_inv2 uuid;
  v_inv4 uuid;
  v_agouza uuid := 'a970d469-37df-40e1-b99f-a49195a3778e';
BEGIN
  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_staff, 'sales_moderator'),
    (v_wh, 'warehouse_supervisor');
  PERFORM set_config('request.jwt.claim.sub', v_staff::text, true);

  INSERT INTO public.offer_boxes (name, shipping_cost)
  VALUES ('بوكس الشهر 1600', 120) RETURNING id INTO v_month_box;
  INSERT INTO public.offer_boxes (name, shipping_cost)
  VALUES ('عرض الرقاب', 40) RETURNING id INTO v_necks_box;
  INSERT INTO public.offer_boxes (name, shipping_cost)
  VALUES ('عرض بدون شحن', NULL) RETURNING id INTO v_plain_box;

  -- Scenario 1: one box.
  INSERT INTO public.orders (customer_id, delivery_address, subtotal, delivery_fee, total, status)
  VALUES (v_customer, 'عنوان ثابت', 540, 40, 580, 'new')
  RETURNING id INTO v_one;
  INSERT INTO public.order_offer_instances (order_id, offer_box_id, offer_name, quantity)
  VALUES (v_one, v_necks_box, 'عرض الرقاب', 1)
  RETURNING id INTO v_one_inst;
  INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price, offer_name)
  VALUES (v_one, v_neck, 'رقاب', 1, 540, 540, 'عرض الرقاب');
  v_list := public.list_order_box_copies(v_one);
  IF jsonb_array_length(v_list) <> 1 THEN
    RAISE EXCEPTION 'scenario 1: expected 1 copy, got %', v_list;
  END IF;
  IF v_list->0->>'key' <> ('inst:' || v_one_inst::text || ':1') THEN
    RAISE EXCEPTION 'scenario 1: key %', v_list->0->>'key';
  END IF;
  IF (v_list->0->>'recorded_price')::numeric <> 540
     OR (v_list->0->>'copy_index')::int <> 1 THEN
    RAISE EXCEPTION 'scenario 1: price/index %', v_list->0;
  END IF;

  -- Scenarios 2 and 9: old merged order, two identical boxes, no copy rows.
  INSERT INTO public.orders (customer_id, delivery_address, subtotal, delivery_fee, total, status)
  VALUES (v_customer, 'عنوان ثابت', 2960, 240, 3200, 'new')
  RETURNING id INTO v_month;
  INSERT INTO public.order_offer_instances (order_id, offer_box_id, offer_name, quantity)
  VALUES (v_month, v_month_box, 'بوكس الشهر 1600', 2)
  RETURNING id INTO v_inst;
  INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price, offer_name)
  VALUES
    (v_month, v_p1, 'برجر', 2, 400, 800, 'بوكس الشهر 1600'),
    (v_month, v_p2, 'كفتة', 2, 340, 680, 'بوكس الشهر 1600'),
    (v_month, v_p3, 'سجق', 2, 740, 1480, 'بوكس الشهر 1600');
  IF (SELECT count(*) FROM public.order_box_copies WHERE order_id = v_month) <> 0 THEN
    RAISE EXCEPTION 'scenario 9: old order should have no copy rows';
  END IF;
  v_list := public.list_order_box_copies(v_month);
  IF jsonb_array_length(v_list) <> 2 THEN
    RAISE EXCEPTION 'scenario 2: expected 2 copies, got %', v_list;
  END IF;
  IF v_list->0->>'key' = v_list->1->>'key' THEN
    RAISE EXCEPTION 'scenario 2: keys must differ';
  END IF;
  IF (v_list->0->>'recorded_price')::numeric <> 1480
     OR (v_list->1->>'recorded_price')::numeric <> 1480 THEN
    RAISE EXCEPTION 'scenario 2: prices %', v_list;
  END IF;
  IF jsonb_array_length(v_list->0->'lines') <> 3
     OR jsonb_array_length(v_list->1->'lines') <> 3 THEN
    RAISE EXCEPTION 'scenario 2: each copy needs 3 lines';
  END IF;
  IF (v_list->0->>'copy_index')::int <> 1 OR (v_list->1->>'copy_index')::int <> 2 THEN
    RAISE EXCEPTION 'scenario 2: indexes % %', v_list->0->>'copy_index', v_list->1->>'copy_index';
  END IF;

  -- Scenario 3: three boxes, then restore the order for the mutations.
  UPDATE public.order_offer_instances SET quantity = 3 WHERE id = v_inst;
  UPDATE public.order_items SET quantity = quantity * 1.5, total_price = round(quantity * 1.5 * unit_price, 2)
  WHERE order_id = v_month;
  v_list := public.list_order_box_copies(v_month);
  IF jsonb_array_length(v_list) <> 3 THEN
    RAISE EXCEPTION 'scenario 3: expected 3 copies, got %', jsonb_array_length(v_list);
  END IF;
  SELECT coalesce(sum((elem->>'recorded_price')::numeric), 0) INTO v_sum
  FROM jsonb_array_elements(v_list) elem;
  IF v_sum <> 4440 THEN
    RAISE EXCEPTION 'scenario 3: price sum %', v_sum;
  END IF;
  UPDATE public.order_offer_instances SET quantity = 2 WHERE id = v_inst;
  UPDATE public.order_items
  SET quantity = 2, total_price = round(2 * unit_price, 2)
  WHERE order_id = v_month;
  UPDATE public.orders SET subtotal = 2960, delivery_fee = 240, total = 3200 WHERE id = v_month;

  -- Scenario 4: replace copy 1 with another box.
  v_token := public.order_box_snapshot_token(v_month);
  v_key := 'inst:' || v_inst::text || ':1';
  v_result := public.apply_order_box_copy_change(
    v_month, v_key, 'replace_box',
    jsonb_build_object(
      'offer_name', 'عرض الرقاب',
      'offer_box_id', v_necks_box,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_neck, 'product_name', 'رقاب', 'quantity', 1, 'unit_price', 540
      ))
    ),
    v_token, 'scenario-4'
  );
  SELECT total, delivery_fee INTO v_total, v_fee FROM public.orders WHERE id = v_month;
  IF v_total <> 2180 OR v_fee <> 160 THEN
    RAISE EXCEPTION 'scenario 4: total % fee %', v_total, v_fee;
  END IF;
  SELECT coalesce(sum(quantity), 0) INTO v_qty
  FROM public.order_items
  WHERE order_id = v_month AND product_id = v_p1 AND offer_name = 'بوكس الشهر 1600';
  IF v_qty <> 1 THEN
    RAISE EXCEPTION 'scenario 4: sibling burger qty %', v_qty;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.order_items
    WHERE order_id = v_month AND offer_name = 'عرض الرقاب' AND product_name = 'رقاب' AND quantity = 1
  ) THEN
    RAISE EXCEPTION 'scenario 4: replacement line missing';
  END IF;
  IF (SELECT customer_id FROM public.orders WHERE id = v_month) IS DISTINCT FROM v_customer
     OR (SELECT delivery_address FROM public.orders WHERE id = v_month) IS DISTINCT FROM 'عنوان ثابت' THEN
    RAISE EXCEPTION 'scenario 4: customer or address changed';
  END IF;

  -- Scenario 14 and 13.
  IF NOT EXISTS (
    SELECT 1 FROM public.order_box_copies
    WHERE order_id = v_month AND offer_name = 'بوكس الشهر 1600' AND copy_index = 2 AND active
  ) OR EXISTS (
    SELECT 1 FROM public.order_box_copies
    WHERE order_id = v_month AND offer_name = 'بوكس الشهر 1600' AND copy_index = 1 AND active
  ) THEN
    RAISE EXCEPTION 'scenario 14: copy 2 must stay active and copy 1 inactive';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.order_items i
    JOIN public.order_box_copies c ON c.id = i.offer_copy_id
    WHERE c.order_id = v_month AND c.offer_name = 'بوكس الشهر 1600' AND c.copy_index = 1
  ) THEN
    RAISE EXCEPTION 'scenario 13: removed copy still has lines';
  END IF;

  -- Scenario 5: replace the remaining month copy with individual products.
  SELECT id INTO v_copy2
  FROM public.order_box_copies
  WHERE order_id = v_month AND offer_name = 'بوكس الشهر 1600' AND copy_index = 2 AND active;
  v_token := public.order_box_snapshot_token(v_month);
  v_result := public.apply_order_box_copy_change(
    v_month, 'copy:' || v_copy2::text, 'replace_products',
    jsonb_build_object('items', jsonb_build_array(
      jsonb_build_object('product_id', v_p4, 'product_name', 'ستيك', 'quantity', 2, 'unit_price', 100),
      jsonb_build_object('product_id', v_p2, 'product_name', 'كبدة', 'quantity', 1, 'unit_price', 80)
    )),
    v_token, 'scenario-5'
  );
  IF EXISTS (
    SELECT 1 FROM public.order_items WHERE order_id = v_month AND offer_name = 'بوكس الشهر 1600'
  ) THEN
    RAISE EXCEPTION 'scenario 5: month lines remain';
  END IF;
  SELECT count(*) INTO v_n FROM public.order_items
  WHERE order_id = v_month AND btrim(coalesce(offer_name, '')) = '';
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'scenario 5: expected 2 loose lines, got %', v_n;
  END IF;
  SELECT total, delivery_fee INTO v_total, v_fee FROM public.orders WHERE id = v_month;
  IF v_total <> 860 OR v_fee <> 40 THEN
    RAISE EXCEPTION 'scenario 5: total % fee %', v_total, v_fee;
  END IF;

  -- Scenario 6 and 7: delete the necks copy; loose products stay.
  SELECT elem->>'key' INTO v_key
  FROM jsonb_array_elements(public.list_order_box_copies(v_month)) elem
  WHERE elem->>'offer_name' = 'عرض الرقاب';
  v_token := public.order_box_snapshot_token(v_month);
  PERFORM public.apply_order_box_copy_change(
    v_month, v_key, 'delete', '{}'::jsonb, v_token, 'scenario-6'
  );
  IF EXISTS (
    SELECT 1 FROM public.order_items WHERE order_id = v_month AND offer_name = 'عرض الرقاب'
  ) THEN
    RAISE EXCEPTION 'scenario 6: necks lines remain';
  END IF;
  SELECT total, delivery_fee INTO v_total, v_fee FROM public.orders WHERE id = v_month;
  IF v_total <> 280 OR v_fee <> 0 THEN
    RAISE EXCEPTION 'scenario 6: total % fee %', v_total, v_fee;
  END IF;
  SELECT count(*) INTO v_n FROM public.order_box_copy_audit
  WHERE order_id = v_month AND idempotency_key = 'scenario-6' AND acted_by = v_staff;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'scenario 6: audit count %', v_n;
  END IF;
  IF (SELECT count(*) FROM public.order_items WHERE order_id = v_month AND product_name IN ('ستيك', 'كبدة')) <> 2 THEN
    RAISE EXCEPTION 'scenario 7: loose products were removed';
  END IF;

  -- Scenario 11: same key does not apply twice.
  v_result := public.apply_order_box_copy_change(
    v_month, v_key, 'delete', '{}'::jsonb, v_token, 'scenario-6'
  );
  IF coalesce((v_result->>'idempotent')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'scenario 11: expected idempotent, got %', v_result;
  END IF;
  SELECT count(*) INTO v_n FROM public.order_box_copy_audit
  WHERE order_id = v_month AND idempotency_key = 'scenario-6';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'scenario 11: audit duplicated';
  END IF;
  IF (SELECT total FROM public.orders WHERE id = v_month) <> 280 THEN
    RAISE EXCEPTION 'scenario 11: total changed';
  END IF;

  -- Scenario 8: replace the plain group; the other box stays. No-shipping offer adds 0.
  INSERT INTO public.orders (customer_id, delivery_address, subtotal, delivery_fee, total, status)
  VALUES (v_customer, 'عنوان ثابت', 740, 40, 780, 'new')
  RETURNING id INTO v_eight;
  INSERT INTO public.order_offer_instances (order_id, offer_box_id, offer_name, quantity)
  VALUES (v_eight, v_necks_box, 'عرض الرقاب', 1);
  INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price, offer_name)
  VALUES
    (v_eight, v_neck, 'رقاب', 1, 540, 540, 'عرض الرقاب'),
    (v_eight, v_p4, 'ستيك', 1, 200, 200, NULL);
  v_token := public.order_box_snapshot_token(v_eight);
  PERFORM public.apply_order_box_copy_change(
    v_eight, 'plain', 'replace_box',
    jsonb_build_object(
      'offer_name', 'عرض بدون شحن',
      'offer_box_id', v_plain_box,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_kilo, 'product_name', 'كيلو', 'quantity', 4, 'unit_price', 250
      ))
    ),
    v_token, 'scenario-8'
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.order_items WHERE order_id = v_eight AND offer_name = 'عرض الرقاب' AND product_name = 'رقاب'
  ) THEN
    RAISE EXCEPTION 'scenario 8: necks box was removed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.order_items WHERE order_id = v_eight AND product_name = 'ستيك'
  ) THEN
    RAISE EXCEPTION 'scenario 8: plain steak remains';
  END IF;
  SELECT total, delivery_fee INTO v_total, v_fee FROM public.orders WHERE id = v_eight;
  IF v_total <> 1580 OR v_fee <> 40 THEN
    RAISE EXCEPTION 'scenario 8: total % fee %', v_total, v_fee;
  END IF;

  -- Scenario 10 and 12: Agouza reservations move only for the selected copy.
  INSERT INTO public.inventory_items (warehouse_id, product_id, stock) VALUES
    (v_agouza, v_p1, 10) RETURNING id INTO v_inv1;
  INSERT INTO public.inventory_items (warehouse_id, product_id, stock) VALUES
    (v_agouza, v_p2, 10) RETURNING id INTO v_inv2;
  INSERT INTO public.inventory_items (warehouse_id, product_id, stock) VALUES
    (v_agouza, v_p4, 1) RETURNING id INTO v_inv4;
  INSERT INTO public.orders (
    customer_id, status, source_warehouse_id, subtotal, delivery_fee, total
  ) VALUES (
    v_customer, 'new', v_agouza, 800, 240, 1040
  ) RETURNING id INTO v_ag;
  INSERT INTO public.order_offer_instances (order_id, offer_box_id, offer_name, quantity)
  VALUES (v_ag, v_month_box, 'بوكس الشهر 1600', 2)
  RETURNING id INTO v_inst;
  INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price, offer_name)
  VALUES
    (v_ag, v_p1, 'برجر', 2, 200, 400, 'بوكس الشهر 1600'),
    (v_ag, v_p2, 'كفتة', 2, 200, 400, 'بوكس الشهر 1600');
  INSERT INTO public.agouza_stock_reservations (order_id, inventory_item_id, product_id, quantity, status)
  VALUES
    (v_ag, v_inv1, v_p1, 2, 'active'),
    (v_ag, v_inv2, v_p2, 2, 'active');
  v_token := public.order_box_snapshot_token(v_ag);
  PERFORM public.apply_order_box_copy_change(
    v_ag, 'inst:' || v_inst::text || ':1', 'replace_products',
    jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
      'product_id', v_p4, 'product_name', 'ستيك', 'quantity', 1, 'unit_price', 50
    ))),
    v_token, 'scenario-10'
  );
  SELECT quantity INTO v_qty FROM public.agouza_stock_reservations
  WHERE order_id = v_ag AND product_id = v_p1 AND status = 'active';
  IF v_qty <> 1 THEN
    RAISE EXCEPTION 'scenario 10: burger reservation %', v_qty;
  END IF;
  SELECT quantity INTO v_qty FROM public.agouza_stock_reservations
  WHERE order_id = v_ag AND product_id = v_p2 AND status = 'active';
  IF v_qty <> 1 THEN
    RAISE EXCEPTION 'scenario 10: kofta reservation %', v_qty;
  END IF;
  SELECT quantity INTO v_qty FROM public.agouza_stock_reservations
  WHERE order_id = v_ag AND product_id = v_p4 AND status = 'active';
  IF v_qty <> 1 THEN
    RAISE EXCEPTION 'scenario 10: steak reservation %', v_qty;
  END IF;
  SELECT subtotal, delivery_fee, total INTO v_sum, v_fee, v_total FROM public.orders WHERE id = v_ag;
  IF v_sum <> 450 OR v_fee <> 120 OR v_total <> 570 THEN
    RAISE EXCEPTION 'scenario 10: subtotal % fee % total %', v_sum, v_fee, v_total;
  END IF;
  PERFORM public.apply_order_box_copy_change(
    v_ag, 'inst:' || v_inst::text || ':1', 'replace_products',
    '{}'::jsonb, v_token, 'scenario-10'
  );
  SELECT quantity INTO v_qty FROM public.agouza_stock_reservations
  WHERE order_id = v_ag AND product_id = v_p4 AND status = 'active';
  IF v_qty <> 1 THEN
    RAISE EXCEPTION 'scenario 11/10: replay moved steak reservation to %', v_qty;
  END IF;

  SELECT id INTO v_copy2
  FROM public.order_box_copies
  WHERE order_id = v_ag AND offer_name = 'بوكس الشهر 1600' AND active;
  v_token := public.order_box_snapshot_token(v_ag);
  BEGIN
    PERFORM public.apply_order_box_copy_change(
      v_ag, 'copy:' || v_copy2::text, 'replace_products',
      jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
        'product_id', v_p4, 'product_name', 'ستيك', 'quantity', 5, 'unit_price', 50
      ))),
      v_token, 'scenario-12'
    );
    RAISE EXCEPTION 'scenario 12: stock shortage should have failed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'المخزون غير كافٍ%' THEN
      RAISE EXCEPTION 'scenario 12: unexpected error %', SQLERRM;
    END IF;
  END;
  SELECT coalesce(sum(quantity), 0) INTO v_qty
  FROM public.order_items
  WHERE order_id = v_ag AND product_id = v_p1 AND offer_name = 'بوكس الشهر 1600';
  IF v_qty <> 1 THEN
    RAISE EXCEPTION 'scenario 12: burger qty changed to %', v_qty;
  END IF;
  SELECT quantity INTO v_qty FROM public.agouza_stock_reservations
  WHERE order_id = v_ag AND product_id = v_p4 AND status = 'active';
  IF v_qty <> 1 THEN
    RAISE EXCEPTION 'scenario 12: steak reservation changed to %', v_qty;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.order_box_copy_audit WHERE order_id = v_ag AND idempotency_key = 'scenario-12'
  ) THEN
    RAISE EXCEPTION 'scenario 12: audit row was kept';
  END IF;

  -- Stale snapshot. A no-op quantity write must not be used; it does not change the token.
  v_token := public.order_box_snapshot_token(v_ag);
  UPDATE public.order_items SET unit_price = unit_price + 1
  WHERE order_id = v_ag AND product_id = v_p1;
  BEGIN
    PERFORM public.apply_order_box_copy_change(
      v_ag, 'copy:' || v_copy2::text, 'delete', '{}'::jsonb, v_token, 'stale'
    );
    RAISE EXCEPTION 'stale snapshot should have failed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'الطلب تغيّر. حدّث الشاشة ثم أعد المحاولة' THEN
      RAISE EXCEPTION 'stale message was %', SQLERRM;
    END IF;
  END;

  -- Delivered is closed for everyone, including a moderator.
  UPDATE public.orders SET status = 'delivered' WHERE id = v_ag;
  v_token := public.order_box_snapshot_token(v_ag);
  BEGIN
    PERFORM public.apply_order_box_copy_change(
      v_ag, 'copy:' || v_copy2::text, 'delete', '{}'::jsonb, v_token, 'delivered'
    );
    RAISE EXCEPTION 'delivered order should have failed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'لا يمكن تعديل بوكسات طلب تم تسليمه أو إلغاؤه' THEN
      RAISE EXCEPTION 'delivered message was %', SQLERRM;
    END IF;
  END;

  -- Manual shipping difference is kept.
  INSERT INTO public.orders (customer_id, status, subtotal, delivery_fee, total)
  VALUES (v_customer, 'new', 800, 300, 1100)
  RETURNING id INTO v_manual;
  INSERT INTO public.order_offer_instances (order_id, offer_box_id, offer_name, quantity)
  VALUES (v_manual, v_month_box, 'بوكس الشهر 1600', 2)
  RETURNING id INTO v_inst;
  INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price, offer_name)
  VALUES (v_manual, v_p1, 'برجر', 2, 400, 800, 'بوكس الشهر 1600');
  v_token := public.order_box_snapshot_token(v_manual);
  PERFORM public.apply_order_box_copy_change(
    v_manual, 'inst:' || v_inst::text || ':2', 'delete', '{}'::jsonb, v_token, 'manual-ship'
  );
  SELECT total, delivery_fee INTO v_total, v_fee FROM public.orders WHERE id = v_manual;
  SELECT coalesce(sum(quantity), 0) INTO v_qty
  FROM public.order_items WHERE order_id = v_manual AND product_id = v_p1;
  IF v_fee <> 180 OR v_total <> 580 OR v_qty <> 1 THEN
    RAISE EXCEPTION 'manual shipping: fee % total % qty %', v_fee, v_total, v_qty;
  END IF;

  -- Mixed payment moves only the cash residual. Vodafone stays.
  INSERT INTO public.orders (
    customer_id, status, subtotal, delivery_fee, total, collection_method,
    courier_cash_due, vodafone_cash_amount
  ) VALUES (
    v_customer, 'new', 800, 240, 1040, 'mixed_payment', 540, 500
  ) RETURNING id INTO v_mixed;
  INSERT INTO public.order_offer_instances (order_id, offer_box_id, offer_name, quantity)
  VALUES (v_mixed, v_month_box, 'بوكس الشهر 1600', 2)
  RETURNING id INTO v_inst;
  INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price, offer_name)
  VALUES
    (v_mixed, v_p1, 'برجر', 2, 200, 400, 'بوكس الشهر 1600'),
    (v_mixed, v_p2, 'كفتة', 2, 200, 400, 'بوكس الشهر 1600');
  UPDATE public.orders
  SET vodafone_cash_amount = 1000, courier_cash_due = 40
  WHERE id = v_mixed;
  v_token := public.order_box_snapshot_token(v_mixed);
  BEGIN
    PERFORM public.apply_order_box_copy_change(
      v_mixed, 'inst:' || v_inst::text || ':1', 'delete', '{}'::jsonb, v_token, 'overpay'
    );
    RAISE EXCEPTION 'overpay should have failed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'المدفوعات السابقة أكبر من إجمالي الطلب الجديد' THEN
      RAISE EXCEPTION 'overpay message was %', SQLERRM;
    END IF;
  END;
  IF (SELECT total FROM public.orders WHERE id = v_mixed) <> 1040
     OR (SELECT vodafone_cash_amount FROM public.orders WHERE id = v_mixed) <> 1000 THEN
    RAISE EXCEPTION 'overpay changed the order';
  END IF;
  UPDATE public.orders
  SET vodafone_cash_amount = 500, courier_cash_due = 540
  WHERE id = v_mixed;
  v_token := public.order_box_snapshot_token(v_mixed);
  PERFORM public.apply_order_box_copy_change(
    v_mixed, 'inst:' || v_inst::text || ':1', 'delete', '{}'::jsonb, v_token, 'mixed'
  );
  SELECT total, courier_cash_due, vodafone_cash_amount
  INTO v_total, v_cash, v_voda
  FROM public.orders WHERE id = v_mixed;
  IF v_total <> 520 OR v_cash <> 20 OR v_voda <> 500 THEN
    RAISE EXCEPTION 'mixed payment: total % cash % vodafone %', v_total, v_cash, v_voda;
  END IF;

  -- Added box is its own last copy. Older merged lines stay unlinked.
  INSERT INTO public.orders (customer_id, status, subtotal, delivery_fee, total)
  VALUES (v_customer, 'new', 900, 240, 1140)
  RETURNING id INTO v_one;
  INSERT INTO public.order_offer_instances (order_id, offer_box_id, offer_name, quantity)
  VALUES (v_one, v_month_box, 'بوكس الشهر 1600', 2);
  INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price, offer_name)
  VALUES (v_one, v_p1, 'برجر', 2, 400, 800, 'بوكس الشهر 1600');
  INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price, offer_name)
  VALUES (v_one, v_p3, 'سجق', 1, 100, 100, 'بوكس الشهر 1600')
  RETURNING id INTO v_item;
  UPDATE public.order_offer_instances SET quantity = 3
  WHERE order_id = v_one AND offer_name = 'بوكس الشهر 1600';
  v_reg := public.register_added_order_box_copy(
    v_one, 'بوكس الشهر 1600', v_month_box, ARRAY[v_item]
  );
  SELECT copy_index INTO v_n FROM public.order_box_copies WHERE id = v_reg;
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'register: expected copy index 3, got %', v_n;
  END IF;
  IF (SELECT offer_copy_id FROM public.order_items WHERE id = v_item) IS DISTINCT FROM v_reg THEN
    RAISE EXCEPTION 'register: new line was not linked';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.order_items
    WHERE order_id = v_one AND product_id = v_p1 AND offer_copy_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'register: older line was linked into the new copy';
  END IF;

  -- Warehouse supervisor and anonymous callers are rejected.
  PERFORM set_config('request.jwt.claim.sub', v_wh::text, true);
  BEGIN
    PERFORM public.list_order_box_copies(v_month);
    RAISE EXCEPTION 'warehouse supervisor should have been rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ليس لديك صلاحية تعديل الطلب' THEN
      RAISE EXCEPTION 'warehouse message was %', SQLERRM;
    END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.apply_order_box_copy_change(
      v_month, 'plain', 'delete', '{}'::jsonb, 'x', 'anon'
    );
    RAISE EXCEPTION 'anonymous caller should have been rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'يجب تسجيل الدخول أولاً' THEN
      RAISE EXCEPTION 'anon message was %', SQLERRM;
    END IF;
  END;
END $$;

SELECT 'order_box_copy_change ok' AS result;
