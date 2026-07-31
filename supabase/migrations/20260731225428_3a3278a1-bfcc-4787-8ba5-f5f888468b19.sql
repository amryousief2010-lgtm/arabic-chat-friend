CREATE OR REPLACE FUNCTION public.decide_duplicate_order_approval(p_id uuid, p_approve boolean, p_reason text DEFAULT NULL::text)
 RETURNS duplicate_order_approvals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_marketing boolean := public.has_role(v_uid, 'marketing_sales_manager'::app_role)
                         OR public.has_role(v_uid, 'general_manager'::app_role);
  v_row public.duplicate_order_approvals;
  v_final_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  IF NOT v_is_marketing THEN
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
  SET marketing_decision = v_final_status,
      marketing_decided_by = v_uid,
      marketing_decided_at = now(),
      marketing_reason = p_reason,
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

CREATE OR REPLACE FUNCTION public.request_duplicate_order_approval(p_customer_id uuid, p_note text DEFAULT NULL::text, p_matched_order_id uuid DEFAULT NULL::uuid, p_duplicate_score numeric DEFAULT NULL::numeric, p_proposed_order jsonb DEFAULT '{}'::jsonb, p_proposed_items jsonb DEFAULT '[]'::jsonb, p_attempt_audit_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_existing uuid;
  v_cust_name text;
  v_moderator_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT id INTO v_existing
  FROM public.duplicate_order_approvals
  WHERE customer_id = p_customer_id
    AND requested_by = v_uid
    AND status = 'pending'
    AND expires_at > now()
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.duplicate_order_approvals
    SET note = COALESCE(NULLIF(trim(p_note), ''), note),
        matched_order_id = COALESCE(p_matched_order_id, matched_order_id),
        duplicate_score = COALESCE(p_duplicate_score, duplicate_score),
        proposed_order = CASE WHEN p_proposed_order = '{}'::jsonb THEN proposed_order ELSE p_proposed_order END,
        proposed_items = CASE WHEN p_proposed_items = '[]'::jsonb THEN proposed_items ELSE p_proposed_items END,
        updated_at = now()
    WHERE id = v_existing;

    v_id := v_existing;
  ELSE
    INSERT INTO public.duplicate_order_approvals (
      customer_id, requested_by, note, matched_order_id, duplicate_score, proposed_order, proposed_items
    )
    VALUES (
      p_customer_id, v_uid, p_note, p_matched_order_id, p_duplicate_score,
      COALESCE(p_proposed_order, '{}'::jsonb), COALESCE(p_proposed_items, '[]'::jsonb)
    )
    RETURNING id INTO v_id;

    SELECT name INTO v_cust_name FROM public.customers WHERE id = p_customer_id;
    SELECT full_name INTO v_moderator_name FROM public.profiles WHERE id = v_uid;

    INSERT INTO public.notifications (title, description, type, target_user_id)
    SELECT
      'طلب موافقة تسجيل أوردر مكرر',
      'المودريتور ' || COALESCE(v_moderator_name, '—') || ' تطلب موافقة لتسجيل طلب مكرر للعميل ' || COALESCE(v_cust_name, '—') ||
        CASE WHEN p_note IS NOT NULL AND length(trim(p_note)) > 0 THEN ' — ' || p_note ELSE '' END,
      'duplicate_order_approval',
      ur.user_id
    FROM public.user_roles ur
    WHERE ur.role IN ('marketing_sales_manager', 'general_manager');
  END IF;

  IF p_attempt_audit_id IS NOT NULL THEN
    UPDATE public.duplicate_order_attempt_audit
    SET approval_id = v_id,
        status = 'request_created',
        updated_at = now()
    WHERE id = p_attempt_audit_id
      AND attempted_by = v_uid;
  END IF;

  RETURN v_id;
END;
$function$;