DROP POLICY IF EXISTS "Moderator views own requests" ON public.duplicate_order_approvals;
CREATE POLICY "Duplicate approvals visible to requester or marketing manager"
  ON public.duplicate_order_approvals FOR SELECT TO authenticated
  USING (
    requested_by = auth.uid()
    OR public.has_role(auth.uid(), 'marketing_sales_manager'::app_role)
  );

DROP POLICY IF EXISTS "Manager updates requests" ON public.duplicate_order_approvals;
CREATE POLICY "Marketing manager updates duplicate approvals"
  ON public.duplicate_order_approvals FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'marketing_sales_manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'marketing_sales_manager'::app_role));

DROP POLICY IF EXISTS "Duplicate audit visible to owner and managers" ON public.duplicate_order_attempt_audit;
CREATE POLICY "Duplicate audit visible to owner or marketing manager"
  ON public.duplicate_order_attempt_audit FOR SELECT TO authenticated
  USING (
    attempted_by = auth.uid()
    OR public.has_role(auth.uid(), 'marketing_sales_manager'::app_role)
  );

CREATE OR REPLACE FUNCTION public.decide_duplicate_order_approval(
  p_id uuid,
  p_approve boolean,
  p_reason text DEFAULT NULL
)
RETURNS public.duplicate_order_approvals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.duplicate_order_approvals;
BEGIN
  IF NOT public.has_role(v_uid, 'marketing_sales_manager'::app_role) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  UPDATE public.duplicate_order_approvals
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      decided_by = v_uid,
      decided_at = now(),
      reason = p_reason,
      expires_at = CASE WHEN p_approve THEN now() + interval '24 hours' ELSE expires_at END
  WHERE id = p_id
  RETURNING * INTO v_row;

  UPDATE public.duplicate_order_attempt_audit
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      decision_by = v_uid,
      decision_reason = p_reason,
      decided_at = now(),
      updated_at = now()
  WHERE approval_id = v_row.id;

  INSERT INTO public.notifications (title, description, type, target_user_id)
  VALUES (
    CASE WHEN p_approve THEN 'تمت الموافقة على الطلب المكرر' ELSE 'تم رفض الطلب المكرر' END,
    COALESCE(p_reason, CASE WHEN p_approve THEN 'يمكنك تسجيل الطلب الآن.' ELSE 'لا يمكن تسجيل الطلب لأنه مكرر.' END),
    'duplicate_order_approval',
    v_row.requested_by
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.decide_duplicate_order_approval(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_duplicate_order_approval(uuid, boolean, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_potential_duplicate_orders_report(p_limit integer DEFAULT 200)
RETURNS TABLE (
  cairo_order_date date,
  shared_phone text,
  order_a_id uuid,
  order_a_number text,
  order_a_created_at timestamptz,
  order_a_customer_name text,
  moderator_a text,
  status_a text,
  products_a text,
  order_b_id uuid,
  order_b_number text,
  order_b_created_at timestamptz,
  order_b_customer_name text,
  moderator_b text,
  status_b text,
  products_b text,
  same_shipping boolean,
  same_address boolean,
  same_items boolean,
  similarity_score numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT public.has_role(auth.uid(), 'marketing_sales_manager'::app_role) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      o.id,
      o.order_number,
      o.created_at,
      o.status,
      (timezone('Africa/Cairo', o.created_at))::date AS cairo_day,
      public.normalize_phone_eg(COALESCE(NULLIF(c.phone, ''), c.phone2)) AS phone_norm,
      c.name AS customer_name,
      public.normalize_match_text(COALESCE(o.shipping_company, '')) AS shipping_norm,
      public.normalize_match_text(COALESCE(o.delivery_address, c.address)) AS address_norm,
      public.order_items_signature_from_order(o.id) AS item_sig,
      public.order_items_summary_from_order(o.id) AS items_summary,
      pd.full_name AS moderator_name
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    LEFT JOIN public.profile_directory pd ON pd.id = o.created_by
    WHERE COALESCE(o.status, '') <> 'cancelled'
  )
  SELECT
    a.cairo_day,
    a.phone_norm,
    a.id,
    a.order_number,
    a.created_at,
    a.customer_name,
    a.moderator_name,
    a.status,
    a.items_summary,
    b.id,
    b.order_number,
    b.created_at,
    b.customer_name,
    b.moderator_name,
    b.status,
    b.items_summary,
    (a.shipping_norm <> '' AND a.shipping_norm = b.shipping_norm) AS same_shipping,
    (a.address_norm <> '' AND a.address_norm = b.address_norm) AS same_address,
    (a.item_sig <> '' AND a.item_sig = b.item_sig) AS same_items,
    round((
      70 +
      CASE WHEN a.item_sig <> '' AND a.item_sig = b.item_sig THEN 15 ELSE 0 END +
      CASE WHEN a.shipping_norm <> '' AND a.shipping_norm = b.shipping_norm THEN 10 ELSE 0 END +
      CASE WHEN a.address_norm <> '' AND a.address_norm = b.address_norm THEN 5 ELSE 0 END
    )::numeric, 2) AS similarity_score
  FROM base a
  JOIN base b
    ON a.id < b.id
   AND a.cairo_day = b.cairo_day
   AND a.phone_norm <> ''
   AND a.phone_norm = b.phone_norm
  ORDER BY a.cairo_day DESC, similarity_score DESC, GREATEST(a.created_at, b.created_at) DESC
  LIMIT GREATEST(COALESCE(p_limit, 200), 1);
END;
$$;

REVOKE ALL ON FUNCTION public.get_potential_duplicate_orders_report(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_potential_duplicate_orders_report(integer) TO authenticated, service_role;