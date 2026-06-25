
-- =========================================================
-- 1) DATA FIX: Reverse orphan treasury txn + delete empty invoice
-- =========================================================
DO $$
DECLARE
  v_invoice_id uuid := 'd7b7707a-25e8-4f27-92b1-43eb867a9f98';
  v_txn_id uuid;
  v_items_count int;
BEGIN
  SELECT COUNT(*) INTO v_items_count
    FROM public.feed_production_invoice_items WHERE invoice_id = v_invoice_id;

  IF v_items_count = 0 THEN
    -- Set labor_cost to 0 first so the UPDATE trigger deletes the linked txn cleanly
    UPDATE public.feed_production_invoices
       SET labor_cost = 0
     WHERE id = v_invoice_id;

    -- Hard-delete txn in case trigger path didn't fire (orphan safety)
    DELETE FROM public.feed_factory_treasury_txns
     WHERE txn_no = 'TRZ-LAB-260625125511-c9da54';

    -- Now delete the empty invoice
    DELETE FROM public.feed_production_invoices WHERE id = v_invoice_id;
  END IF;
END $$;

-- =========================================================
-- 2) Validation: prevent orphan manufacturing_labor txns at commit time
-- =========================================================
CREATE OR REPLACE FUNCTION public.validate_manufacturing_labor_not_orphan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items int;
  v_total numeric;
  v_unit numeric;
BEGIN
  IF NEW.kind <> 'manufacturing_labor' OR NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;
  IF NEW.ref_table <> 'feed_production_invoice' OR NEW.ref_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(total_cost,0), COALESCE(unit_cost,0)
    INTO v_total, v_unit
    FROM public.feed_production_invoices
   WHERE id = NEW.ref_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'حركة أجرة تصنيع يتيمة: الفاتورة (%) غير موجودة', NEW.ref_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*) INTO v_items
    FROM public.feed_production_invoice_items WHERE invoice_id = NEW.ref_id;

  IF v_items = 0 OR v_total <= 0 OR v_unit <= 0 THEN
    RAISE EXCEPTION 'لا يمكن إنشاء حركة أجرة تصنيع لفاتورة بدون خامات أو بتكلفة صفر (invoice=%)', NEW.ref_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_manufacturing_labor_not_orphan ON public.feed_factory_treasury_txns;
CREATE CONSTRAINT TRIGGER trg_validate_manufacturing_labor_not_orphan
AFTER INSERT OR UPDATE ON public.feed_factory_treasury_txns
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.validate_manufacturing_labor_not_orphan();

-- =========================================================
-- 3) Atomic RPC: header + items + finalize in ONE transaction
-- =========================================================
CREATE OR REPLACE FUNCTION public.create_feed_production_invoice_atomic(
  p_prod_date date,
  p_product_id uuid,
  p_qty_produced numeric,
  p_bags numeric,
  p_labor_cost numeric,
  p_notes text,
  p_client_request_id text,
  p_items jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id uuid;
  v_user uuid := auth.uid();
  v_count int;
  v_total numeric;
  v_unit numeric;
BEGIN
  -- Pre-validate input
  IF p_product_id IS NULL THEN RAISE EXCEPTION 'يجب اختيار المنتج'; END IF;
  IF COALESCE(p_qty_produced,0) <= 0 THEN RAISE EXCEPTION 'الكمية المنتجة يجب أن تكون أكبر من صفر'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'يجب إضافة خامة واحدة على الأقل';
  END IF;

  -- Idempotency: if client_request_id already used, return existing invoice
  IF p_client_request_id IS NOT NULL THEN
    SELECT id INTO v_invoice_id FROM public.feed_production_invoices
      WHERE client_request_id = p_client_request_id LIMIT 1;
    IF v_invoice_id IS NOT NULL THEN RETURN v_invoice_id; END IF;
  END IF;

  -- 1) Insert header with labor_cost = 0 (defer labor txn creation to AFTER items exist)
  INSERT INTO public.feed_production_invoices(
    prod_date, product_id, qty_produced, bags, labor_cost, notes, created_by, client_request_id
  ) VALUES (
    COALESCE(p_prod_date, CURRENT_DATE), p_product_id, p_qty_produced,
    COALESCE(p_bags,0), 0, p_notes, v_user, p_client_request_id
  ) RETURNING id INTO v_invoice_id;

  -- 2) Insert items
  INSERT INTO public.feed_production_invoice_items(invoice_id, raw_material_id, quantity, unit_cost, line_cost)
  SELECT v_invoice_id,
         (item->>'raw_material_id')::uuid,
         (item->>'quantity')::numeric,
         (item->>'unit_cost')::numeric,
         COALESCE((item->>'line_cost')::numeric, ((item->>'quantity')::numeric * (item->>'unit_cost')::numeric))
  FROM jsonb_array_elements(p_items) AS item;

  -- 3) Compute totals, update inventory and unit_cost
  PERFORM public.finalize_feed_production(v_invoice_id);

  -- 4) Now set labor_cost — triggers labor treasury txn creation
  IF COALESCE(p_labor_cost,0) > 0 THEN
    UPDATE public.feed_production_invoices
       SET labor_cost = p_labor_cost,
           total_cost = total_cost + p_labor_cost,
           unit_cost  = CASE WHEN qty_produced > 0 THEN (total_cost + p_labor_cost) / qty_produced ELSE 0 END,
           updated_at = now()
     WHERE id = v_invoice_id;
  END IF;

  -- 5) Final assert
  SELECT COUNT(*) INTO v_count FROM public.feed_production_invoice_items WHERE invoice_id = v_invoice_id;
  SELECT total_cost, unit_cost INTO v_total, v_unit FROM public.feed_production_invoices WHERE id = v_invoice_id;
  IF v_count = 0 OR v_total <= 0 OR v_unit <= 0 THEN
    RAISE EXCEPTION 'فشل التحقق النهائي للفاتورة: تأكد من وجود خامات وتكلفة صحيحة';
  END IF;

  RETURN v_invoice_id;
END $$;

GRANT EXECUTE ON FUNCTION public.create_feed_production_invoice_atomic(date,uuid,numeric,numeric,numeric,text,text,jsonb) TO authenticated, service_role;

-- =========================================================
-- 4) Monitoring view: orphan / incomplete production invoices
-- =========================================================
CREATE OR REPLACE VIEW public.v_feed_production_orphan_invoices AS
SELECT
  i.id,
  i.prod_no,
  i.prod_date,
  i.product_id,
  i.qty_produced,
  i.total_cost,
  i.unit_cost,
  i.labor_cost,
  i.created_at,
  i.created_by,
  (SELECT COUNT(*) FROM public.feed_production_invoice_items WHERE invoice_id = i.id) AS items_count,
  EXISTS (SELECT 1 FROM public.feed_factory_treasury_txns t
            WHERE t.ref_table='feed_production_invoice' AND t.ref_id=i.id
              AND t.kind='manufacturing_labor' AND t.status='active') AS has_labor_txn,
  CASE
    WHEN (SELECT COUNT(*) FROM public.feed_production_invoice_items WHERE invoice_id = i.id) = 0 THEN 'no_items'
    WHEN i.total_cost <= 0 THEN 'zero_total_cost'
    WHEN i.unit_cost <= 0 THEN 'zero_unit_cost'
    WHEN i.labor_cost > 0 AND NOT EXISTS (
      SELECT 1 FROM public.feed_factory_treasury_txns t
       WHERE t.ref_table='feed_production_invoice' AND t.ref_id=i.id
         AND t.kind='manufacturing_labor' AND t.status='active'
    ) THEN 'missing_labor_txn'
    ELSE 'ok'
  END AS issue
FROM public.feed_production_invoices i
WHERE
  (SELECT COUNT(*) FROM public.feed_production_invoice_items WHERE invoice_id = i.id) = 0
  OR i.total_cost <= 0
  OR i.unit_cost <= 0
  OR (i.labor_cost > 0 AND NOT EXISTS (
    SELECT 1 FROM public.feed_factory_treasury_txns t
     WHERE t.ref_table='feed_production_invoice' AND t.ref_id=i.id
       AND t.kind='manufacturing_labor' AND t.status='active'));

GRANT SELECT ON public.v_feed_production_orphan_invoices TO authenticated, service_role;
