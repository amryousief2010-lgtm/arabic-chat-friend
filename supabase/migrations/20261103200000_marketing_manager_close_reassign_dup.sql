-- GM decision 2026-11-03: a user whose roles are marketing_sales_manager without
-- sales_manager (Mohamed Sayed) may not reassign order owners or decide duplicate
-- order approvals. Alaa (marketing_sales_manager + sales_manager), GM and executive
-- manager keep their access unchanged.
CREATE OR REPLACE FUNCTION public.decide_duplicate_order_approval(p_id uuid, p_approve boolean, p_reason text DEFAULT NULL::text)
 RETURNS duplicate_order_approvals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_marketing boolean := (public.has_role(v_uid, 'marketing_sales_manager'::app_role) AND public.has_role(v_uid, 'sales_manager'::app_role))
                         OR public.has_role(v_uid, 'general_manager'::app_role);
  v_row public.duplicate_order_approvals;
  v_final_status text;
  v_order_id uuid;
  v_order_number text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT v_is_marketing THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT * INTO v_row FROM public.duplicate_order_approvals WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'APPROVAL_NOT_FOUND'; END IF;
  IF v_row.status <> 'pending' THEN RAISE EXCEPTION 'ALREADY_DECIDED'; END IF;

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
    BEGIN
      v_order_id := public.create_order_from_duplicate_approval(v_row.id);
    EXCEPTION WHEN OTHERS THEN
      v_order_id := NULL;
    END;

    IF v_order_id IS NOT NULL THEN
      SELECT order_number INTO v_order_number FROM public.orders WHERE id = v_order_id;
      SELECT * INTO v_row FROM public.duplicate_order_approvals WHERE id = p_id;
      INSERT INTO public.notifications (title, description, type, target_user_id, order_id)
      VALUES ('تمت الموافقة وتسجيل الأوردر',
              COALESCE(p_reason, '') || ' تم تسجيل الأوردر رقم ' || COALESCE(v_order_number, '') || ' تلقائياً بعد موافقة م. آلاء حامد.',
              'duplicate_order_approval', v_row.requested_by, v_order_id);
    ELSE
      INSERT INTO public.notifications (title, description, type, target_user_id)
      VALUES ('تمت الموافقة على الطلب المكرر',
              COALESCE(p_reason, 'تمت موافقة م. آلاء حامد. يمكنك تسجيل الطلب الآن.'),
              'duplicate_order_approval', v_row.requested_by);
    END IF;
  ELSE
    INSERT INTO public.notifications (title, description, type, target_user_id)
    VALUES ('تم رفض الطلب المكرر',
            COALESCE(p_reason, 'تم رفض تسجيل الطلب المكرر.'),
            'duplicate_order_approval', v_row.requested_by);
  END IF;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reassign_order_owner(p_order_id uuid, p_new_owner_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_old_owner uuid;
  v_order_number text;
  v_new_name text;
  v_old_name text;
  v_caller_name text;
  v_audit_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT (public.has_any_role(v_caller, ARRAY['general_manager','executive_manager']::app_role[])
          OR (public.has_role(v_caller, 'marketing_sales_manager'::app_role) AND public.has_role(v_caller, 'sales_manager'::app_role))) THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  IF p_new_owner_id IS NULL THEN
    RAISE EXCEPTION 'new_owner_required';
  END IF;

  SELECT created_by, order_number INTO v_old_owner, v_order_number
  FROM public.orders WHERE id = p_order_id;

  IF v_order_number IS NULL THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  IF v_old_owner = p_new_owner_id THEN
    RAISE EXCEPTION 'same_owner';
  END IF;

  -- Only allow reassigning to a user with a sales-related role
  IF NOT public.has_any_role(
    p_new_owner_id,
    ARRAY['sales_moderator','sales_manager','marketing_sales_manager']::app_role[]
  ) THEN
    RAISE EXCEPTION 'invalid_new_owner_role';
  END IF;

  SELECT full_name INTO v_new_name FROM public.profile_directory WHERE id = p_new_owner_id;
  SELECT full_name INTO v_old_name FROM public.profile_directory WHERE id = v_old_owner;
  SELECT full_name INTO v_caller_name FROM public.profile_directory WHERE id = v_caller;

  UPDATE public.orders
  SET created_by = p_new_owner_id,
      moderator = COALESCE(v_new_name, moderator)
  WHERE id = p_order_id;

  INSERT INTO public.order_owner_reassignment_audit
    (order_id, order_number, old_owner_id, old_owner_name, new_owner_id, new_owner_name, reason, changed_by, changed_by_name)
  VALUES
    (p_order_id, v_order_number, v_old_owner, v_old_name, p_new_owner_id, v_new_name, btrim(p_reason), v_caller, v_caller_name)
  RETURNING id INTO v_audit_id;

  RETURN v_audit_id;
END;
$function$;

