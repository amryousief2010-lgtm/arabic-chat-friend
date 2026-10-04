-- Caller lookup for the sales desk.
--
-- sales_moderator may read customers, but orders RLS only shows rows they
-- created. Roles in "Managers and authorized roles can view all orders"
-- and "marketing_sales_viewer read" can already see every order.
-- social_media_manager can read every order and cannot read customers, so
-- this function returns an empty payload for that role.
-- Anyone else gets insufficient_privilege and no customer row.
--
-- Phone match uses public.normalize_phone_eg so 01, +20, 0020, spaces,
-- dashes, and Arabic digits still hit the stored phone or phone2.
-- customers has no last-contact timestamp; last_contact stays null.

CREATE OR REPLACE FUNCTION public.lookup_caller_by_phone(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text;
  v_customer_id uuid;
  v_name text;
  v_area text;
  v_governorate text;
  v_orders jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(v_uid, 'sales_moderator'::public.app_role)
    OR public.has_any_role(v_uid, ARRAY[
      'general_manager',
      'executive_manager',
      'sales_manager',
      'marketing_sales_manager',
      'accountant',
      'warehouse_supervisor',
      'marketing_sales_viewer'
    ]::public.app_role[])
    OR public.is_social_media_manager(v_uid)
  ) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  -- Same unscoped customer SELECT policies already on public.customers.
  -- A role that can see every order but not customers (social_media_manager)
  -- gets no customer fields and no orders.
  IF NOT public.has_any_role(v_uid, ARRAY[
    'general_manager',
    'executive_manager',
    'sales_manager',
    'marketing_sales_manager',
    'marketing_sales_viewer',
    'sales_moderator',
    'accountant',
    'financial_manager',
    'warehouse_supervisor',
    'agouza_warehouse_keeper'
  ]::public.app_role[]) THEN
    RETURN jsonb_build_object(
      'match', 'none',
      'customer', NULL,
      'orders', '[]'::jsonb
    );
  END IF;

  v_phone := public.normalize_phone_eg(p_phone);
  IF v_phone !~ '^01[0-9]{9}$' THEN
    RETURN jsonb_build_object(
      'match', 'invalid',
      'customer', NULL,
      'orders', '[]'::jsonb
    );
  END IF;

  SELECT c.id, c.name, c.area, c.governorate
    INTO v_customer_id, v_name, v_area, v_governorate
  FROM public.customers c
  WHERE public.normalize_phone_eg(c.phone) = v_phone
     OR (
       c.phone2 IS NOT NULL
       AND btrim(c.phone2) <> ''
       AND public.normalize_phone_eg(c.phone2) = v_phone
     )
  ORDER BY
    CASE WHEN public.normalize_phone_eg(c.phone) = v_phone THEN 0 ELSE 1 END,
    (
      SELECT max(o.created_at)
      FROM public.orders o
      WHERE o.customer_id = c.id
    ) DESC NULLS LAST,
    c.updated_at DESC NULLS LAST,
    c.created_at DESC
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object(
      'match', 'new',
      'customer', NULL,
      'orders', '[]'::jsonb
    );
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'created_at', s.created_at,
        'status', s.status,
        'total', s.total
      )
      ORDER BY s.created_at DESC
    ),
    '[]'::jsonb
  )
    INTO v_orders
  FROM (
    SELECT o.created_at, o.status, o.total
    FROM public.orders o
    WHERE o.customer_id = v_customer_id
    ORDER BY o.created_at DESC
    LIMIT 8
  ) s;

  RETURN jsonb_build_object(
    'match', 'customer',
    'customer', jsonb_build_object(
      'id', v_customer_id,
      'name', v_name,
      'area', v_area,
      'governorate', v_governorate,
      'last_contact', NULL
    ),
    'orders', v_orders
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_caller_by_phone(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lookup_caller_by_phone(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.lookup_caller_by_phone(text) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_customers_phone_eg_norm
  ON public.customers (public.normalize_phone_eg(phone));

CREATE INDEX IF NOT EXISTS idx_customers_phone2_eg_norm
  ON public.customers (public.normalize_phone_eg(phone2))
  WHERE phone2 IS NOT NULL AND btrim(phone2) <> '';
