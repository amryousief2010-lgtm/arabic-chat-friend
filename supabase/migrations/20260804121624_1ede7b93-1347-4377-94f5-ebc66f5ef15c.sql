-- 1) status + audit columns
ALTER TABLE public.mf_transfers DROP CONSTRAINT IF EXISTS mf_transfers_status_check;
ALTER TABLE public.mf_transfers
  ADD CONSTRAINT mf_transfers_status_check
  CHECK (status = ANY (ARRAY['draft','awaiting_receipt','posted','cancelled']));

ALTER TABLE public.mf_transfers
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS received_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- 2) post: deduct from factory, do NOT add to destination stock (needs receipt)
CREATE OR REPLACE FUNCTION public.post_mf_transfer(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE inv RECORD; ln RECORD; total_v NUMERIC := 0;
BEGIN
  SELECT * INTO inv FROM mf_transfers WHERE id = p_id FOR UPDATE;
  IF inv IS NULL THEN RAISE EXCEPTION 'أمر نقل غير موجود'; END IF;
  IF inv.status = 'posted' THEN RAISE EXCEPTION 'أمر النقل معتمد بالفعل'; END IF;
  IF inv.status = 'awaiting_receipt' THEN RAISE EXCEPTION 'أمر النقل مرسل بالفعل وبانتظار استلام المخزن'; END IF;
  IF inv.status = 'cancelled' THEN RAISE EXCEPTION 'أمر النقل ملغى'; END IF;

  FOR ln IN
    SELECT l.*, f.name_ar AS fname, f.unit AS funit, f.stock AS cur_stock,
           f.avg_prod_cost AS cur_cost, f.code AS fcode
    FROM mf_transfer_lines l
    JOIN meat_finished_inventory f ON f.id = l.finished_id
    WHERE l.transfer_id = p_id
  LOOP
    IF ln.cur_stock < ln.qty THEN RAISE EXCEPTION 'رصيد % غير كاف للنقل', ln.fname; END IF;
    UPDATE meat_finished_inventory
      SET stock = ln.cur_stock - ln.qty, last_movement_at = now(), updated_at = now()
      WHERE id = ln.finished_id;
    UPDATE mf_transfer_lines SET unit_cost = ln.cur_cost, total = ln.qty * ln.cur_cost WHERE id = ln.id;
    total_v := total_v + ln.qty * ln.cur_cost;

    INSERT INTO mf_log(movement_type,direction,item_kind,item_id,item_name,qty,unit,unit_cost,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes,is_test)
      VALUES('transfer_out','OUT','finished',ln.finished_id,ln.fname,ln.qty,ln.funit,ln.cur_cost,ln.qty*ln.cur_cost,
             'مخزن المنتجات الجاهزة','بانتظار استلام المخزن',inv.transfer_no,'mf_transfers',inv.id,auth.uid(),
             'إرسال للمخزن — بانتظار اعتماد مسؤول المخزن',inv.is_test);
  END LOOP;

  UPDATE mf_transfers
     SET total_value = total_v, status = 'awaiting_receipt', updated_at = now()
   WHERE id = p_id;
END $$;

-- 3) warehouse supervisor receives => stock enters destination warehouse
CREATE OR REPLACE FUNCTION public.receive_mf_transfer(p_id uuid, p_notes text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inv RECORD; ln RECORD; dest_item_id uuid; v_uid uuid := auth.uid();
BEGIN
  IF NOT (
    public.has_role(v_uid,'general_manager')
    OR public.has_role(v_uid,'executive_manager')
    OR public.has_role(v_uid,'warehouse_supervisor')
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية اعتماد الوارد';
  END IF;

  SELECT * INTO inv FROM mf_transfers WHERE id = p_id FOR UPDATE;
  IF inv IS NULL THEN RAISE EXCEPTION 'أمر نقل غير موجود'; END IF;
  IF inv.status <> 'awaiting_receipt' THEN
    RAISE EXCEPTION 'أمر النقل ليس بانتظار الاستلام (الحالة: %)', inv.status;
  END IF;

  FOR ln IN
    SELECT l.*, f.name_ar AS fname, f.unit AS funit, f.code AS fcode
    FROM mf_transfer_lines l
    JOIN meat_finished_inventory f ON f.id = l.finished_id
    WHERE l.transfer_id = p_id
  LOOP
    SELECT id INTO dest_item_id FROM inventory_items
      WHERE warehouse_id = inv.destination_warehouse_id AND item_code = ln.fcode LIMIT 1;
    IF dest_item_id IS NULL THEN
      INSERT INTO inventory_items(warehouse_id,name,unit,stock,low_stock_threshold,unit_cost,is_active,module,item_code,last_movement_date)
        VALUES(inv.destination_warehouse_id, ln.fname, ln.funit, ln.qty, 0, COALESCE(ln.unit_cost,0), true, 'meat', ln.fcode, now())
        RETURNING id INTO dest_item_id;
    ELSE
      UPDATE inventory_items
        SET stock = COALESCE(stock,0) + ln.qty,
            unit_cost = COALESCE(NULLIF(ln.unit_cost,0), unit_cost),
            last_movement_date = now(), updated_at = now()
        WHERE id = dest_item_id;
    END IF;

    IF NOT inv.is_test THEN
      INSERT INTO inventory_movements(item_id,warehouse_id,movement_type,quantity,reference,party,unit_cost,notes,performed_by,movement_no,module,reference_type,reference_id,total_cost,approval_status,approved_by,approved_at)
        VALUES(dest_item_id, inv.destination_warehouse_id,'transfer_in', ln.qty, inv.transfer_no,'مصنع اللحوم',
               COALESCE(ln.unit_cost,0), COALESCE(p_notes,'استلام معتمد من مصنع اللحوم'), v_uid, inv.transfer_no,
               'meat','mf_transfers', inv.id::text, ln.qty * COALESCE(ln.unit_cost,0),'approved', v_uid, now());
    END IF;
  END LOOP;

  UPDATE mf_transfers
     SET status = 'posted', posted_at = now(), posted_by = v_uid,
         received_at = now(), received_by = v_uid,
         notes = COALESCE(p_notes, notes), updated_at = now()
   WHERE id = p_id;
END $$;

-- 4) reject => return quantities to factory finished stock
CREATE OR REPLACE FUNCTION public.reject_mf_transfer(p_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE inv RECORD; ln RECORD; v_uid uuid := auth.uid();
BEGIN
  IF NOT (
    public.has_role(v_uid,'general_manager')
    OR public.has_role(v_uid,'executive_manager')
    OR public.has_role(v_uid,'warehouse_supervisor')
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية رفض الوارد';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'سبب الرفض مطلوب';
  END IF;

  SELECT * INTO inv FROM mf_transfers WHERE id = p_id FOR UPDATE;
  IF inv IS NULL THEN RAISE EXCEPTION 'أمر نقل غير موجود'; END IF;
  IF inv.status <> 'awaiting_receipt' THEN
    RAISE EXCEPTION 'أمر النقل ليس بانتظار الاستلام (الحالة: %)', inv.status;
  END IF;

  FOR ln IN
    SELECT l.*, f.name_ar AS fname, f.unit AS funit
    FROM mf_transfer_lines l
    JOIN meat_finished_inventory f ON f.id = l.finished_id
    WHERE l.transfer_id = p_id
  LOOP
    UPDATE meat_finished_inventory
      SET stock = COALESCE(stock,0) + ln.qty, last_movement_at = now(), updated_at = now()
      WHERE id = ln.finished_id;

    INSERT INTO mf_log(movement_type,direction,item_kind,item_id,item_name,qty,unit,unit_cost,total_value,from_party,to_party,ref_no,source_type,source_id,created_by,notes,is_test)
      VALUES('transfer_return','IN','finished',ln.finished_id,ln.fname,ln.qty,ln.funit,COALESCE(ln.unit_cost,0),
             ln.qty*COALESCE(ln.unit_cost,0),'المخزن الرئيسي','مخزن المنتجات الجاهزة',inv.transfer_no,'mf_transfers',inv.id,v_uid,
             concat('رفض استلام: ', p_reason), inv.is_test);
  END LOOP;

  UPDATE mf_transfers
     SET status = 'cancelled', rejected_at = now(), rejected_by = v_uid,
         rejection_reason = p_reason, updated_at = now()
   WHERE id = p_id;
END $$;

GRANT EXECUTE ON FUNCTION public.receive_mf_transfer(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_mf_transfer(uuid, text) TO authenticated;