
CREATE TABLE public.meat_raw_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE, name_ar TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'كجم',
  stock NUMERIC NOT NULL DEFAULT 0, avg_cost NUMERIC NOT NULL DEFAULT 0,
  reorder_level NUMERIC NOT NULL DEFAULT 0, last_movement_at TIMESTAMPTZ,
  notes TEXT, is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.meat_raw_inventory TO authenticated;
GRANT ALL ON public.meat_raw_inventory TO service_role;
ALTER TABLE public.meat_raw_inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mri_r" ON public.meat_raw_inventory FOR SELECT TO authenticated USING (true);
CREATE POLICY "mri_w" ON public.meat_raw_inventory FOR ALL TO authenticated
  USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'))
  WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'));

CREATE TABLE public.meat_packaging_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE, name_ar TEXT NOT NULL, product_type TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'علبة', stock NUMERIC NOT NULL DEFAULT 0,
  avg_cost NUMERIC NOT NULL DEFAULT 0, reorder_level NUMERIC NOT NULL DEFAULT 0,
  last_movement_at TIMESTAMPTZ, is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.meat_packaging_inventory TO authenticated;
GRANT ALL ON public.meat_packaging_inventory TO service_role;
ALTER TABLE public.meat_packaging_inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mpi_r" ON public.meat_packaging_inventory FOR SELECT TO authenticated USING (true);
CREATE POLICY "mpi_w" ON public.meat_packaging_inventory FOR ALL TO authenticated
  USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'))
  WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'));

CREATE TABLE public.meat_finished_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE, name_ar TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'كجم',
  stock NUMERIC NOT NULL DEFAULT 0, avg_prod_cost NUMERIC NOT NULL DEFAULT 0,
  sale_price NUMERIC NOT NULL DEFAULT 0, reorder_level NUMERIC NOT NULL DEFAULT 0,
  last_movement_at TIMESTAMPTZ, is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.meat_finished_inventory TO authenticated;
GRANT ALL ON public.meat_finished_inventory TO service_role;
ALTER TABLE public.meat_finished_inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mfi_r" ON public.meat_finished_inventory FOR SELECT TO authenticated USING (true);
CREATE POLICY "mfi_w" ON public.meat_finished_inventory FOR ALL TO authenticated
  USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'))
  WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'));

CREATE TABLE public.mf_treasury (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_date DATE NOT NULL DEFAULT CURRENT_DATE,
  direction TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  amount NUMERIC NOT NULL CHECK (amount >= 0),
  source_type TEXT NOT NULL, source_id UUID, ref_no TEXT, notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.mf_treasury TO authenticated;
GRANT ALL ON public.mf_treasury TO service_role;
ALTER TABLE public.mf_treasury ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mft_r" ON public.mf_treasury FOR SELECT TO authenticated USING (true);
CREATE POLICY "mft_w" ON public.mf_treasury FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'));

CREATE SEQUENCE public.mf_log_seq START 1;
CREATE TABLE public.mf_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_no TEXT NOT NULL UNIQUE DEFAULT ('MF-LOG-' || lpad(nextval('public.mf_log_seq')::text, 5, '0')),
  movement_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  movement_type TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('IN','OUT','NONE')),
  item_kind TEXT NOT NULL CHECK (item_kind IN ('raw','pack','finished','treasury','none')),
  item_id UUID, item_name TEXT, qty NUMERIC, unit TEXT,
  unit_cost NUMERIC, total_value NUMERIC,
  from_party TEXT, to_party TEXT, ref_no TEXT, linked_id UUID,
  source_type TEXT, source_id UUID,
  status TEXT NOT NULL DEFAULT 'posted',
  created_by UUID REFERENCES auth.users(id),
  notes TEXT, metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.mf_log TO authenticated;
GRANT ALL ON public.mf_log TO service_role;
ALTER TABLE public.mf_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mfl_r" ON public.mf_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "mfl_w" ON public.mf_log FOR INSERT TO authenticated WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.prevent_mf_log_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.status = 'posted' THEN
    RAISE EXCEPTION 'لا يمكن تعديل أو حذف حركة معتمدة. استخدم حركة عكسية.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_prevent_mf_log_mutation BEFORE UPDATE OR DELETE ON public.mf_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_mf_log_mutation();

CREATE SEQUENCE public.mf_rp_seq START 1;
CREATE TABLE public.mf_raw_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no TEXT NOT NULL UNIQUE DEFAULT ('MF-RP-' || lpad(nextval('public.mf_rp_seq')::text, 5, '0')),
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','credit')),
  total_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  notes TEXT, posted_at TIMESTAMPTZ, posted_by UUID REFERENCES auth.users(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.mf_raw_purchase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES public.mf_raw_purchases(id) ON DELETE CASCADE,
  raw_id UUID NOT NULL REFERENCES public.meat_raw_inventory(id),
  qty NUMERIC NOT NULL CHECK (qty > 0),
  unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
  total NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.mf_raw_purchases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mf_raw_purchase_items TO authenticated;
GRANT ALL ON public.mf_raw_purchases, public.mf_raw_purchase_items TO service_role;
ALTER TABLE public.mf_raw_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mf_raw_purchase_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mrp_a" ON public.mf_raw_purchases FOR ALL TO authenticated
  USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'))
  WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'));
CREATE POLICY "mrpi_a" ON public.mf_raw_purchase_items FOR ALL TO authenticated
  USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'))
  WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'));

CREATE SEQUENCE public.mf_pp_seq START 1;
CREATE TABLE public.mf_pack_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no TEXT NOT NULL UNIQUE DEFAULT ('MF-PP-' || lpad(nextval('public.mf_pp_seq')::text, 5, '0')),
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','credit')),
  total_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  notes TEXT, posted_at TIMESTAMPTZ, posted_by UUID REFERENCES auth.users(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.mf_pack_purchase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES public.mf_pack_purchases(id) ON DELETE CASCADE,
  pack_id UUID NOT NULL REFERENCES public.meat_packaging_inventory(id),
  qty NUMERIC NOT NULL CHECK (qty > 0),
  unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
  total NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.mf_pack_purchases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mf_pack_purchase_items TO authenticated;
GRANT ALL ON public.mf_pack_purchases, public.mf_pack_purchase_items TO service_role;
ALTER TABLE public.mf_pack_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mf_pack_purchase_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mpp_a" ON public.mf_pack_purchases FOR ALL TO authenticated
  USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'))
  WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'));
CREATE POLICY "mppi_a" ON public.mf_pack_purchase_items FOR ALL TO authenticated
  USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'))
  WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'));

CREATE SEQUENCE public.mf_mfg_seq START 1;
CREATE TABLE public.mf_manufacturing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no TEXT NOT NULL UNIQUE DEFAULT ('MF-MFG-' || lpad(nextval('public.mf_mfg_seq')::text, 5, '0')),
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  finished_id UUID NOT NULL REFERENCES public.meat_finished_inventory(id),
  produced_qty NUMERIC NOT NULL CHECK (produced_qty > 0),
  raw_cost NUMERIC NOT NULL DEFAULT 0, pack_cost NUMERIC NOT NULL DEFAULT 0,
  extra_cost NUMERIC NOT NULL DEFAULT 0, total_cost NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  notes TEXT, posted_at TIMESTAMPTZ, posted_by UUID REFERENCES auth.users(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.mf_mfg_raw_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mfg_id UUID NOT NULL REFERENCES public.mf_manufacturing(id) ON DELETE CASCADE,
  raw_id UUID NOT NULL REFERENCES public.meat_raw_inventory(id),
  qty NUMERIC NOT NULL CHECK (qty > 0),
  unit_cost NUMERIC NOT NULL DEFAULT 0, total NUMERIC NOT NULL DEFAULT 0
);
CREATE TABLE public.mf_mfg_pack_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mfg_id UUID NOT NULL REFERENCES public.mf_manufacturing(id) ON DELETE CASCADE,
  pack_id UUID NOT NULL REFERENCES public.meat_packaging_inventory(id),
  qty NUMERIC NOT NULL CHECK (qty > 0),
  unit_cost NUMERIC NOT NULL DEFAULT 0, total NUMERIC NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE ON public.mf_manufacturing TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mf_mfg_raw_lines, public.mf_mfg_pack_lines TO authenticated;
GRANT ALL ON public.mf_manufacturing, public.mf_mfg_raw_lines, public.mf_mfg_pack_lines TO service_role;
ALTER TABLE public.mf_manufacturing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mf_mfg_raw_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mf_mfg_pack_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mm_a" ON public.mf_manufacturing FOR ALL TO authenticated
  USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'))
  WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'));
CREATE POLICY "mmrl_a" ON public.mf_mfg_raw_lines FOR ALL TO authenticated
  USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'))
  WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'));
CREATE POLICY "mmpl_a" ON public.mf_mfg_pack_lines FOR ALL TO authenticated
  USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'))
  WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'));

CREATE SEQUENCE public.mf_sl_seq START 1;
CREATE TABLE public.mf_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no TEXT NOT NULL UNIQUE DEFAULT ('MF-SL-' || lpad(nextval('public.mf_sl_seq')::text, 5, '0')),
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  customer TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','credit')),
  total_amount NUMERIC NOT NULL DEFAULT 0, total_cost NUMERIC NOT NULL DEFAULT 0,
  profit NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  notes TEXT, posted_at TIMESTAMPTZ, posted_by UUID REFERENCES auth.users(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.mf_sales_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.mf_sales(id) ON DELETE CASCADE,
  finished_id UUID NOT NULL REFERENCES public.meat_finished_inventory(id),
  qty NUMERIC NOT NULL CHECK (qty > 0),
  unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
  cost_snapshot NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE ON public.mf_sales TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mf_sales_lines TO authenticated;
GRANT ALL ON public.mf_sales, public.mf_sales_lines TO service_role;
ALTER TABLE public.mf_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mf_sales_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ms_a" ON public.mf_sales FOR ALL TO authenticated
  USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'))
  WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'));
CREATE POLICY "msl_a" ON public.mf_sales_lines FOR ALL TO authenticated
  USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'))
  WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'));

CREATE SEQUENCE public.mf_ret_seq START 1;
CREATE TABLE public.mf_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no TEXT NOT NULL UNIQUE DEFAULT ('MF-RET-' || lpad(nextval('public.mf_ret_seq')::text, 5, '0')),
  return_date DATE NOT NULL DEFAULT CURRENT_DATE,
  customer TEXT NOT NULL,
  original_sale_id UUID REFERENCES public.mf_sales(id),
  total_amount NUMERIC NOT NULL DEFAULT 0, reason TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  notes TEXT, posted_at TIMESTAMPTZ, posted_by UUID REFERENCES auth.users(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.mf_return_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES public.mf_returns(id) ON DELETE CASCADE,
  finished_id UUID NOT NULL REFERENCES public.meat_finished_inventory(id),
  qty NUMERIC NOT NULL CHECK (qty > 0),
  unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
  total NUMERIC NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE ON public.mf_returns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mf_return_lines TO authenticated;
GRANT ALL ON public.mf_returns, public.mf_return_lines TO service_role;
ALTER TABLE public.mf_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mf_return_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mr_a" ON public.mf_returns FOR ALL TO authenticated
  USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'))
  WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'));
CREATE POLICY "mrl_a" ON public.mf_return_lines FOR ALL TO authenticated
  USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'))
  WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'));

CREATE SEQUENCE public.mf_tr_seq START 1;
CREATE TABLE public.mf_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_no TEXT NOT NULL UNIQUE DEFAULT ('MF-TR-' || lpad(nextval('public.mf_tr_seq')::text, 5, '0')),
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  destination_warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  total_value NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  notes TEXT, posted_at TIMESTAMPTZ, posted_by UUID REFERENCES auth.users(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.mf_transfer_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES public.mf_transfers(id) ON DELETE CASCADE,
  finished_id UUID NOT NULL REFERENCES public.meat_finished_inventory(id),
  qty NUMERIC NOT NULL CHECK (qty > 0),
  unit_cost NUMERIC NOT NULL DEFAULT 0, total NUMERIC NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE ON public.mf_transfers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mf_transfer_lines TO authenticated;
GRANT ALL ON public.mf_transfers, public.mf_transfer_lines TO service_role;
ALTER TABLE public.mf_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mf_transfer_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mt_a" ON public.mf_transfers FOR ALL TO authenticated
  USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'))
  WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'));
CREATE POLICY "mtl_a" ON public.mf_transfer_lines FOR ALL TO authenticated
  USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'))
  WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'meat_factory_manager'));

-- POSTING RPCs
CREATE OR REPLACE FUNCTION public.post_mf_raw_purchase(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE inv RECORD; it RECORD; new_stock NUMERIC; new_avg NUMERIC;
BEGIN
  SELECT * INTO inv FROM mf_raw_purchases WHERE id=p_id FOR UPDATE;
  IF inv IS NULL THEN RAISE EXCEPTION 'فاتورة غير موجودة'; END IF;
  IF inv.status='posted' THEN RAISE EXCEPTION 'الفاتورة معتمدة بالفعل'; END IF;
  IF inv.status='cancelled' THEN RAISE EXCEPTION 'الفاتورة ملغاة'; END IF;
  FOR it IN SELECT i.*, r.name_ar, r.unit, r.stock cur_stock, r.avg_cost cur_cost FROM mf_raw_purchase_items i JOIN meat_raw_inventory r ON r.id=i.raw_id WHERE i.purchase_id=p_id LOOP
    new_stock := it.cur_stock + it.qty;
    new_avg := CASE WHEN new_stock>0 THEN ((it.cur_stock*it.cur_cost)+(it.qty*it.unit_price))/new_stock ELSE it.unit_price END;
    UPDATE meat_raw_inventory SET stock=new_stock, avg_cost=new_avg, last_movement_at=now(), updated_at=now() WHERE id=it.raw_id;
    INSERT INTO mf_log(movement_type,direction,item_kind,item_id,item_name,qty,unit,unit_cost,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes)
      VALUES('raw_purchase','IN','raw',it.raw_id,it.name_ar,it.qty,it.unit,it.unit_price,it.total,inv.supplier,'مخزن خامات اللحوم',inv.invoice_no,'mf_raw_purchases',inv.id,auth.uid(),'شراء خامة');
  END LOOP;
  IF inv.payment_method='cash' THEN
    INSERT INTO mf_treasury(direction,amount,source_type,source_id,ref_no,notes,created_by) VALUES('OUT',inv.total_amount,'mf_raw_purchases',inv.id,inv.invoice_no,'دفع شراء خامات',auth.uid());
    INSERT INTO mf_log(movement_type,direction,item_kind,qty,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes)
      VALUES('treasury_out','OUT','treasury',inv.total_amount,inv.total_amount,'خزنة مصنع اللحوم',inv.supplier,inv.invoice_no,'mf_raw_purchases',inv.id,auth.uid(),'دفع نقدي - شراء خامات');
  END IF;
  UPDATE mf_raw_purchases SET status='posted', posted_at=now(), posted_by=auth.uid(), updated_at=now() WHERE id=p_id;
END $$;

CREATE OR REPLACE FUNCTION public.post_mf_pack_purchase(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE inv RECORD; it RECORD; new_stock NUMERIC; new_avg NUMERIC;
BEGIN
  SELECT * INTO inv FROM mf_pack_purchases WHERE id=p_id FOR UPDATE;
  IF inv IS NULL THEN RAISE EXCEPTION 'فاتورة غير موجودة'; END IF;
  IF inv.status='posted' THEN RAISE EXCEPTION 'الفاتورة معتمدة بالفعل'; END IF;
  IF inv.status='cancelled' THEN RAISE EXCEPTION 'الفاتورة ملغاة'; END IF;
  FOR it IN SELECT i.*, p.name_ar, p.unit, p.stock cur_stock, p.avg_cost cur_cost FROM mf_pack_purchase_items i JOIN meat_packaging_inventory p ON p.id=i.pack_id WHERE i.purchase_id=p_id LOOP
    new_stock := it.cur_stock + it.qty;
    new_avg := CASE WHEN new_stock>0 THEN ((it.cur_stock*it.cur_cost)+(it.qty*it.unit_price))/new_stock ELSE it.unit_price END;
    UPDATE meat_packaging_inventory SET stock=new_stock, avg_cost=new_avg, last_movement_at=now(), updated_at=now() WHERE id=it.pack_id;
    INSERT INTO mf_log(movement_type,direction,item_kind,item_id,item_name,qty,unit,unit_cost,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes)
      VALUES('pack_purchase','IN','pack',it.pack_id,it.name_ar,it.qty,it.unit,it.unit_price,it.total,inv.supplier,'مخزن تغليف اللحوم',inv.invoice_no,'mf_pack_purchases',inv.id,auth.uid(),'شراء علب');
  END LOOP;
  IF inv.payment_method='cash' THEN
    INSERT INTO mf_treasury(direction,amount,source_type,source_id,ref_no,notes,created_by) VALUES('OUT',inv.total_amount,'mf_pack_purchases',inv.id,inv.invoice_no,'دفع شراء تغليف',auth.uid());
    INSERT INTO mf_log(movement_type,direction,item_kind,qty,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes)
      VALUES('treasury_out','OUT','treasury',inv.total_amount,inv.total_amount,'خزنة مصنع اللحوم',inv.supplier,inv.invoice_no,'mf_pack_purchases',inv.id,auth.uid(),'دفع نقدي - شراء تغليف');
  END IF;
  UPDATE mf_pack_purchases SET status='posted', posted_at=now(), posted_by=auth.uid(), updated_at=now() WHERE id=p_id;
END $$;

CREATE OR REPLACE FUNCTION public.post_mf_manufacturing(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE inv RECORD; rl RECORD; pl RECORD; raw_total NUMERIC:=0; pack_total NUMERIC:=0; total NUMERIC; ucost NUMERIC;
  fin_stock NUMERIC; fin_cost NUMERIC; new_fin_stock NUMERIC; new_fin_cost NUMERIC; fin_name TEXT; fin_unit TEXT;
BEGIN
  SELECT * INTO inv FROM mf_manufacturing WHERE id=p_id FOR UPDATE;
  IF inv IS NULL THEN RAISE EXCEPTION 'فاتورة تصنيع غير موجودة'; END IF;
  IF inv.status='posted' THEN RAISE EXCEPTION 'فاتورة التصنيع معتمدة بالفعل'; END IF;
  IF inv.status='cancelled' THEN RAISE EXCEPTION 'فاتورة التصنيع ملغاة'; END IF;
  FOR rl IN SELECT l.*, r.name_ar, r.stock cur_stock FROM mf_mfg_raw_lines l JOIN meat_raw_inventory r ON r.id=l.raw_id WHERE l.mfg_id=p_id LOOP
    IF rl.cur_stock < rl.qty THEN RAISE EXCEPTION 'رصيد الخامة % غير كاف (متوفر %, مطلوب %)', rl.name_ar, rl.cur_stock, rl.qty; END IF;
  END LOOP;
  FOR pl IN SELECT l.*, p.name_ar, p.stock cur_stock FROM mf_mfg_pack_lines l JOIN meat_packaging_inventory p ON p.id=l.pack_id WHERE l.mfg_id=p_id LOOP
    IF pl.cur_stock < pl.qty THEN RAISE EXCEPTION 'رصيد علبة % غير كاف (متوفر %, مطلوب %)', pl.name_ar, pl.cur_stock, pl.qty; END IF;
  END LOOP;
  FOR rl IN SELECT l.*, r.name_ar, r.unit, r.stock cur_stock, r.avg_cost cur_cost FROM mf_mfg_raw_lines l JOIN meat_raw_inventory r ON r.id=l.raw_id WHERE l.mfg_id=p_id LOOP
    UPDATE meat_raw_inventory SET stock=cur_stock - rl.qty, last_movement_at=now(), updated_at=now() WHERE id=rl.raw_id;
    UPDATE mf_mfg_raw_lines SET unit_cost=rl.cur_cost, total=rl.qty*rl.cur_cost WHERE id=rl.id;
    raw_total := raw_total + rl.qty*rl.cur_cost;
    INSERT INTO mf_log(movement_type,direction,item_kind,item_id,item_name,qty,unit,unit_cost,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes)
      VALUES('mfg_raw_issue','OUT','raw',rl.raw_id,rl.name_ar,rl.qty,rl.unit,rl.cur_cost,rl.qty*rl.cur_cost,'مخزن خامات اللحوم','تصنيع',inv.invoice_no,'mf_manufacturing',inv.id,auth.uid(),'سحب خامة');
  END LOOP;
  FOR pl IN SELECT l.*, p.name_ar, p.unit, p.stock cur_stock, p.avg_cost cur_cost FROM mf_mfg_pack_lines l JOIN meat_packaging_inventory p ON p.id=l.pack_id WHERE l.mfg_id=p_id LOOP
    UPDATE meat_packaging_inventory SET stock=cur_stock - pl.qty, last_movement_at=now(), updated_at=now() WHERE id=pl.pack_id;
    UPDATE mf_mfg_pack_lines SET unit_cost=pl.cur_cost, total=pl.qty*pl.cur_cost WHERE id=pl.id;
    pack_total := pack_total + pl.qty*pl.cur_cost;
    INSERT INTO mf_log(movement_type,direction,item_kind,item_id,item_name,qty,unit,unit_cost,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes)
      VALUES('mfg_pack_issue','OUT','pack',pl.pack_id,pl.name_ar,pl.qty,pl.unit,pl.cur_cost,pl.qty*pl.cur_cost,'مخزن تغليف اللحوم','تصنيع',inv.invoice_no,'mf_manufacturing',inv.id,auth.uid(),'سحب علبة');
  END LOOP;
  total := raw_total + pack_total + COALESCE(inv.extra_cost,0);
  ucost := total / inv.produced_qty;
  SELECT stock, avg_prod_cost, name_ar, unit INTO fin_stock, fin_cost, fin_name, fin_unit FROM meat_finished_inventory WHERE id=inv.finished_id FOR UPDATE;
  new_fin_stock := fin_stock + inv.produced_qty;
  new_fin_cost := CASE WHEN new_fin_stock>0 THEN ((fin_stock*fin_cost)+(inv.produced_qty*ucost))/new_fin_stock ELSE ucost END;
  UPDATE meat_finished_inventory SET stock=new_fin_stock, avg_prod_cost=new_fin_cost, last_movement_at=now(), updated_at=now() WHERE id=inv.finished_id;
  INSERT INTO mf_log(movement_type,direction,item_kind,item_id,item_name,qty,unit,unit_cost,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes)
    VALUES('mfg_finished_in','IN','finished',inv.finished_id,fin_name,inv.produced_qty,fin_unit,ucost,total,'تصنيع','مخزن المنتجات الجاهزة',inv.invoice_no,'mf_manufacturing',inv.id,auth.uid(),'منتج جاهز من التصنيع');
  UPDATE mf_manufacturing SET raw_cost=raw_total, pack_cost=pack_total, total_cost=total, unit_cost=ucost, status='posted', posted_at=now(), posted_by=auth.uid(), updated_at=now() WHERE id=p_id;
END $$;

CREATE OR REPLACE FUNCTION public.post_mf_sale(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE inv RECORD; ln RECORD; total_amt NUMERIC:=0; total_cost NUMERIC:=0;
BEGIN
  SELECT * INTO inv FROM mf_sales WHERE id=p_id FOR UPDATE;
  IF inv IS NULL THEN RAISE EXCEPTION 'فاتورة بيع غير موجودة'; END IF;
  IF inv.status='posted' THEN RAISE EXCEPTION 'فاتورة البيع معتمدة بالفعل'; END IF;
  IF inv.status='cancelled' THEN RAISE EXCEPTION 'فاتورة البيع ملغاة'; END IF;
  FOR ln IN SELECT l.*, f.name_ar, f.stock cur_stock FROM mf_sales_lines l JOIN meat_finished_inventory f ON f.id=l.finished_id WHERE l.sale_id=p_id LOOP
    IF ln.cur_stock < ln.qty THEN RAISE EXCEPTION 'رصيد % غير كاف (متوفر %, مطلوب %)', ln.name_ar, ln.cur_stock, ln.qty; END IF;
  END LOOP;
  FOR ln IN SELECT l.*, f.name_ar, f.unit, f.stock cur_stock, f.avg_prod_cost cur_cost FROM mf_sales_lines l JOIN meat_finished_inventory f ON f.id=l.finished_id WHERE l.sale_id=p_id LOOP
    UPDATE meat_finished_inventory SET stock=cur_stock - ln.qty, last_movement_at=now(), updated_at=now() WHERE id=ln.finished_id;
    UPDATE mf_sales_lines SET cost_snapshot=ln.cur_cost, total=ln.qty*ln.unit_price WHERE id=ln.id;
    total_amt := total_amt + ln.qty*ln.unit_price;
    total_cost := total_cost + ln.qty*ln.cur_cost;
    INSERT INTO mf_log(movement_type,direction,item_kind,item_id,item_name,qty,unit,unit_cost,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes,metadata)
      VALUES('sale','OUT','finished',ln.finished_id,ln.name_ar,ln.qty,ln.unit,ln.unit_price,ln.qty*ln.unit_price,'مخزن المنتجات الجاهزة',inv.customer,inv.invoice_no,'mf_sales',inv.id,auth.uid(),'بيع', jsonb_build_object('cost_snapshot',ln.cur_cost,'profit',(ln.unit_price-ln.cur_cost)*ln.qty));
  END LOOP;
  IF inv.payment_method='cash' THEN
    INSERT INTO mf_treasury(direction,amount,source_type,source_id,ref_no,notes,created_by) VALUES('IN',total_amt,'mf_sales',inv.id,inv.invoice_no,'تحصيل بيع نقدي',auth.uid());
    INSERT INTO mf_log(movement_type,direction,item_kind,qty,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes)
      VALUES('treasury_in','IN','treasury',total_amt,total_amt,inv.customer,'خزنة مصنع اللحوم',inv.invoice_no,'mf_sales',inv.id,auth.uid(),'تحصيل نقدي');
  END IF;
  UPDATE mf_sales SET total_amount=total_amt, total_cost=total_cost, profit=total_amt-total_cost, status='posted', posted_at=now(), posted_by=auth.uid(), updated_at=now() WHERE id=p_id;
END $$;

CREATE OR REPLACE FUNCTION public.post_mf_return(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE inv RECORD; ln RECORD; total_amt NUMERIC:=0;
BEGIN
  SELECT * INTO inv FROM mf_returns WHERE id=p_id FOR UPDATE;
  IF inv IS NULL THEN RAISE EXCEPTION 'مرتجع غير موجود'; END IF;
  IF inv.status='posted' THEN RAISE EXCEPTION 'المرتجع معتمد بالفعل'; END IF;
  IF inv.status='cancelled' THEN RAISE EXCEPTION 'المرتجع ملغى'; END IF;
  FOR ln IN SELECT l.*, f.name_ar, f.unit, f.stock cur_stock FROM mf_return_lines l JOIN meat_finished_inventory f ON f.id=l.finished_id WHERE l.return_id=p_id LOOP
    UPDATE meat_finished_inventory SET stock=cur_stock + ln.qty, last_movement_at=now(), updated_at=now() WHERE id=ln.finished_id;
    UPDATE mf_return_lines SET total=ln.qty*ln.unit_price WHERE id=ln.id;
    total_amt := total_amt + ln.qty*ln.unit_price;
    INSERT INTO mf_log(movement_type,direction,item_kind,item_id,item_name,qty,unit,unit_cost,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes)
      VALUES('sale_return','IN','finished',ln.finished_id,ln.name_ar,ln.qty,ln.unit,ln.unit_price,ln.qty*ln.unit_price,inv.customer,'مخزن المنتجات الجاهزة',inv.return_no,'mf_returns',inv.id,auth.uid(),'مرتجع مبيعات');
  END LOOP;
  INSERT INTO mf_treasury(direction,amount,source_type,source_id,ref_no,notes,created_by) VALUES('OUT',total_amt,'mf_returns',inv.id,inv.return_no,'رد قيمة مرتجع',auth.uid());
  INSERT INTO mf_log(movement_type,direction,item_kind,qty,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes)
    VALUES('treasury_out','OUT','treasury',total_amt,total_amt,'خزنة مصنع اللحوم',inv.customer,inv.return_no,'mf_returns',inv.id,auth.uid(),'رد نقدي مرتجع');
  UPDATE mf_returns SET total_amount=total_amt, status='posted', posted_at=now(), posted_by=auth.uid(), updated_at=now() WHERE id=p_id;
END $$;

CREATE OR REPLACE FUNCTION public.post_mf_transfer(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE inv RECORD; ln RECORD; total_v NUMERIC:=0; dest_item_id UUID;
BEGIN
  SELECT * INTO inv FROM mf_transfers WHERE id=p_id FOR UPDATE;
  IF inv IS NULL THEN RAISE EXCEPTION 'أمر نقل غير موجود'; END IF;
  IF inv.status='posted' THEN RAISE EXCEPTION 'أمر النقل معتمد بالفعل'; END IF;
  IF inv.status='cancelled' THEN RAISE EXCEPTION 'أمر النقل ملغى'; END IF;
  FOR ln IN SELECT l.*, f.name_ar, f.unit, f.stock cur_stock, f.avg_prod_cost cur_cost, f.code FROM mf_transfer_lines l JOIN meat_finished_inventory f ON f.id=l.finished_id WHERE l.transfer_id=p_id LOOP
    IF ln.cur_stock < ln.qty THEN RAISE EXCEPTION 'رصيد % غير كاف للنقل', ln.name_ar; END IF;
    UPDATE meat_finished_inventory SET stock=cur_stock - ln.qty, last_movement_at=now(), updated_at=now() WHERE id=ln.finished_id;
    UPDATE mf_transfer_lines SET unit_cost=ln.cur_cost, total=ln.qty*ln.cur_cost WHERE id=ln.id;
    total_v := total_v + ln.qty*ln.cur_cost;
    SELECT id INTO dest_item_id FROM inventory_items WHERE warehouse_id=inv.destination_warehouse_id AND item_code=ln.code LIMIT 1;
    IF dest_item_id IS NULL THEN
      INSERT INTO inventory_items(warehouse_id,name,unit,stock,low_stock_threshold,unit_cost,is_active,module,item_code,last_movement_date)
        VALUES(inv.destination_warehouse_id, ln.name_ar, ln.unit, ln.qty, 0, ln.cur_cost, true, 'meat', ln.code, now())
        RETURNING id INTO dest_item_id;
    ELSE
      UPDATE inventory_items SET stock=stock+ln.qty, unit_cost=ln.cur_cost, last_movement_date=now(), updated_at=now() WHERE id=dest_item_id;
    END IF;
    INSERT INTO mf_log(movement_type,direction,item_kind,item_id,item_name,qty,unit,unit_cost,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes)
      VALUES('transfer_out','OUT','finished',ln.finished_id,ln.name_ar,ln.qty,ln.unit,ln.cur_cost,ln.qty*ln.cur_cost,'مخزن المنتجات الجاهزة','المخزن الرئيسي',inv.transfer_no,'mf_transfers',inv.id,auth.uid(),'نقل للمخزن الرئيسي');
  END LOOP;
  UPDATE mf_transfers SET total_value=total_v, status='posted', posted_at=now(), posted_by=auth.uid(), updated_at=now() WHERE id=p_id;
END $$;

GRANT EXECUTE ON FUNCTION public.post_mf_raw_purchase(UUID), public.post_mf_pack_purchase(UUID), public.post_mf_manufacturing(UUID), public.post_mf_sale(UUID), public.post_mf_return(UUID), public.post_mf_transfer(UUID) TO authenticated;

-- SEED
INSERT INTO meat_packaging_inventory(code,name_ar,product_type,unit,reorder_level) VALUES
  ('PK-KOFTA','علبة كفتة','kofta','علبة',50),
  ('PK-BURGER','علبة برجر','burger','علبة',50),
  ('PK-SAUSAGE','علبة سجق','sausage','علبة',50),
  ('PK-KOFTARICE','علبة كفتة رز','kofta_rice','علبة',50);

INSERT INTO meat_raw_inventory(code,name_ar,unit,reorder_level) VALUES
  ('RM-OSTRICH','لحم نعام خام','كجم',10),('RM-BEEF','لحم بقري','كجم',10),
  ('RM-FAT','دهن بقري','كجم',5),('RM-TRIM','شغت / قطع تشغيل','كجم',5),
  ('RM-ONION','بصل','كجم',5),('RM-PEPPER','فلفل','كجم',2),
  ('RM-SOYA','صويا','كجم',5),('RM-RICE','أرز','كجم',5),
  ('RM-BULGUR','برغل','كجم',5),('RM-SPICE','توابل','كجم',2),
  ('RM-SALT','ملح','كجم',2),('RM-BREAD','عيش حواوشي','كجم',5);

INSERT INTO meat_finished_inventory(code,name_ar,unit,reorder_level) VALUES
  ('FN-KOFTA','كفتة','كجم',5),('FN-BURGER','برجر','كجم',5),
  ('FN-SAUSAGE','سجق','كجم',5),('FN-MINCED','مفروم','كجم',5),
  ('FN-HAWAWSHI','حواوشي','كجم',5),('FN-KOFTARICE','كفتة رز','كجم',5),
  ('FN-BURGERCHEESE','برجر جبنة','كجم',5),('FN-SHAWARMA','شاورما متبلة','كجم',5),
  ('FN-SHISH','شيش متبل','كجم',5);
