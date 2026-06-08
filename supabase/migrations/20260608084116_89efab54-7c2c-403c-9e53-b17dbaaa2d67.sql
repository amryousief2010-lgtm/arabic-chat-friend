
-- ============================================================
-- Lab Treasury Advances (نظام العُهد) — Phase 1
-- ============================================================

-- 1) Add new categories to existing enums (safe: ADD VALUE IF NOT EXISTS)
ALTER TYPE public.lab_treasury_expense_category ADD VALUE IF NOT EXISTS 'advance_issue';
ALTER TYPE public.lab_treasury_expense_category ADD VALUE IF NOT EXISTS 'advance_difference_payout';
ALTER TYPE public.lab_treasury_income_category  ADD VALUE IF NOT EXISTS 'advance_return';

-- 2) Status enum for advances
DO $$ BEGIN
  CREATE TYPE public.lab_treasury_advance_status AS ENUM ('open','settled','closed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Advances table
CREATE TABLE IF NOT EXISTS public.lab_treasury_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_name text NOT NULL,
  issued_at date NOT NULL DEFAULT ((now() AT TIME ZONE 'Africa/Cairo')::date),
  amount numeric NOT NULL CHECK (amount > 0),
  payment_method public.lab_treasury_payment_method NOT NULL,
  purpose text,
  notes text,
  status public.lab_treasury_advance_status NOT NULL DEFAULT 'open',
  issue_movement_id uuid REFERENCES public.lab_treasury_movements(id) ON DELETE SET NULL,
  return_movement_id uuid REFERENCES public.lab_treasury_movements(id) ON DELETE SET NULL,
  difference_movement_id uuid REFERENCES public.lab_treasury_movements(id) ON DELETE SET NULL,
  actual_expense_total numeric NOT NULL DEFAULT 0,
  returned_amount numeric NOT NULL DEFAULT 0,
  pending_employee_amount numeric NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  settled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  settled_at timestamptz,
  manager_approval_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  manager_approval_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lta_status ON public.lab_treasury_advances(status);
CREATE INDEX IF NOT EXISTS idx_lta_employee ON public.lab_treasury_advances(employee_user_id);
CREATE INDEX IF NOT EXISTS idx_lta_issued_at ON public.lab_treasury_advances(issued_at DESC);

GRANT SELECT ON public.lab_treasury_advances TO authenticated;
GRANT ALL ON public.lab_treasury_advances TO service_role;

ALTER TABLE public.lab_treasury_advances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lta_select_authorized" ON public.lab_treasury_advances FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(),'general_manager'::app_role)
    OR has_role(auth.uid(),'executive_manager'::app_role)
    OR has_role(auth.uid(),'accountant'::app_role)
    OR has_role(auth.uid(),'financial_manager'::app_role)
    OR has_role(auth.uid(),'lab_treasury_keeper'::app_role)
    OR has_role(auth.uid(),'lab_treasury_approver'::app_role)
    OR employee_user_id = auth.uid()
    OR created_by = auth.uid()
  );

-- No direct INSERT/UPDATE policies: all changes go through SECURITY DEFINER RPCs.

-- 4) Settlement lines table
CREATE TABLE IF NOT EXISTS public.lab_treasury_advance_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advance_id uuid NOT NULL REFERENCES public.lab_treasury_advances(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  description text NOT NULL,
  expense_category public.lab_treasury_expense_category NOT NULL DEFAULT 'other',
  amount numeric NOT NULL CHECK (amount > 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ltas_advance ON public.lab_treasury_advance_settlements(advance_id);

GRANT SELECT ON public.lab_treasury_advance_settlements TO authenticated;
GRANT ALL ON public.lab_treasury_advance_settlements TO service_role;

ALTER TABLE public.lab_treasury_advance_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ltas_select_authorized" ON public.lab_treasury_advance_settlements FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.lab_treasury_advances a
      WHERE a.id = advance_id AND (
        has_role(auth.uid(),'general_manager'::app_role)
        OR has_role(auth.uid(),'executive_manager'::app_role)
        OR has_role(auth.uid(),'accountant'::app_role)
        OR has_role(auth.uid(),'financial_manager'::app_role)
        OR has_role(auth.uid(),'lab_treasury_keeper'::app_role)
        OR has_role(auth.uid(),'lab_treasury_approver'::app_role)
        OR a.employee_user_id = auth.uid()
        OR a.created_by = auth.uid()
      )
    )
  );

-- 5) Updated_at trigger
CREATE OR REPLACE FUNCTION public.lab_treasury_advances_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_lta_touch ON public.lab_treasury_advances;
CREATE TRIGGER trg_lta_touch BEFORE UPDATE ON public.lab_treasury_advances
FOR EACH ROW EXECUTE FUNCTION public.lab_treasury_advances_touch();

-- 6) Improve insufficient-balance message wording (clearer Arabic)
CREATE OR REPLACE FUNCTION public.lab_treasury_check_expense_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  is_manager boolean;
  current_balance numeric;
  method_label text;
BEGIN
  IF NEW.movement_type <> 'expense' THEN
    RETURN NEW;
  END IF;

  is_manager := has_role(auth.uid(), 'general_manager'::app_role)
             OR has_role(auth.uid(), 'executive_manager'::app_role);

  IF is_manager THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(
    CASE WHEN movement_type = 'income'  AND status = 'approved' THEN amount
         WHEN movement_type = 'expense' AND status = 'approved' THEN -amount
         ELSE 0 END
  ), 0) INTO current_balance
  FROM public.lab_treasury_movements
  WHERE payment_method = NEW.payment_method;

  IF NEW.amount > current_balance THEN
    method_label := CASE NEW.payment_method::text
      WHEN 'cash' THEN 'النقدية (كاش)'
      WHEN 'vodafone_cash' THEN 'فودافون كاش'
      WHEN 'instapay' THEN 'انستاباي'
      WHEN 'bank_transfer' THEN 'التحويل البنكي'
      ELSE NEW.payment_method::text END;
    RAISE EXCEPTION 'الرصيد المتاح في % غير كافٍ. المتاح: % ج، المطلوب: % ج. راجع المبلغ المُدخل أو اطلب اعتماد المدير.',
      method_label, current_balance, NEW.amount
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- 7) Helper: check role for issuing an advance
CREATE OR REPLACE FUNCTION public.can_manage_lab_advances(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    has_role(_uid,'general_manager'::app_role)
    OR has_role(_uid,'executive_manager'::app_role)
    OR has_role(_uid,'accountant'::app_role)
    OR has_role(_uid,'financial_manager'::app_role)
    OR has_role(_uid,'lab_treasury_keeper'::app_role)
$$;

-- 8) RPC: Issue advance
CREATE OR REPLACE FUNCTION public.lab_treasury_issue_advance(
  p_recipient_name text,
  p_employee_user_id uuid,
  p_amount numeric,
  p_payment_method public.lab_treasury_payment_method,
  p_purpose text,
  p_notes text,
  p_issued_at date DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_movement_id uuid;
  v_advance_id uuid;
  v_date date := COALESCE(p_issued_at, (now() AT TIME ZONE 'Africa/Cairo')::date);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.can_manage_lab_advances(v_uid) THEN
    RAISE EXCEPTION 'صلاحية غير كافية لصرف العُهد';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'مبلغ العهدة يجب أن يكون أكبر من صفر';
  END IF;
  IF COALESCE(TRIM(p_recipient_name),'') = '' THEN
    RAISE EXCEPTION 'اسم المستلم مطلوب';
  END IF;

  -- Create the expense movement (pending). Balance trigger will enforce funds (unless manager).
  INSERT INTO public.lab_treasury_movements(
    movement_type, movement_date, expense_category, amount, payment_method,
    description, beneficiary, notes, status, created_by, source_table
  ) VALUES (
    'expense', v_date, 'advance_issue'::public.lab_treasury_expense_category,
    p_amount, p_payment_method,
    'صرف عهدة: ' || COALESCE(p_purpose,'') ,
    p_recipient_name, p_notes, 'pending', v_uid, 'lab_treasury_advances'
  ) RETURNING id INTO v_movement_id;

  INSERT INTO public.lab_treasury_advances(
    employee_user_id, recipient_name, issued_at, amount, payment_method,
    purpose, notes, status, issue_movement_id, created_by
  ) VALUES (
    p_employee_user_id, p_recipient_name, v_date, p_amount, p_payment_method,
    p_purpose, p_notes, 'open', v_movement_id, v_uid
  ) RETURNING id INTO v_advance_id;

  -- link back source_id
  UPDATE public.lab_treasury_movements SET source_id = v_advance_id WHERE id = v_movement_id;

  INSERT INTO public.lab_treasury_audit_log(action, movement_id, actor_id, after_data, metadata)
  VALUES ('advance_issue', v_movement_id, v_uid,
    jsonb_build_object('advance_id', v_advance_id, 'amount', p_amount,
      'recipient', p_recipient_name, 'payment_method', p_payment_method::text,
      'purpose', p_purpose),
    jsonb_build_object('source','lab_treasury_issue_advance'));

  RETURN v_advance_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lab_treasury_issue_advance(text,uuid,numeric,public.lab_treasury_payment_method,text,text,date) TO authenticated;

-- 9) RPC: Settle advance
CREATE OR REPLACE FUNCTION public.lab_treasury_settle_advance(
  p_advance_id uuid,
  p_lines jsonb,   -- array of {description, expense_category, amount}
  p_returned_amount numeric DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_adv public.lab_treasury_advances;
  v_total numeric := 0;
  v_line jsonb;
  v_idx int := 0;
  v_return_mov_id uuid;
  v_diff numeric;
  v_new_status public.lab_treasury_advance_status;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.can_manage_lab_advances(v_uid) THEN
    RAISE EXCEPTION 'صلاحية غير كافية لتسوية العُهد';
  END IF;

  SELECT * INTO v_adv FROM public.lab_treasury_advances WHERE id = p_advance_id FOR UPDATE;
  IF v_adv.id IS NULL THEN RAISE EXCEPTION 'العهدة غير موجودة'; END IF;
  IF v_adv.status <> 'open' THEN RAISE EXCEPTION 'لا يمكن تسوية عهدة بحالة %', v_adv.status; END IF;
  IF p_returned_amount IS NULL OR p_returned_amount < 0 THEN p_returned_amount := 0; END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'يلزم إدخال بنود المصروف الفعلي';
  END IF;

  -- Clear any prior settlement lines (idempotent within open status — should be empty)
  DELETE FROM public.lab_treasury_advance_settlements WHERE advance_id = p_advance_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_idx := v_idx + 1;
    IF (v_line->>'amount') IS NULL OR (v_line->>'amount')::numeric <= 0 THEN
      RAISE EXCEPTION 'مبلغ البند % غير صالح', v_idx;
    END IF;
    INSERT INTO public.lab_treasury_advance_settlements(
      advance_id, line_no, description, expense_category, amount, created_by
    ) VALUES (
      p_advance_id, v_idx,
      COALESCE(NULLIF(TRIM(v_line->>'description'),''),'بند ' || v_idx),
      COALESCE((v_line->>'expense_category')::public.lab_treasury_expense_category, 'other'),
      (v_line->>'amount')::numeric,
      v_uid
    );
    v_total := v_total + (v_line->>'amount')::numeric;
  END LOOP;

  -- Check arithmetic consistency: returned + actual must reconcile with advance unless there is a pending difference
  IF p_returned_amount > 0 AND (v_total + p_returned_amount) > v_adv.amount THEN
    -- impossible: spent more AND returned cash
    RAISE EXCEPTION 'لا يمكن أن يكون هناك مرتجع ومصروف فعلي أكبر من العهدة في نفس الوقت';
  END IF;

  -- If money returned to treasury, post income movement (auto-approved since it just reverses part of the issue)
  IF p_returned_amount > 0 THEN
    INSERT INTO public.lab_treasury_movements(
      movement_type, movement_date, income_category, amount, payment_method,
      description, notes, status, created_by, approved_by, approved_at,
      source_table, source_id
    ) VALUES (
      'income', (now() AT TIME ZONE 'Africa/Cairo')::date,
      'advance_return'::public.lab_treasury_income_category,
      p_returned_amount, v_adv.payment_method,
      'رد باقي عهدة: ' || v_adv.recipient_name,
      'تسوية العهدة #' || p_advance_id::text,
      'approved', v_uid, v_uid, now(),
      'lab_treasury_advance_returns', p_advance_id
    ) RETURNING id INTO v_return_mov_id;
  END IF;

  v_diff := GREATEST(0, v_total - v_adv.amount); -- amount owed to employee

  IF v_diff > 0 THEN
    v_new_status := 'open'; -- stays open until manager approves payout (or we mark settled with pending diff?)
    -- Per spec: keep status settled but with pending_employee_amount; payout requires manager approval
    v_new_status := 'settled';
  ELSE
    v_new_status := 'settled';
  END IF;

  UPDATE public.lab_treasury_advances
  SET actual_expense_total = v_total,
      returned_amount = p_returned_amount,
      pending_employee_amount = v_diff,
      return_movement_id = COALESCE(v_return_mov_id, return_movement_id),
      settled_by = v_uid,
      settled_at = now(),
      status = CASE WHEN v_diff = 0 AND p_returned_amount + v_total = v_adv.amount THEN 'closed'::public.lab_treasury_advance_status
                    ELSE v_new_status END
  WHERE id = p_advance_id;

  INSERT INTO public.lab_treasury_audit_log(action, movement_id, actor_id, after_data, metadata)
  VALUES ('advance_settle', v_adv.issue_movement_id, v_uid,
    jsonb_build_object('advance_id', p_advance_id, 'actual_total', v_total,
      'returned_amount', p_returned_amount, 'pending_employee_amount', v_diff,
      'return_movement_id', v_return_mov_id),
    jsonb_build_object('source','lab_treasury_settle_advance','line_count', v_idx));

  RETURN jsonb_build_object(
    'advance_id', p_advance_id,
    'actual_total', v_total,
    'returned_amount', p_returned_amount,
    'pending_employee_amount', v_diff,
    'return_movement_id', v_return_mov_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lab_treasury_settle_advance(uuid,jsonb,numeric) TO authenticated;

-- 10) RPC: Approve & pay out pending difference to employee
CREATE OR REPLACE FUNCTION public.lab_treasury_approve_advance_difference(
  p_advance_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_adv public.lab_treasury_advances;
  v_mov_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT (has_role(v_uid,'general_manager'::app_role) OR has_role(v_uid,'executive_manager'::app_role)) THEN
    RAISE EXCEPTION 'صلاحية المدير العام/التنفيذي فقط';
  END IF;

  SELECT * INTO v_adv FROM public.lab_treasury_advances WHERE id = p_advance_id FOR UPDATE;
  IF v_adv.id IS NULL THEN RAISE EXCEPTION 'العهدة غير موجودة'; END IF;
  IF v_adv.pending_employee_amount <= 0 THEN
    RAISE EXCEPTION 'لا يوجد فرق مستحق للموظف لهذه العهدة';
  END IF;
  IF v_adv.difference_movement_id IS NOT NULL THEN
    RAISE EXCEPTION 'تم صرف الفرق مسبقاً';
  END IF;

  INSERT INTO public.lab_treasury_movements(
    movement_type, movement_date, expense_category, amount, payment_method,
    description, beneficiary, notes, status, created_by, approved_by, approved_at,
    source_table, source_id
  ) VALUES (
    'expense', (now() AT TIME ZONE 'Africa/Cairo')::date,
    'advance_difference_payout'::public.lab_treasury_expense_category,
    v_adv.pending_employee_amount, v_adv.payment_method,
    'فرق عهدة مستحق للموظف: ' || v_adv.recipient_name,
    v_adv.recipient_name,
    'اعتماد فرق العهدة #' || p_advance_id::text,
    'approved', v_uid, v_uid, now(),
    'lab_treasury_advance_difference', p_advance_id
  ) RETURNING id INTO v_mov_id;

  UPDATE public.lab_treasury_advances
  SET difference_movement_id = v_mov_id,
      manager_approval_by = v_uid,
      manager_approval_at = now(),
      status = 'closed'::public.lab_treasury_advance_status
  WHERE id = p_advance_id;

  INSERT INTO public.lab_treasury_audit_log(action, movement_id, actor_id, after_data, metadata)
  VALUES ('advance_difference_payout', v_mov_id, v_uid,
    jsonb_build_object('advance_id', p_advance_id, 'amount', v_adv.pending_employee_amount),
    jsonb_build_object('source','lab_treasury_approve_advance_difference'));

  RETURN v_mov_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lab_treasury_approve_advance_difference(uuid) TO authenticated;

-- 11) RPC: Cancel advance (manager-only, before settlement)
CREATE OR REPLACE FUNCTION public.lab_treasury_cancel_advance(
  p_advance_id uuid,
  p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_adv public.lab_treasury_advances;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT (has_role(v_uid,'general_manager'::app_role) OR has_role(v_uid,'executive_manager'::app_role)) THEN
    RAISE EXCEPTION 'صلاحية المدير العام/التنفيذي فقط';
  END IF;
  IF COALESCE(TRIM(p_reason),'') = '' THEN
    RAISE EXCEPTION 'سبب الإلغاء مطلوب';
  END IF;

  SELECT * INTO v_adv FROM public.lab_treasury_advances WHERE id = p_advance_id FOR UPDATE;
  IF v_adv.id IS NULL THEN RAISE EXCEPTION 'العهدة غير موجودة'; END IF;
  IF v_adv.status <> 'open' THEN RAISE EXCEPTION 'لا يمكن إلغاء عهدة بحالة %', v_adv.status; END IF;

  UPDATE public.lab_treasury_advances
  SET status = 'cancelled', cancelled_by = v_uid, cancelled_at = now(), cancellation_reason = p_reason
  WHERE id = p_advance_id;

  -- Reverse the issuing movement by inserting a refund income (only if it was approved)
  IF v_adv.issue_movement_id IS NOT NULL THEN
    INSERT INTO public.lab_treasury_movements(
      movement_type, movement_date, income_category, amount, payment_method,
      description, notes, status, created_by, approved_by, approved_at,
      source_table, source_id
    )
    SELECT 'income', (now() AT TIME ZONE 'Africa/Cairo')::date,
           'advance_return'::public.lab_treasury_income_category,
           m.amount, m.payment_method,
           'إلغاء عهدة — رد للخزنة: ' || v_adv.recipient_name,
           p_reason, 'approved', v_uid, v_uid, now(),
           'lab_treasury_advance_cancel', v_adv.id
    FROM public.lab_treasury_movements m
    WHERE m.id = v_adv.issue_movement_id AND m.status = 'approved';
  END IF;

  INSERT INTO public.lab_treasury_audit_log(action, movement_id, actor_id, reason, metadata)
  VALUES ('advance_cancel', v_adv.issue_movement_id, v_uid, p_reason,
    jsonb_build_object('advance_id', p_advance_id, 'source','lab_treasury_cancel_advance'));
END;
$$;

GRANT EXECUTE ON FUNCTION public.lab_treasury_cancel_advance(uuid,text) TO authenticated;
