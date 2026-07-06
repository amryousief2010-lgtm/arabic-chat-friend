
CREATE OR REPLACE FUNCTION public.check_duplicate_order_attempt(
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_address text DEFAULT NULL::text,
  p_shipping_company text DEFAULT NULL::text,
  p_fulfillment_type text DEFAULT NULL::text,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_note text DEFAULT NULL::text
)
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
      'double_submit_order_id', v_double_submit_id,
      'candidates', '[]'::jsonb,
      'attempt_id', NULL
    );
  END IF;

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
    AND (status <> 'approved' OR resolved_order_id IS NULL)
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
