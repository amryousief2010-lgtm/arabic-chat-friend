
-- 1) Idempotency guard column: prevents any code path from applying stock twice
ALTER TABLE public.feed_production_invoices
  ADD COLUMN IF NOT EXISTS stock_applied_at timestamptz;

-- Mark all currently-approved invoices as already applied
UPDATE public.feed_production_invoices
   SET stock_applied_at = COALESCE(approved_at, updated_at, now())
 WHERE status = 'approved' AND stock_applied_at IS NULL;

-- 2) Harden the approve function with the guard
CREATE OR REPLACE FUNCTION public.approve_feed_production_invoice(
  p_invoice_id uuid,
  p_review_note text DEFAULT NULL::text,
  p_was_flagged boolean DEFAULT false,
  p_flag_reasons jsonb DEFAULT NULL::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_status text; v_qty numeric; v_prod uuid; v_labor numeric;
  v_applied_at timestamptz;
  v_items_total numeric; v_total numeric;
  v_old_stock numeric; v_old_cost numeric; v_new_cost numeric;
  r record;
BEGIN
  IF NOT (has_role(v_user,'general_manager') OR has_role(v_user,'executive_manager')) THEN
    RAISE EXCEPTION 'غير مصرح: الاعتماد للمدير العام أو التنفيذي فقط';
  END IF;

  SELECT status, qty_produced, product_id, COALESCE(labor_cost,0), stock_applied_at
    INTO v_status, v_qty, v_prod, v_labor, v_applied_at
    FROM feed_production_invoices WHERE id=p_invoice_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
  IF v_status <> 'pending_approval' THEN
    RAISE EXCEPTION 'الفاتورة ليست بانتظار الاعتماد (الحالة الحالية: %)', v_status;
  END IF;
  IF v_applied_at IS NOT NULL THEN
    RAISE EXCEPTION 'تم بالفعل تطبيق أثر هذه الفاتورة على المخزون سابقًا (في %). لا يمكن تكرار الاعتماد.', v_applied_at;
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
         stock_applied_at=now(),
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

-- 3) Also harden finalize to never touch stock (creation flow only computes totals)
CREATE OR REPLACE FUNCTION public.finalize_feed_production(_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_total numeric; v_items_total numeric; v_labor numeric;
  v_qty numeric;
BEGIN
  SELECT COALESCE(SUM(line_cost),0) INTO v_items_total
    FROM feed_production_invoice_items WHERE invoice_id=_invoice_id;

  SELECT qty_produced, COALESCE(labor_cost,0)
    INTO v_qty, v_labor
    FROM feed_production_invoices WHERE id=_invoice_id;

  v_total := v_items_total + COALESCE(v_labor,0);

  -- Stock effects are handled exclusively by approve/edit RPCs. Never touch stock here.
  UPDATE feed_production_invoices
     SET total_cost = v_total,
         unit_cost = CASE WHEN v_qty>0 THEN v_total/v_qty ELSE 0 END,
         updated_at = now()
   WHERE id = _invoice_id;
END $function$;

-- 4) Post-approval edit RPC
CREATE OR REPLACE FUNCTION public.edit_approved_feed_production_invoice(
  p_invoice_id uuid,
  p_prod_date date,
  p_qty_produced numeric,
  p_bags numeric,
  p_labor_cost numeric,
  p_notes text,
  p_items jsonb,
  p_edit_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_status text; v_prod uuid;
  v_old_qty numeric; v_old_total numeric; v_old_labor numeric;
  v_new_items_total numeric; v_new_total numeric;
  v_prod_stock numeric; v_prod_cost numeric;
  v_after_revert_stock numeric; v_after_revert_value numeric;
  v_final_stock numeric; v_final_cost numeric;
  v_d_qty numeric;
  r record; new_item jsonb;
BEGIN
  IF NOT (has_role(v_user,'general_manager') OR has_role(v_user,'executive_manager')) THEN
    RAISE EXCEPTION 'غير مصرح: تعديل الفاتورة بعد الاعتماد للمدير العام أو التنفيذي فقط';
  END IF;
  IF p_edit_reason IS NULL OR length(trim(p_edit_reason)) < 3 THEN
    RAISE EXCEPTION 'سبب التعديل مطلوب';
  END IF;
  IF COALESCE(p_qty_produced,0) <= 0 THEN
    RAISE EXCEPTION 'الكمية المنتجة يجب أن تكون أكبر من صفر';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'يجب إضافة خامة واحدة على الأقل';
  END IF;

  SELECT status, product_id, qty_produced, COALESCE(total_cost,0), COALESCE(labor_cost,0)
    INTO v_status, v_prod, v_old_qty, v_old_total, v_old_labor
    FROM feed_production_invoices WHERE id=p_invoice_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
  IF v_status <> 'approved' THEN
    RAISE EXCEPTION 'التعديل بعد الاعتماد متاح فقط للفواتير المعتمدة (الحالة: %)', v_status;
  END IF;

  -- Lock product row
  SELECT COALESCE(current_stock,0), COALESCE(latest_unit_cost,0)
    INTO v_prod_stock, v_prod_cost
    FROM feed_products WHERE id=v_prod FOR UPDATE;

  -- Safety: ensure enough of previous produced qty is still in stock to revert
  IF v_prod_stock < v_old_qty THEN
    RAISE EXCEPTION 'لا يمكن التعديل: تم صرف % كجم من % كجم أصلية من هذا المنتج. المتاح % كجم فقط.',
      (v_old_qty - v_prod_stock), v_old_qty, v_prod_stock;
  END IF;

  -- Revert product stock by removing this invoice's contribution
  v_after_revert_stock := v_prod_stock - v_old_qty;
  v_after_revert_value := (v_prod_stock * v_prod_cost) - v_old_total;
  IF v_after_revert_value < 0 THEN v_after_revert_value := 0; END IF;

  -- Revert raw materials: put back old quantities
  FOR r IN SELECT raw_material_id, quantity FROM feed_production_invoice_items WHERE invoice_id=p_invoice_id LOOP
    UPDATE feed_raw_materials SET stock = stock + r.quantity, updated_at = now()
     WHERE id = r.raw_material_id;
  END LOOP;

  -- Delete old items (trigger revert_feed_production_item runs only if status=approved & fires on DELETE;
  -- our reversal above already restored stock, so temporarily switch status to prevent double revert)
  UPDATE feed_production_invoices SET status='editing' WHERE id=p_invoice_id;
  DELETE FROM feed_production_invoice_items WHERE invoice_id=p_invoice_id;

  -- Insert new items with fresh snapshots + deduct new quantities from raw stock
  FOR new_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    DECLARE
      v_rid uuid := (new_item->>'raw_material_id')::uuid;
      v_q   numeric := (new_item->>'quantity')::numeric;
      v_curr_stock numeric; v_curr_cost numeric; v_name text;
    BEGIN
      SELECT stock, unit_cost, name INTO v_curr_stock, v_curr_cost, v_name
        FROM feed_raw_materials WHERE id=v_rid FOR UPDATE;
      IF v_curr_stock IS NULL THEN RAISE EXCEPTION 'خامة غير موجودة'; END IF;
      IF v_curr_stock < v_q THEN
        RAISE EXCEPTION 'الكمية المطلوبة من "%": % كجم، المتاح % كجم', v_name, v_q, v_curr_stock;
      END IF;
      INSERT INTO feed_production_invoice_items(invoice_id, raw_material_id, quantity, unit_cost, line_cost)
      VALUES (p_invoice_id, v_rid, v_q, v_curr_cost, v_q * v_curr_cost);
      UPDATE feed_raw_materials SET stock = stock - v_q, updated_at = now() WHERE id=v_rid;
    END;
  END LOOP;

  -- Restore status to approved
  UPDATE feed_production_invoices SET status='approved' WHERE id=p_invoice_id;

  -- Recompute new totals
  SELECT COALESCE(SUM(line_cost),0) INTO v_new_items_total
    FROM feed_production_invoice_items WHERE invoice_id=p_invoice_id;
  v_new_total := v_new_items_total + COALESCE(p_labor_cost,0);
  IF v_new_total <= 0 THEN RAISE EXCEPTION 'إجمالي التكلفة الجديد صفر — غير مقبول'; END IF;

  -- Reapply product stock with new qty + new total, using post-revert weighted state
  v_final_stock := v_after_revert_stock + p_qty_produced;
  IF v_final_stock > 0 THEN
    v_final_cost := (v_after_revert_value + v_new_total) / v_final_stock;
  ELSE
    v_final_cost := 0;
  END IF;
  UPDATE feed_products
     SET current_stock = v_final_stock,
         latest_unit_cost = v_final_cost,
         updated_at = now()
   WHERE id = v_prod;

  -- Update invoice header
  UPDATE feed_production_invoices
     SET prod_date = COALESCE(p_prod_date, prod_date),
         qty_produced = p_qty_produced,
         bags = COALESCE(p_bags, bags),
         labor_cost = COALESCE(p_labor_cost, 0),
         notes = p_notes,
         total_cost = v_new_total,
         unit_cost = CASE WHEN p_qty_produced>0 THEN v_new_total/p_qty_produced ELSE 0 END,
         edited_after_approval_at = now(),
         edited_after_approval_by = v_user,
         edit_reason = p_edit_reason,
         updated_at = now()
   WHERE id = p_invoice_id;

  -- Labor treasury will auto-sync via existing trigger (fires on UPDATE OF labor_cost)

  INSERT INTO feed_audit_log(table_name, row_id, action, old_value, new_value, performed_by, notes)
  VALUES ('feed_production_invoices', p_invoice_id, 'EDIT_AFTER_APPROVAL',
          jsonb_build_object('qty', v_old_qty, 'total_cost', v_old_total, 'labor_cost', v_old_labor),
          jsonb_build_object('qty', p_qty_produced, 'total_cost', v_new_total, 'labor_cost', p_labor_cost, 'reason', p_edit_reason),
          v_user, 'تعديل فاتورة تصنيع علف بعد الاعتماد');
END $function$;

-- 5) Add columns to store edit metadata
ALTER TABLE public.feed_production_invoices
  ADD COLUMN IF NOT EXISTS edited_after_approval_at timestamptz,
  ADD COLUMN IF NOT EXISTS edited_after_approval_by uuid,
  ADD COLUMN IF NOT EXISTS edit_reason text;

GRANT EXECUTE ON FUNCTION public.edit_approved_feed_production_invoice(uuid, date, numeric, numeric, numeric, text, jsonb, text) TO authenticated;
