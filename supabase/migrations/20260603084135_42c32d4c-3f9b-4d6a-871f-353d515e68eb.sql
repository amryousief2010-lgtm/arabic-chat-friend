-- ============================================================
-- MEAT FACTORY: independent tables, RPCs, RLS
-- ============================================================

-- ---------- RAW ITEMS ----------
CREATE TABLE public.meat_factory_raw_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'كجم',
  current_stock NUMERIC NOT NULL DEFAULT 0,
  avg_cost NUMERIC NOT NULL DEFAULT 0,
  low_stock_threshold NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meat_factory_raw_items TO authenticated;
GRANT ALL ON public.meat_factory_raw_items TO service_role;
ALTER TABLE public.meat_factory_raw_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meat_raw_read" ON public.meat_factory_raw_items FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
  OR public.has_role(auth.uid(),'accountant') OR public.has_role(auth.uid(),'financial_manager')
);
CREATE POLICY "meat_raw_write" ON public.meat_factory_raw_items FOR ALL TO authenticated USING (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
) WITH CHECK (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
);

-- ---------- FINISHED ITEMS ----------
CREATE TABLE public.meat_factory_finished_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'كجم',
  current_stock NUMERIC NOT NULL DEFAULT 0,
  avg_cost NUMERIC NOT NULL DEFAULT 0,
  sale_price NUMERIC NOT NULL DEFAULT 0,
  low_stock_threshold NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meat_factory_finished_items TO authenticated;
GRANT ALL ON public.meat_factory_finished_items TO service_role;
ALTER TABLE public.meat_factory_finished_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meat_fin_read" ON public.meat_factory_finished_items FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
  OR public.has_role(auth.uid(),'accountant') OR public.has_role(auth.uid(),'financial_manager')
);
CREATE POLICY "meat_fin_write" ON public.meat_factory_finished_items FOR ALL TO authenticated USING (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
) WITH CHECK (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
);

-- ---------- INVENTORY MOVES ----------
CREATE TABLE public.meat_factory_inventory_moves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_kind TEXT NOT NULL CHECK (item_kind IN ('raw','finished')),
  item_id UUID NOT NULL,
  item_name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  quantity NUMERIC NOT NULL,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  ref_table TEXT,
  ref_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.meat_factory_inventory_moves TO authenticated;
GRANT ALL ON public.meat_factory_inventory_moves TO service_role;
ALTER TABLE public.meat_factory_inventory_moves ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meat_moves_read" ON public.meat_factory_inventory_moves FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
  OR public.has_role(auth.uid(),'accountant') OR public.has_role(auth.uid(),'financial_manager')
);

-- ---------- TREASURY ----------
CREATE TABLE public.meat_factory_treasury_txns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_date DATE NOT NULL DEFAULT CURRENT_DATE,
  direction TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  amount NUMERIC NOT NULL CHECK (amount >= 0),
  reason TEXT NOT NULL,
  ref_table TEXT,
  ref_id UUID,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.meat_factory_treasury_txns TO authenticated;
GRANT ALL ON public.meat_factory_treasury_txns TO service_role;
ALTER TABLE public.meat_factory_treasury_txns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meat_treasury_read" ON public.meat_factory_treasury_txns FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
  OR public.has_role(auth.uid(),'accountant') OR public.has_role(auth.uid(),'financial_manager')
);
CREATE POLICY "meat_treasury_insert" ON public.meat_factory_treasury_txns FOR INSERT TO authenticated WITH CHECK (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'accountant') OR public.has_role(auth.uid(),'financial_manager')
);

-- ---------- PURCHASES ----------
CREATE TABLE public.meat_factory_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier TEXT,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','credit')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','cancelled')),
  notes TEXT,
  treasury_txn_id UUID,
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meat_factory_purchases TO authenticated;
GRANT ALL ON public.meat_factory_purchases TO service_role;
ALTER TABLE public.meat_factory_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meat_pur_all" ON public.meat_factory_purchases FOR ALL TO authenticated USING (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
  OR public.has_role(auth.uid(),'accountant') OR public.has_role(auth.uid(),'financial_manager')
) WITH CHECK (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
  OR public.has_role(auth.uid(),'accountant') OR public.has_role(auth.uid(),'financial_manager')
);

CREATE TABLE public.meat_factory_purchase_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES public.meat_factory_purchases(id) ON DELETE CASCADE,
  raw_item_id UUID NOT NULL REFERENCES public.meat_factory_raw_items(id),
  raw_item_name TEXT NOT NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meat_factory_purchase_lines TO authenticated;
GRANT ALL ON public.meat_factory_purchase_lines TO service_role;
ALTER TABLE public.meat_factory_purchase_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meat_pur_lines_all" ON public.meat_factory_purchase_lines FOR ALL TO authenticated USING (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
  OR public.has_role(auth.uid(),'accountant') OR public.has_role(auth.uid(),'financial_manager')
) WITH CHECK (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
  OR public.has_role(auth.uid(),'accountant') OR public.has_role(auth.uid(),'financial_manager')
);

-- ---------- MANUFACTURING ----------
CREATE TABLE public.meat_factory_manufacturing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL UNIQUE DEFAULT ('MFG-' || to_char(now(),'YYMMDDHH24MISSMS')),
  mfg_date DATE NOT NULL DEFAULT CURRENT_DATE,
  finished_item_id UUID NOT NULL REFERENCES public.meat_factory_finished_items(id),
  finished_item_name TEXT NOT NULL,
  produced_qty NUMERIC NOT NULL CHECK (produced_qty > 0),
  total_cost NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','cancelled')),
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meat_factory_manufacturing TO authenticated;
GRANT ALL ON public.meat_factory_manufacturing TO service_role;
ALTER TABLE public.meat_factory_manufacturing ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meat_mfg_all" ON public.meat_factory_manufacturing FOR ALL TO authenticated USING (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
) WITH CHECK (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
);

CREATE TABLE public.meat_factory_manufacturing_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manufacturing_id UUID NOT NULL REFERENCES public.meat_factory_manufacturing(id) ON DELETE CASCADE,
  raw_item_id UUID NOT NULL REFERENCES public.meat_factory_raw_items(id),
  raw_item_name TEXT NOT NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  line_total NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meat_factory_manufacturing_lines TO authenticated;
GRANT ALL ON public.meat_factory_manufacturing_lines TO service_role;
ALTER TABLE public.meat_factory_manufacturing_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meat_mfg_lines_all" ON public.meat_factory_manufacturing_lines FOR ALL TO authenticated USING (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
) WITH CHECK (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
);

-- ---------- SALES ----------
CREATE TABLE public.meat_factory_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL UNIQUE DEFAULT ('SAL-' || to_char(now(),'YYMMDDHH24MISSMS')),
  sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
  customer TEXT,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','credit')),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','cancelled')),
  treasury_txn_id UUID,
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meat_factory_sales TO authenticated;
GRANT ALL ON public.meat_factory_sales TO service_role;
ALTER TABLE public.meat_factory_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meat_sal_all" ON public.meat_factory_sales FOR ALL TO authenticated USING (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
  OR public.has_role(auth.uid(),'accountant') OR public.has_role(auth.uid(),'financial_manager')
) WITH CHECK (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
  OR public.has_role(auth.uid(),'accountant') OR public.has_role(auth.uid(),'financial_manager')
);

CREATE TABLE public.meat_factory_sales_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.meat_factory_sales(id) ON DELETE CASCADE,
  finished_item_id UUID NOT NULL REFERENCES public.meat_factory_finished_items(id),
  finished_item_name TEXT NOT NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
  unit_cost_snapshot NUMERIC NOT NULL DEFAULT 0,
  line_total NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meat_factory_sales_lines TO authenticated;
GRANT ALL ON public.meat_factory_sales_lines TO service_role;
ALTER TABLE public.meat_factory_sales_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meat_sal_lines_all" ON public.meat_factory_sales_lines FOR ALL TO authenticated USING (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
  OR public.has_role(auth.uid(),'accountant') OR public.has_role(auth.uid(),'financial_manager')
) WITH CHECK (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
  OR public.has_role(auth.uid(),'accountant') OR public.has_role(auth.uid(),'financial_manager')
);

-- ---------- SALES RETURNS ----------
CREATE TABLE public.meat_factory_sales_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number TEXT NOT NULL UNIQUE DEFAULT ('RET-' || to_char(now(),'YYMMDDHH24MISSMS')),
  return_date DATE NOT NULL DEFAULT CURRENT_DATE,
  original_sale_id UUID REFERENCES public.meat_factory_sales(id),
  customer TEXT,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  reason TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','cancelled')),
  stock_movement_id UUID,
  cash_transaction_id UUID,
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meat_factory_sales_returns TO authenticated;
GRANT ALL ON public.meat_factory_sales_returns TO service_role;
ALTER TABLE public.meat_factory_sales_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meat_ret_all" ON public.meat_factory_sales_returns FOR ALL TO authenticated USING (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
  OR public.has_role(auth.uid(),'accountant') OR public.has_role(auth.uid(),'financial_manager')
) WITH CHECK (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
  OR public.has_role(auth.uid(),'accountant') OR public.has_role(auth.uid(),'financial_manager')
);

CREATE TABLE public.meat_factory_sales_return_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES public.meat_factory_sales_returns(id) ON DELETE CASCADE,
  finished_item_id UUID NOT NULL REFERENCES public.meat_factory_finished_items(id),
  finished_item_name TEXT NOT NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meat_factory_sales_return_lines TO authenticated;
GRANT ALL ON public.meat_factory_sales_return_lines TO service_role;
ALTER TABLE public.meat_factory_sales_return_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meat_ret_lines_all" ON public.meat_factory_sales_return_lines FOR ALL TO authenticated USING (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
  OR public.has_role(auth.uid(),'accountant') OR public.has_role(auth.uid(),'financial_manager')
) WITH CHECK (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
  OR public.has_role(auth.uid(),'accountant') OR public.has_role(auth.uid(),'financial_manager')
);

-- ---------- STOCKTAKING ----------
CREATE TABLE public.meat_factory_stocktaking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taken_date DATE NOT NULL DEFAULT CURRENT_DATE,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('raw','finished')),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meat_factory_stocktaking TO authenticated;
GRANT ALL ON public.meat_factory_stocktaking TO service_role;
ALTER TABLE public.meat_factory_stocktaking ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meat_stk_all" ON public.meat_factory_stocktaking FOR ALL TO authenticated USING (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
) WITH CHECK (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
);

CREATE TABLE public.meat_factory_stocktaking_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stocktake_id UUID NOT NULL REFERENCES public.meat_factory_stocktaking(id) ON DELETE CASCADE,
  item_id UUID NOT NULL,
  item_name TEXT NOT NULL,
  system_qty NUMERIC NOT NULL,
  actual_qty NUMERIC NOT NULL,
  diff_qty NUMERIC NOT NULL,
  diff_value NUMERIC NOT NULL DEFAULT 0,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meat_factory_stocktaking_lines TO authenticated;
GRANT ALL ON public.meat_factory_stocktaking_lines TO service_role;
ALTER TABLE public.meat_factory_stocktaking_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meat_stk_lines_all" ON public.meat_factory_stocktaking_lines FOR ALL TO authenticated USING (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
) WITH CHECK (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'meat_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
);

-- ============================================================
-- TRIGGERS for updated_at
-- ============================================================
CREATE TRIGGER mf_raw_upd BEFORE UPDATE ON public.meat_factory_raw_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER mf_fin_upd BEFORE UPDATE ON public.meat_factory_finished_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER mf_pur_upd BEFORE UPDATE ON public.meat_factory_purchases
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER mf_mfg_upd BEFORE UPDATE ON public.meat_factory_manufacturing
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER mf_sal_upd BEFORE UPDATE ON public.meat_factory_sales
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER mf_ret_upd BEFORE UPDATE ON public.meat_factory_sales_returns
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- RPC: APPROVE PURCHASE
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_meat_purchase(p_purchase_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_p RECORD; v_line RECORD; v_txn UUID; v_new_avg NUMERIC; v_old_stock NUMERIC; v_old_cost NUMERIC;
BEGIN
  IF NOT (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
      OR has_role(auth.uid(),'meat_factory_manager') OR has_role(auth.uid(),'warehouse_supervisor')
      OR has_role(auth.uid(),'accountant') OR has_role(auth.uid(),'financial_manager')) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  SELECT * INTO v_p FROM meat_factory_purchases WHERE id=p_purchase_id FOR UPDATE;
  IF v_p.id IS NULL THEN RAISE EXCEPTION 'فاتورة غير موجودة'; END IF;
  IF v_p.status='approved' THEN RAISE EXCEPTION 'الفاتورة معتمدة بالفعل'; END IF;

  FOR v_line IN SELECT * FROM meat_factory_purchase_lines WHERE purchase_id=p_purchase_id LOOP
    SELECT current_stock, avg_cost INTO v_old_stock, v_old_cost FROM meat_factory_raw_items WHERE id=v_line.raw_item_id FOR UPDATE;
    v_new_avg := CASE WHEN (v_old_stock + v_line.quantity)=0 THEN v_line.unit_price
                      ELSE ((v_old_stock*v_old_cost)+(v_line.quantity*v_line.unit_price))/(v_old_stock+v_line.quantity) END;
    UPDATE meat_factory_raw_items SET current_stock=v_old_stock+v_line.quantity, avg_cost=v_new_avg, updated_at=now()
      WHERE id=v_line.raw_item_id;
    INSERT INTO meat_factory_inventory_moves(item_kind,item_id,item_name,direction,quantity,unit_cost,reason,ref_table,ref_id,created_by)
      VALUES('raw',v_line.raw_item_id,v_line.raw_item_name,'IN',v_line.quantity,v_line.unit_price,'شراء خامات','meat_factory_purchases',p_purchase_id,auth.uid());
  END LOOP;

  IF v_p.payment_method='cash' AND v_p.total_amount>0 THEN
    INSERT INTO meat_factory_treasury_txns(txn_date,direction,amount,reason,ref_table,ref_id,created_by)
      VALUES(v_p.purchase_date,'OUT',v_p.total_amount,'شراء خامات مصنع اللحوم','meat_factory_purchases',p_purchase_id,auth.uid())
      RETURNING id INTO v_txn;
  END IF;

  UPDATE meat_factory_purchases SET status='approved', approved_at=now(), approved_by=auth.uid(), treasury_txn_id=v_txn WHERE id=p_purchase_id;
  RETURN p_purchase_id;
END $$;
GRANT EXECUTE ON FUNCTION public.approve_meat_purchase(UUID) TO authenticated;

-- ============================================================
-- RPC: APPROVE MANUFACTURING
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_meat_manufacturing(p_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m RECORD; v_line RECORD; v_total NUMERIC := 0; v_old_stock NUMERIC; v_old_cost NUMERIC; v_new_avg NUMERIC;
BEGIN
  IF NOT (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
      OR has_role(auth.uid(),'meat_factory_manager') OR has_role(auth.uid(),'warehouse_supervisor')) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  SELECT * INTO v_m FROM meat_factory_manufacturing WHERE id=p_id FOR UPDATE;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'فاتورة غير موجودة'; END IF;
  IF v_m.status='approved' THEN RAISE EXCEPTION 'الفاتورة معتمدة بالفعل'; END IF;

  -- check raw availability
  FOR v_line IN SELECT * FROM meat_factory_manufacturing_lines WHERE manufacturing_id=p_id LOOP
    SELECT current_stock INTO v_old_stock FROM meat_factory_raw_items WHERE id=v_line.raw_item_id FOR UPDATE;
    IF v_old_stock < v_line.quantity THEN
      RAISE EXCEPTION 'الخامة % غير كافية (المتاح %, المطلوب %)', v_line.raw_item_name, v_old_stock, v_line.quantity;
    END IF;
  END LOOP;

  -- deduct raws & compute cost
  FOR v_line IN SELECT * FROM meat_factory_manufacturing_lines WHERE manufacturing_id=p_id LOOP
    SELECT current_stock, avg_cost INTO v_old_stock, v_old_cost FROM meat_factory_raw_items WHERE id=v_line.raw_item_id;
    UPDATE meat_factory_manufacturing_lines SET unit_cost=v_old_cost, line_total=v_line.quantity*v_old_cost WHERE id=v_line.id;
    v_total := v_total + (v_line.quantity*v_old_cost);
    UPDATE meat_factory_raw_items SET current_stock=v_old_stock-v_line.quantity, updated_at=now() WHERE id=v_line.raw_item_id;
    INSERT INTO meat_factory_inventory_moves(item_kind,item_id,item_name,direction,quantity,unit_cost,reason,ref_table,ref_id,created_by)
      VALUES('raw',v_line.raw_item_id,v_line.raw_item_name,'OUT',v_line.quantity,v_old_cost,'استهلاك تصنيع','meat_factory_manufacturing',p_id,auth.uid());
  END LOOP;

  -- add finished product
  SELECT current_stock, avg_cost INTO v_old_stock, v_old_cost FROM meat_factory_finished_items WHERE id=v_m.finished_item_id FOR UPDATE;
  v_new_avg := CASE WHEN (v_old_stock + v_m.produced_qty)=0 THEN (v_total/NULLIF(v_m.produced_qty,0))
                    ELSE ((v_old_stock*v_old_cost)+v_total)/(v_old_stock+v_m.produced_qty) END;
  UPDATE meat_factory_finished_items SET current_stock=v_old_stock+v_m.produced_qty, avg_cost=v_new_avg, updated_at=now()
    WHERE id=v_m.finished_item_id;

  INSERT INTO meat_factory_inventory_moves(item_kind,item_id,item_name,direction,quantity,unit_cost,reason,ref_table,ref_id,created_by)
    VALUES('finished',v_m.finished_item_id,v_m.finished_item_name,'IN',v_m.produced_qty, v_total/NULLIF(v_m.produced_qty,0),'إنتاج تصنيع','meat_factory_manufacturing',p_id,auth.uid());

  UPDATE meat_factory_manufacturing SET status='approved', approved_at=now(), approved_by=auth.uid(),
    total_cost=v_total, unit_cost=v_total/NULLIF(v_m.produced_qty,0) WHERE id=p_id;
  RETURN p_id;
END $$;
GRANT EXECUTE ON FUNCTION public.approve_meat_manufacturing(UUID) TO authenticated;

-- ============================================================
-- RPC: APPROVE SALE
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_meat_sale(p_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_s RECORD; v_line RECORD; v_old_stock NUMERIC; v_old_cost NUMERIC; v_txn UUID;
BEGIN
  IF NOT (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
      OR has_role(auth.uid(),'meat_factory_manager') OR has_role(auth.uid(),'warehouse_supervisor')
      OR has_role(auth.uid(),'accountant') OR has_role(auth.uid(),'financial_manager')) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  SELECT * INTO v_s FROM meat_factory_sales WHERE id=p_id FOR UPDATE;
  IF v_s.id IS NULL THEN RAISE EXCEPTION 'فاتورة غير موجودة'; END IF;
  IF v_s.status='approved' THEN RAISE EXCEPTION 'الفاتورة معتمدة بالفعل'; END IF;

  FOR v_line IN SELECT * FROM meat_factory_sales_lines WHERE sale_id=p_id LOOP
    SELECT current_stock, avg_cost INTO v_old_stock, v_old_cost FROM meat_factory_finished_items WHERE id=v_line.finished_item_id FOR UPDATE;
    IF v_old_stock < v_line.quantity THEN
      RAISE EXCEPTION 'المنتج % غير كافي (المتاح %, المطلوب %)', v_line.finished_item_name, v_old_stock, v_line.quantity;
    END IF;
    UPDATE meat_factory_finished_items SET current_stock=v_old_stock-v_line.quantity, updated_at=now() WHERE id=v_line.finished_item_id;
    UPDATE meat_factory_sales_lines SET unit_cost_snapshot=v_old_cost WHERE id=v_line.id;
    INSERT INTO meat_factory_inventory_moves(item_kind,item_id,item_name,direction,quantity,unit_cost,reason,ref_table,ref_id,created_by)
      VALUES('finished',v_line.finished_item_id,v_line.finished_item_name,'OUT',v_line.quantity,v_old_cost,'بيع','meat_factory_sales',p_id,auth.uid());
  END LOOP;

  IF v_s.payment_method='cash' AND v_s.total_amount>0 THEN
    INSERT INTO meat_factory_treasury_txns(txn_date,direction,amount,reason,ref_table,ref_id,created_by)
      VALUES(v_s.sale_date,'IN',v_s.total_amount,'بيع منتجات مصنع اللحوم','meat_factory_sales',p_id,auth.uid())
      RETURNING id INTO v_txn;
  END IF;

  UPDATE meat_factory_sales SET status='approved', approved_at=now(), approved_by=auth.uid(), treasury_txn_id=v_txn WHERE id=p_id;
  RETURN p_id;
END $$;
GRANT EXECUTE ON FUNCTION public.approve_meat_sale(UUID) TO authenticated;

-- ============================================================
-- RPC: APPROVE SALES RETURN
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_meat_sales_return(p_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r RECORD; v_line RECORD; v_txn UUID; v_first_move UUID; v_move UUID; v_old_stock NUMERIC; v_old_cost NUMERIC;
BEGIN
  IF NOT (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
      OR has_role(auth.uid(),'meat_factory_manager') OR has_role(auth.uid(),'warehouse_supervisor')
      OR has_role(auth.uid(),'accountant') OR has_role(auth.uid(),'financial_manager')) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  SELECT * INTO v_r FROM meat_factory_sales_returns WHERE id=p_id FOR UPDATE;
  IF v_r.id IS NULL THEN RAISE EXCEPTION 'المرتجع غير موجود'; END IF;
  IF v_r.status='approved' THEN RAISE EXCEPTION 'المرتجع معتمد بالفعل'; END IF;
  IF v_r.stock_movement_id IS NOT NULL OR v_r.cash_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'المرتجع له تأثير سابق';
  END IF;

  FOR v_line IN SELECT * FROM meat_factory_sales_return_lines WHERE return_id=p_id LOOP
    SELECT current_stock, avg_cost INTO v_old_stock, v_old_cost FROM meat_factory_finished_items WHERE id=v_line.finished_item_id FOR UPDATE;
    UPDATE meat_factory_finished_items SET current_stock=v_old_stock+v_line.quantity, updated_at=now() WHERE id=v_line.finished_item_id;
    INSERT INTO meat_factory_inventory_moves(item_kind,item_id,item_name,direction,quantity,unit_cost,reason,ref_table,ref_id,created_by)
      VALUES('finished',v_line.finished_item_id,v_line.finished_item_name,'IN',v_line.quantity,v_old_cost,'مرتجع مبيعات','meat_factory_sales_returns',p_id,auth.uid())
      RETURNING id INTO v_move;
    IF v_first_move IS NULL THEN v_first_move := v_move; END IF;
  END LOOP;

  IF v_r.total_amount>0 THEN
    INSERT INTO meat_factory_treasury_txns(txn_date,direction,amount,reason,ref_table,ref_id,created_by)
      VALUES(v_r.return_date,'OUT',v_r.total_amount,'رد قيمة مرتجع','meat_factory_sales_returns',p_id,auth.uid())
      RETURNING id INTO v_txn;
  END IF;

  UPDATE meat_factory_sales_returns SET status='approved', approved_at=now(), approved_by=auth.uid(),
    stock_movement_id=v_first_move, cash_transaction_id=v_txn WHERE id=p_id;
  RETURN p_id;
END $$;
GRANT EXECUTE ON FUNCTION public.approve_meat_sales_return(UUID) TO authenticated;

-- ============================================================
-- RPC: CANCEL SALES RETURN
-- ============================================================
CREATE OR REPLACE FUNCTION public.cancel_meat_sales_return(p_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r RECORD; v_line RECORD; v_old_stock NUMERIC;
BEGIN
  IF NOT (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')) THEN
    RAISE EXCEPTION 'غير مصرح — للمدير العام أو التنفيذي فقط';
  END IF;
  SELECT * INTO v_r FROM meat_factory_sales_returns WHERE id=p_id FOR UPDATE;
  IF v_r.id IS NULL THEN RAISE EXCEPTION 'المرتجع غير موجود'; END IF;
  IF v_r.status<>'approved' THEN RAISE EXCEPTION 'لا يمكن إلغاء مرتجع غير معتمد'; END IF;

  FOR v_line IN SELECT * FROM meat_factory_sales_return_lines WHERE return_id=p_id LOOP
    SELECT current_stock INTO v_old_stock FROM meat_factory_finished_items WHERE id=v_line.finished_item_id FOR UPDATE;
    UPDATE meat_factory_finished_items SET current_stock=v_old_stock-v_line.quantity, updated_at=now() WHERE id=v_line.finished_item_id;
    INSERT INTO meat_factory_inventory_moves(item_kind,item_id,item_name,direction,quantity,unit_cost,reason,ref_table,ref_id,created_by)
      VALUES('finished',v_line.finished_item_id,v_line.finished_item_name,'OUT',v_line.quantity,0,'إلغاء مرتجع مبيعات','meat_factory_sales_returns',p_id,auth.uid());
  END LOOP;

  IF v_r.total_amount>0 THEN
    INSERT INTO meat_factory_treasury_txns(txn_date,direction,amount,reason,ref_table,ref_id,created_by)
      VALUES(CURRENT_DATE,'IN',v_r.total_amount,'إلغاء مرتجع — استرداد للخزنة','meat_factory_sales_returns',p_id,auth.uid());
  END IF;

  UPDATE meat_factory_sales_returns SET status='cancelled', cancelled_at=now(), cancelled_by=auth.uid() WHERE id=p_id;
  RETURN p_id;
END $$;
GRANT EXECUTE ON FUNCTION public.cancel_meat_sales_return(UUID) TO authenticated;

-- ============================================================
-- RPC: APPLY STOCKTAKE
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_meat_stocktake(p_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_s RECORD; v_line RECORD; v_dir TEXT; v_qty NUMERIC; v_cost NUMERIC;
BEGIN
  IF NOT (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
      OR has_role(auth.uid(),'meat_factory_manager')) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  SELECT * INTO v_s FROM meat_factory_stocktaking WHERE id=p_id FOR UPDATE;
  IF v_s.id IS NULL THEN RAISE EXCEPTION 'الجرد غير موجود'; END IF;
  IF v_s.status='approved' THEN RAISE EXCEPTION 'الجرد معتمد بالفعل'; END IF;

  FOR v_line IN SELECT * FROM meat_factory_stocktaking_lines WHERE stocktake_id=p_id LOOP
    IF v_line.diff_qty = 0 THEN CONTINUE; END IF;
    v_dir := CASE WHEN v_line.diff_qty>0 THEN 'IN' ELSE 'OUT' END;
    v_qty := ABS(v_line.diff_qty);
    IF v_s.item_kind='raw' THEN
      SELECT avg_cost INTO v_cost FROM meat_factory_raw_items WHERE id=v_line.item_id;
      UPDATE meat_factory_raw_items SET current_stock=v_line.actual_qty, updated_at=now() WHERE id=v_line.item_id;
    ELSE
      SELECT avg_cost INTO v_cost FROM meat_factory_finished_items WHERE id=v_line.item_id;
      UPDATE meat_factory_finished_items SET current_stock=v_line.actual_qty, updated_at=now() WHERE id=v_line.item_id;
    END IF;
    INSERT INTO meat_factory_inventory_moves(item_kind,item_id,item_name,direction,quantity,unit_cost,reason,ref_table,ref_id,created_by)
      VALUES(v_s.item_kind,v_line.item_id,v_line.item_name,v_dir,v_qty,COALESCE(v_cost,0),'تسوية جرد','meat_factory_stocktaking',p_id,auth.uid());
  END LOOP;

  UPDATE meat_factory_stocktaking SET status='approved', approved_at=now(), approved_by=auth.uid() WHERE id=p_id;
  RETURN p_id;
END $$;
GRANT EXECUTE ON FUNCTION public.apply_meat_stocktake(UUID) TO authenticated;
