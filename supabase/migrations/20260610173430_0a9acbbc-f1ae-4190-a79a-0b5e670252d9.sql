
-- Phase 1: Meat Factory Purchase Invoices + Packaging materials

-- 1) Extend meat_factory_raw_items
ALTER TABLE public.meat_factory_raw_items
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'raw',
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE public.meat_factory_raw_items
  DROP CONSTRAINT IF EXISTS meat_factory_raw_items_kind_check;
ALTER TABLE public.meat_factory_raw_items
  ADD CONSTRAINT meat_factory_raw_items_kind_check CHECK (kind IN ('raw','spice','packaging'));

-- Backfill kind from notes for existing rows
UPDATE public.meat_factory_raw_items
SET kind = CASE
  WHEN notes ILIKE '%بهارات%' OR notes ILIKE '%إضافات%' THEN 'spice'
  WHEN notes ILIKE '%ثلاجة%' OR notes ILIKE '%مواد خام%' THEN 'raw'
  ELSE kind
END
WHERE kind = 'raw';

-- 2) Extend meat_factory_purchases
ALTER TABLE public.meat_factory_purchases
  ADD COLUMN IF NOT EXISTS invoice_no text,
  ADD COLUMN IF NOT EXISTS purchase_invoice_uuid uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS invoice_type text NOT NULL DEFAULT 'mixed',
  ADD COLUMN IF NOT EXISTS receipt_no text,
  ADD COLUMN IF NOT EXISTS attachment_url text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_meat_purchases_invoice_no ON public.meat_factory_purchases(invoice_no) WHERE invoice_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_meat_purchases_uuid ON public.meat_factory_purchases(purchase_invoice_uuid);

ALTER TABLE public.meat_factory_purchases
  DROP CONSTRAINT IF EXISTS meat_factory_purchases_invoice_type_check;
ALTER TABLE public.meat_factory_purchases
  ADD CONSTRAINT meat_factory_purchases_invoice_type_check
  CHECK (invoice_type IN ('raw','spice','packaging','mixed'));

-- Allow status=rejected/cancelled too (no strict CHECK existed — leave as-is).

-- 3) Extend meat_factory_purchase_lines
ALTER TABLE public.meat_factory_purchase_lines
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'raw',
  ADD COLUMN IF NOT EXISTS unit text,
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.meat_factory_purchase_lines
  DROP CONSTRAINT IF EXISTS meat_factory_purchase_lines_kind_check;
ALTER TABLE public.meat_factory_purchase_lines
  ADD CONSTRAINT meat_factory_purchase_lines_kind_check CHECK (kind IN ('raw','spice','packaging'));

-- 4) Extend meat_factory_inventory_moves
ALTER TABLE public.meat_factory_inventory_moves
  ADD COLUMN IF NOT EXISTS stock_before numeric,
  ADD COLUMN IF NOT EXISTS stock_after numeric;

-- Anti-duplicate: only one IN move per (purchase, item) line
CREATE UNIQUE INDEX IF NOT EXISTS uq_meat_moves_purchase_item
  ON public.meat_factory_inventory_moves(ref_id, item_id, direction)
  WHERE ref_table = 'meat_factory_purchases';

-- 5) Auto invoice number generator
CREATE OR REPLACE FUNCTION public.gen_meat_purchase_invoice_no()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prefix text; v_count int; v_no text;
BEGIN
  v_prefix := 'MPI-' || to_char(now() AT TIME ZONE 'Africa/Cairo', 'YYYYMM') || '-';
  SELECT COUNT(*)+1 INTO v_count FROM public.meat_factory_purchases
    WHERE invoice_no LIKE v_prefix || '%';
  v_no := v_prefix || lpad(v_count::text, 4, '0');
  RETURN v_no;
END $$;

-- 6) Replace approve_meat_purchase to record kind + stock_before/after, audit, idempotency
CREATE OR REPLACE FUNCTION public.approve_meat_purchase(p_purchase_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_p RECORD; v_line RECORD; v_txn uuid; v_new_avg numeric; v_old_stock numeric; v_old_cost numeric; v_kind text;
BEGIN
  IF NOT (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')) THEN
    RAISE EXCEPTION 'الاعتماد متاح للمدير العام أو المدير التنفيذي فقط';
  END IF;

  SELECT * INTO v_p FROM meat_factory_purchases WHERE id=p_purchase_id FOR UPDATE;
  IF v_p.id IS NULL THEN RAISE EXCEPTION 'فاتورة غير موجودة'; END IF;
  IF v_p.status='approved' THEN RAISE EXCEPTION 'الفاتورة معتمدة بالفعل'; END IF;
  IF v_p.status='rejected' OR v_p.status='cancelled' THEN RAISE EXCEPTION 'لا يمكن اعتماد فاتورة مرفوضة أو ملغاة'; END IF;

  IF v_p.invoice_no IS NULL THEN
    UPDATE meat_factory_purchases SET invoice_no = gen_meat_purchase_invoice_no() WHERE id=p_purchase_id;
  END IF;

  FOR v_line IN SELECT * FROM meat_factory_purchase_lines WHERE purchase_id=p_purchase_id LOOP
    SELECT current_stock, avg_cost, kind INTO v_old_stock, v_old_cost, v_kind
      FROM meat_factory_raw_items WHERE id=v_line.raw_item_id FOR UPDATE;
    IF v_old_stock IS NULL THEN RAISE EXCEPTION 'صنف غير موجود في مخزن الخامات: %', v_line.raw_item_name; END IF;

    v_new_avg := CASE WHEN (v_old_stock + v_line.quantity) = 0 THEN v_line.unit_price
                      ELSE ((v_old_stock*v_old_cost)+(v_line.quantity*v_line.unit_price))/(v_old_stock+v_line.quantity) END;

    UPDATE meat_factory_raw_items
      SET current_stock = v_old_stock + v_line.quantity, avg_cost = v_new_avg, updated_at = now()
      WHERE id = v_line.raw_item_id;

    INSERT INTO meat_factory_inventory_moves(item_kind,item_id,item_name,direction,quantity,unit_cost,reason,ref_table,ref_id,created_by,stock_before,stock_after)
      VALUES(COALESCE(v_line.kind, v_kind, 'raw'), v_line.raw_item_id, v_line.raw_item_name, 'IN',
             v_line.quantity, v_line.unit_price, 'شراء خامات',
             'meat_factory_purchases', p_purchase_id, auth.uid(),
             v_old_stock, v_old_stock + v_line.quantity);
  END LOOP;

  IF v_p.payment_method='cash' AND v_p.total_amount>0 THEN
    INSERT INTO meat_factory_treasury_txns(txn_date,direction,amount,reason,ref_table,ref_id,created_by)
      VALUES(v_p.purchase_date,'OUT',v_p.total_amount,'شراء خامات مصنع اللحوم','meat_factory_purchases',p_purchase_id,auth.uid())
      RETURNING id INTO v_txn;
  END IF;

  UPDATE meat_factory_purchases
    SET status='approved', approved_at=now(), approved_by=auth.uid(), treasury_txn_id=v_txn
    WHERE id=p_purchase_id;

  INSERT INTO meat_factory_audit_log(table_name,row_id,action,new_value,performed_by)
    VALUES('meat_factory_purchases', p_purchase_id, 'approve',
           jsonb_build_object('total', v_p.total_amount, 'supplier', v_p.supplier), auth.uid());

  RETURN p_purchase_id;
END $$;

-- 7) Reject helper
CREATE OR REPLACE FUNCTION public.reject_meat_purchase(p_purchase_id uuid, p_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  IF NOT (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')) THEN
    RAISE EXCEPTION 'الرفض متاح للمدير العام أو المدير التنفيذي فقط';
  END IF;
  SELECT status INTO v_status FROM meat_factory_purchases WHERE id=p_purchase_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'فاتورة غير موجودة'; END IF;
  IF v_status<>'draft' THEN RAISE EXCEPTION 'لا يمكن رفض فاتورة بحالة %', v_status; END IF;
  UPDATE meat_factory_purchases SET status='rejected', notes = COALESCE(notes,'') || E'\n[رفض] ' || COALESCE(p_reason,'') WHERE id=p_purchase_id;
  INSERT INTO meat_factory_audit_log(table_name,row_id,action,new_value,performed_by)
    VALUES('meat_factory_purchases', p_purchase_id, 'reject', jsonb_build_object('reason', p_reason), auth.uid());
  RETURN p_purchase_id;
END $$;

-- 8) Insert 14 packaging items (idempotent on name)
INSERT INTO public.meat_factory_raw_items(name, unit, current_stock, avg_cost, low_stock_threshold, notes, kind, is_active)
SELECT v.name, v.unit, 0, 0, 0, 'رصيد افتتاحي — خامات تغليف', 'packaging', true
FROM (VALUES
  ('علبة برجر','علبة'),('علبة كفتة','علبة'),('علبة سجق','علبة'),('علبة مفروم','علبة'),
  ('علبة حواوشي','علبة'),('علبة شاورما','علبة'),('علبة شيش','علبة'),
  ('رول استرتش','رول'),('أكياس تغليف','قطعة'),('استيكرات','قطعة'),
  ('أطباق فوم','قطعة'),('رول فاكيوم','رول'),('شنط','قطعة'),('تغليف أخرى','قطعة')
) AS v(name, unit)
WHERE NOT EXISTS (SELECT 1 FROM public.meat_factory_raw_items r WHERE r.name = v.name);
