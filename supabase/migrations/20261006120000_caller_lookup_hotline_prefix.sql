-- Hotline callers: the company hotline delivers the caller number as the
-- Cairo area code 02 followed by the full mobile (0201276030250 for
-- 01276030250), so lookup_caller_by_phone returned match = invalid and the
-- caller card showed «أدخل رقم موبايل مصري» even for a registered customer.
--
-- Only lookup_caller_by_phone changes: after normalize_phone_eg, a number of
-- the form 02 + 01xxxxxxxxx (or 2 + 01xxxxxxxxx from +20 2 01...) drops the
-- extra prefix before the search. Everything else in the function is the
-- definition that is live today (permissions, payload, ordering).
-- normalize_phone_eg is not touched.

CREATE OR REPLACE FUNCTION public.lookup_caller_by_phone(p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text;
  v_customer_id uuid;
  v_name text;
  v_area text;
  v_governorate text;
  v_customer_address text;
  v_orders jsonb;
  v_address text;
  v_total_spent numeric;
  v_orders_count integer;
  v_last_order jsonb;
  v_open_order jsonb;
  v_moderator text;
  v_top_products jsonb;
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
  -- Calls through the company hotline arrive with the Cairo area code
  -- in front of the full mobile: 02 01xxxxxxxxx, or +20 2 01xxxxxxxxx
  -- (which normalize_phone_eg leaves as 2 01xxxxxxxxx). Drop that extra
  -- prefix here only. normalize_phone_eg is shared with the duplicate
  -- order checks and stays unchanged. A real landline (02 + 8 digits)
  -- does not match either pattern and still returns invalid.
  IF v_phone ~ '^0201[0-9]{9}$' THEN
    v_phone := substr(v_phone, 3);
  ELSIF v_phone ~ '^201[0-9]{9}$' THEN
    v_phone := substr(v_phone, 2);
  END IF;
  IF v_phone !~ '^01[0-9]{9}$' THEN
    RETURN jsonb_build_object(
      'match', 'invalid',
      'customer', NULL,
      'orders', '[]'::jsonb
    );
  END IF;

  SELECT c.id, c.name, c.area, c.governorate, c.address
    INTO v_customer_id, v_name, v_area, v_governorate, v_customer_address
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

  SELECT COALESCE(SUM(o.total), 0), COUNT(*)::integer
    INTO v_total_spent, v_orders_count
  FROM public.orders o
  WHERE o.customer_id = v_customer_id
    AND lower(btrim(o.status)) NOT IN ('cancelled', 'canceled', 'void', 'rejected');

  SELECT jsonb_build_object(
    'order_number', o.order_number,
    'created_at', o.created_at,
    'total', o.total,
    'status', o.status
  )
    INTO v_last_order
  FROM public.orders o
  WHERE o.customer_id = v_customer_id
  ORDER BY o.created_at DESC, o.id DESC
  LIMIT 1;

  SELECT jsonb_build_object(
    'order_number', o.order_number,
    'status', o.status,
    'created_at', o.created_at,
    'total', o.total
  )
    INTO v_open_order
  FROM public.orders o
  WHERE o.customer_id = v_customer_id
    AND lower(btrim(o.status)) IS DISTINCT FROM 'delivered'
    AND lower(btrim(o.status)) NOT IN ('cancelled', 'canceled', 'void', 'rejected')
  ORDER BY o.created_at DESC, o.id DESC
  LIMIT 1;

  v_address := NULLIF(btrim(v_customer_address), '');
  IF v_address IS NULL THEN
    SELECT NULLIF(btrim(o.delivery_address), '')
      INTO v_address
    FROM public.orders o
    WHERE o.customer_id = v_customer_id
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT 1;
  END IF;

  SELECT COALESCE(NULLIF(btrim(o.moderator), ''), NULLIF(btrim(pd.full_name), ''))
    INTO v_moderator
  FROM public.orders o
  LEFT JOIN public.profile_directory pd ON pd.id = o.created_by
  WHERE o.customer_id = v_customer_id
  ORDER BY o.created_at DESC, o.id DESC
  LIMIT 1;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('name', t.name, 'qty', t.qty)
      ORDER BY t.qty DESC, t.name
    ),
    '[]'::jsonb
  )
    INTO v_top_products
  FROM (
    SELECT btrim(oi.product_name) AS name, SUM(oi.quantity) AS qty
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.customer_id = v_customer_id
      AND btrim(oi.product_name) <> ''
      AND lower(btrim(o.status)) NOT IN ('cancelled', 'canceled', 'void', 'rejected')
    GROUP BY btrim(oi.product_name)
    ORDER BY SUM(oi.quantity) DESC, btrim(oi.product_name)
    LIMIT 3
  ) t;

  RETURN jsonb_build_object(
    'match', 'customer',
    'customer', jsonb_build_object(
      'id', v_customer_id,
      'name', v_name,
      'area', v_area,
      'governorate', v_governorate,
      'last_contact', NULL
    ),
    'orders', v_orders,
    'total_spent', v_total_spent,
    'orders_count', v_orders_count,
    'last_order', v_last_order,
    'open_order', v_open_order,
    'address', v_address,
    'governorate', NULLIF(btrim(v_governorate), ''),
    'moderator', v_moderator,
    'top_products', v_top_products
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_caller_by_phone(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lookup_caller_by_phone(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.lookup_caller_by_phone(text) TO authenticated;
