
-- 1) Add rejection columns to the 3 invoice tables
ALTER TABLE public.mf_raw_purchases
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE public.mf_pack_purchases
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE public.mf_manufacturing
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- 2) Helper: only general/executive managers can approve or reject MF invoices
CREATE OR REPLACE FUNCTION public._assert_mf_invoice_approver()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'general_manager'::app_role)
       OR public.has_role(auth.uid(), 'executive_manager'::app_role)) THEN
    RAISE EXCEPTION 'صلاحية اعتماد/رفض فواتير الشراء والتصنيع للمدير العام أو التنفيذي فقط';
  END IF;
END $$;

-- 3) Gate the 3 existing post_* RPCs with the role check (wrap, do not rewrite body)
CREATE OR REPLACE FUNCTION public.post_mf_raw_purchase(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE inv RECORD; ln RECORD; new_stock NUMERIC; new_cost NUMERIC;
BEGIN
  PERFORM public._assert_mf_invoice_approver();
  SELECT * INTO inv FROM mf_raw_purchases WHERE id=p_id FOR UPDATE;
  IF inv IS NULL THEN RAISE EXCEPTION 'فاتورة شراء خامات غير موجودة'; END IF;
  IF inv.status='posted' THEN RAISE EXCEPTION 'الفاتورة معتمدة بالفعل'; END IF;
  IF inv.status='rejected' THEN RAISE EXCEPTION 'لا يمكن اعتماد فاتورة مرفوضة'; END IF;
  FOR ln IN SELECT l.*, r.name_ar AS rname, r.unit AS runit, r.stock AS cur_stock, r.avg_cost AS cur_cost
            FROM mf_raw_purchase_items l JOIN meat_raw_inventory r ON r.id=l.raw_id WHERE l.purchase_id=p_id LOOP
    new_stock := COALESCE(ln.cur_stock,0) + ln.qty;
    new_cost  := CASE WHEN new_stock>0
                      THEN ((COALESCE(ln.cur_stock,0)*COALESCE(ln.cur_cost,0)) + (ln.qty*ln.unit_price)) / new_stock
                      ELSE ln.unit_price END;
    UPDATE meat_raw_inventory SET stock=new_stock, avg_cost=new_cost, last_movement_at=now(), updated_at=now() WHERE id=ln.raw_id;
    INSERT INTO mf_log(movement_type,direction,item_kind,item_id,item_name,qty,unit,unit_cost,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes,is_test)
      VALUES('raw_purchase','IN','raw',ln.raw_id,ln.rname,ln.qty,ln.runit,ln.unit_price,ln.total,inv.supplier,'مخزن خامات اللحوم',inv.invoice_no,'mf_raw_purchases',inv.id,auth.uid(),'شراء خامات',inv.is_test);
  END LOOP;
  UPDATE mf_raw_purchases SET status='posted', posted_at=now(), posted_by=auth.uid(), updated_at=now() WHERE id=p_id;
END $function$;

CREATE OR REPLACE FUNCTION public.post_mf_pack_purchase(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE inv RECORD; ln RECORD; new_stock NUMERIC; new_cost NUMERIC;
BEGIN
  PERFORM public._assert_mf_invoice_approver();
  SELECT * INTO inv FROM mf_pack_purchases WHERE id=p_id FOR UPDATE;
  IF inv IS NULL THEN RAISE EXCEPTION 'فاتورة شراء تغليف غير موجودة'; END IF;
  IF inv.status='posted' THEN RAISE EXCEPTION 'الفاتورة معتمدة بالفعل'; END IF;
  IF inv.status='rejected' THEN RAISE EXCEPTION 'لا يمكن اعتماد فاتورة مرفوضة'; END IF;
  FOR ln IN SELECT l.*, p.name_ar AS pname, p.unit AS punit, p.stock AS cur_stock, p.avg_cost AS cur_cost
            FROM mf_pack_purchase_items l JOIN meat_packaging_inventory p ON p.id=l.pack_id WHERE l.purchase_id=p_id LOOP
    new_stock := COALESCE(ln.cur_stock,0) + ln.qty;
    new_cost  := CASE WHEN new_stock>0
                      THEN ((COALESCE(ln.cur_stock,0)*COALESCE(ln.cur_cost,0)) + (ln.qty*ln.unit_price)) / new_stock
                      ELSE ln.unit_price END;
    UPDATE meat_packaging_inventory SET stock=new_stock, avg_cost=new_cost, last_movement_at=now(), updated_at=now() WHERE id=ln.pack_id;
    INSERT INTO mf_log(movement_type,direction,item_kind,item_id,item_name,qty,unit,unit_cost,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes,is_test)
      VALUES('pack_purchase','IN','pack',ln.pack_id,ln.pname,ln.qty,ln.punit,ln.unit_price,ln.total,inv.supplier,'مخزن تغليف اللحوم',inv.invoice_no,'mf_pack_purchases',inv.id,auth.uid(),'شراء تغليف',inv.is_test);
  END LOOP;
  UPDATE mf_pack_purchases SET status='posted', posted_at=now(), posted_by=auth.uid(), updated_at=now() WHERE id=p_id;
END $function$;

CREATE OR REPLACE FUNCTION public.post_mf_manufacturing(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE inv RECORD; rl RECORD; pl RECORD; raw_total NUMERIC:=0; pack_total NUMERIC:=0; total NUMERIC; ucost NUMERIC;
  fin_stock NUMERIC; fin_cost NUMERIC; new_fin_stock NUMERIC; new_fin_cost NUMERIC; fin_name TEXT; fin_unit TEXT;
BEGIN
  PERFORM public._assert_mf_invoice_approver();
  SELECT * INTO inv FROM mf_manufacturing WHERE id=p_id FOR UPDATE;
  IF inv IS NULL THEN RAISE EXCEPTION 'فاتورة تصنيع غير موجودة'; END IF;
  IF inv.status='posted' THEN RAISE EXCEPTION 'فاتورة التصنيع معتمدة بالفعل'; END IF;
  IF inv.status='cancelled' THEN RAISE EXCEPTION 'فاتورة التصنيع ملغاة'; END IF;
  IF inv.status='rejected' THEN RAISE EXCEPTION 'لا يمكن اعتماد فاتورة مرفوضة'; END IF;
  FOR rl IN SELECT l.*, r.name_ar AS rname, r.stock AS cur_stock FROM mf_mfg_raw_lines l JOIN meat_raw_inventory r ON r.id=l.raw_id WHERE l.mfg_id=p_id LOOP
    IF rl.cur_stock < rl.qty THEN RAISE EXCEPTION 'رصيد الخامة % غير كاف (متوفر %, مطلوب %)', rl.rname, rl.cur_stock, rl.qty; END IF;
  END LOOP;
  FOR pl IN SELECT l.*, p.name_ar AS pname, p.stock AS cur_stock FROM mf_mfg_pack_lines l JOIN meat_packaging_inventory p ON p.id=l.pack_id WHERE l.mfg_id=p_id LOOP
    IF pl.cur_stock < pl.qty THEN RAISE EXCEPTION 'رصيد علبة % غير كاف (متوفر %, مطلوب %)', pl.pname, pl.cur_stock, pl.qty; END IF;
  END LOOP;
  FOR rl IN SELECT l.*, r.name_ar AS rname, r.unit AS runit, r.stock AS cur_stock, r.avg_cost AS cur_cost FROM mf_mfg_raw_lines l JOIN meat_raw_inventory r ON r.id=l.raw_id WHERE l.mfg_id=p_id LOOP
    UPDATE meat_raw_inventory SET stock=rl.cur_stock - rl.qty, last_movement_at=now(), updated_at=now() WHERE id=rl.raw_id;
    UPDATE mf_mfg_raw_lines SET unit_cost=rl.cur_cost, total=rl.qty*rl.cur_cost WHERE id=rl.id;
    raw_total := raw_total + rl.qty*rl.cur_cost;
    INSERT INTO mf_log(movement_type,direction,item_kind,item_id,item_name,qty,unit,unit_cost,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes,is_test)
      VALUES('mfg_raw_issue','OUT','raw',rl.raw_id,rl.rname,rl.qty,rl.runit,rl.cur_cost,rl.qty*rl.cur_cost,'مخزن خامات اللحوم','تصنيع',inv.invoice_no,'mf_manufacturing',inv.id,auth.uid(),'سحب خامة',inv.is_test);
  END LOOP;
  FOR pl IN SELECT l.*, p.name_ar AS pname, p.unit AS punit, p.stock AS cur_stock, p.avg_cost AS cur_cost FROM mf_mfg_pack_lines l JOIN meat_packaging_inventory p ON p.id=l.pack_id WHERE l.mfg_id=p_id LOOP
    UPDATE meat_packaging_inventory SET stock=pl.cur_stock - pl.qty, last_movement_at=now(), updated_at=now() WHERE id=pl.pack_id;
    UPDATE mf_mfg_pack_lines SET unit_cost=pl.cur_cost, total=pl.qty*pl.cur_cost WHERE id=pl.id;
    pack_total := pack_total + pl.qty*pl.cur_cost;
    INSERT INTO mf_log(movement_type,direction,item_kind,item_id,item_name,qty,unit,unit_cost,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes,is_test)
      VALUES('mfg_pack_issue','OUT','pack',pl.pack_id,pl.pname,pl.qty,pl.punit,pl.cur_cost,pl.qty*pl.cur_cost,'مخزن تغليف اللحوم','تصنيع',inv.invoice_no,'mf_manufacturing',inv.id,auth.uid(),'سحب علبة',inv.is_test);
  END LOOP;
  total := raw_total + pack_total + COALESCE(inv.extra_cost,0);
  ucost := total / inv.produced_qty;
  SELECT stock, avg_prod_cost, name_ar, unit INTO fin_stock, fin_cost, fin_name, fin_unit FROM meat_finished_inventory WHERE id=inv.finished_id FOR UPDATE;
  new_fin_stock := fin_stock + inv.produced_qty;
  new_fin_cost := CASE WHEN new_fin_stock>0 THEN ((fin_stock*fin_cost)+(inv.produced_qty*ucost))/new_fin_stock ELSE ucost END;
  UPDATE meat_finished_inventory SET stock=new_fin_stock, avg_prod_cost=new_fin_cost, last_movement_at=now(), updated_at=now() WHERE id=inv.finished_id;
  INSERT INTO mf_log(movement_type,direction,item_kind,item_id,item_name,qty,unit,unit_cost,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes,is_test)
    VALUES('mfg_finished_in','IN','finished',inv.finished_id,fin_name,inv.produced_qty,fin_unit,ucost,total,'تصنيع','مخزن المنتجات الجاهزة',inv.invoice_no,'mf_manufacturing',inv.id,auth.uid(),'منتج جاهز',inv.is_test);
  UPDATE mf_manufacturing SET raw_cost=raw_total, pack_cost=pack_total, total_cost=total, unit_cost=ucost, status='posted', posted_at=now(), posted_by=auth.uid(), updated_at=now() WHERE id=p_id;
END $function$;

-- 4) Generic reject RPC for the 3 invoice tables
CREATE OR REPLACE FUNCTION public.reject_mf_invoice(p_table text, p_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE cur_status text; ref_no text;
BEGIN
  PERFORM public._assert_mf_invoice_approver();
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'سبب الرفض إلزامي (3 أحرف على الأقل)';
  END IF;
  IF p_table NOT IN ('mf_raw_purchases','mf_pack_purchases','mf_manufacturing') THEN
    RAISE EXCEPTION 'جدول غير مدعوم: %', p_table;
  END IF;

  IF p_table = 'mf_raw_purchases' THEN
    SELECT status, invoice_no INTO cur_status, ref_no FROM mf_raw_purchases WHERE id=p_id FOR UPDATE;
    IF cur_status IS NULL THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
    IF cur_status <> 'draft' THEN RAISE EXCEPTION 'لا يمكن رفض فاتورة حالتها %', cur_status; END IF;
    UPDATE mf_raw_purchases SET status='rejected', rejected_at=now(), rejected_by=auth.uid(), rejection_reason=btrim(p_reason), updated_at=now() WHERE id=p_id;
  ELSIF p_table = 'mf_pack_purchases' THEN
    SELECT status, invoice_no INTO cur_status, ref_no FROM mf_pack_purchases WHERE id=p_id FOR UPDATE;
    IF cur_status IS NULL THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
    IF cur_status <> 'draft' THEN RAISE EXCEPTION 'لا يمكن رفض فاتورة حالتها %', cur_status; END IF;
    UPDATE mf_pack_purchases SET status='rejected', rejected_at=now(), rejected_by=auth.uid(), rejection_reason=btrim(p_reason), updated_at=now() WHERE id=p_id;
  ELSE
    SELECT status, invoice_no INTO cur_status, ref_no FROM mf_manufacturing WHERE id=p_id FOR UPDATE;
    IF cur_status IS NULL THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
    IF cur_status <> 'draft' THEN RAISE EXCEPTION 'لا يمكن رفض فاتورة حالتها %', cur_status; END IF;
    UPDATE mf_manufacturing SET status='rejected', rejected_at=now(), rejected_by=auth.uid(), rejection_reason=btrim(p_reason), updated_at=now() WHERE id=p_id;
  END IF;

  -- Audit row in mf_log (non-stock event)
  INSERT INTO mf_log(movement_type,direction,item_kind,item_id,item_name,qty,unit,unit_cost,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes,is_test)
    VALUES('invoice_rejected','NONE','none',NULL,'رفض فاتورة',0,NULL,0,0,NULL,NULL,ref_no,p_table,p_id,auth.uid(),btrim(p_reason),false);
END $$;

GRANT EXECUTE ON FUNCTION public.reject_mf_invoice(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public._assert_mf_invoice_approver() TO authenticated;
