
-- Update create RPC: notifications go ONLY to general_manager + executive_manager
CREATE OR REPLACE FUNCTION public.create_feed_production_invoice_atomic(
  p_product_id uuid,
  p_qty_produced numeric,
  p_labor_cost numeric,
  p_notes text,
  p_items jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_invoice_id uuid := gen_random_uuid();
  v_prod_no text;
  v_count int;
  v_product_name text;
  u record;
BEGIN
  IF p_product_id IS NULL THEN RAISE EXCEPTION 'المنتج مطلوب'; END IF;
  IF COALESCE(p_qty_produced,0) <= 0 THEN RAISE EXCEPTION 'الكمية المنتجة يجب أن تكون أكبر من صفر'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'يجب إضافة خامات للفاتورة';
  END IF;

  v_prod_no := 'PROD-' || to_char(now(),'DDMMYYHH24MISS') || lpad((floor(random()*999)::int)::text,3,'0');

  INSERT INTO public.feed_production_invoices(
    id, invoice_no, product_id, qty_produced, labor_cost, notes,
    total_cost, unit_cost, status, created_by, created_at, updated_at
  ) VALUES (
    v_invoice_id, v_prod_no, p_product_id, p_qty_produced, COALESCE(p_labor_cost,0), p_notes,
    0, 0, 'pending_approval', v_user, now(), now()
  );

  INSERT INTO public.feed_production_invoice_items(invoice_id, raw_material_id, quantity, unit_cost, line_cost)
  SELECT v_invoice_id,
         (it->>'raw_material_id')::uuid,
         (it->>'quantity')::numeric,
         COALESCE((it->>'unit_cost')::numeric, 0),
         COALESCE((it->>'quantity')::numeric,0) * COALESCE((it->>'unit_cost')::numeric,0)
    FROM jsonb_array_elements(p_items) it;

  PERFORM public.finalize_feed_production(v_invoice_id);

  SELECT COUNT(*) INTO v_count FROM public.feed_production_invoice_items WHERE invoice_id=v_invoice_id;
  IF v_count = 0 THEN RAISE EXCEPTION 'فشل حفظ الخامات'; END IF;

  -- Notifications ONLY to general_manager + executive_manager (financial_manager excluded)
  SELECT name INTO v_product_name FROM feed_products WHERE id=p_product_id;
  FOR u IN
    SELECT DISTINCT ur.user_id FROM user_roles ur
     WHERE ur.role IN ('general_manager','executive_manager')
  LOOP
    INSERT INTO public.notifications(title, description, type, target_user_id)
    VALUES (
      'فاتورة تصنيع علف بانتظار الاعتماد',
      'فاتورة ' || v_prod_no || ' — ' || COALESCE(v_product_name,'') || ' بكمية ' || p_qty_produced || ' كجم',
      'feed_production_approval',
      u.user_id
    );
  END LOOP;

  RETURN v_invoice_id;
END $function$;

-- Approval restricted to general_manager + executive_manager only
CREATE OR REPLACE FUNCTION public.approve_feed_production_invoice(p_invoice_id uuid)
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
         updated_at=now()
   WHERE id=p_invoice_id;

  INSERT INTO feed_audit_log(table_name, row_id, action, new_value, performed_by, notes)
  VALUES ('feed_production_invoices', p_invoice_id, 'APPROVE',
          jsonb_build_object('total_cost', v_total,
                             'unit_cost', CASE WHEN v_qty>0 THEN v_total/v_qty ELSE 0 END,
                             'labor_cost', v_labor),
          v_user, 'اعتماد فاتورة تصنيع علف');
END $function$;

-- Reject restricted to general_manager + executive_manager only
CREATE OR REPLACE FUNCTION public.reject_feed_production_invoice(p_invoice_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_status text;
BEGIN
  IF NOT (has_role(v_user,'general_manager') OR has_role(v_user,'executive_manager')) THEN
    RAISE EXCEPTION 'غير مصرح: الرفض للمدير العام أو التنفيذي فقط';
  END IF;
  IF COALESCE(trim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'سبب الرفض مطلوب';
  END IF;

  SELECT status INTO v_status FROM feed_production_invoices WHERE id=p_invoice_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
  IF v_status <> 'pending_approval' THEN
    RAISE EXCEPTION 'لا يمكن رفض فاتورة حالتها: %', v_status;
  END IF;

  UPDATE feed_production_invoices
     SET status='rejected',
         rejected_by=v_user,
         rejected_at=now(),
         rejection_reason=p_reason,
         updated_at=now()
   WHERE id=p_invoice_id;

  INSERT INTO feed_audit_log(table_name, row_id, action, new_value, performed_by, notes)
  VALUES ('feed_production_invoices', p_invoice_id, 'REJECT',
          jsonb_build_object('reason', p_reason), v_user, 'رفض فاتورة تصنيع علف');
END $function$;
