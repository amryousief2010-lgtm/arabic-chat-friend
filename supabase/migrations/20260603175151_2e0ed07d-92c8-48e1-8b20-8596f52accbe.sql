
CREATE OR REPLACE FUNCTION public.post_mf_sale(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE inv RECORD; ln RECORD; v_amt NUMERIC:=0; v_cost NUMERIC:=0;
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
    v_amt := v_amt + ln.qty*ln.unit_price;
    v_cost := v_cost + ln.qty*ln.cur_cost;
    INSERT INTO mf_log(movement_type,direction,item_kind,item_id,item_name,qty,unit,unit_cost,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes,metadata)
      VALUES('sale','OUT','finished',ln.finished_id,ln.fname,ln.qty,ln.funit,ln.unit_price,ln.qty*ln.unit_price,'مخزن المنتجات الجاهزة',inv.customer,inv.invoice_no,'mf_sales',inv.id,auth.uid(),'بيع', jsonb_build_object('cost_snapshot',ln.cur_cost,'profit',(ln.unit_price-ln.cur_cost)*ln.qty));
  END LOOP;
  IF inv.payment_method='cash' THEN
    INSERT INTO mf_treasury(direction,amount,source_type,source_id,ref_no,notes,created_by) VALUES('IN',v_amt,'mf_sales',inv.id,inv.invoice_no,'تحصيل بيع نقدي',auth.uid());
    INSERT INTO mf_log(movement_type,direction,item_kind,qty,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes)
      VALUES('treasury_in','IN','treasury',v_amt,v_amt,inv.customer,'خزنة مصنع اللحوم',inv.invoice_no,'mf_sales',inv.id,auth.uid(),'تحصيل نقدي');
  END IF;
  UPDATE mf_sales SET total_amount=v_amt, total_cost=v_cost, profit=v_amt-v_cost, status='posted', posted_at=now(), posted_by=auth.uid(), updated_at=now() WHERE id=p_id;
END $$;

-- Cleanup partial test state
UPDATE meat_raw_inventory SET stock=0, avg_cost=0 WHERE code IN ('RM-OSTRICH','RM-BEEF');
UPDATE meat_packaging_inventory SET stock=0, avg_cost=0 WHERE code='PK-KOFTA';
UPDATE meat_finished_inventory SET stock=0, avg_prod_cost=0 WHERE code='FN-KOFTA';
DELETE FROM mf_log; DELETE FROM mf_treasury;
DELETE FROM mf_transfer_lines; DELETE FROM mf_transfers;
DELETE FROM mf_return_lines; DELETE FROM mf_returns;
DELETE FROM mf_sales_lines; DELETE FROM mf_sales;
DELETE FROM mf_mfg_raw_lines; DELETE FROM mf_mfg_pack_lines; DELETE FROM mf_manufacturing;
DELETE FROM mf_pack_purchase_items; DELETE FROM mf_pack_purchases;
DELETE FROM mf_raw_purchase_items; DELETE FROM mf_raw_purchases;
ALTER SEQUENCE mf_rp_seq RESTART WITH 1;
ALTER SEQUENCE mf_pp_seq RESTART WITH 1;
ALTER SEQUENCE mf_mfg_seq RESTART WITH 1;
ALTER SEQUENCE mf_sl_seq RESTART WITH 1;
ALTER SEQUENCE mf_ret_seq RESTART WITH 1;
ALTER SEQUENCE mf_tr_seq RESTART WITH 1;
ALTER SEQUENCE mf_log_seq RESTART WITH 1;
-- Also clean inventory_items remnants for FN-KOFTA from previous attempts
DELETE FROM inventory_items WHERE item_code='FN-KOFTA' AND module='meat';
