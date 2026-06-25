
-- =========================================
-- 1) Courier profiles (limits + commission)
-- =========================================
CREATE TABLE IF NOT EXISTS public.courier_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_name TEXT UNIQUE NOT NULL,
  credit_limit NUMERIC(14,2),
  commission_type TEXT NOT NULL DEFAULT 'none' CHECK (commission_type IN ('none','percent_of_sales','per_kg','per_item')),
  commission_value NUMERIC(14,4) DEFAULT 0,
  notes TEXT,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.courier_profiles TO authenticated;
GRANT ALL ON public.courier_profiles TO service_role;
ALTER TABLE public.courier_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cp_select" ON public.courier_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "cp_write" ON public.courier_profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager'));
CREATE POLICY "cp_update" ON public.courier_profiles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager'))
  WITH CHECK (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager'));

DROP TRIGGER IF EXISTS trg_cp_updated ON public.courier_profiles;
CREATE TRIGGER trg_cp_updated BEFORE UPDATE ON public.courier_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- 2) Commission payouts
-- =========================================
CREATE TABLE IF NOT EXISTS public.courier_commission_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_name TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  performed_by UUID,
  treasury_txn_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ccp_courier ON public.courier_commission_payouts(courier_name);

GRANT SELECT, INSERT ON public.courier_commission_payouts TO authenticated;
GRANT ALL ON public.courier_commission_payouts TO service_role;
ALTER TABLE public.courier_commission_payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ccp_select" ON public.courier_commission_payouts FOR SELECT TO authenticated USING (true);
CREATE POLICY "ccp_insert" ON public.courier_commission_payouts
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager') OR public.has_role(auth.uid(),'financial_manager'));

-- =========================================
-- 3) Daily closures
-- =========================================
CREATE TABLE IF NOT EXISTS public.courier_daily_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  custody_id UUID NOT NULL REFERENCES public.courier_goods_custodies(id) ON DELETE CASCADE,
  closure_date DATE NOT NULL,
  goods_out NUMERIC(14,2) NOT NULL DEFAULT 0,
  goods_returned NUMERIC(14,2) NOT NULL DEFAULT 0,
  sales_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  discounts_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  cash_collected NUMERIC(14,2) NOT NULL DEFAULT 0,
  remaining_goods NUMERIC(14,2) NOT NULL DEFAULT 0,
  remaining_cash NUMERIC(14,2) NOT NULL DEFAULT 0,
  deficit_or_surplus NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'closed' CHECK (status IN ('closed','reopened')),
  closed_by UUID,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reopened_by UUID,
  reopened_at TIMESTAMPTZ,
  reopen_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (custody_id, closure_date)
);
CREATE INDEX IF NOT EXISTS idx_cdc_custody_date ON public.courier_daily_closures(custody_id, closure_date DESC);

GRANT SELECT, INSERT, UPDATE ON public.courier_daily_closures TO authenticated;
GRANT ALL ON public.courier_daily_closures TO service_role;
ALTER TABLE public.courier_daily_closures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cdc_select" ON public.courier_daily_closures FOR SELECT TO authenticated USING (true);
CREATE POLICY "cdc_insert" ON public.courier_daily_closures
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager') OR public.has_role(auth.uid(),'warehouse_supervisor') OR public.has_role(auth.uid(),'financial_manager'));
CREATE POLICY "cdc_update" ON public.courier_daily_closures
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager'))
  WITH CHECK (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager'));

-- =========================================
-- 4) Credit override fields on lines
-- =========================================
ALTER TABLE public.courier_goods_custody_lines
  ADD COLUMN IF NOT EXISTS credit_override_status TEXT
    CHECK (credit_override_status IN ('none','pending','approved','rejected')) DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS credit_override_by UUID,
  ADD COLUMN IF NOT EXISTS credit_override_at TIMESTAMPTZ;

-- =========================================
-- 5) Closure lock trigger
-- =========================================
CREATE OR REPLACE FUNCTION public.enforce_courier_closure_lock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cid UUID;
  _dt DATE;
  _last_close DATE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _cid := OLD.custody_id; _dt := OLD.performed_at::DATE;
  ELSE
    _cid := NEW.custody_id; _dt := NEW.performed_at::DATE;
  END IF;

  SELECT MAX(closure_date) INTO _last_close
    FROM public.courier_daily_closures
    WHERE custody_id = _cid AND status = 'closed';

  IF _last_close IS NOT NULL AND _dt <= _last_close THEN
    -- Allow only general/executive manager to bypass
    IF NOT (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')) THEN
      RAISE EXCEPTION 'لا يمكن تعديل حركات بتاريخ % لأن اليوم مغلق (آخر إغلاق: %)', _dt, _last_close;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;

DROP TRIGGER IF EXISTS trg_cgcl_closure_lock ON public.courier_goods_custody_lines;
CREATE TRIGGER trg_cgcl_closure_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.courier_goods_custody_lines
  FOR EACH ROW EXECUTE FUNCTION public.enforce_courier_closure_lock();

-- =========================================
-- 6) RPCs
-- =========================================
CREATE OR REPLACE FUNCTION public.approve_courier_credit_override(_line_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF NOT (public.has_role(_uid,'general_manager') OR public.has_role(_uid,'executive_manager')) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  UPDATE public.courier_goods_custody_lines
    SET credit_override_status='approved', credit_override_by=_uid, credit_override_at=now()
    WHERE id=_line_id AND credit_override_status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'لا يوجد طلب تجاوز بانتظار الاعتماد'; END IF;
  RETURN _line_id;
END;$$;

CREATE OR REPLACE FUNCTION public.reject_courier_credit_override(_line_id UUID, _reason TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF NOT (public.has_role(_uid,'general_manager') OR public.has_role(_uid,'executive_manager')) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  UPDATE public.courier_goods_custody_lines
    SET credit_override_status='rejected', credit_override_by=_uid, credit_override_at=now(),
        notes = COALESCE(notes,'') || ' | رفض تجاوز الحد: ' || COALESCE(_reason,'')
    WHERE id=_line_id AND credit_override_status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'لا يوجد طلب تجاوز بانتظار الاعتماد'; END IF;
  RETURN _line_id;
END;$$;

CREATE OR REPLACE FUNCTION public.close_courier_day(_custody_id UUID, _date DATE)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _goods_out NUMERIC := 0;
  _goods_returned NUMERIC := 0;
  _sales NUMERIC := 0;
  _discounts NUMERIC := 0;
  _cash NUMERIC := 0;
  _remaining_goods NUMERIC;
  _remaining_cash NUMERIC;
  _existing UUID;
  _id UUID;
BEGIN
  IF NOT (public.has_role(_uid,'general_manager') OR public.has_role(_uid,'executive_manager')
          OR public.has_role(_uid,'warehouse_supervisor') OR public.has_role(_uid,'financial_manager')) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  SELECT id INTO _existing FROM public.courier_daily_closures
    WHERE custody_id=_custody_id AND closure_date=_date;
  IF _existing IS NOT NULL THEN
    RAISE EXCEPTION 'هذا اليوم مغلق بالفعل';
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN line_type='issue' THEN total_value END),0),
    COALESCE(SUM(CASE WHEN line_type='return' THEN total_value END),0),
    COALESCE(SUM(CASE WHEN line_type='sale' THEN total_value END),0),
    COALESCE(SUM(CASE WHEN line_type='sale' THEN discount_amount END),0),
    COALESCE(SUM(CASE WHEN line_type='cash_collect' THEN cash_collected END),0)
  INTO _goods_out, _goods_returned, _sales, _discounts, _cash
  FROM public.courier_goods_custody_lines
  WHERE custody_id=_custody_id AND performed_at::DATE <= _date;

  _remaining_goods := _goods_out - _goods_returned - _sales;
  _remaining_cash := _sales - _cash;

  INSERT INTO public.courier_daily_closures(
    custody_id, closure_date, goods_out, goods_returned, sales_value, discounts_value,
    cash_collected, remaining_goods, remaining_cash, deficit_or_surplus,
    status, closed_by
  ) VALUES (
    _custody_id, _date, _goods_out, _goods_returned, _sales, _discounts,
    _cash, _remaining_goods, _remaining_cash, _remaining_cash, -- deficit (positive) أو زيادة (negative)
    'closed', _uid
  ) RETURNING id INTO _id;

  RETURN _id;
END;$$;

CREATE OR REPLACE FUNCTION public.reopen_courier_day(_closure_id UUID, _reason TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF NOT (public.has_role(_uid,'general_manager') OR public.has_role(_uid,'executive_manager')) THEN
    RAISE EXCEPTION 'إعادة الفتح متاحة للمدير العام/التنفيذي فقط';
  END IF;
  UPDATE public.courier_daily_closures
    SET status='reopened', reopened_by=_uid, reopened_at=now(), reopen_reason=_reason
    WHERE id=_closure_id AND status='closed';
  IF NOT FOUND THEN RAISE EXCEPTION 'لا يوجد إغلاق مغلق بهذا المعرّف'; END IF;
  RETURN _closure_id;
END;$$;

CREATE OR REPLACE FUNCTION public.pay_courier_commission(_courier_name TEXT, _amount NUMERIC, _notes TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _txn_id UUID;
  _payout_id UUID;
BEGIN
  IF NOT (public.has_role(_uid,'general_manager') OR public.has_role(_uid,'executive_manager') OR public.has_role(_uid,'financial_manager')) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'مبلغ غير صحيح'; END IF;

  INSERT INTO public.main_warehouse_treasury_txns(
    direction, category, amount, notes, performed_by, status, courier_name
  ) VALUES (
    'out','manual_adjust',_amount,
    'صرف عمولة مندوب — ' || _courier_name || COALESCE(' | ' || _notes,''),
    _uid,'posted',_courier_name
  ) RETURNING id INTO _txn_id;

  INSERT INTO public.courier_commission_payouts(
    courier_name, amount, notes, performed_by, treasury_txn_id
  ) VALUES (_courier_name, _amount, _notes, _uid, _txn_id)
  RETURNING id INTO _payout_id;

  RETURN _payout_id;
END;$$;

GRANT EXECUTE ON FUNCTION public.approve_courier_credit_override(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_courier_credit_override(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_courier_day(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_courier_day(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_courier_commission(TEXT, NUMERIC, TEXT) TO authenticated;
