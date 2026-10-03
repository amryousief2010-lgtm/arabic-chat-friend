-- Box names on the order card come from order_offer_instances.
-- save_order_items_edit must drop a replaced or deleted box in the same
-- transaction, including for sales_moderator, who cannot delete those rows
-- under RLS and whose client insert omitted created_by.
-- Rolls back nothing: this file builds a scratch schema. Run it on an empty
-- database.

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
    'shipping_company',
    'sales_moderator'
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
  created_by uuid,
  subtotal numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  delivery_fee numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
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
  is_half_kg boolean NOT NULL DEFAULT false,
  is_gift boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.offer_boxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
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

ALTER TABLE public.order_offer_instances ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

DROP POLICY IF EXISTS order_offer_instances_select ON public.order_offer_instances;
DROP POLICY IF EXISTS order_offer_instances_insert ON public.order_offer_instances;
DROP POLICY IF EXISTS order_offer_instances_delete ON public.order_offer_instances;

CREATE POLICY order_offer_instances_select
ON public.order_offer_instances
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_offer_instances.order_id
  )
);

CREATE POLICY order_offer_instances_insert
ON public.order_offer_instances
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (
    created_by = auth.uid()
    OR public.has_any_role(auth.uid(), ARRAY[
      'general_manager'::public.app_role,
      'executive_manager'::public.app_role,
      'sales_manager'::public.app_role
    ])
  )
  AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_offer_instances.order_id
      AND (
        o.created_by = auth.uid()
        OR public.has_any_role(auth.uid(), ARRAY[
          'general_manager'::public.app_role,
          'executive_manager'::public.app_role,
          'sales_manager'::public.app_role
        ])
      )
  )
);

CREATE POLICY order_offer_instances_delete
ON public.order_offer_instances
FOR DELETE
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::public.app_role,
    'executive_manager'::public.app_role,
    'sales_manager'::public.app_role
  ])
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_offer_instances TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT SELECT, UPDATE ON public.orders TO authenticated;

\ir ../migrations/20261003120000_sync_order_offer_instances.sql

DO $$
DECLARE
  v_mod uuid := '11111111-1111-1111-1111-111111111111';
  v_other uuid := '22222222-2222-2222-2222-222222222222';
  v_order uuid;
  v_order2 uuid;
  v_box_a uuid;
  v_box_b uuid;
  v_box_c uuid;
  v_box_d uuid;
  v_item_a uuid;
  v_item_b uuid;
  v_item_c uuid;
  v_individual uuid;
  v_shipping uuid;
  v_inst uuid;
  v_inst_b uuid;
  v_n int;
  v_names text;
  v_fee numeric;
  v_price numeric;
  v_qty numeric;
  v_offer text;
  v_box uuid;
  v_created uuid;
BEGIN
  INSERT INTO public.user_roles (user_id, role) VALUES (v_mod, 'sales_moderator');

  INSERT INTO public.offer_boxes (name) VALUES ('بوكس A') RETURNING id INTO v_box_a;
  INSERT INTO public.offer_boxes (name) VALUES ('بوكس B') RETURNING id INTO v_box_b;
  INSERT INTO public.offer_boxes (name) VALUES ('بوكس C') RETURNING id INTO v_box_c;
  INSERT INTO public.offer_boxes (name) VALUES ('بوكس D') RETURNING id INTO v_box_d;

  INSERT INTO public.orders (created_by, subtotal, discount, total, delivery_fee)
  VALUES (v_mod, 580, 0, 655, 40)
  RETURNING id INTO v_order;

  INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price, offer_name)
  VALUES (v_order, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'كفتة', 2, 290, 580, 'بوكس A')
  RETURNING id INTO v_item_a;

  INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price, offer_name)
  VALUES (v_order, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'استيك', 1, 450, 450, NULL)
  RETURNING id INTO v_individual;

  INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price, offer_name)
  VALUES (v_order, NULL, 'تكلفة الشحن', 1, 75, 75, 'بوكس A')
  RETURNING id INTO v_shipping;

  INSERT INTO public.order_offer_instances (order_id, offer_box_id, offer_name, quantity, created_by)
  VALUES (v_order, v_box_a, 'بوكس A', 2, v_mod)
  RETURNING id INTO v_inst;

  PERFORM set_config('request.jwt.claim.sub', v_mod::text, true);

  -- sales_moderator delete is a silent no-op under the manager-only policy.
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    DELETE FROM public.order_offer_instances WHERE id = v_inst;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 0 THEN
      RAISE EXCEPTION 'sales_moderator deleted % instance rows', v_n;
    END IF;
    EXECUTE 'RESET ROLE';
  END;
  SELECT count(*) INTO v_n FROM public.order_offer_instances WHERE id = v_inst;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'old box row disappeared after a moderator delete';
  END IF;

  -- Insert without created_by fails the insert check.
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO public.order_offer_instances (order_id, offer_name, quantity)
    VALUES (v_order, 'بوكس B', 1);
    RAISE EXCEPTION 'insert without created_by should have failed';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  -- Insert with created_by succeeds and the old row stays: both names.
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO public.order_offer_instances (order_id, offer_box_id, offer_name, quantity, created_by)
    VALUES (v_order, v_box_b, 'بوكس B', 1, v_mod);
    DELETE FROM public.order_offer_instances WHERE order_id = v_order AND offer_name = 'بوكس A';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 0 THEN
      RAISE EXCEPTION 'moderator deleted the old box while inserting the new one';
    END IF;
    EXECUTE 'RESET ROLE';
  END;
  SELECT string_agg(offer_name, ',' ORDER BY offer_name)
    INTO v_names
    FROM public.order_offer_instances
   WHERE order_id = v_order;
  IF v_names IS DISTINCT FROM 'بوكس A,بوكس B' THEN
    RAISE EXCEPTION 'expected both names before sync, got %', v_names;
  END IF;

  -- A failed save rolls back the new items and the instance change together.
  BEGIN
    PERFORM public.save_order_items_edit(
      v_order,
      jsonb_build_array(
        jsonb_build_object('id', v_item_a, '_deleted', true, 'product_name', 'كفتة', 'quantity', 2, 'unit_price', 290, 'offer_name', 'بوكس A'),
        jsonb_build_object('product_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'product_name', 'كفتة', 'quantity', 1, 'unit_price', 310, 'offer_name', 'بوكس C')
      ),
      310, 0, 350, 40
    );
    RAISE EXCEPTION 'force_rollback';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM 'force_rollback' THEN
        RAISE;
      END IF;
  END;
  SELECT count(*) INTO v_n FROM public.order_items WHERE id = v_item_a;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'rolled-back save removed the original item';
  END IF;
  SELECT string_agg(offer_name, ',' ORDER BY offer_name) INTO v_names
    FROM public.order_offer_instances WHERE order_id = v_order;
  IF v_names IS DISTINCT FROM 'بوكس A,بوكس B' THEN
    RAISE EXCEPTION 'rolled-back save changed instances to %', v_names;
  END IF;

  -- Replace A with B. Shipping line still says A and must not keep that link.
  PERFORM public.save_order_items_edit(
    v_order,
    jsonb_build_array(
      jsonb_build_object('id', v_item_a, '_deleted', true, 'product_name', 'كفتة', 'quantity', 2, 'unit_price', 290, 'offer_name', 'بوكس A'),
      jsonb_build_object('product_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'product_name', 'كفتة', 'quantity', 1, 'unit_price', 310, 'offer_name', 'بوكس B'),
      jsonb_build_object('id', v_individual, 'product_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'product_name', 'استيك', 'quantity', 1, 'unit_price', 450, 'offer_name', NULL)
    ),
    760, 0, 800, 40
  );

  SELECT string_agg(offer_name || '×' || quantity::text, ',' ORDER BY offer_name), count(*)
    INTO v_names, v_n
    FROM public.order_offer_instances
   WHERE order_id = v_order;
  IF v_n <> 1 OR v_names IS DISTINCT FROM 'بوكس B×1' THEN
    RAISE EXCEPTION 'after replace, card rows are % (% rows)', v_names, v_n;
  END IF;
  SELECT offer_box_id, created_by INTO v_box, v_created
    FROM public.order_offer_instances WHERE order_id = v_order;
  IF v_box IS DISTINCT FROM v_box_b OR v_created IS DISTINCT FROM v_mod THEN
    RAISE EXCEPTION 'new box link is % created_by %', v_box, v_created;
  END IF;
  SELECT offer_name, unit_price, quantity INTO v_offer, v_price, v_qty
    FROM public.order_items WHERE id = v_individual;
  IF v_offer IS NOT NULL OR v_price IS DISTINCT FROM 450 OR v_qty IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'individual line changed to % / % / %', v_offer, v_price, v_qty;
  END IF;
  SELECT unit_price, offer_name INTO v_price, v_offer
    FROM public.order_items WHERE id = v_shipping;
  IF v_price IS DISTINCT FROM 75 OR v_offer IS DISTINCT FROM 'بوكس A' THEN
    RAISE EXCEPTION 'shipping line changed to % / %', v_price, v_offer;
  END IF;
  SELECT unit_price INTO v_price
    FROM public.order_items
   WHERE order_id = v_order AND offer_name = 'بوكس B' AND product_id IS NOT NULL;
  IF v_price IS DISTINCT FROM 310 THEN
    RAISE EXCEPTION 'replaced box price is %', v_price;
  END IF;
  SELECT delivery_fee INTO v_fee FROM public.orders WHERE id = v_order;
  IF v_fee IS DISTINCT FROM 40 THEN
    RAISE EXCEPTION 'delivery fee changed to %', v_fee;
  END IF;
  SELECT count(*) INTO v_n FROM public.order_items WHERE id = v_item_a;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'old box item still on the order';
  END IF;

  SELECT id INTO v_item_b
    FROM public.order_items
   WHERE order_id = v_order AND offer_name = 'بوكس B' AND product_id IS NOT NULL;

  -- Replace again, B to C.
  PERFORM public.save_order_items_edit(
    v_order,
    jsonb_build_array(
      jsonb_build_object('id', v_item_b, '_deleted', true, 'product_name', 'كفتة', 'quantity', 1, 'unit_price', 310, 'offer_name', 'بوكس B'),
      jsonb_build_object('product_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'product_name', 'كفتة', 'quantity', 1, 'unit_price', 310, 'offer_name', 'بوكس C'),
      jsonb_build_object('id', v_individual, 'product_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'product_name', 'استيك', 'quantity', 1, 'unit_price', 450, 'offer_name', NULL)
    ),
    760, 0, 800, 40
  );
  SELECT string_agg(offer_name, ',' ORDER BY offer_name), count(*)
    INTO v_names, v_n
    FROM public.order_offer_instances WHERE order_id = v_order;
  IF v_n <> 1 OR v_names IS DISTINCT FROM 'بوكس C' THEN
    RAISE EXCEPTION 'second replace left %', v_names;
  END IF;

  SELECT id INTO v_item_c
    FROM public.order_items
   WHERE order_id = v_order AND offer_name = 'بوكس C' AND product_id IS NOT NULL;
  SELECT id INTO v_inst FROM public.order_offer_instances WHERE order_id = v_order;

  -- Same box: quantity and product edit keep one row and the stored box count.
  PERFORM public.save_order_items_edit(
    v_order,
    jsonb_build_array(
      jsonb_build_object('id', v_item_c, 'product_id', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'product_name', 'برجر', 'quantity', 4, 'unit_price', 310, 'offer_name', 'بوكس C'),
      jsonb_build_object('id', v_individual, 'product_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'product_name', 'استيك', 'quantity', 1, 'unit_price', 450, 'offer_name', NULL)
    ),
    1690, 0, 1730, 40
  );
  SELECT count(*), max(id::text), max(quantity), max(offer_name)
    INTO v_n, v_names, v_qty, v_offer
    FROM public.order_offer_instances WHERE order_id = v_order;
  IF v_n <> 1 OR v_names IS DISTINCT FROM v_inst::text OR v_qty IS DISTINCT FROM 1 OR v_offer IS DISTINCT FROM 'بوكس C' THEN
    RAISE EXCEPTION 'same-box edit changed the link to rows=% id=% qty=% name=%', v_n, v_names, v_qty, v_offer;
  END IF;
  SELECT quantity, unit_price INTO v_qty, v_price FROM public.order_items WHERE id = v_item_c;
  IF v_qty IS DISTINCT FROM 4 OR v_price IS DISTINCT FROM 310 THEN
    RAISE EXCEPTION 'item qty/price after same-box edit is % / %', v_qty, v_price;
  END IF;

  -- Delete the box. The shipping line still carries the old name and must not restore it.
  PERFORM public.save_order_items_edit(
    v_order,
    jsonb_build_array(
      jsonb_build_object('id', v_item_c, '_deleted', true, 'product_name', 'برجر', 'quantity', 4, 'unit_price', 310, 'offer_name', 'بوكس C'),
      jsonb_build_object('id', v_individual, 'product_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'product_name', 'استيك', 'quantity', 1, 'unit_price', 450, 'offer_name', NULL)
    ),
    450, 0, 490, 40
  );
  SELECT count(*) INTO v_n FROM public.order_offer_instances WHERE order_id = v_order;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'deleted box left % instance rows', v_n;
  END IF;
  SELECT offer_name, unit_price INTO v_offer, v_price FROM public.order_items WHERE id = v_individual;
  IF v_offer IS NOT NULL OR v_price IS DISTINCT FROM 450 THEN
    RAISE EXCEPTION 'individual line after delete is % / %', v_offer, v_price;
  END IF;
  SELECT unit_price INTO v_price FROM public.order_items WHERE id = v_shipping;
  IF v_price IS DISTINCT FROM 75 THEN
    RAISE EXCEPTION 'shipping price after delete is %', v_price;
  END IF;
  SELECT delivery_fee INTO v_fee FROM public.orders WHERE id = v_order;
  IF v_fee IS DISTINCT FROM 40 THEN
    RAISE EXCEPTION 'delivery fee after delete is %', v_fee;
  END IF;

  -- Several real boxes: only the ones that remain, and their counts stay.
  INSERT INTO public.order_items (order_id, product_name, quantity, unit_price, total_price, offer_name)
  VALUES (v_order, 'كفتة', 1, 290, 290, 'بوكس A')
  RETURNING id INTO v_item_a;
  INSERT INTO public.order_items (order_id, product_name, quantity, unit_price, total_price, offer_name)
  VALUES (v_order, 'كفتة', 1, 310, 310, 'بوكس B')
  RETURNING id INTO v_item_b;
  INSERT INTO public.order_offer_instances (order_id, offer_box_id, offer_name, quantity, created_by)
  VALUES (v_order, v_box_a, 'بوكس A', 3, v_mod);
  INSERT INTO public.order_offer_instances (order_id, offer_box_id, offer_name, quantity, created_by)
  VALUES (v_order, v_box_b, 'بوكس B', 2, v_mod);
  PERFORM public.sync_order_offer_instances(v_order);
  SELECT string_agg(offer_name || '×' || quantity::text, ',' ORDER BY offer_name)
    INTO v_names
    FROM public.order_offer_instances WHERE order_id = v_order;
  IF v_names IS DISTINCT FROM 'بوكس A×3,بوكس B×2' THEN
    RAISE EXCEPTION 'sync duplicated or reset multi-box counts: %', v_names;
  END IF;

  PERFORM public.save_order_items_edit(
    v_order,
    jsonb_build_array(
      jsonb_build_object('id', v_item_a, '_deleted', true, 'product_name', 'كفتة', 'quantity', 1, 'unit_price', 290, 'offer_name', 'بوكس A'),
      jsonb_build_object('id', v_item_b, 'product_name', 'كفتة', 'quantity', 1, 'unit_price', 310, 'offer_name', 'بوكس B'),
      jsonb_build_object('id', v_individual, 'product_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'product_name', 'استيك', 'quantity', 1, 'unit_price', 450, 'offer_name', NULL)
    ),
    760, 0, 800, 40
  );
  SELECT string_agg(offer_name || '×' || quantity::text, ',' ORDER BY offer_name), count(*)
    INTO v_names, v_n
    FROM public.order_offer_instances WHERE order_id = v_order;
  IF v_n <> 1 OR v_names IS DISTINCT FROM 'بوكس B×2' THEN
    RAISE EXCEPTION 'multi-box delete left %', v_names;
  END IF;

  -- Swap path: items already point at D, the old instance row is still B.
  DELETE FROM public.order_items WHERE id = v_item_b;
  INSERT INTO public.order_items (order_id, product_name, quantity, unit_price, total_price, offer_name)
  VALUES (v_order, 'كفتة', 2, 500, 1000, 'بوكس D');
  PERFORM public.sync_order_offer_instances(v_order, v_box_d, 'بوكس D');
  SELECT offer_name, quantity, offer_box_id INTO v_offer, v_qty, v_box
    FROM public.order_offer_instances WHERE order_id = v_order;
  SELECT count(*) INTO v_n FROM public.order_offer_instances WHERE order_id = v_order;
  IF v_n <> 1 OR v_offer IS DISTINCT FROM 'بوكس D' OR v_qty IS DISTINCT FROM 1 OR v_box IS DISTINCT FROM v_box_d THEN
    RAISE EXCEPTION 'swap sync left % × % box % (% rows)', v_offer, v_qty, v_box, v_n;
  END IF;
  SELECT unit_price INTO v_price
    FROM public.order_items WHERE order_id = v_order AND offer_name = 'بوكس D';
  IF v_price IS DISTINCT FROM 500 THEN
    RAISE EXCEPTION 'swap changed the box price to %', v_price;
  END IF;
  SELECT delivery_fee INTO v_fee FROM public.orders WHERE id = v_order;
  IF v_fee IS DISTINCT FROM 40 THEN
    RAISE EXCEPTION 'swap sync changed delivery fee to %', v_fee;
  END IF;

  -- Adding another copy of the same box keeps the incremented count.
  UPDATE public.order_offer_instances SET quantity = 2 WHERE order_id = v_order;
  PERFORM public.sync_order_offer_instances(v_order, v_box_d, 'بوكس D');
  SELECT count(*), max(quantity), max(offer_name) INTO v_n, v_qty, v_offer
    FROM public.order_offer_instances WHERE order_id = v_order;
  IF v_n <> 1 OR v_qty IS DISTINCT FROM 2 OR v_offer IS DISTINCT FROM 'بوكس D' THEN
    RAISE EXCEPTION 'second copy of the same box became % × % (% rows)', v_offer, v_qty, v_n;
  END IF;

  -- A stranger cannot sync.
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  BEGIN
    PERFORM public.sync_order_offer_instances(v_order);
    RAISE EXCEPTION 'user without a sales role synced instances';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM 'ليس لديك صلاحية تعديل الطلب' THEN
        RAISE;
      END IF;
  END;

  -- anon cannot execute.
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM public.sync_order_offer_instances(v_order);
    RAISE EXCEPTION 'anon executed sync';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END $$;
