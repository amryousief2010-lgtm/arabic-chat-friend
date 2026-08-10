CREATE OR REPLACE FUNCTION public.create_order_from_duplicate_approval(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.duplicate_order_approvals;
  v_po jsonb;
  v_items jsonb;
  v_order_id uuid;
  v_order_number text;
  v_moderator text;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_delivery_fee numeric := 0;
  v_extra numeric := 0;
  v_total numeric := 0;
  v_it jsonb;
  v_qty numeric;
  v_price numeric;
BEGIN
  SELECT * INTO v_row FROM public.duplicate_order_approvals WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'APPROVAL_NOT_FOUND'; END IF;
  IF v_row.resolved_order_id IS NOT NULL THEN RETURN v_row.resolved_order_id; END IF;

  v_po := COALESCE(v_row.proposed_order, '{}'::jsonb);
  v_items := COALESCE(v_row.proposed_items, '[]'::jsonb);
  IF jsonb_array_length(v_items) = 0 THEN
    RETURN NULL; -- nothing to build; moderator will register manually
  END IF;

  FOR v_it IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    v_qty := COALESCE((v_it->>'quantity')::numeric, 0);
    v_price := COALESCE((v_it->>'unit_price')::numeric, 0);
    v_subtotal := v_subtotal + ROUND(v_qty * v_price, 2);
  END LOOP;

  v_discount := COALESCE((v_po->>'discount')::numeric, 0);
  v_delivery_fee := COALESCE((v_po->>'delivery_fee')::numeric, 0);
  v_extra := COALESCE((v_po->>'extra_charge')::numeric, 0);
  v_total := v_subtotal - v_discount + v_delivery_fee + v_extra;

  SELECT full_name INTO v_moderator FROM public.profiles WHERE id = v_row.requested_by;
  v_order_number := public.generate_order_number();

  INSERT INTO public.orders (
    order_number, customer_id, payment_method, subtotal, discount, delivery_fee, total,
    notes, delivery_address, created_by, moderator, source, shipping_company,
    extra_charge, extra_charge_reason, fulfillment_type, source_warehouse_id,
    duplicate_approval_id, is_duplicate_approved, duplicate_approved_by,
    duplicate_approved_at, duplicate_approval_reason
  ) VALUES (
    v_order_number,
    v_row.customer_id,
    COALESCE(NULLIF(v_po->>'payment_method',''), 'cash'),
    v_subtotal, v_discount, v_delivery_fee, v_total,
    COALESCE(NULLIF(v_po->>'note',''), v_row.note),
    NULLIF(v_po->>'delivery_address',''),
    v_row.requested_by,
    COALESCE(NULLIF(v_po->>'moderator',''), v_moderator),
    NULLIF(v_po->>'source',''),
    NULLIF(v_po->>'shipping_company',''),
    v_extra,
    NULLIF(v_po->>'extra_charge_reason',''),
    NULLIF(v_po->>'fulfillment_type',''),
    NULLIF(v_po->>'source_warehouse_id','')::uuid,
    v_row.id, true, COALESCE(v_row.marketing_decided_by, v_row.decided_by),
    COALESCE(v_row.marketing_decided_at, v_row.decided_at), v_row.reason
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price, is_half_kg, offer_name)
  SELECT v_order_id,
         (it->>'product_id')::uuid,
         it->>'product_name',
         COALESCE((it->>'quantity')::numeric, 0),
         COALESCE((it->>'unit_price')::numeric, 0),
         ROUND(COALESCE((it->>'quantity')::numeric,0) * COALESCE((it->>'unit_price')::numeric,0), 2),
         COALESCE((it->>'is_half_kg')::boolean, false),
         NULLIF(it->>'offer_name','')
  FROM jsonb_array_elements(v_items) AS it
  WHERE (it->>'product_id') IS NOT NULL;

  UPDATE public.duplicate_order_approvals
  SET resolved_order_id = v_order_id, updated_at = now()
  WHERE id = v_row.id;

  UPDATE public.duplicate_order_attempt_audit
  SET status = 'saved_with_approval', updated_at = now()
  WHERE approval_id = v_row.id;

  UPDATE public.customers
  SET total_orders = COALESCE(total_orders,0) + 1,
      total_spent = COALESCE(total_spent,0) + v_total
  WHERE id = v_row.customer_id;

  BEGIN
    PERFORM public.reserve_agouza_stock_for_order(v_order_id);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_duplicate_order_approval(p_id uuid, p_approve boolean, p_reason text DEFAULT NULL)
RETURNS public.duplicate_order_approvals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_marketing boolean := public.has_role(v_uid, 'marketing_sales_manager'::app_role)
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
$$;