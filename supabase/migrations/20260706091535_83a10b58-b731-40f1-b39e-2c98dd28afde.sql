
CREATE OR REPLACE FUNCTION public.find_duplicate_order_candidates(p_customer_id uuid, p_customer_name text, p_customer_phone text, p_delivery_address text DEFAULT NULL::text, p_shipping_company text DEFAULT NULL::text, p_fulfillment_type text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE(matched_order_id uuid, order_number text, customer_name text, customer_phone text, moderator_name text, created_at timestamp with time zone, status text, delivery_address text, shipping_company text, fulfillment_type text, products_summary text, similarity_score numeric, matched_on_phone boolean, matched_on_same_day boolean, matched_on_items boolean, matched_on_address boolean, matched_on_shipping boolean, matched_on_name boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text := public.normalize_phone_eg(p_customer_phone);
  v_name text := public.normalize_match_text(p_customer_name);
  v_address text := public.normalize_match_text(p_delivery_address);
  v_shipping text := public.normalize_match_text(p_shipping_company);
  v_item_sig text := public.order_items_signature_from_json(p_items);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  RETURN QUERY
  WITH recent_orders AS (
    SELECT
      o.id AS o_id,
      o.order_number AS o_order_number,
      o.created_at AS o_created_at,
      o.status AS o_status,
      COALESCE(o.delivery_address, c.address) AS effective_delivery_address,
      o.shipping_company AS o_shipping_company,
      o.fulfillment_type AS o_fulfillment_type,
      c.name AS existing_customer_name,
      COALESCE(NULLIF(c.phone, ''), c.phone2) AS existing_customer_phone,
      public.normalize_phone_eg(c.phone) AS phone1_norm,
      public.normalize_phone_eg(c.phone2) AS phone2_norm,
      public.normalize_match_text(c.name) AS name_norm,
      public.normalize_match_text(COALESCE(o.delivery_address, c.address)) AS address_norm,
      public.normalize_match_text(COALESCE(o.shipping_company, '')) AS shipping_norm,
      public.order_items_signature_from_order(o.id) AS item_sig,
      public.order_items_summary_from_order(o.id) AS items_summary,
      pd.full_name AS existing_moderator_name,
      ((timezone('Africa/Cairo', o.created_at))::date = (timezone('Africa/Cairo', now()))::date) AS same_day
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    LEFT JOIN public.profile_directory pd ON pd.id = o.created_by
    WHERE COALESCE(o.status, '') <> 'cancelled'
      AND o.created_by IS DISTINCT FROM v_uid
      AND (
        o.created_at >= now() - interval '24 hours'
        OR (timezone('Africa/Cairo', o.created_at))::date = (timezone('Africa/Cairo', now()))::date
      )
  ),
  scored AS (
    SELECT
      ro.*,
      (v_phone <> '' AND (ro.phone1_norm = v_phone OR ro.phone2_norm = v_phone)) AS match_phone,
      ro.same_day AS match_same_day,
      (v_item_sig <> '' AND ro.item_sig <> '' AND ro.item_sig = v_item_sig) AS match_items,
      (v_address <> '' AND ro.address_norm <> '' AND ro.address_norm = v_address) AS match_address,
      (v_shipping <> '' AND ro.shipping_norm <> '' AND ro.shipping_norm = v_shipping) AS match_shipping,
      (v_name <> '' AND ro.name_norm <> '' AND (
        ro.name_norm = v_name
        OR ro.name_norm LIKE '%' || v_name || '%'
        OR v_name LIKE '%' || ro.name_norm || '%'
      )) AS match_name
    FROM recent_orders ro
  )
  SELECT
    s.o_id, s.o_order_number, s.existing_customer_name, s.existing_customer_phone,
    s.existing_moderator_name, s.o_created_at, s.o_status, s.effective_delivery_address,
    s.o_shipping_company, s.o_fulfillment_type, s.items_summary,
    round((
      CASE WHEN s.match_phone THEN 55 ELSE 0 END +
      CASE WHEN s.match_same_day THEN 20 ELSE 0 END +
      CASE WHEN s.match_items THEN 15 ELSE 0 END +
      CASE WHEN s.match_address THEN 5 ELSE 0 END +
      CASE WHEN s.match_shipping THEN 3 ELSE 0 END +
      CASE WHEN s.match_name THEN 2 ELSE 0 END
    )::numeric, 2) AS score,
    s.match_phone, s.match_same_day, s.match_items, s.match_address, s.match_shipping, s.match_name
  FROM scored s
  WHERE s.match_phone
     OR (s.match_same_day AND s.match_items AND (s.match_address OR s.match_shipping OR s.match_name))
  ORDER BY score DESC, s.o_created_at DESC
  LIMIT 10;
END;
$function$;
