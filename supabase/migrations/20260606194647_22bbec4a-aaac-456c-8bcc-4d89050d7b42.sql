ALTER TABLE public.duplicate_order_approvals
  ADD COLUMN IF NOT EXISTS matched_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS duplicate_score numeric(5,2),
  ADD COLUMN IF NOT EXISTS proposed_order jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS proposed_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS resolved_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_duplicate_order_approvals_matched_order_id
  ON public.duplicate_order_approvals(matched_order_id);
CREATE INDEX IF NOT EXISTS idx_duplicate_order_approvals_resolved_order_id
  ON public.duplicate_order_approvals(resolved_order_id);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS duplicate_approval_id uuid REFERENCES public.duplicate_order_approvals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_duplicate_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS duplicate_approved_by uuid,
  ADD COLUMN IF NOT EXISTS duplicate_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS duplicate_approval_reason text;

CREATE TABLE IF NOT EXISTS public.duplicate_order_attempt_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempted_by uuid NOT NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_phone text,
  matched_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  approval_id uuid REFERENCES public.duplicate_order_approvals(id) ON DELETE SET NULL,
  similarity_score numeric(5,2),
  proposed_order jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposed_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  matched_order_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'detected' CHECK (status IN ('detected','request_created','approved','rejected','saved_with_approval')),
  decision_by uuid,
  decision_reason text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.duplicate_order_attempt_audit TO authenticated;
GRANT ALL ON public.duplicate_order_attempt_audit TO service_role;
ALTER TABLE public.duplicate_order_attempt_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Duplicate audit visible to owner and managers"
  ON public.duplicate_order_attempt_audit
  FOR SELECT
  TO authenticated
  USING (
    attempted_by = auth.uid()
    OR public.has_any_role(auth.uid(), ARRAY[
      'marketing_sales_manager'::app_role,
      'sales_manager'::app_role,
      'general_manager'::app_role,
      'executive_manager'::app_role
    ])
  );
CREATE TRIGGER trg_duplicate_order_attempt_audit_updated_at
  BEFORE UPDATE ON public.duplicate_order_attempt_audit
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.normalize_phone_eg(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  s text := COALESCE(input, '');
BEGIN
  s := translate(s, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  s := regexp_replace(trim(s), '[^0-9+]', '', 'g');

  IF s LIKE '+20%' THEN
    s := substr(s, 4);
  ELSIF s LIKE '0020%' THEN
    s := substr(s, 5);
  ELSIF s ~ '^20[0-9]{10}$' THEN
    s := substr(s, 3);
  END IF;

  IF s ~ '^1[0-9]{9}$' THEN
    s := '0' || s;
  END IF;

  RETURN s;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_match_text(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT trim(regexp_replace(lower(COALESCE(input, '')), '\s+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.order_items_signature_from_json(p_items jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    string_agg(
      DISTINCT public.normalize_match_text(
        COALESCE(
          NULLIF(elem->>'offer_name', ''),
          NULLIF(elem->>'offerBoxName', ''),
          NULLIF(elem->>'product_name', ''),
          NULLIF(elem->>'name', '')
        )
      ),
      '|' ORDER BY public.normalize_match_text(
        COALESCE(
          NULLIF(elem->>'offer_name', ''),
          NULLIF(elem->>'offerBoxName', ''),
          NULLIF(elem->>'product_name', ''),
          NULLIF(elem->>'name', '')
        )
      )
    ),
    ''
  )
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) elem
  WHERE trim(COALESCE(
    NULLIF(elem->>'offer_name', ''),
    NULLIF(elem->>'offerBoxName', ''),
    NULLIF(elem->>'product_name', ''),
    NULLIF(elem->>'name', '')
  )) <> '';
$$;

CREATE OR REPLACE FUNCTION public.order_items_summary_from_json(p_items jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(string_agg(item_label, '، ' ORDER BY item_label), '')
  FROM (
    SELECT DISTINCT
      trim(COALESCE(
        NULLIF(elem->>'offer_name', ''),
        NULLIF(elem->>'offerBoxName', ''),
        NULLIF(elem->>'product_name', ''),
        NULLIF(elem->>'name', '')
      ))
      || CASE
        WHEN NULLIF(trim(COALESCE(elem->>'quantity', '')), '') IS NOT NULL
          THEN ' × ' || trim(elem->>'quantity')
        ELSE ''
      END AS item_label
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) elem
    WHERE trim(COALESCE(
      NULLIF(elem->>'offer_name', ''),
      NULLIF(elem->>'offerBoxName', ''),
      NULLIF(elem->>'product_name', ''),
      NULLIF(elem->>'name', '')
    )) <> ''
  ) s;
$$;

CREATE OR REPLACE FUNCTION public.order_items_signature_from_order(p_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    string_agg(
      DISTINCT public.normalize_match_text(COALESCE(NULLIF(oi.offer_name, ''), oi.product_name)),
      '|' ORDER BY public.normalize_match_text(COALESCE(NULLIF(oi.offer_name, ''), oi.product_name))
    ),
    ''
  )
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;
$$;

CREATE OR REPLACE FUNCTION public.order_items_summary_from_order(p_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(string_agg(item_label, '، ' ORDER BY item_label), '')
  FROM (
    SELECT DISTINCT
      trim(COALESCE(NULLIF(oi.offer_name, ''), oi.product_name))
      || ' × ' || trim(to_char(oi.quantity, 'FM999999990.##')) AS item_label
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
  ) s;
$$;

CREATE OR REPLACE FUNCTION public.find_duplicate_order_candidates(
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_address text DEFAULT NULL,
  p_shipping_company text DEFAULT NULL,
  p_fulfillment_type text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE (
  matched_order_id uuid,
  order_number text,
  customer_name text,
  customer_phone text,
  moderator_name text,
  created_at timestamptz,
  status text,
  delivery_address text,
  shipping_company text,
  fulfillment_type text,
  products_summary text,
  similarity_score numeric,
  matched_on_phone boolean,
  matched_on_same_day boolean,
  matched_on_items boolean,
  matched_on_address boolean,
  matched_on_shipping boolean,
  matched_on_name boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text := public.normalize_phone_eg(p_customer_phone);
  v_name text := public.normalize_match_text(p_customer_name);
  v_address text := public.normalize_match_text(p_delivery_address);
  v_shipping text := public.normalize_match_text(p_shipping_company);
  v_item_sig text := public.order_items_signature_from_json(p_items);
BEGIN
  IF auth.uid() IS NULL THEN
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
    id,
    order_number,
    existing_customer_name,
    existing_customer_phone,
    existing_moderator_name,
    created_at,
    status,
    effective_delivery_address,
    shipping_company,
    fulfillment_type,
    items_summary,
    round((
      CASE WHEN match_phone THEN 55 ELSE 0 END +
      CASE WHEN match_same_day THEN 20 ELSE 0 END +
      CASE WHEN match_items THEN 15 ELSE 0 END +
      CASE WHEN match_address THEN 5 ELSE 0 END +
      CASE WHEN match_shipping THEN 3 ELSE 0 END +
      CASE WHEN match_name THEN 2 ELSE 0 END
    )::numeric, 2) AS score,
    match_phone,
    match_same_day,
    match_items,
    match_address,
    match_shipping,
    match_name
  FROM scored
  WHERE match_phone
     OR (match_same_day AND match_items AND (match_address OR match_shipping OR match_name))
  ORDER BY score DESC, created_at DESC
  LIMIT 10;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_duplicate_order_attempt(
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_address text DEFAULT NULL,
  p_shipping_company text DEFAULT NULL,
  p_fulfillment_type text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_candidates jsonb := '[]'::jsonb;
  v_top record;
  v_attempt_id uuid;
  v_existing public.duplicate_order_approvals;
  v_proposed_order jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
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
    p_customer_id,
    p_customer_name,
    p_customer_phone,
    p_delivery_address,
    p_shipping_company,
    p_fulfillment_type,
    p_items
  ) c;

  IF jsonb_array_length(v_candidates) = 0 THEN
    RETURN jsonb_build_object(
      'is_duplicate', false,
      'candidates', '[]'::jsonb,
      'attempt_id', NULL
    );
  END IF;

  SELECT *
  INTO v_top
  FROM public.find_duplicate_order_candidates(
    p_customer_id,
    p_customer_name,
    p_customer_phone,
    p_delivery_address,
    p_shipping_company,
    p_fulfillment_type,
    p_items
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
    attempted_by,
    customer_id,
    customer_phone,
    matched_order_id,
    similarity_score,
    proposed_order,
    proposed_items,
    matched_order_snapshot,
    status
  )
  VALUES (
    v_uid,
    p_customer_id,
    public.normalize_phone_eg(p_customer_phone),
    v_top.matched_order_id,
    v_top.similarity_score,
    v_proposed_order,
    COALESCE(p_items, '[]'::jsonb),
    to_jsonb(v_top),
    'detected'
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
$$;

CREATE OR REPLACE FUNCTION public.request_duplicate_order_approval(
  p_customer_id uuid,
  p_note text DEFAULT NULL,
  p_matched_order_id uuid DEFAULT NULL,
  p_duplicate_score numeric DEFAULT NULL,
  p_proposed_order jsonb DEFAULT '{}'::jsonb,
  p_proposed_items jsonb DEFAULT '[]'::jsonb,
  p_attempt_audit_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      customer_id,
      requested_by,
      note,
      matched_order_id,
      duplicate_score,
      proposed_order,
      proposed_items
    )
    VALUES (
      p_customer_id,
      v_uid,
      p_note,
      p_matched_order_id,
      p_duplicate_score,
      COALESCE(p_proposed_order, '{}'::jsonb),
      COALESCE(p_proposed_items, '[]'::jsonb)
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
    WHERE ur.role IN ('marketing_sales_manager', 'general_manager', 'executive_manager');
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
$$;

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
  IF NOT public.has_any_role(v_uid, ARRAY[
    'marketing_sales_manager'::app_role,
    'general_manager'::app_role,
    'executive_manager'::app_role
  ]) THEN
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

CREATE OR REPLACE FUNCTION public.mark_duplicate_order_approval_used(
  p_id uuid,
  p_order_id uuid
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
  SELECT * INTO v_row
  FROM public.duplicate_order_approvals
  WHERE id = p_id;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'APPROVAL_NOT_FOUND';
  END IF;

  IF v_row.requested_by <> v_uid
     AND NOT public.has_any_role(v_uid, ARRAY[
       'marketing_sales_manager'::app_role,
       'general_manager'::app_role,
       'executive_manager'::app_role,
       'sales_manager'::app_role
     ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  UPDATE public.duplicate_order_approvals
  SET resolved_order_id = p_order_id,
      updated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_row;

  UPDATE public.duplicate_order_attempt_audit
  SET status = 'saved_with_approval',
      updated_at = now()
  WHERE approval_id = p_id;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_has_other_order_today(p_customer_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
      AND (
        o.created_at >= now() - interval '24 hours'
        OR (timezone('Africa/Cairo', o.created_at))::date = (timezone('Africa/Cairo', now()))::date
      )
      AND (
        public.normalize_phone_eg(c.phone) IN (tc.phone1, tc.phone2)
        OR public.normalize_phone_eg(c.phone2) IN (tc.phone1, tc.phone2)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.enforce_duplicate_order_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := NEW.created_by;
BEGIN
  IF v_uid IS NULL OR NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.has_role(v_uid, 'sales_moderator'::app_role) THEN
    RETURN NEW;
  END IF;

  IF public.customer_has_other_order_today(NEW.customer_id, v_uid)
     AND NOT public.has_approved_duplicate_order(NEW.customer_id, v_uid) THEN
    RAISE EXCEPTION 'DUPLICATE_ORDER_REQUIRES_APPROVAL: يوجد طلب مشابه مسجل بالفعل لهذا العميل اليوم. لا يمكن تسجيل الطلب مرة أخرى إلا بموافقة مديرة التسويق.';
  END IF;

  RETURN NEW;
END;
$$;

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

  IF NOT public.has_any_role(auth.uid(), ARRAY[
    'marketing_sales_manager'::app_role,
    'sales_manager'::app_role,
    'general_manager'::app_role,
    'executive_manager'::app_role
  ]) THEN
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