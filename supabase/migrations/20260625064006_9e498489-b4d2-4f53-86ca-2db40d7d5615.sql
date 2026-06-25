
-- =========================================================
-- 1) MAIN WAREHOUSE TREASURY RECONCILIATIONS (cash count)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.main_warehouse_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  book_balance NUMERIC(14,2) NOT NULL,
  physical_cash NUMERIC(14,2) NOT NULL,
  difference NUMERIC(14,2) GENERATED ALWAYS AS (physical_cash - book_balance) STORED,
  reason TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  performed_by UUID,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  adjustment_txn_id UUID, -- pointer to main_warehouse_treasury_txns when difference posted
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mwr_performed_at ON public.main_warehouse_reconciliations(performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_mwr_status ON public.main_warehouse_reconciliations(status);

GRANT SELECT, INSERT, UPDATE ON public.main_warehouse_reconciliations TO authenticated;
GRANT ALL ON public.main_warehouse_reconciliations TO service_role;

ALTER TABLE public.main_warehouse_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mwr_select_authed" ON public.main_warehouse_reconciliations
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "mwr_insert_authed" ON public.main_warehouse_reconciliations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'financial_manager')
    OR public.has_role(auth.uid(),'warehouse_supervisor')
  );

-- Only approvers may UPDATE (approve/reject). Pending owner cannot edit after submit.
CREATE POLICY "mwr_update_approvers" ON public.main_warehouse_reconciliations
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'financial_manager')
  )
  WITH CHECK (
    public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'financial_manager')
  );

-- =========================================================
-- 2) COURIER GOODS CUSTODY (goods issued to a courier)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.courier_goods_custodies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  opened_by UUID,
  closed_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cgc_courier ON public.courier_goods_custodies(courier_name);
CREATE INDEX IF NOT EXISTS idx_cgc_status ON public.courier_goods_custodies(status);

GRANT SELECT, INSERT, UPDATE ON public.courier_goods_custodies TO authenticated;
GRANT ALL ON public.courier_goods_custodies TO service_role;

ALTER TABLE public.courier_goods_custodies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cgc_select_authed" ON public.courier_goods_custodies
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "cgc_write_authed" ON public.courier_goods_custodies
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'financial_manager')
    OR public.has_role(auth.uid(),'warehouse_supervisor')
  );

CREATE POLICY "cgc_update_authed" ON public.courier_goods_custodies
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'financial_manager')
    OR public.has_role(auth.uid(),'warehouse_supervisor')
  );

CREATE TABLE IF NOT EXISTS public.courier_goods_custody_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  custody_id UUID NOT NULL REFERENCES public.courier_goods_custodies(id) ON DELETE CASCADE,
  line_type TEXT NOT NULL CHECK (line_type IN ('issue','return','sale','cash_collect')),
  product_name TEXT,
  inventory_item_id UUID,
  quantity NUMERIC(14,3),
  unit TEXT,
  unit_price NUMERIC(14,2),
  total_value NUMERIC(14,2),
  cash_collected NUMERIC(14,2),
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  performed_by UUID,
  notes TEXT,
  inventory_movement_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cgcl_custody ON public.courier_goods_custody_lines(custody_id);
CREATE INDEX IF NOT EXISTS idx_cgcl_type ON public.courier_goods_custody_lines(line_type);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.courier_goods_custody_lines TO authenticated;
GRANT ALL ON public.courier_goods_custody_lines TO service_role;

ALTER TABLE public.courier_goods_custody_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cgcl_select_authed" ON public.courier_goods_custody_lines
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "cgcl_write_authed" ON public.courier_goods_custody_lines
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'financial_manager')
    OR public.has_role(auth.uid(),'warehouse_supervisor')
  )
  WITH CHECK (
    public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'financial_manager')
    OR public.has_role(auth.uid(),'warehouse_supervisor')
  );

-- =========================================================
-- 3) RPC: approve a reconciliation, post adjustment if needed
-- =========================================================
CREATE OR REPLACE FUNCTION public.approve_warehouse_reconciliation(_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.main_warehouse_reconciliations%ROWTYPE;
  _txn_id UUID;
  _uid UUID := auth.uid();
BEGIN
  IF NOT (
    public.has_role(_uid,'general_manager')
    OR public.has_role(_uid,'executive_manager')
    OR public.has_role(_uid,'financial_manager')
  ) THEN
    RAISE EXCEPTION 'غير مصرح: يلزم اعتماد المدير العام/التنفيذي/المالي';
  END IF;

  SELECT * INTO _row FROM public.main_warehouse_reconciliations WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الجرد غير موجود'; END IF;
  IF _row.status <> 'pending' THEN RAISE EXCEPTION 'لا يمكن اعتماد جرد بحالة %', _row.status; END IF;

  IF _row.difference <> 0 THEN
    INSERT INTO public.main_warehouse_treasury_txns(
      direction, category, amount, notes, performed_by, status, performed_at
    ) VALUES (
      CASE WHEN _row.difference > 0 THEN 'in' ELSE 'out' END,
      'manual_adjust',
      ABS(_row.difference),
      COALESCE('تسوية جرد خزينة المخزن الرئيسي — ' || COALESCE(_row.reason,'بدون سبب موضّح'), 'تسوية جرد'),
      _uid,
      'posted',
      now()
    ) RETURNING id INTO _txn_id;
  END IF;

  UPDATE public.main_warehouse_reconciliations
    SET status='approved', approved_by=_uid, approved_at=now(), adjustment_txn_id=_txn_id, updated_at=now()
    WHERE id=_id;

  RETURN _id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_warehouse_reconciliation(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_warehouse_reconciliation(_id UUID, _reason TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF NOT (
    public.has_role(_uid,'general_manager')
    OR public.has_role(_uid,'executive_manager')
    OR public.has_role(_uid,'financial_manager')
  ) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  UPDATE public.main_warehouse_reconciliations
    SET status='rejected', approved_by=_uid, approved_at=now(), rejection_reason=_reason, updated_at=now()
    WHERE id=_id AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'لا يمكن رفض جرد غير معلّق'; END IF;
  RETURN _id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_warehouse_reconciliation(UUID, TEXT) TO authenticated;

-- updated_at triggers
DROP TRIGGER IF EXISTS trg_mwr_updated_at ON public.main_warehouse_reconciliations;
CREATE TRIGGER trg_mwr_updated_at BEFORE UPDATE ON public.main_warehouse_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_cgc_updated_at ON public.courier_goods_custodies;
CREATE TRIGGER trg_cgc_updated_at BEFORE UPDATE ON public.courier_goods_custodies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
