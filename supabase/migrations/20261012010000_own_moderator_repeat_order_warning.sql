-- Same-moderator repeat-order WARNING (confirm-only, no approval, no block).
--
-- Before: find_duplicate_order_candidates skips orders created by the caller
-- (o.created_by IS DISTINCT FROM v_uid), so a moderator who registers a second
-- order for the same phone (even on a new customer record) sees nothing.
-- Case: 01102626616 — ORD-20261005-011956 then ORD-20261008-368847, both by مريم.
--
-- After:
--   * Cross-moderator duplicates: unchanged (approval flow by م. آلاء حامد).
--   * Own prior orders (same phone, or same day + name + address), current Cairo
--     month or last 24h, not cancelled → check_duplicate_order_attempt returns
--     is_own_repeat = true + own_candidates. The app shows a confirm dialog; the
--     moderator must accept before the order is saved. Nothing is blocked
--     server-side and customer creation is untouched.
--   * Confirmation is logged in duplicate_order_attempt_audit
--     (own_repeat_detected → own_repeat_confirmed with the created order id).

-- 1) Audit statuses
ALTER TABLE public.duplicate_order_attempt_audit
  DROP CONSTRAINT IF EXISTS duplicate_order_attempt_audit_status_check;
ALTER TABLE public.duplicate_order_attempt_audit
  ADD CONSTRAINT duplicate_order_attempt_audit_status_check
  CHECK (status = ANY (ARRAY[
    'detected', 'request_created', 'approved', 'rejected', 'saved_with_approval',
    'own_repeat_detected', 'own_repeat_confirmed'
  ]::text[]));

-- 2) Caller's own prior orders (same matching rules as find_duplicate_order_candidates,
--    but ONLY orders created by the caller).
CREATE OR REPLACE FUNCTION public.find_own_repeat_order_candidates(
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_address text DEFAULT NULL::text,
  p_shipping_company text DEFAULT NULL::text,
  p_fulfillment_type text DEFAULT NULL::text,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE(
  matched_order_id uuid, order_number text, customer_name text, customer_phone text,
  moderator_name text, created_at timestamp with time zone, status text,
  delivery_address text, shipping_company text, fulfillment_type text,
  products_summary text, similarity_score numeric, matched_on_phone boolean,
  matched_on_same_day boolean, matched_on_items boolean, matched_on_address boolean,
  matched_on_shipping boolean, matched_on_name boolean
)
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
      AND o.created_by = v_uid
      AND (
        o.created_at >= now() - interval '24 hours'
        OR date_trunc('month', timezone('Africa/Cairo', o.created_at))
           = date_trunc('month', timezone('Africa/Cairo', now()))
      )
  ),
  scored AS (
    SELECT
      ro.*,
      (v_phone <> '' AND (ro.phone1_norm = v_phone OR ro.phone2_norm = v_phone)) AS match_phone,
      ro.same_day AS match_same_day,
      (v_item_sig <> '' AND ro.item_sig <> '' AND ro.item_sig = v_item_sig) AS match_items,
      (v_address <> '' AND ro.address_norm <> '' AND (
        ro.address_norm = v_address
        OR ro.address_norm LIKE '%' || v_address || '%'
        OR v_address LIKE '%' || ro.address_norm || '%'
      )) AS match_address,
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
    CASE
      WHEN s.match_phone THEN 100::numeric
      ELSE round((
        CASE WHEN s.match_name THEN 40 ELSE 0 END +
        CASE WHEN s.match_address THEN 40 ELSE 0 END +
        CASE WHEN s.match_same_day THEN 10 ELSE 0 END +
        CASE WHEN s.match_items THEN 5 ELSE 0 END +
        CASE WHEN s.match_shipping THEN 3 ELSE 0 END
      )::numeric, 2)
    END AS score,
    s.match_phone, s.match_same_day, s.match_items, s.match_address, s.match_shipping, s.match_name
  FROM scored s
  WHERE
    s.match_phone
    OR (s.match_same_day AND s.match_name AND s.match_address)
  ORDER BY score DESC, s.o_created_at DESC
  LIMIT 10;
END;
$function$;

REVOKE ALL ON FUNCTION public.find_own_repeat_order_candidates(uuid, text, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_own_repeat_order_candidates(uuid, text, text, text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.find_own_repeat_order_candidates(uuid, text, text, text, text, text, jsonb) TO authenticated, service_role;

-- 3) check_duplicate_order_attempt: add p_own_repeat_confirmed (default false).
--    Signature changes → drop the old 8-arg version so PostgREST has one match.
DROP FUNCTION IF EXISTS public.check_duplicate_order_attempt(uuid, text, text, text, text, text, jsonb, text);

CREATE OR REPLACE FUNCTION public.check_duplicate_order_attempt(
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_address text DEFAULT NULL::text,
  p_shipping_company text DEFAULT NULL::text,
  p_fulfillment_type text DEFAULT NULL::text,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_note text DEFAULT NULL::text,
  p_own_repeat_confirmed boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_candidates jsonb := '[]'::jsonb;
  v_own_candidates jsonb := '[]'::jsonb;
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

  -- Accidental double click (same customer record, same items, <2 min): unchanged.
  SELECT o.id INTO v_double_submit_id
  FROM public.orders o
  WHERE o.customer_id = p_customer_id
    AND o.created_by = v_uid
    AND COALESCE(o.status, '') <> 'cancelled'
    AND o.created_at >= now() - interval '2 minutes'
    AND public.order_items_signature_from_order(o.id) = v_item_sig
  LIMIT 1;

  IF v_double_submit_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'is_duplicate', false,
      'is_double_submit', true,
      'is_own_repeat', false,
      'double_submit_order_id', v_double_submit_id,
      'candidates', '[]'::jsonb,
      'own_candidates', '[]'::jsonb,
      'attempt_id', NULL
    );
  END IF;

  v_proposed_order := jsonb_build_object(
    'customer_name', p_customer_name,
    'customer_phone', public.normalize_phone_eg(p_customer_phone),
    'delivery_address', p_delivery_address,
    'shipping_company', p_shipping_company,
    'fulfillment_type', p_fulfillment_type,
    'note', p_note
  );

  -- Cross-moderator duplicates (approval flow) — unchanged.
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
    -- No cross-moderator match. Warn about the caller's own prior orders
    -- unless she already confirmed this attempt.
    IF NOT COALESCE(p_own_repeat_confirmed, false) THEN
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
      INTO v_own_candidates
      FROM public.find_own_repeat_order_candidates(
        p_customer_id, p_customer_name, p_customer_phone,
        p_delivery_address, p_shipping_company, p_fulfillment_type, p_items
      ) c;

      IF jsonb_array_length(v_own_candidates) > 0 THEN
        INSERT INTO public.duplicate_order_attempt_audit (
          attempted_by, customer_id, customer_phone, matched_order_id,
          similarity_score, proposed_order, proposed_items, matched_order_snapshot, status
        )
        VALUES (
          v_uid, p_customer_id, public.normalize_phone_eg(p_customer_phone),
          (v_own_candidates->0->>'matched_order_id')::uuid,
          (v_own_candidates->0->>'similarity_score')::numeric,
          v_proposed_order, COALESCE(p_items, '[]'::jsonb),
          v_own_candidates->0, 'own_repeat_detected'
        )
        RETURNING id INTO v_attempt_id;

        RETURN jsonb_build_object(
          'is_duplicate', false,
          'is_double_submit', false,
          'is_own_repeat', true,
          'attempt_id', v_attempt_id,
          'candidates', '[]'::jsonb,
          'own_candidates', v_own_candidates
        );
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'is_duplicate', false,
      'is_double_submit', false,
      'is_own_repeat', false,
      'candidates', '[]'::jsonb,
      'own_candidates', '[]'::jsonb,
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
    AND (status <> 'approved' OR resolved_order_id IS NULL)
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'is_duplicate', true,
    'is_double_submit', false,
    'is_own_repeat', false,
    'attempt_id', v_attempt_id,
    'candidates', v_candidates,
    'own_candidates', '[]'::jsonb,
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

REVOKE ALL ON FUNCTION public.check_duplicate_order_attempt(uuid, text, text, text, text, text, jsonb, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_duplicate_order_attempt(uuid, text, text, text, text, text, jsonb, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_duplicate_order_attempt(uuid, text, text, text, text, text, jsonb, text, boolean) TO authenticated, service_role;

-- 4) Log the moderator's confirmation and link the created order.
CREATE OR REPLACE FUNCTION public.confirm_own_repeat_order_attempt(p_attempt_id uuid, p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_count int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  UPDATE public.duplicate_order_attempt_audit a
  SET status = 'own_repeat_confirmed',
      decision_by = v_uid,
      decided_at = now(),
      decision_reason = 'أكدت المودريتور إن ده أوردر جديد مقصود لنفس العميل',
      proposed_order = COALESCE(a.proposed_order, '{}'::jsonb)
                       || jsonb_build_object('created_order_id', p_order_id),
      updated_at = now()
  WHERE a.id = p_attempt_id
    AND a.attempted_by = v_uid
    AND a.status = 'own_repeat_detected'
    AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order_id AND o.created_by = v_uid);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_own_repeat_order_attempt(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_own_repeat_order_attempt(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_own_repeat_order_attempt(uuid, uuid) TO authenticated, service_role;
