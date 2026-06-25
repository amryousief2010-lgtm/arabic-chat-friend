
-- 1) Add approval columns
ALTER TABLE public.feed_production_invoices
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending_approval',
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Status domain
DO $$ BEGIN
  ALTER TABLE public.feed_production_invoices
    ADD CONSTRAINT feed_prod_invoices_status_chk
    CHECK (status IN ('pending_approval','approved','rejected','cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_feed_prod_invoices_status ON public.feed_production_invoices(status);

-- Backfill existing rows as approved (they already have full effects applied)
UPDATE public.feed_production_invoices SET status='approved' WHERE status='pending_approval' AND created_at < now();

-- 2) Item trigger: skip stock deduction for pending invoices, just snapshot cost
CREATE OR REPLACE FUNCTION public.apply_feed_production_item()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_cost numeric;
  v_stock numeric;
  v_status text;
BEGIN
  SELECT status INTO v_status FROM feed_production_invoices WHERE id = NEW.invoice_id;
  SELECT COALESCE(unit_cost,0), COALESCE(stock,0) INTO v_cost, v_stock
    FROM feed_raw_materials WHERE id = NEW.raw_material_id;

  NEW.unit_cost := v_cost;
  NEW.line_cost := NEW.quantity * v_cost;

  IF v_status IS DISTINCT FROM 'approved' THEN
    -- Pending/rejected: only snapshot cost, no stock effect, no hard availability check
    RETURN NEW;
  END IF;

  IF v_stock < NEW.quantity THEN
    RAISE EXCEPTION 'الكمية المطلوبة من الخامة أكبر من الرصيد المتاح (% < %)', v_stock, NEW.quantity;
  END IF;
  UPDATE feed_raw_materials
     SET stock = GREATEST(0, stock - NEW.quantity), updated_at = now()
   WHERE id = NEW.raw_material_id;
  RETURN NEW;
END $function$;

-- 3) Revert trigger: skip if parent not approved (nothing to revert)
CREATE OR REPLACE FUNCTION public.revert_feed_production_item()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM feed_production_invoices WHERE id = OLD.invoice_id;
  IF v_status = 'approved' THEN
    UPDATE feed_raw_materials
       SET stock = stock + OLD.quantity, updated_at = now()
     WHERE id = OLD.raw_material_id;
  END IF;
  RETURN OLD;
END $function$;

-- 4) Labor sync: only create treasury txn for approved invoices
CREATE OR REPLACE FUNCTION public.feed_invoice_labor_sync()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_amount numeric; v_prod_no text; v_date date; v_existing uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.feed_factory_treasury_txns
     WHERE ref_table='feed_production_invoice' AND ref_id=OLD.id AND kind='manufacturing_labor';
    RETURN OLD;
  END IF;

  -- Only operate on approved invoices
  IF COALESCE(NEW.status,'pending_approval') <> 'approved' THEN
    -- Ensure no stale txn lingers
    DELETE FROM public.feed_factory_treasury_txns
     WHERE ref_table='feed_production_invoice' AND ref_id=NEW.id AND kind='manufacturing_labor';
    RETURN NEW;
  END IF;

  v_amount := COALESCE(NEW.labor_cost, 0);
  v_prod_no := NEW.prod_no;
  v_date := COALESCE(NEW.prod_date, CURRENT_DATE);

  SELECT id INTO v_existing FROM public.feed_factory_treasury_txns
   WHERE ref_table='feed_production_invoice' AND ref_id=NEW.id AND kind='manufacturing_labor' LIMIT 1;

  IF v_amount <= 0 THEN
    IF v_existing IS NOT NULL THEN DELETE FROM public.feed_factory_treasury_txns WHERE id=v_existing; END IF;
    RETURN NEW;
  END IF;

  IF v_existing IS NULL THEN
    INSERT INTO public.feed_factory_treasury_txns(
      txn_no, txn_date, direction, kind, amount, ref_table, ref_id, party, note, created_by
    ) VALUES (
      'TRZ-LAB-' || to_char(now(),'YYMMDDHH24MISS') || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6),
      v_date, 'out', 'manufacturing_labor', v_amount,
      'feed_production_invoice', NEW.id, 'مصنع الأعلاف',
      'أجرة تصنيع لفاتورة رقم ' || COALESCE(v_prod_no,''),
      COALESCE(NEW.approved_by, NEW.created_by)
    );
  ELSE
    UPDATE public.feed_factory_treasury_txns
       SET amount=v_amount, txn_date=v_date,
           note='أجرة تصنيع لفاتورة رقم ' || COALESCE(v_prod_no,'')
     WHERE id=v_existing;
  END IF;
  RETURN NEW;
END $function$;

-- Add status to the UPDATE trigger trigger columns (must re-create)
DROP TRIGGER IF EXISTS trg_feed_invoice_labor_sync_upd ON public.feed_production_invoices;
CREATE TRIGGER trg_feed_invoice_labor_sync_upd
AFTER UPDATE OF labor_cost, prod_no, prod_date, status ON public.feed_production_invoices
FOR EACH ROW EXECUTE FUNCTION public.feed_invoice_labor_sync();

-- 5) finalize: skip product stock/cost update for non-approved
CREATE OR REPLACE FUNCTION public.finalize_feed_production(_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_total numeric; v_items_total numeric; v_labor numeric;
  v_qty numeric; v_prod uuid; v_status text;
  v_old_stock numeric; v_old_cost numeric; v_new_cost numeric;
BEGIN
  SELECT COALESCE(SUM(line_cost),0) INTO v_items_total
    FROM feed_production_invoice_items WHERE invoice_id=_invoice_id;

  SELECT qty_produced, product_id, COALESCE(labor_cost,0), status
    INTO v_qty, v_prod, v_labor, v_status
    FROM feed_production_invoices WHERE id=_invoice_id;

  v_total := v_items_total + COALESCE(v_labor,0);

  IF v_status = 'approved' THEN
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
  END IF;

  UPDATE feed_production_invoices
     SET total_cost = v_total,
         unit_cost = CASE WHEN v_qty>0 THEN v_total/v_qty ELSE 0 END,
         updated_at = now()
   WHERE id = _invoice_id;
END $function$;

-- 6) Modify atomic creator to leave invoice in pending_approval state + notify approvers
CREATE OR REPLACE FUNCTION public.create_feed_production_invoice_atomic(
  p_prod_date date, p_product_id uuid, p_qty_produced numeric, p_bags numeric,
  p_labor_cost numeric, p_notes text, p_client_request_id text, p_items jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_invoice_id uuid;
  v_user uuid := auth.uid();
  v_count int;
  v_prod_no text;
  v_product_name text;
  u record;
BEGIN
  IF p_product_id IS NULL THEN RAISE EXCEPTION 'يجب اختيار المنتج'; END IF;
  IF COALESCE(p_qty_produced,0) <= 0 THEN RAISE EXCEPTION 'الكمية المنتجة يجب أن تكون أكبر من صفر'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'يجب إضافة خامة واحدة على الأقل';
  END IF;

  IF p_client_request_id IS NOT NULL THEN
    SELECT id INTO v_invoice_id FROM public.feed_production_invoices
      WHERE client_request_id=p_client_request_id LIMIT 1;
    IF v_invoice_id IS NOT NULL THEN RETURN v_invoice_id; END IF;
  END IF;

  -- Insert header as pending_approval, with labor_cost stored but no treasury (trigger gated)
  INSERT INTO public.feed_production_invoices(
    prod_date, product_id, qty_produced, bags, labor_cost, notes, created_by, client_request_id, status
  ) VALUES (
    COALESCE(p_prod_date, CURRENT_DATE), p_product_id, p_qty_produced,
    COALESCE(p_bags,0), COALESCE(p_labor_cost,0), p_notes, v_user, p_client_request_id, 'pending_approval'
  ) RETURNING id, prod_no INTO v_invoice_id, v_prod_no;

  -- Insert items (trigger snapshots cost only, no stock effect)
  INSERT INTO public.feed_production_invoice_items(invoice_id, raw_material_id, quantity, unit_cost, line_cost)
  SELECT v_invoice_id,
         (item->>'raw_material_id')::uuid,
         (item->>'quantity')::numeric,
         (item->>'unit_cost')::numeric,
         COALESCE((item->>'line_cost')::numeric, ((item->>'quantity')::numeric * (item->>'unit_cost')::numeric))
  FROM jsonb_array_elements(p_items) AS item;

  -- Recompute totals only (no product stock change since status pending)
  PERFORM public.finalize_feed_production(v_invoice_id);

  SELECT COUNT(*) INTO v_count FROM public.feed_production_invoice_items WHERE invoice_id=v_invoice_id;
  IF v_count = 0 THEN RAISE EXCEPTION 'فشل حفظ الخامات'; END IF;

  -- Notifications to approvers
  SELECT name INTO v_product_name FROM feed_products WHERE id=p_product_id;
  FOR u IN
    SELECT DISTINCT ur.user_id FROM user_roles ur
     WHERE ur.role IN ('general_manager','executive_manager','financial_manager')
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

-- 7) Approve RPC
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
  IF NOT (has_role(v_user,'general_manager') OR has_role(v_user,'executive_manager') OR has_role(v_user,'financial_manager')) THEN
    RAISE EXCEPTION 'غير مصرح: الاعتماد للمدير العام أو التنفيذي أو محمد شعلة فقط';
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

  -- Re-snapshot current raw material cost + check availability + deduct stock
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

  -- Compute totals from refreshed line_cost
  SELECT COALESCE(SUM(line_cost),0) INTO v_items_total
    FROM feed_production_invoice_items WHERE invoice_id=p_invoice_id;
  v_total := v_items_total + COALESCE(v_labor,0);

  -- Update product stock + average cost
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

  -- Flip status to approved + totals + approver. This UPDATE fires labor_sync trigger
  -- which will now create the treasury txn since status='approved'.
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

-- 8) Reject RPC
CREATE OR REPLACE FUNCTION public.reject_feed_production_invoice(p_invoice_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_status text;
BEGIN
  IF NOT (has_role(v_user,'general_manager') OR has_role(v_user,'executive_manager') OR has_role(v_user,'financial_manager')) THEN
    RAISE EXCEPTION 'غير مصرح: الرفض للمدير العام أو التنفيذي أو محمد شعلة فقط';
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

GRANT EXECUTE ON FUNCTION public.approve_feed_production_invoice(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_feed_production_invoice(uuid, text) TO authenticated;
