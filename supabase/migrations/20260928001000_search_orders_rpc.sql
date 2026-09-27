-- One round trip for the Orders page search. SECURITY INVOKER so the caller's
-- RLS policies stay in force. Match rules follow the page's current search
-- branch: order number, waybill, address, and customer name / phones /
-- governorate, including the same plain and fuzzy ILIKE patterns. Optional
-- filters are applied only when the caller passes them. A null filter means
-- "no extra predicate", which is how the search branch works today for
-- year and month (those stay on the client, and search ignores them).

CREATE OR REPLACE FUNCTION public.search_orders(
  p_query text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_status text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_route_id uuid DEFAULT NULL,
  p_collection_method text DEFAULT NULL,
  p_product_name text DEFAULT NULL,
  p_fulfillment text DEFAULT NULL,
  p_moderator text DEFAULT NULL,
  p_governorate text DEFAULT NULL,
  p_warehouse_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  order_number text,
  customer_id uuid,
  status text,
  payment_method text,
  payment_status text,
  collection_status text,
  subtotal numeric,
  discount numeric,
  delivery_fee numeric,
  total numeric,
  notes text,
  delivery_address text,
  created_at timestamptz,
  delivered_at timestamptz,
  created_by uuid,
  moderator text,
  shipping_company text,
  source text,
  fulfillment_type text,
  source_warehouse_id uuid,
  route_id uuid,
  update_status_marker text,
  update_status_updated_at timestamptz,
  collection_method text,
  courier_cash_due numeric,
  collection_updated_at timestamptz,
  vodafone_cash_amount numeric,
  instapay_amount numeric,
  free_amount numeric,
  shipping_bill_no text,
  customer_name text,
  customer_phone text,
  customer_phone2 text,
  governorate text,
  creator_name text,
  warehouse_name text,
  route_name text,
  items jsonb,
  offer_instances jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_term text;
  v_norm text;
  v_digits text;
  v_plain text;
  v_fuzzy text;
  v_limit integer;
  v_offset integer;
BEGIN
  v_term := btrim(coalesce(p_query, ''));
  v_term := translate(v_term, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  v_norm := translate(v_term, 'إأآٱىةؤئ', 'اااايهوي');
  v_norm := regexp_replace(v_norm, '[ًٌٍَُِّْٰـ]', '', 'g');
  v_norm := replace(v_norm, '،', ' ');
  v_norm := btrim(regexp_replace(v_norm, '\s+', ' ', 'g'));
  v_digits := regexp_replace(v_term, '[^0-9]', '', 'g');

  SELECT
    CASE WHEN count(*) > 0 THEN '%' || string_agg(tok, '%' ORDER BY ord) || '%' ELSE '' END,
    CASE WHEN count(*) > 0 THEN '%' || string_agg(regexp_replace(tok, '[اأإآيىةه]', '_', 'g'), '%' ORDER BY ord) || '%' ELSE '' END
    INTO v_plain, v_fuzzy
  FROM (
    SELECT btrim(x) AS tok, ordinality AS ord
      FROM regexp_split_to_table(v_norm, ' ') WITH ORDINALITY AS s(x, ordinality)
     WHERE btrim(x) <> ''
  ) tokens;

  IF v_fuzzy = v_plain THEN
    v_fuzzy := '';
  END IF;

  v_limit := LEAST(GREATEST(coalesce(p_limit, 50), 0), 10000);
  v_offset := GREATEST(coalesce(p_offset, 0), 0);

  RETURN QUERY
  WITH cust AS (
    SELECT c.id
      FROM public.customers c
     WHERE (
            (v_plain <> '' AND c.name ILIKE v_plain)
         OR (v_fuzzy <> '' AND c.name ILIKE v_fuzzy)
         OR (v_digits <> '' AND c.phone ILIKE '%' || v_digits || '%')
         OR (v_digits <> '' AND c.phone2 ILIKE '%' || v_digits || '%')
         OR (v_plain <> '' AND c.governorate ILIKE v_plain)
     )
     ORDER BY c.id
     LIMIT 1000
  ),
  cust_numbered AS (
    SELECT cust.id, row_number() OVER (ORDER BY cust.id) - 1 AS rn
      FROM cust
  ),
  text_orders AS (
    SELECT o.id
      FROM public.orders o
     WHERE o.order_number ILIKE '%' || v_term || '%'
        OR o.shipping_bill_no ILIKE '%' || v_term || '%'
        OR (v_digits <> '' AND o.order_number ILIKE '%' || v_digits || '%')
        OR (v_digits <> '' AND o.shipping_bill_no ILIKE '%' || v_digits || '%')
        OR (v_plain <> '' AND o.delivery_address ILIKE v_plain)
        OR (v_fuzzy <> '' AND o.delivery_address ILIKE v_fuzzy)
     ORDER BY o.created_at DESC
     LIMIT 300
  ),
  cust_orders AS (
    SELECT s.id
      FROM (
        SELECT o.id,
               row_number() OVER (PARTITION BY (cn.rn / 100) ORDER BY o.created_at DESC) AS rnk
          FROM public.orders o
          JOIN cust_numbered cn ON cn.id = o.customer_id
      ) s
     WHERE s.rnk <= 300
  ),
  ids AS (
    SELECT text_orders.id FROM text_orders
    UNION
    SELECT cust_orders.id FROM cust_orders
  )
  SELECT
    o.id,
    o.order_number,
    o.customer_id,
    o.status,
    o.payment_method,
    o.payment_status,
    o.collection_status,
    o.subtotal,
    o.discount,
    o.delivery_fee,
    o.total,
    o.notes,
    o.delivery_address,
    o.created_at,
    o.delivered_at,
    o.created_by,
    o.moderator,
    o.shipping_company,
    o.source,
    o.fulfillment_type,
    o.source_warehouse_id,
    o.route_id,
    o.update_status_marker,
    o.update_status_updated_at,
    o.collection_method,
    o.courier_cash_due,
    o.collection_updated_at,
    o.vodafone_cash_amount,
    o.instapay_amount,
    o.free_amount,
    o.shipping_bill_no,
    c.name,
    c.phone,
    c.phone2,
    c.governorate,
    pd.full_name,
    w.name,
    dr.name,
    (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id,
        'order_id', i.order_id,
        'product_id', i.product_id,
        'product_name', i.product_name,
        'quantity', i.quantity,
        'unit_price', i.unit_price,
        'total_price', i.total_price,
        'offer_name', i.offer_name,
        'is_half_kg', i.is_half_kg,
        'unit', pr.unit
      )), '[]'::jsonb)
        FROM public.order_items i
        LEFT JOIN public.products pr ON pr.id = i.product_id
       WHERE i.order_id = o.id
    ),
    (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'offer_name', oi.offer_name,
        'quantity', oi.quantity
      )), '[]'::jsonb)
        FROM public.order_offer_instances oi
       WHERE oi.order_id = o.id
    )
  FROM ids
  JOIN public.orders o ON o.id = ids.id
  LEFT JOIN public.customers c ON c.id = o.customer_id
  LEFT JOIN public.profile_directory pd ON pd.id = o.created_by
  LEFT JOIN public.warehouses w ON w.id = o.source_warehouse_id
  LEFT JOIN public.delivery_routes dr ON dr.id = o.route_id
  WHERE (p_status IS NULL OR p_status = '' OR p_status = 'all'
         OR (p_status = 'pending' AND o.status IN ('pending', 'processing'))
         OR (p_status <> 'pending' AND o.status = p_status))
    AND (p_from IS NULL OR o.created_at >= p_from)
    AND (p_to IS NULL OR o.created_at < p_to)
    AND (p_route_id IS NULL OR o.route_id = p_route_id)
    AND (p_collection_method IS NULL OR p_collection_method = '' OR p_collection_method = 'all'
         OR (p_collection_method = 'unset' AND o.collection_method IS NULL)
         OR (p_collection_method <> 'unset' AND o.collection_method = p_collection_method))
    AND (p_product_name IS NULL OR p_product_name = '' OR p_product_name = 'all'
         OR EXISTS (
              SELECT 1 FROM public.order_items i
               WHERE i.order_id = o.id AND i.product_name = p_product_name
            ))
    AND (p_moderator IS NULL OR p_moderator = '' OR p_moderator = 'all'
         OR o.moderator ILIKE '%' || p_moderator || '%')
    AND (p_governorate IS NULL OR p_governorate = '' OR p_governorate = 'all'
         OR c.governorate ILIKE '%' || p_governorate || '%')
    AND (p_warehouse_id IS NULL OR o.source_warehouse_id = p_warehouse_id)
    AND (
      p_fulfillment IS NULL OR p_fulfillment = '' OR p_fulfillment = 'all'
      OR CASE
           WHEN o.fulfillment_type = 'pickup' AND coalesce(w.name, '') LIKE '%الرئيسي%' THEN 'pickup_main'
           WHEN o.fulfillment_type = 'delivery' AND coalesce(w.name, '') LIKE '%الرئيسي%' THEN 'delivery_main'
           WHEN o.fulfillment_type = 'pickup' AND coalesce(w.name, '') LIKE '%العجوزة%' THEN 'pickup_agouza'
           WHEN o.fulfillment_type = 'delivery' AND coalesce(w.name, '') LIKE '%العجوزة%' THEN 'delivery_agouza'
           WHEN o.shipping_company IS NOT NULL AND o.shipping_company <> 'مندوب خاص' THEN 'shipping_company'
           ELSE ''
         END = p_fulfillment
    )
  ORDER BY o.created_at DESC
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.search_orders(text, integer, integer, text, timestamptz, timestamptz, uuid, text, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_orders(text, integer, integer, text, timestamptz, timestamptz, uuid, text, text, text, text, text, uuid) TO authenticated;
