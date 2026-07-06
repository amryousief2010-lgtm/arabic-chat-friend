-- 1) Only flag "another order today" when it was made by a DIFFERENT rep.
CREATE OR REPLACE FUNCTION public.customer_has_other_order_today(p_customer_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH target_customer AS (
    SELECT public.normalize_phone_eg(phone) AS phone1, public.normalize_phone_eg(phone2) AS phone2
    FROM public.customers
    WHERE id = p_customer_id
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    CROSS JOIN target_customer tc
    WHERE COALESCE(o.status, '') <> 'cancelled'
      AND o.created_by IS DISTINCT FROM p_user_id  -- only DIFFERENT rep counts as duplicate conflict
      AND (
        o.created_at >= now() - interval '24 hours'
        OR (timezone('Africa/Cairo', o.created_at))::date = (timezone('Africa/Cairo', now()))::date
      )
      AND (
        public.normalize_phone_eg(c.phone) IN (tc.phone1, tc.phone2)
        OR public.normalize_phone_eg(c.phone2) IN (tc.phone1, tc.phone2)
      )
  );
$function$;

-- 2) Candidates: exclude same-rep matches. Same rep re-ordering for the same
--    customer is legitimate business — not a duplicate.
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
      o.id,
      o.order_number,
      o.created_at,
      o.status,
      COALESCE(o.delivery_address, c.address) AS effective_delivery_address,
      o.shipping_company,
      o.fulfillment_type,
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
      AND o.created_by IS DISTINCT FROM v_uid  -- same rep = not a duplicate
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
    id, order_number, existing_customer_name, existing_customer_phone,
    existing_moderator_name, created_at, status, effective_delivery_address,
    shipping_company, fulfillment_type, items_summary,
    round((
      CASE WHEN match_phone THEN 55 ELSE 0 END +
      CASE WHEN match_same_day THEN 20 ELSE 0 END +
      CASE WHEN match_items THEN 15 ELSE 0 END +
      CASE WHEN match_address THEN 5 ELSE 0 END +
      CASE WHEN match_shipping THEN 3 ELSE 0 END +
      CASE WHEN match_name THEN 2 ELSE 0 END
    )::numeric, 2) AS score,
    match_phone, match_same_day, match_items, match_address, match_shipping, match_name
  FROM scored
  WHERE match_phone
     OR (match_same_day AND match_items AND (match_address OR match_shipping OR match_name))
  ORDER BY score DESC, created_at DESC
  LIMIT 10;
END;
$function$;

-- 3) check_duplicate_order_attempt: detect same-rep double-submit within 2 minutes
--    (same items, same phone) BEFORE the cross-rep duplicate check, and return
--    a distinct `is_double_submit` signal so the UI can show a simple prevention
--    message instead of a dual-approval flow.
CREATE OR REPLACE FUNCTION public.check_duplicate_order_attempt(p_customer_id uuid, p_customer_name text, p_customer_phone text, p_delivery_address text DEFAULT NULL::text, p_shipping_company text DEFAULT NULL::text, p_fulfillment_type text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_candidates jsonb := '[]'::jsonb;
  v_top record;
  v_attempt_id uuid;
  v_existing public.duplicate_order_approvals;
  v_proposed_order jsonb;
  v_item_sig text := public.order_items_signature_from_json(p_items);
  v_double_submit_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  -- Double-submit guard: same rep, same customer, same items, within 2 minutes.
  SELECT o.id INTO v_double_submit_id
  FROM public.orders o
  WHERE o.customer_id = p_customer_id
    AND o.created_by = v_uid
    AND COALESCE(o.status, '') <> 'cancelled'
    AND o.created_at >= now() - interval '2 minutes'
    AND (v_item_sig = '' OR public.order_items_signature_from_order(o.id) = v_item_sig)
  ORDER BY o.created_at DESC
  LIMIT 1;

  IF v_double_submit_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'is_duplicate', false,
      'is_double_submit', true,
      'double_submit_order_id', v_double_submit_id,
      'candidates', '[]'::jsonb,
      'attempt_id', NULL
    );
  END IF;

  -- Cross-rep candidates only (find_duplicate_order_candidates excludes same rep).
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'matched_order_id', c.matched_order_id,
        'order_number', c.order_number,
        'customer_name', c.customer_name,
        'customer_phone', c.customer_phone,
        'moderator_name', c.moderator_name,
        'created_at', c.created_at,
        'status', c.status,
        'delivery_address', c.delivery_address,
        'shipping_company', c.shipping_company,
        'fulfillment_type', c.fulfillment_type,
        'products_summary', c.products_summary,
        'similarity_score', c.similarity_score,
        'matched_on_phone', c.matched_on_phone,
        'matched_on_same_day', c.matched_on_same_day,
        'matched_on_items', c.matched_on_items,
        'matched_on_address', c.matched_on_address,
        'matched_on_shipping', c.matched_on_shipping,
        'matched_on_name', c.matched_on_name
      )
      ORDER BY c.similarity_score DESC, c.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_candidates
  FROM public.find_duplicate_order_candidates(
    p_customer_id, p_customer_name, p_customer_phone,
    p_delivery_address, p_shipping_company, p_fulfillment_type, p_items
  ) c;

  IF jsonb_array_length(v_candidates) = 0 THEN
    RETURN jsonb_build_object(
      'is_duplicate', false,
      'is_double_submit', false,
      'candidates', '[]'::jsonb,
      'attempt_id', NULL
    );
  END IF;

  SELECT *
  INTO v_top
  FROM public.find_duplicate_order_candidates(
    p_customer_id, p_customer_name, p_customer_phone,
    p_delivery_address, p_shipping_company, p_fulfillment_type, p_items
  )
  LIMIT 1;

  v_proposed_order := jsonb_build_object(
    'customer_name', p_customer_name,
    'customer_phone', public.normalize_phone_eg(p_customer_phone),
    'delivery_address', p_delivery_address,
    'shipping_company', p_shipping_company,
    'fulfillment_type', p_fulfillment_type,
    'note', p_note
  );

  INSERT INTO public.duplicate_order_attempt_audit (
    attempted_by, customer_id, customer_phone, matched_order_id,
    similarity_score, proposed_order, proposed_items, matched_order_snapshot, status
  )
  VALUES (
    v_uid, p_customer_id, public.normalize_phone_eg(p_customer_phone),
    v_top.matched_order_id, v_top.similarity_score,
    v_proposed_order, COALESCE(p_items, '[]'::jsonb), to_jsonb(v_top), 'detected'
  )
  RETURNING id INTO v_attempt_id;

  SELECT *
  INTO v_existing
  FROM public.duplicate_order_approvals
  WHERE requested_by = v_uid
    AND customer_id = p_customer_id
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'is_duplicate', true,
    'is_double_submit', false,
    'attempt_id', v_attempt_id,
    'candidates', v_candidates,
    'existing_request', CASE
      WHEN v_existing.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', v_existing.id,
        'status', v_existing.status,
        'reason', v_existing.reason,
        'created_at', v_existing.created_at,
        'decided_at', v_existing.decided_at,
        'matched_order_id', v_existing.matched_order_id,
        'duplicate_score', v_existing.duplicate_score
      )
    END
  );
END;
$function$;