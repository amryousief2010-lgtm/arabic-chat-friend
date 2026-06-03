
CREATE OR REPLACE FUNCTION public.post_mf_manufacturing(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE inv RECORD; rl RECORD; pl RECORD; raw_total NUMERIC:=0; pack_total NUMERIC:=0; total NUMERIC; ucost NUMERIC;
  fin_stock NUMERIC; fin_cost NUMERIC; new_fin_stock NUMERIC; new_fin_cost NUMERIC; fin_name TEXT; fin_unit TEXT;
BEGIN
  SELECT * INTO inv FROM mf_manufacturing WHERE id=p_id FOR UPDATE;
  IF inv IS NULL THEN RAISE EXCEPTION 'فاتورة تصنيع غير موجودة'; END IF;
  IF inv.status='posted' THEN RAISE EXCEPTION 'فاتورة التصنيع معتمدة بالفعل'; END IF;
  IF inv.status='cancelled' THEN RAISE EXCEPTION 'فاتورة التصنيع ملغاة'; END IF;
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
    INSERT INTO mf_log(movement_type,direction,item_kind,item_id,item_name,qty,unit,unit_cost,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes)
      VALUES('mfg_raw_issue','OUT','raw',rl.raw_id,rl.rname,rl.qty,rl.runit,rl.cur_cost,rl.qty*rl.cur_cost,'مخزن خامات اللحوم','تصنيع',inv.invoice_no,'mf_manufacturing',inv.id,auth.uid(),'سحب خامة');
  END LOOP;
  FOR pl IN SELECT l.*, p.name_ar AS pname, p.unit AS punit, p.stock AS cur_stock, p.avg_cost AS cur_cost FROM mf_mfg_pack_lines l JOIN meat_packaging_inventory p ON p.id=l.pack_id WHERE l.mfg_id=p_id LOOP
    UPDATE meat_packaging_inventory SET stock=pl.cur_stock - pl.qty, last_movement_at=now(), updated_at=now() WHERE id=pl.pack_id;
    UPDATE mf_mfg_pack_lines SET unit_cost=pl.cur_cost, total=pl.qty*pl.cur_cost WHERE id=pl.id;
    pack_total := pack_total + pl.qty*pl.cur_cost;
    INSERT INTO mf_log(movement_type,direction,item_kind,item_id,item_name,qty,unit,unit_cost,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes)
      VALUES('mfg_pack_issue','OUT','pack',pl.pack_id,pl.pname,pl.qty,pl.punit,pl.cur_cost,pl.qty*pl.cur_cost,'مخزن تغليف اللحوم','تصنيع',inv.invoice_no,'mf_manufacturing',inv.id,auth.uid(),'سحب علبة');
  END LOOP;
  total := raw_total + pack_total + COALESCE(inv.extra_cost,0);
  ucost := total / inv.produced_qty;
  SELECT stock, avg_prod_cost, name_ar, unit INTO fin_stock, fin_cost, fin_name, fin_unit FROM meat_finished_inventory WHERE id=inv.finished_id FOR UPDATE;
  new_fin_stock := fin_stock + inv.produced_qty;
  new_fin_cost := CASE WHEN new_fin_stock>0 THEN ((fin_stock*fin_cost)+(inv.produced_qty*ucost))/new_fin_stock ELSE ucost END;
  UPDATE meat_finished_inventory SET stock=new_fin_stock, avg_prod_cost=new_fin_cost, last_movement_at=now(), updated_at=now() WHERE id=inv.finished_id;
  INSERT INTO mf_log(movement_type,direction,item_kind,item_id,item_name,qty,unit,unit_cost,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes)
    VALUES('mfg_finished_in','IN','finished',inv.finished_id,fin_name,inv.produced_qty,fin_unit,ucost,total,'تصنيع','مخزن المنتجات الجاهزة',inv.invoice_no,'mf_manufacturing',inv.id,auth.uid(),'منتج جاهز');
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
  FOR ln IN SELECT l.*, f.name_ar AS fname, f.stock AS cur_stock FROM mf_sales_lines l JOIN meat_finished_inventory f ON f.id=l.finished_id WHERE l.sale_id=p_id LOOP
    IF ln.cur_stock < ln.qty THEN RAISE EXCEPTION 'رصيد % غير كاف (متوفر %, مطلوب %)', ln.fname, ln.cur_stock, ln.qty; END IF;
  END LOOP;
  FOR ln IN SELECT l.*, f.name_ar AS fname, f.unit AS funit, f.stock AS cur_stock, f.avg_prod_cost AS cur_cost FROM mf_sales_lines l JOIN meat_finished_inventory f ON f.id=l.finished_id WHERE l.sale_id=p_id LOOP
    UPDATE meat_finished_inventory SET stock=ln.cur_stock - ln.qty, last_movement_at=now(), updated_at=now() WHERE id=ln.finished_id;
    UPDATE mf_sales_lines SET cost_snapshot=ln.cur_cost, total=ln.qty*ln.unit_price WHERE id=ln.id;
    total_amt := total_amt + ln.qty*ln.unit_price;
    total_cost := total_cost + ln.qty*ln.cur_cost;
    INSERT INTO mf_log(movement_type,direction,item_kind,item_id,item_name,qty,unit,unit_cost,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes,metadata)
      VALUES('sale','OUT','finished',ln.finished_id,ln.fname,ln.qty,ln.funit,ln.unit_price,ln.qty*ln.unit_price,'مخزن المنتجات الجاهزة',inv.customer,inv.invoice_no,'mf_sales',inv.id,auth.uid(),'بيع', jsonb_build_object('cost_snapshot',ln.cur_cost,'profit',(ln.unit_price-ln.cur_cost)*ln.qty));
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
  FOR ln IN SELECT l.*, f.name_ar AS fname, f.unit AS funit, f.stock AS cur_stock FROM mf_return_lines l JOIN meat_finished_inventory f ON f.id=l.finished_id WHERE l.return_id=p_id LOOP
    UPDATE meat_finished_inventory SET stock=ln.cur_stock + ln.qty, last_movement_at=now(), updated_at=now() WHERE id=ln.finished_id;
    UPDATE mf_return_lines SET total=ln.qty*ln.unit_price WHERE id=ln.id;
    total_amt := total_amt + ln.qty*ln.unit_price;
    INSERT INTO mf_log(movement_type,direction,item_kind,item_id,item_name,qty,unit,unit_cost,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes)
      VALUES('sale_return','IN','finished',ln.finished_id,ln.fname,ln.qty,ln.funit,ln.unit_price,ln.qty*ln.unit_price,inv.customer,'مخزن المنتجات الجاهزة',inv.return_no,'mf_returns',inv.id,auth.uid(),'مرتجع مبيعات');
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
  FOR ln IN SELECT l.*, f.name_ar AS fname, f.unit AS funit, f.stock AS cur_stock, f.avg_prod_cost AS cur_cost, f.code AS fcode FROM mf_transfer_lines l JOIN meat_finished_inventory f ON f.id=l.finished_id WHERE l.transfer_id=p_id LOOP
    IF ln.cur_stock < ln.qty THEN RAISE EXCEPTION 'رصيد % غير كاف للنقل', ln.fname; END IF;
    UPDATE meat_finished_inventory SET stock=ln.cur_stock - ln.qty, last_movement_at=now(), updated_at=now() WHERE id=ln.finished_id;
    UPDATE mf_transfer_lines SET unit_cost=ln.cur_cost, total=ln.qty*ln.cur_cost WHERE id=ln.id;
    total_v := total_v + ln.qty*ln.cur_cost;
    SELECT id INTO dest_item_id FROM inventory_items WHERE warehouse_id=inv.destination_warehouse_id AND item_code=ln.fcode LIMIT 1;
    IF dest_item_id IS NULL THEN
      INSERT INTO inventory_items(warehouse_id,name,unit,stock,low_stock_threshold,unit_cost,is_active,module,item_code,last_movement_date)
        VALUES(inv.destination_warehouse_id, ln.fname, ln.funit, ln.qty, 0, ln.cur_cost, true, 'meat', ln.fcode, now())
        RETURNING id INTO dest_item_id;
    ELSE
      UPDATE inventory_items SET stock=stock+ln.qty, unit_cost=ln.cur_cost, last_movement_date=now(), updated_at=now() WHERE id=dest_item_id;
    END IF;
    INSERT INTO mf_log(movement_type,direction,item_kind,item_id,item_name,qty,unit,unit_cost,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes)
      VALUES('transfer_out','OUT','finished',ln.finished_id,ln.fname,ln.qty,ln.funit,ln.cur_cost,ln.qty*ln.cur_cost,'مخزن المنتجات الجاهزة','المخزن الرئيسي',inv.transfer_no,'mf_transfers',inv.id,auth.uid(),'نقل للمخزن الرئيسي');
  END LOOP;
  UPDATE mf_transfers SET total_value=total_v, status='posted', posted_at=now(), posted_by=auth.uid(), updated_at=now() WHERE id=p_id;
END $$;

-- Cleanup previously-posted test artifacts from earlier failed attempt
-- (some inventory got bumped by tests 1-3 already; reset for clean test run)
UPDATE meat_raw_inventory SET stock=0, avg_cost=0 WHERE code IN ('RM-OSTRICH','RM-BEEF');
UPDATE meat_packaging_inventory SET stock=0, avg_cost=0 WHERE code='PK-KOFTA';
DELETE FROM mf_log;
DELETE FROM mf_treasury;
DELETE FROM mf_raw_purchase_items;
DELETE FROM mf_raw_purchases;
DELETE FROM mf_pack_purchase_items;
DELETE FROM mf_pack_purchases;
ALTER SEQUENCE mf_rp_seq RESTART WITH 1;
ALTER SEQUENCE mf_pp_seq RESTART WITH 1;
ALTER SEQUENCE mf_log_seq RESTART WITH 1;
