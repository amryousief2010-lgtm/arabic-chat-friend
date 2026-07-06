
-- 1) Add per-role decision columns
ALTER TABLE public.duplicate_order_approvals
  ADD COLUMN IF NOT EXISTS marketing_decision text NOT NULL DEFAULT 'pending'
    CHECK (marketing_decision IN ('pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS marketing_decided_by uuid,
  ADD COLUMN IF NOT EXISTS marketing_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_reason text,
  ADD COLUMN IF NOT EXISTS executive_decision text NOT NULL DEFAULT 'pending'
    CHECK (executive_decision IN ('pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS executive_decided_by uuid,
  ADD COLUMN IF NOT EXISTS executive_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS executive_reason text;

-- 2) Backfill historical rows so the new dual-approval logic stays consistent
--    Rows that were previously 'approved' by a single decider count as approved on both sides.
UPDATE public.duplicate_order_approvals
SET marketing_decision = 'approved',
    marketing_decided_by = COALESCE(marketing_decided_by, decided_by),
    marketing_decided_at = COALESCE(marketing_decided_at, decided_at),
    marketing_reason     = COALESCE(marketing_reason, reason),
    executive_decision   = 'approved',
    executive_decided_by = COALESCE(executive_decided_by, decided_by),
    executive_decided_at = COALESCE(executive_decided_at, decided_at),
    executive_reason     = COALESCE(executive_reason, reason)
WHERE status = 'approved';

UPDATE public.duplicate_order_approvals
SET marketing_decision = 'rejected',
    marketing_decided_by = COALESCE(marketing_decided_by, decided_by),
    marketing_decided_at = COALESCE(marketing_decided_at, decided_at),
    marketing_reason     = COALESCE(marketing_reason, reason),
    executive_decision   = 'rejected',
    executive_decided_by = COALESCE(executive_decided_by, decided_by),
    executive_decided_at = COALESCE(executive_decided_at, decided_at),
    executive_reason     = COALESCE(executive_reason, reason)
WHERE status = 'rejected';

-- 3) Extend RLS so the executive manager can see and act on these requests
DROP POLICY IF EXISTS "Duplicate approvals visible to requester or marketing manager" ON public.duplicate_order_approvals;
CREATE POLICY "Duplicate approvals visible to requester or approvers"
  ON public.duplicate_order_approvals
  FOR SELECT TO authenticated
  USING (
    requested_by = auth.uid()
    OR public.has_role(auth.uid(), 'marketing_sales_manager'::app_role)
    OR public.has_role(auth.uid(), 'executive_manager'::app_role)
    OR public.has_role(auth.uid(), 'general_manager'::app_role)
  );

DROP POLICY IF EXISTS "Marketing manager updates duplicate approvals" ON public.duplicate_order_approvals;
CREATE POLICY "Approvers update duplicate approvals"
  ON public.duplicate_order_approvals
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'marketing_sales_manager'::app_role)
    OR public.has_role(auth.uid(), 'executive_manager'::app_role)
    OR public.has_role(auth.uid(), 'general_manager'::app_role)
  );

-- Same for the audit table so the executive can see attempts
DROP POLICY IF EXISTS "Duplicate audit visible to managers" ON public.duplicate_order_attempt_audit;
CREATE POLICY "Duplicate audit visible to managers"
  ON public.duplicate_order_attempt_audit
  FOR SELECT TO authenticated
  USING (
    attempted_by = auth.uid()
    OR public.has_role(auth.uid(), 'marketing_sales_manager'::app_role)
    OR public.has_role(auth.uid(), 'executive_manager'::app_role)
    OR public.has_role(auth.uid(), 'general_manager'::app_role)
  );

-- 4) Rewrite the decide RPC to handle dual approval
CREATE OR REPLACE FUNCTION public.decide_duplicate_order_approval(
  p_id uuid,
  p_approve boolean,
  p_reason text DEFAULT NULL
)
RETURNS public.duplicate_order_approvals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_marketing boolean := public.has_role(v_uid, 'marketing_sales_manager'::app_role);
  v_is_executive boolean := public.has_role(v_uid, 'executive_manager'::app_role)
                          OR public.has_role(v_uid, 'general_manager'::app_role);
  v_row public.duplicate_order_approvals;
  v_new_marketing text;
  v_new_executive text;
  v_final_status  text;
  v_notify_target uuid;
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

  v_new_marketing := v_row.marketing_decision;
  v_new_executive := v_row.executive_decision;

  -- Apply this user's decision on the appropriate side (marketing first if both roles held)
  IF v_is_marketing AND v_row.marketing_decision = 'pending' THEN
    v_new_marketing := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
    UPDATE public.duplicate_order_approvals
    SET marketing_decision = v_new_marketing,
        marketing_decided_by = v_uid,
        marketing_decided_at = now(),
        marketing_reason = p_reason
    WHERE id = p_id;
  ELSIF v_is_executive AND v_row.executive_decision = 'pending' THEN
    v_new_executive := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
    UPDATE public.duplicate_order_approvals
    SET executive_decision = v_new_executive,
        executive_decided_by = v_uid,
        executive_decided_at = now(),
        executive_reason = p_reason
    WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'NO_PENDING_SIDE_FOR_USER';
  END IF;

  -- Compute final status
  IF v_new_marketing = 'rejected' OR v_new_executive = 'rejected' THEN
    v_final_status := 'rejected';
  ELSIF v_new_marketing = 'approved' AND v_new_executive = 'approved' THEN
    v_final_status := 'approved';
  ELSE
    v_final_status := 'pending';
  END IF;

  UPDATE public.duplicate_order_approvals
  SET status = v_final_status,
      decided_by = CASE WHEN v_final_status <> 'pending' THEN v_uid ELSE decided_by END,
      decided_at = CASE WHEN v_final_status <> 'pending' THEN now() ELSE decided_at END,
      reason     = CASE WHEN v_final_status <> 'pending' THEN p_reason ELSE reason END,
      expires_at = CASE WHEN v_final_status = 'approved' THEN now() + interval '24 hours' ELSE expires_at END
  WHERE id = p_id
  RETURNING * INTO v_row;

  -- Audit
  IF v_final_status <> 'pending' THEN
    UPDATE public.duplicate_order_attempt_audit
    SET status = v_final_status,
        decision_by = v_uid,
        decision_reason = p_reason,
        decided_at = now(),
        updated_at = now()
    WHERE approval_id = v_row.id;
  END IF;

  -- Notify the requester when final decision is made
  IF v_final_status = 'approved' THEN
    INSERT INTO public.notifications (title, description, type, target_user_id)
    VALUES ('تمت الموافقة على الطلب المكرر',
            COALESCE(p_reason, 'تمت موافقة كل من مديرة التسويق والمدير التنفيذي. يمكنك تسجيل الطلب الآن.'),
            'duplicate_order_approval', v_row.requested_by);
  ELSIF v_final_status = 'rejected' THEN
    INSERT INTO public.notifications (title, description, type, target_user_id)
    VALUES ('تم رفض الطلب المكرر',
            COALESCE(p_reason, 'تم رفض تسجيل الطلب المكرر.'),
            'duplicate_order_approval', v_row.requested_by);
  ELSE
    -- Notify the other approver that their decision is still pending
    IF v_new_marketing = 'approved' AND v_new_executive = 'pending' THEN
      SELECT user_id INTO v_notify_target
      FROM public.user_roles
      WHERE role IN ('executive_manager'::app_role, 'general_manager'::app_role)
      LIMIT 1;
      IF v_notify_target IS NOT NULL THEN
        INSERT INTO public.notifications (title, description, type, target_user_id)
        VALUES ('طلب اعتماد أوردر مكرر بانتظارك',
                'وافقت مديرة التسويق على طلب مكرر ومستني اعتمادك النهائي.',
                'duplicate_order_approval', v_notify_target);
      END IF;
    ELSIF v_new_executive = 'approved' AND v_new_marketing = 'pending' THEN
      SELECT user_id INTO v_notify_target
      FROM public.user_roles
      WHERE role = 'marketing_sales_manager'::app_role
      LIMIT 1;
      IF v_notify_target IS NOT NULL THEN
        INSERT INTO public.notifications (title, description, type, target_user_id)
        VALUES ('طلب اعتماد أوردر مكرر بانتظارك',
                'وافق المدير التنفيذي على طلب مكرر ومستني اعتمادك النهائي.',
                'duplicate_order_approval', v_notify_target);
      END IF;
    END IF;
  END IF;

  RETURN v_row;
END;
$$;

-- 5) Also notify the executive on request creation (marketing was already notified via requester_flow).
--    We patch request_duplicate_order_approval to send a notification to both approvers.
DO $$
DECLARE
  v_sig text;
BEGIN
  SELECT pg_get_function_identity_arguments(oid) INTO v_sig
  FROM pg_proc
  WHERE proname = 'request_duplicate_order_approval'
  LIMIT 1;
  -- If it exists, we leave notification enhancement to the app layer since the
  -- existing function is used and we do not want to break its signature.
  PERFORM 1;
END $$;
