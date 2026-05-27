
-- 1) Table
CREATE TABLE IF NOT EXISTS public.duplicate_order_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by uuid,
  decided_at timestamptz,
  reason text,
  note text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dup_appr_pending
  ON public.duplicate_order_approvals(customer_id, requested_by, status, expires_at);

GRANT SELECT, INSERT, UPDATE ON public.duplicate_order_approvals TO authenticated;
GRANT ALL ON public.duplicate_order_approvals TO service_role;

ALTER TABLE public.duplicate_order_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Moderator views own requests"
  ON public.duplicate_order_approvals FOR SELECT TO authenticated
  USING (
    requested_by = auth.uid()
    OR public.has_any_role(auth.uid(), ARRAY[
      'marketing_sales_manager'::app_role,
      'general_manager'::app_role,
      'executive_manager'::app_role,
      'sales_manager'::app_role
    ])
  );

CREATE POLICY "Manager updates requests"
  ON public.duplicate_order_approvals FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY[
    'marketing_sales_manager'::app_role,
    'general_manager'::app_role,
    'executive_manager'::app_role
  ]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY[
    'marketing_sales_manager'::app_role,
    'general_manager'::app_role,
    'executive_manager'::app_role
  ]));

CREATE TRIGGER trg_dup_appr_updated_at
  BEFORE UPDATE ON public.duplicate_order_approvals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Helpers
CREATE OR REPLACE FUNCTION public.customer_has_other_order_today(p_customer_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.customer_id = p_customer_id
      AND o.created_by IS DISTINCT FROM p_user_id
      AND (timezone('Africa/Cairo', o.created_at))::date
          = (timezone('Africa/Cairo', now()))::date
      AND COALESCE(o.status,'') <> 'cancelled'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_approved_duplicate_order(p_customer_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.duplicate_order_approvals a
    WHERE a.customer_id = p_customer_id
      AND a.requested_by = p_user_id
      AND a.status = 'approved'
      AND a.expires_at > now()
  );
$$;

-- 3) Request approval (callable by sales_moderator)
CREATE OR REPLACE FUNCTION public.request_duplicate_order_approval(p_customer_id uuid, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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

  -- Reuse existing pending request if any
  SELECT id INTO v_existing FROM public.duplicate_order_approvals
   WHERE customer_id = p_customer_id AND requested_by = v_uid
     AND status = 'pending' AND expires_at > now()
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  INSERT INTO public.duplicate_order_approvals (customer_id, requested_by, note)
  VALUES (p_customer_id, v_uid, p_note)
  RETURNING id INTO v_id;

  SELECT name INTO v_cust_name FROM public.customers WHERE id = p_customer_id;
  SELECT full_name INTO v_moderator_name FROM public.profiles WHERE id = v_uid;

  -- Notify approvers
  INSERT INTO public.notifications (title, description, type, target_user_id)
  SELECT
    'طلب موافقة تسجيل طلب مكرر',
    'البنت ' || COALESCE(v_moderator_name,'—') || ' بتطلب موافقة لتسجيل طلب للعميل ' || COALESCE(v_cust_name,'—') ||
      CASE WHEN p_note IS NOT NULL AND length(trim(p_note))>0 THEN ' — ' || p_note ELSE '' END,
    'duplicate_order_approval',
    ur.user_id
  FROM public.user_roles ur
  WHERE ur.role IN ('marketing_sales_manager','general_manager','executive_manager');

  RETURN v_id;
END;
$$;

-- 4) Decide (approve/reject) — managers only
CREATE OR REPLACE FUNCTION public.decide_duplicate_order_approval(p_id uuid, p_approve boolean, p_reason text DEFAULT NULL)
RETURNS public.duplicate_order_approvals LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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

  -- Notify requester
  INSERT INTO public.notifications (title, description, type, target_user_id)
  VALUES (
    CASE WHEN p_approve THEN 'تمت الموافقة على طلب التكرار' ELSE 'تم رفض طلب التكرار' END,
    COALESCE(p_reason, CASE WHEN p_approve THEN 'تقدرى تسجلى الطلب دلوقتى.' ELSE 'لا يمكن تسجيل الطلب.' END),
    'duplicate_order_approval',
    v_row.requested_by
  );

  RETURN v_row;
END;
$$;

-- 5) Enforce at DB level
CREATE OR REPLACE FUNCTION public.enforce_duplicate_order_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := NEW.created_by;
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;
  -- Only enforce for sales_moderator role
  IF NOT public.has_role(v_uid, 'sales_moderator'::app_role) THEN
    RETURN NEW;
  END IF;
  IF public.customer_has_other_order_today(NEW.customer_id, v_uid)
     AND NOT public.has_approved_duplicate_order(NEW.customer_id, v_uid) THEN
    RAISE EXCEPTION 'DUPLICATE_ORDER_REQUIRES_APPROVAL: يلزم موافقة مديرة التسويق آلاء حامد لتسجيل طلب لنفس العميل فى نفس اليوم';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_duplicate_order_approval ON public.orders;
CREATE TRIGGER trg_enforce_duplicate_order_approval
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_duplicate_order_approval();
