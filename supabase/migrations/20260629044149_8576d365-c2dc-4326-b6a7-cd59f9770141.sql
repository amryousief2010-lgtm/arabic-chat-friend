CREATE OR REPLACE FUNCTION public.approve_feed_production_invoice(
  p_invoice_id uuid,
  p_review_note text DEFAULT NULL,
  p_was_flagged boolean DEFAULT false,
  p_flag_reasons jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_status text; v_qty numeric; v_prod uuid; v_labor numeric;
  v_items_total numeric; v_total numeric;
  v_old_stock numeric; v_old_cost numeric; v_new_cost numeric;
  r record;
BEGIN
  IF NOT (has_role(v_user,'general_manager') OR has_role(v_user,'executive_manager')) THEN
    RAISE EXCEPTION 'غير مصرح: الاعتماد للمدير العام أو التنفيذي فقط';
  END IF;

  SELECT status, qty_produced, product_id, COALESCE(labor_cost,0)
    INTO v_status, v_qty, v_prod, v_labor
    FROM feed_production_invoices WHERE id=p_invoice_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
  IF v_status <> 'pending_approval' THEN
    RAISE EXCEPTION 'الفاتورة ليست بانتظار الاعتماد (الحالة الحالية: %)', v_status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM feed_production_invoice_items WHERE invoice_id=p_invoice_id) THEN
    RAISE EXCEPTION 'لا يمكن اعتماد فاتورة بدون خامات';
  END IF;

  FOR r IN
    SELECT i.id AS item_id, i.raw_material_id, i.quantity,
           rm.unit_cost AS curr_cost, rm.stock AS curr_stock, rm.name
      FROM feed_production_invoice_items i
      JOIN feed_raw_materials rm ON rm.id = i.raw_material_id
     WHERE i.invoice_id = p_invoice_id
     FOR UPDATE OF rm
  LOOP
    IF r.curr_stock < r.quantity THEN
      RAISE EXCEPTION 'الكمية المطلوبة من الخامة "%": % كجم، الرصيد المتاح: % كجم', r.name, r.quantity, r.curr_stock;
    END IF;
    UPDATE feed_production_invoice_items
       SET unit_cost = r.curr_cost,
           line_cost = r.quantity * r.curr_cost
     WHERE id = r.item_id;
    UPDATE feed_raw_materials
       SET stock = stock - r.quantity, updated_at = now()
     WHERE id = r.raw_material_id;
  END LOOP;

  SELECT COALESCE(SUM(line_cost),0) INTO v_items_total
    FROM feed_production_invoice_items WHERE invoice_id=p_invoice_id;
  v_total := v_items_total + COALESCE(v_labor,0);

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'لا يمكن اعتماد فاتورة بإجمالي تكلفة صفر';
  END IF;

  SELECT COALESCE(current_stock,0), COALESCE(latest_unit_cost,0)
    INTO v_old_stock, v_old_cost FROM feed_products WHERE id=v_prod FOR UPDATE;
  IF (v_old_stock + v_qty) > 0 THEN
    v_new_cost := ((v_old_stock*v_old_cost) + v_total) / (v_old_stock + v_qty);
  ELSE
    v_new_cost := CASE WHEN v_qty>0 THEN v_total/v_qty ELSE 0 END;
  END IF;
  UPDATE feed_products
     SET current_stock = v_old_stock + v_qty,
         latest_unit_cost = v_new_cost,
         updated_at = now()
   WHERE id = v_prod;

  UPDATE feed_production_invoices
     SET status='approved',
         approved_by=v_user,
         approved_at=now(),
         total_cost=v_total,
         unit_cost=CASE WHEN v_qty>0 THEN v_total/v_qty ELSE 0 END,
         review_note = COALESCE(p_review_note, review_note),
         was_flagged_for_review = COALESCE(p_was_flagged, was_flagged_for_review),
         flag_reasons = COALESCE(p_flag_reasons, flag_reasons),
         updated_at=now()
   WHERE id=p_invoice_id;

  INSERT INTO feed_audit_log(table_name, row_id, action, new_value, performed_by, notes)
  VALUES ('feed_production_invoices', p_invoice_id, 'APPROVE',
          jsonb_build_object(
            'total_cost', v_total,
            'unit_cost', CASE WHEN v_qty>0 THEN v_total/v_qty ELSE 0 END,
            'labor_cost', v_labor,
            'review_note', p_review_note,
            'was_flagged', p_was_flagged,
            'flag_reasons', p_flag_reasons
          ),
          v_user, 'اعتماد فاتورة تصنيع علف');
END $function$;

GRANT EXECUTE ON FUNCTION public.approve_feed_production_invoice(uuid, text, boolean, jsonb) TO authenticated;