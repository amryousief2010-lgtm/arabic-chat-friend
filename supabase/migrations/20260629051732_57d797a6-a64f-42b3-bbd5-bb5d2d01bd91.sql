
-- =========================================================
-- M3: Agouza Warehouse Reconciliation + Daily Closure
-- Scope: agouza_* only. Does NOT touch orders, inventory_*,
-- warehouse_transfers, main warehouse, or courier system.
-- =========================================================

-- ---------- Helper: get daily summary ----------
CREATE OR REPLACE FUNCTION public.get_agouza_daily_summary(p_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opening numeric := 0;
  v_in numeric := 0;
  v_out numeric := 0;
  v_expenses numeric := 0;
  v_handover_pending numeric := 0;
  v_handover_approved numeric := 0;
  v_handover_rejected numeric := 0;
  v_sales numeric := 0;
  v_expected numeric := 0;
  v_prev record;
BEGIN
  IF NOT public.can_manage_agouza(auth.uid()) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  -- Opening = closing of previous closed day, else sum of (in-out) before p_date
  SELECT closing_treasury INTO v_prev
  FROM public.agouza_daily_closures
  WHERE closure_date < p_date AND status IN ('closed','reopened')
  ORDER BY closure_date DESC LIMIT 1;

  IF v_prev IS NOT NULL THEN
    v_opening := v_prev.closing_treasury;
  ELSE
    SELECT
      COALESCE(SUM(CASE WHEN direction='in' AND status IN ('approved','posted') THEN amount ELSE 0 END),0)
      - COALESCE(SUM(CASE WHEN direction='out' AND status IN ('approved','posted') THEN amount ELSE 0 END),0)
    INTO v_opening
    FROM public.agouza_warehouse_treasury_txns
    WHERE txn_date::date < p_date;
  END IF;

  -- Day movement (only realized: posted or approved)
  SELECT
    COALESCE(SUM(CASE WHEN direction='in' AND status IN ('approved','posted') THEN amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN direction='out' AND status IN ('approved','posted') AND txn_type <> 'expense' THEN amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN txn_type='expense' AND status IN ('approved','posted') THEN amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN txn_type='sale' AND status IN ('approved','posted') THEN amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN txn_type='handover_to_main' AND status='pending' THEN amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN txn_type='handover_to_main' AND status='approved' THEN amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN txn_type='handover_to_main' AND status='rejected' THEN amount ELSE 0 END),0)
  INTO v_in, v_out, v_expenses, v_sales, v_handover_pending, v_handover_approved, v_handover_rejected
  FROM public.agouza_warehouse_treasury_txns
  WHERE txn_date::date = p_date;

  v_expected := v_opening + v_in - v_out - v_expenses;

  RETURN jsonb_build_object(
    'date', p_date,
    'opening_treasury', v_opening,
    'total_cash_in', v_in,
    'total_cash_out', v_out,
    'total_expenses', v_expenses,
    'total_sales', v_sales,
    'handover_pending', v_handover_pending,
    'handover_approved', v_handover_approved,
    'handover_rejected', v_handover_rejected,
    'expected_treasury', v_expected
  );
END;
$$;

-- ---------- Reconciliation RPCs ----------
CREATE OR REPLACE FUNCTION public.create_agouza_reconciliation(
  p_recon_date date,
  p_actual_balance numeric,
  p_notes text DEFAULT NULL,
  p_kind text DEFAULT 'treasury'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_system numeric;
  v_summary jsonb;
  v_no text;
BEGIN
  IF NOT public.can_manage_agouza(auth.uid()) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  IF p_actual_balance IS NULL OR p_actual_balance < 0 THEN
    RAISE EXCEPTION 'الرصيد الفعلي غير صحيح';
  END IF;
  IF p_kind NOT IN ('treasury','stock','both') THEN
    RAISE EXCEPTION 'نوع المطابقة غير صحيح';
  END IF;

  v_summary := public.get_agouza_daily_summary(p_recon_date);
  v_system := (v_summary->>'expected_treasury')::numeric;
  v_no := 'AGR-' || to_char(now(),'YYMMDD-HH24MISS');

  INSERT INTO public.agouza_warehouse_reconciliations(
    recon_no, recon_date, recon_kind, system_balance, actual_balance,
    variance, notes, status, submitted_by, submitted_at
  ) VALUES (
    v_no, p_recon_date, p_kind, v_system, p_actual_balance,
    p_actual_balance - v_system, p_notes, 'submitted', auth.uid(), now()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_agouza_reconciliation(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  IF NOT public.can_approve_agouza(auth.uid()) THEN
    RAISE EXCEPTION 'غير مصرح بالاعتماد';
  END IF;
  SELECT * INTO r FROM public.agouza_warehouse_reconciliations WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'المطابقة غير موجودة'; END IF;
  IF r.status <> 'submitted' THEN RAISE EXCEPTION 'الحالة لا تسمح بالاعتماد'; END IF;
  IF r.submitted_by = auth.uid() THEN RAISE EXCEPTION 'لا يمكنك اعتماد ما قدمته بنفسك'; END IF;

  UPDATE public.agouza_warehouse_reconciliations
  SET status='approved', approved_by=auth.uid(), approved_at=now()
  WHERE id=p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_agouza_reconciliation(p_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  IF NOT public.can_approve_agouza(auth.uid()) THEN
    RAISE EXCEPTION 'غير مصرح بالرفض';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'سبب الرفض مطلوب';
  END IF;
  SELECT * INTO r FROM public.agouza_warehouse_reconciliations WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'المطابقة غير موجودة'; END IF;
  IF r.status <> 'submitted' THEN RAISE EXCEPTION 'الحالة لا تسمح بالرفض'; END IF;
  IF r.submitted_by = auth.uid() THEN RAISE EXCEPTION 'لا يمكنك رفض ما قدمته بنفسك'; END IF;

  UPDATE public.agouza_warehouse_reconciliations
  SET status='rejected', rejected_reason=p_reason, approved_by=auth.uid(), approved_at=now()
  WHERE id=p_id;
END;
$$;

-- ---------- Daily Closure RPCs ----------
CREATE OR REPLACE FUNCTION public.agouza_daily_closure_open(p_date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_summary jsonb;
BEGIN
  IF NOT public.can_manage_agouza(auth.uid()) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  v_summary := public.get_agouza_daily_summary(p_date);

  INSERT INTO public.agouza_daily_closures(
    closure_date, status, opening_treasury, total_sales,
    total_cash_in, total_cash_out, total_expenses, total_handover,
    closing_treasury, expected_treasury, variance
  ) VALUES (
    p_date, 'open',
    (v_summary->>'opening_treasury')::numeric,
    (v_summary->>'total_sales')::numeric,
    (v_summary->>'total_cash_in')::numeric,
    (v_summary->>'total_cash_out')::numeric,
    (v_summary->>'total_expenses')::numeric,
    (v_summary->>'handover_approved')::numeric,
    0, (v_summary->>'expected_treasury')::numeric, 0
  )
  ON CONFLICT (closure_date) DO UPDATE
  SET opening_treasury = EXCLUDED.opening_treasury,
      total_sales = EXCLUDED.total_sales,
      total_cash_in = EXCLUDED.total_cash_in,
      total_cash_out = EXCLUDED.total_cash_out,
      total_expenses = EXCLUDED.total_expenses,
      total_handover = EXCLUDED.total_handover,
      expected_treasury = EXCLUDED.expected_treasury,
      updated_at = now()
  WHERE public.agouza_daily_closures.status <> 'closed'
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.agouza_daily_closures WHERE closure_date = p_date;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.agouza_daily_closure_close(
  p_date date,
  p_actual_balance numeric,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_summary jsonb;
  v_expected numeric;
  v_existing record;
BEGIN
  IF NOT public.can_manage_agouza(auth.uid()) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  IF p_actual_balance IS NULL OR p_actual_balance < 0 THEN
    RAISE EXCEPTION 'الرصيد الفعلي غير صحيح';
  END IF;

  SELECT * INTO v_existing FROM public.agouza_daily_closures WHERE closure_date = p_date;
  IF v_existing.status = 'closed' THEN
    RAISE EXCEPTION 'اليوم مُقفل بالفعل';
  END IF;

  -- Ensure row exists & refresh from summary
  PERFORM public.agouza_daily_closure_open(p_date);
  v_summary := public.get_agouza_daily_summary(p_date);
  v_expected := (v_summary->>'expected_treasury')::numeric;

  UPDATE public.agouza_daily_closures
  SET status='closed',
      closing_treasury = p_actual_balance,
      expected_treasury = v_expected,
      variance = p_actual_balance - v_expected,
      notes = p_notes,
      closed_by = auth.uid(),
      closed_at = now()
  WHERE closure_date = p_date
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.agouza_daily_closure_reopen(
  p_date date,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_approve_agouza(auth.uid()) THEN
    RAISE EXCEPTION 'إعادة الفتح من المدير العام/التنفيذي فقط';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'سبب إعادة الفتح مطلوب';
  END IF;

  UPDATE public.agouza_daily_closures
  SET status='reopened',
      reopened_by = auth.uid(),
      reopened_at = now(),
      reopen_reason = p_reason
  WHERE closure_date = p_date AND status='closed';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'لا يوجد إقفال مغلق لهذا اليوم';
  END IF;
END;
$$;

-- ---------- Freeze trigger: block edits to closed days ----------
CREATE OR REPLACE FUNCTION public.tg_agouza_freeze_closed_day()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_check_date date;
  v_status text;
BEGIN
  v_check_date := COALESCE(NEW.txn_date, OLD.txn_date)::date;

  SELECT status INTO v_status
  FROM public.agouza_daily_closures
  WHERE closure_date = v_check_date;

  IF v_status = 'closed' THEN
    -- Only GM/Executive can override on closed days
    IF NOT public.can_approve_agouza(auth.uid()) THEN
      RAISE EXCEPTION 'اليوم % مُقفل ولا يمكن تعديله. يلزم Override من المدير.', v_check_date;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_agouza_freeze_closed_day_ins ON public.agouza_warehouse_treasury_txns;
DROP TRIGGER IF EXISTS trg_agouza_freeze_closed_day_upd ON public.agouza_warehouse_treasury_txns;
DROP TRIGGER IF EXISTS trg_agouza_freeze_closed_day_del ON public.agouza_warehouse_treasury_txns;

CREATE TRIGGER trg_agouza_freeze_closed_day_ins
BEFORE INSERT ON public.agouza_warehouse_treasury_txns
FOR EACH ROW EXECUTE FUNCTION public.tg_agouza_freeze_closed_day();

CREATE TRIGGER trg_agouza_freeze_closed_day_upd
BEFORE UPDATE ON public.agouza_warehouse_treasury_txns
FOR EACH ROW EXECUTE FUNCTION public.tg_agouza_freeze_closed_day();

CREATE TRIGGER trg_agouza_freeze_closed_day_del
BEFORE DELETE ON public.agouza_warehouse_treasury_txns
FOR EACH ROW EXECUTE FUNCTION public.tg_agouza_freeze_closed_day();

-- Grants
GRANT EXECUTE ON FUNCTION public.get_agouza_daily_summary(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_agouza_reconciliation(date,numeric,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_agouza_reconciliation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_agouza_reconciliation(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agouza_daily_closure_open(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agouza_daily_closure_close(date,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agouza_daily_closure_reopen(date,text) TO authenticated;
