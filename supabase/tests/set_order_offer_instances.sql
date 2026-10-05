-- A moderator must be able to store 1, 2, or 3 copies of a box, and two
-- different boxes, even when orders.created_by is null. A warehouse
-- supervisor must not. This file builds a scratch schema and rolls nothing
-- back in production. Run it with psql on an empty database.

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
  created_by uuid,
  subtotal numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  delivery_fee numeric NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.offer_boxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.order_offer_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  offer_box_id uuid REFERENCES public.offer_boxes(id) ON DELETE SET NULL,
  offer_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_by uuid,
  UNIQUE (order_id, offer_name)
);

ALTER TABLE public.order_offer_instances ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_offer_instances TO authenticated;
GRANT SELECT ON public.orders TO authenticated;

DROP POLICY IF EXISTS order_offer_instances_insert ON public.order_offer_instances;
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

\ir ../migrations/20261005180000_set_order_offer_instances.sql

DO $$
DECLARE
  v_mariam uuid := 'ff165c36-6390-4700-a880-e3894762693b';
  v_abdelmonem uuid := 'c47d1804-1423-4f33-81fa-294a34ed7a16';
  v_order uuid;
  v_box_1500 uuid;
  v_box_1000 uuid;
  v_n int;
  v_qty int;
  v_names text;
  v_created uuid;
BEGIN
  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_mariam, 'sales_moderator'),
    (v_abdelmonem, 'warehouse_supervisor');

  INSERT INTO public.offer_boxes (name) VALUES ('بوكس 1500') RETURNING id INTO v_box_1500;
  INSERT INTO public.offer_boxes (name) VALUES ('عرض 1000') RETURNING id INTO v_box_1000;

  -- Production orders have created_by null. The client insert then fails for a moderator.
  INSERT INTO public.orders (created_by, subtotal, total, delivery_fee)
  VALUES (NULL, 1380, 1500, 120)
  RETURNING id INTO v_order;

  PERFORM set_config('request.jwt.claim.sub', v_mariam::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO public.order_offer_instances (order_id, offer_name, quantity)
    VALUES (v_order, 'بوكس 1500', 2);
    RAISE EXCEPTION 'moderator insert without a matching created_by should have failed';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  SELECT count(*) INTO v_n FROM public.order_offer_instances WHERE order_id = v_order;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'direct insert wrote % rows', v_n;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.set_order_offer_instances(
      v_order,
      jsonb_build_array(jsonb_build_object('offer_name', 'بوكس 1500', 'quantity', 1, 'offer_box_id', v_box_1500))
    );
    RAISE EXCEPTION 'anonymous call should have failed';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM 'يجب تسجيل الدخول أولاً' THEN
        RAISE;
      END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_abdelmonem::text, true);
  BEGIN
    PERFORM public.set_order_offer_instances(
      v_order,
      jsonb_build_array(jsonb_build_object('offer_name', 'بوكس 1500', 'quantity', 1, 'offer_box_id', v_box_1500))
    );
    RAISE EXCEPTION 'warehouse supervisor should have failed';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM 'ليس لديك صلاحية تعديل الطلب' THEN
        RAISE;
      END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_mariam::text, true);

  PERFORM public.set_order_offer_instances(
    v_order,
    jsonb_build_array(jsonb_build_object('offer_name', 'بوكس 1500', 'quantity', 1, 'offer_box_id', v_box_1500))
  );
  SELECT quantity, created_by INTO v_qty, v_created
    FROM public.order_offer_instances WHERE order_id = v_order;
  IF v_qty IS DISTINCT FROM 1 OR v_created IS DISTINCT FROM v_mariam THEN
    RAISE EXCEPTION '1 box stored as qty % created_by %', v_qty, v_created;
  END IF;

  PERFORM public.set_order_offer_instances(
    v_order,
    jsonb_build_array(jsonb_build_object('offer_name', 'بوكس 1500', 'quantity', 2, 'offer_box_id', v_box_1500))
  );
  SELECT count(*), max(quantity) INTO v_n, v_qty
    FROM public.order_offer_instances WHERE order_id = v_order;
  IF v_n <> 1 OR v_qty IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION '2 same boxes stored as % rows qty %', v_n, v_qty;
  END IF;

  PERFORM public.set_order_offer_instances(
    v_order,
    jsonb_build_array(jsonb_build_object('offer_name', 'بوكس 1500', 'quantity', 3, 'offer_box_id', v_box_1500))
  );
  SELECT quantity INTO v_qty FROM public.order_offer_instances WHERE order_id = v_order;
  IF v_qty IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION '3 boxes stored as qty %', v_qty;
  END IF;

  PERFORM public.set_order_offer_instances(
    v_order,
    jsonb_build_array(
      jsonb_build_object('offer_name', 'بوكس 1500', 'quantity', 1, 'offer_box_id', v_box_1500),
      jsonb_build_object('offer_name', 'عرض 1000', 'quantity', 1, 'offer_box_id', v_box_1000)
    )
  );
  SELECT string_agg(offer_name || '×' || quantity::text, ',' ORDER BY offer_name)
    INTO v_names
    FROM public.order_offer_instances
   WHERE order_id = v_order;
  IF v_names IS DISTINCT FROM 'بوكس 1500×1,عرض 1000×1' THEN
    RAISE EXCEPTION '2 different boxes stored as %', v_names;
  END IF;

  -- Two payload rows for one name collapse to one unique row.
  PERFORM public.set_order_offer_instances(
    v_order,
    jsonb_build_array(
      jsonb_build_object('offer_name', 'عرض 1000', 'quantity', 1, 'offer_box_id', v_box_1000),
      jsonb_build_object('offer_name', 'عرض 1000', 'quantity', 1, 'offer_box_id', v_box_1000)
    )
  );
  SELECT count(*), max(quantity) INTO v_n, v_qty
    FROM public.order_offer_instances WHERE order_id = v_order AND offer_name = 'عرض 1000';
  IF v_n <> 1 OR v_qty IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'no-shipping offer ×2 stored as % rows qty %', v_n, v_qty;
  END IF;
END $$;
