
-- ============================================================================
-- Lab Treasury Hardening: audit log, day closures, balance guard, rejection/deletion tracking
-- ============================================================================

-- 1) New columns on lab_treasury_movements
ALTER TABLE public.lab_treasury_movements
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_reason text,
  ADD COLUMN IF NOT EXISTS edit_reason text;

-- 2) Day closures table
CREATE TABLE IF NOT EXISTS public.lab_treasury_day_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closure_date date NOT NULL UNIQUE,
  closed_by uuid NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  opening_balance numeric NOT NULL DEFAULT 0,
  closing_balance numeric NOT NULL DEFAULT 0,
  cash_balance numeric NOT NULL DEFAULT 0,
  vodafone_balance numeric NOT NULL DEFAULT 0,
  instapay_balance numeric NOT NULL DEFAULT 0,
  bank_balance numeric NOT NULL DEFAULT 0,
  total_income numeric NOT NULL DEFAULT 0,
  total_expense numeric NOT NULL DEFAULT 0,
  net_movement numeric NOT NULL DEFAULT 0,
  notes text,
  reopened_at timestamptz,
  reopened_by uuid,
  reopen_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_treasury_day_closures TO authenticated;
GRANT ALL ON public.lab_treasury_day_closures TO service_role;
ALTER TABLE public.lab_treasury_day_closures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ltdc_select ON public.lab_treasury_day_closures;
CREATE POLICY ltdc_select ON public.lab_treasury_day_closures FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'general_manager'::app_role)
    OR has_role(auth.uid(), 'executive_manager'::app_role)
    OR has_role(auth.uid(), 'accountant'::app_role)
    OR has_role(auth.uid(), 'financial_manager'::app_role)
    OR has_role(auth.uid(), 'lab_treasury_keeper'::app_role)
  );

DROP POLICY IF EXISTS ltdc_insert ON public.lab_treasury_day_closures;
CREATE POLICY ltdc_insert ON public.lab_treasury_day_closures FOR INSERT TO authenticated
  WITH CHECK (
    closed_by = auth.uid()
    AND (has_role(auth.uid(), 'general_manager'::app_role) OR has_role(auth.uid(), 'executive_manager'::app_role))
  );

DROP POLICY IF EXISTS ltdc_update_gm ON public.lab_treasury_day_closures;
CREATE POLICY ltdc_update_gm ON public.lab_treasury_day_closures FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'general_manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'general_manager'::app_role));

DROP POLICY IF EXISTS ltdc_delete_gm ON public.lab_treasury_day_closures;
CREATE POLICY ltdc_delete_gm ON public.lab_treasury_day_closures FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'general_manager'::app_role));

-- 3) Audit log table
CREATE TABLE IF NOT EXISTS public.lab_treasury_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  movement_id uuid,
  actor_id uuid,
  actor_name text,
  before_data jsonb,
  after_data jsonb,
  reason text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lt_audit_created_at ON public.lab_treasury_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_audit_movement_id ON public.lab_treasury_audit_log (movement_id);

GRANT SELECT, INSERT ON public.lab_treasury_audit_log TO authenticated;
GRANT ALL ON public.lab_treasury_audit_log TO service_role;
ALTER TABLE public.lab_treasury_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lta_select ON public.lab_treasury_audit_log;
CREATE POLICY lta_select ON public.lab_treasury_audit_log FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'general_manager'::app_role)
    OR has_role(auth.uid(), 'executive_manager'::app_role)
    OR has_role(auth.uid(), 'accountant'::app_role)
    OR has_role(auth.uid(), 'financial_manager'::app_role)
  );

DROP POLICY IF EXISTS lta_insert ON public.lab_treasury_audit_log;
CREATE POLICY lta_insert ON public.lab_treasury_audit_log FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid());

-- 4) Widen DELETE on movements to GM + Executive (was GM-only)
DROP POLICY IF EXISTS lab_treasury_delete_gm ON public.lab_treasury_movements;
CREATE POLICY lab_treasury_delete_managers ON public.lab_treasury_movements FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'general_manager'::app_role)
    OR has_role(auth.uid(), 'executive_manager'::app_role)
  );

-- 5) Trigger: guard updates/deletes for closed days and post-approval edits
CREATE OR REPLACE FUNCTION public.lab_treasury_guard_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_manager boolean;
  day_closed boolean;
  check_date date;
BEGIN
  is_manager := has_role(auth.uid(), 'general_manager'::app_role)
             OR has_role(auth.uid(), 'executive_manager'::app_role);

  IF TG_OP = 'DELETE' THEN
    check_date := OLD.movement_date;
  ELSE
    check_date := COALESCE(NEW.movement_date, OLD.movement_date);
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.lab_treasury_day_closures
    WHERE closure_date = check_date AND reopened_at IS NULL
  ) INTO day_closed;

  IF day_closed AND NOT is_manager THEN
    RAISE EXCEPTION 'هذا اليوم مُقفل ولا يمكن تعديل أو حذف حركاته إلا بصلاحية المدير العام أو التنفيذي';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- After approval, only managers can edit
    IF OLD.status = 'approved' AND NOT is_manager THEN
      RAISE EXCEPTION 'لا يمكن تعديل حركة معتمدة إلا بصلاحية المدير العام أو التنفيذي';
    END IF;

    -- Force rejection metadata when rejecting
    IF NEW.status = 'rejected' AND COALESCE(OLD.status,'') <> 'rejected' THEN
      IF NEW.rejection_reason IS NULL OR length(trim(NEW.rejection_reason)) < 3 THEN
        RAISE EXCEPTION 'سبب الرفض إلزامي (3 أحرف على الأقل)';
      END IF;
      NEW.rejected_by := auth.uid();
      NEW.rejected_at := now();
    END IF;

    -- Stamp approval metadata
    IF NEW.status = 'approved' AND COALESCE(OLD.status,'') <> 'approved' THEN
      NEW.approved_by := auth.uid();
      NEW.approved_at := now();
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_lab_treasury_guard ON public.lab_treasury_movements;
CREATE TRIGGER trg_lab_treasury_guard
  BEFORE UPDATE OR DELETE ON public.lab_treasury_movements
  FOR EACH ROW EXECUTE FUNCTION public.lab_treasury_guard_changes();

-- 6) Balance check trigger on INSERT for expenses (non-managers only)
CREATE OR REPLACE FUNCTION public.lab_treasury_check_expense_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_manager boolean;
  current_balance numeric;
BEGIN
  IF NEW.movement_type <> 'expense' THEN
    RETURN NEW;
  END IF;

  is_manager := has_role(auth.uid(), 'general_manager'::app_role)
             OR has_role(auth.uid(), 'executive_manager'::app_role);

  IF is_manager THEN
    RETURN NEW; -- managers may overdraw (logged in audit by app)
  END IF;

  SELECT COALESCE(SUM(
    CASE WHEN movement_type = 'income' AND status = 'approved' THEN amount
         WHEN movement_type = 'expense' AND status = 'approved' THEN -amount
         ELSE 0 END
  ), 0) INTO current_balance
  FROM public.lab_treasury_movements
  WHERE payment_method = NEW.payment_method;

  IF NEW.amount > current_balance THEN
    RAISE EXCEPTION 'الرصيد المتاح في % غير كافٍ. المتاح: %, المطلوب: %', NEW.payment_method, current_balance, NEW.amount;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lab_treasury_balance_check ON public.lab_treasury_movements;
CREATE TRIGGER trg_lab_treasury_balance_check
  BEFORE INSERT ON public.lab_treasury_movements
  FOR EACH ROW EXECUTE FUNCTION public.lab_treasury_check_expense_balance();

-- 7) Daily report function
CREATE OR REPLACE FUNCTION public.lab_treasury_daily_report(p_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  opening numeric;
  income_total numeric;
  expense_total numeric;
  pending_count int;
  rejected_count int;
  by_method jsonb;
  closing numeric;
BEGIN
  SELECT COALESCE(SUM(
    CASE WHEN movement_type = 'income' AND status = 'approved' THEN amount
         WHEN movement_type = 'expense' AND status = 'approved' THEN -amount
         ELSE 0 END), 0)
  INTO opening
  FROM public.lab_treasury_movements
  WHERE movement_date < p_date;

  SELECT
    COALESCE(SUM(CASE WHEN movement_type='income' AND status='approved' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN movement_type='expense' AND status='approved' THEN amount ELSE 0 END), 0),
    COUNT(*) FILTER (WHERE status='pending'),
    COUNT(*) FILTER (WHERE status='rejected')
  INTO income_total, expense_total, pending_count, rejected_count
  FROM public.lab_treasury_movements
  WHERE movement_date = p_date;

  closing := opening + income_total - expense_total;

  SELECT jsonb_object_agg(payment_method, balance_approved)
  INTO by_method
  FROM (
    SELECT payment_method,
      COALESCE(SUM(
        CASE WHEN movement_type='income' AND status='approved' AND movement_date <= p_date THEN amount
             WHEN movement_type='expense' AND status='approved' AND movement_date <= p_date THEN -amount
             ELSE 0 END), 0) AS balance_approved
    FROM public.lab_treasury_movements
    GROUP BY payment_method
  ) t;

  RETURN jsonb_build_object(
    'date', p_date,
    'opening_balance', opening,
    'income_total', income_total,
    'expense_total', expense_total,
    'net_movement', income_total - expense_total,
    'closing_balance', closing,
    'pending_count', pending_count,
    'rejected_count', rejected_count,
    'by_method', COALESCE(by_method, '{}'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lab_treasury_daily_report(date) TO authenticated;
