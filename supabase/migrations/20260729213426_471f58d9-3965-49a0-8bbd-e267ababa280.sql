-- 1) Monthly duplicate helper (phone-based, Cairo month, different rep)
CREATE OR REPLACE FUNCTION public.customer_has_other_order_this_month(p_customer_id uuid, p_user_id uuid)
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
      AND o.created_by IS DISTINCT FROM p_user_id
      AND date_trunc('month', timezone('Africa/Cairo', o.created_at))
          = date_trunc('month', timezone('Africa/Cairo', now()))
      AND (
        (NULLIF(tc.phone1,'') IS NOT NULL AND public.normalize_phone_eg(c.phone) = tc.phone1)
        OR (NULLIF(tc.phone2,'') IS NOT NULL AND public.normalize_phone_eg(c.phone) = tc.phone2)
        OR (NULLIF(tc.phone1,'') IS NOT NULL AND public.normalize_phone_eg(c.phone2) = tc.phone1)
        OR (NULLIF(tc.phone2,'') IS NOT NULL AND public.normalize_phone_eg(c.phone2) = tc.phone2)
      )
  );
$function$;

GRANT EXECUTE ON FUNCTION public.customer_has_other_order_this_month(uuid, uuid) TO authenticated, service_role;

-- 2) Enforcement: block moderators when same phone ordered this month with another rep
CREATE OR REPLACE FUNCTION public.enforce_duplicate_order_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := NEW.created_by;
BEGIN
  IF v_uid IS NULL OR NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.has_role(v_uid, 'sales_moderator'::app_role) THEN
    RETURN NEW;
  END IF;

  IF public.customer_has_other_order_this_month(NEW.customer_id, v_uid)
     AND NOT public.has_approved_duplicate_order(NEW.customer_id, v_uid) THEN
    RAISE EXCEPTION 'DUPLICATE_ORDER_REQUIRES_APPROVAL: هذا العميل (نفس رقم الهاتف) لديه طلب مسجل هذا الشهر مع مسوقة أخرى. لا يمكن تسجيل الطلب إلا بموافقة م. آلاء حامد.';
  END IF;

  RETURN NEW;
END;
$function$;

-- 3) Candidate search window extended to the current Cairo month for phone matches
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

-- 4) Marketing sales manager decision is final (single approver)
CREATE OR REPLACE FUNCTION public.decide_duplicate_order_approval(p_id uuid, p_approve boolean, p_reason text DEFAULT NULL::text)
RETURNS duplicate_order_approvals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_marketing boolean := public.has_role(v_uid, 'marketing_sales_manager'::app_role)
                         OR public.has_role(v_uid, 'sales_manager'::app_role);
  v_is_executive boolean := public.has_role(v_uid, 'executive_manager'::app_role)
                          OR public.has_role(v_uid, 'general_manager'::app_role);
  v_row public.duplicate_order_approvals;
  v_final_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  IF NOT (v_is_marketing OR v_is_executive) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT * INTO v_row FROM public.duplicate_order_approvals WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPROVAL_NOT_FOUND';
  END IF;
  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'ALREADY_DECIDED';
  END IF;

  v_final_status := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;

  UPDATE public.duplicate_order_approvals
  SET marketing_decision = CASE WHEN v_is_marketing THEN v_final_status ELSE marketing_decision END,
      marketing_decided_by = CASE WHEN v_is_marketing THEN v_uid ELSE marketing_decided_by END,
      marketing_decided_at = CASE WHEN v_is_marketing THEN now() ELSE marketing_decided_at END,
      marketing_reason = CASE WHEN v_is_marketing THEN p_reason ELSE marketing_reason END,
      executive_decision = CASE WHEN NOT v_is_marketing THEN v_final_status ELSE executive_decision END,
      executive_decided_by = CASE WHEN NOT v_is_marketing THEN v_uid ELSE executive_decided_by END,
      executive_decided_at = CASE WHEN NOT v_is_marketing THEN now() ELSE executive_decided_at END,
      executive_reason = CASE WHEN NOT v_is_marketing THEN p_reason ELSE executive_reason END,
      status = v_final_status,
      decided_by = v_uid,
      decided_at = now(),
      reason = p_reason,
      expires_at = CASE WHEN v_final_status = 'approved' THEN now() + interval '24 hours' ELSE expires_at END,
      updated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_row;

  UPDATE public.duplicate_order_attempt_audit
  SET status = v_final_status,
      decision_by = v_uid,
      decision_reason = p_reason,
      decided_at = now(),
      updated_at = now()
  WHERE approval_id = v_row.id;

  IF v_final_status = 'approved' THEN
    INSERT INTO public.notifications (title, description, type, target_user_id)
    VALUES ('تمت الموافقة على الطلب المكرر',
            COALESCE(p_reason, 'تمت موافقة م. آلاء حامد. يمكنك تسجيل الطلب الآن.'),
            'duplicate_order_approval', v_row.requested_by);
  ELSE
    INSERT INTO public.notifications (title, description, type, target_user_id)
    VALUES ('تم رفض الطلب المكرر',
            COALESCE(p_reason, 'تم رفض تسجيل الطلب المكرر.'),
            'duplicate_order_approval', v_row.requested_by);
  END IF;

  RETURN v_row;
END;
$function$;