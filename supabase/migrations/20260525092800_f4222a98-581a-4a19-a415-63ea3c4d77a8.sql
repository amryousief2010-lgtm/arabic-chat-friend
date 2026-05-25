
-- 1. Extend feed_invoice_batches
ALTER TABLE public.feed_invoice_batches
  ADD COLUMN IF NOT EXISTS other_expenses numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS byproduct_value numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS packaging_cost numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_output_qty numeric(14,3),
  ADD COLUMN IF NOT EXISTS final_unit_cost numeric(14,4),
  ADD COLUMN IF NOT EXISTS cost_approved_by uuid,
  ADD COLUMN IF NOT EXISTS cost_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS posted_to_inventory boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS destination_warehouse text,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_reason text;

-- 2. Update compute trigger to include packaging/other/byproduct and final cost
CREATE OR REPLACE FUNCTION public.feed_invoice_batch_compute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total_cost numeric;
  v_qty numeric;
BEGIN
  v_total_cost := COALESCE(NEW.input_cost,0)
                + COALESCE(NEW.operating_cost,0)
                + COALESCE(NEW.other_expenses,0)
                + COALESCE(NEW.packaging_cost,0)
                - COALESCE(NEW.byproduct_value,0);

  IF NEW.output_qty_kg > 0 THEN
    NEW.unit_cost_calc := ROUND((v_total_cost / NEW.output_qty_kg)::numeric, 4);
  END IF;

  v_qty := COALESCE(NEW.approved_output_qty, NEW.output_qty_kg);
  IF v_qty > 0 THEN
    NEW.final_unit_cost := ROUND((v_total_cost / v_qty)::numeric, 4);
  END IF;

  IF NEW.input_qty_weight_kg IS NOT NULL AND NEW.input_qty_weight_kg > 0 THEN
    NEW.qty_variance_kg := NEW.output_qty_kg - NEW.input_qty_weight_kg;
    NEW.qty_variance_pct := ROUND((NEW.qty_variance_kg / NEW.input_qty_weight_kg)::numeric, 6);
    IF NEW.qty_variance_pct > 0.02 THEN
      NEW.needs_review := true;
      IF NEW.review_reason IS NULL THEN
        NEW.review_reason := 'انحراف الكمية المنتجة عن كمية المدخلات يتجاوز 2%';
      END IF;
      IF NEW.status IN ('qc_pending','approved') THEN
        NEW.status := 'needs_review';
      END IF;
    END IF;
  END IF;

  IF NEW.invoice_output_total IS NOT NULL THEN
    NEW.cost_diff := ROUND((NEW.invoice_output_total - v_total_cost)::numeric, 4);
  END IF;

  RETURN NEW;
END $function$;

-- 3. Recompute RPC
CREATE OR REPLACE FUNCTION public.recompute_feed_batch_cost(p_batch uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_unit numeric;
BEGIN
  IF NOT public.can_approve_feed_cost(auth.uid())
     AND NOT public.can_manage_feed_recipes(auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN: not allowed to recompute feed batch cost';
  END IF;

  -- Recompute packaging cost from material issues marked as packaging
  UPDATE public.feed_invoice_batches b
  SET packaging_cost = COALESCE((
    SELECT SUM(mi.total_cost)
    FROM public.feed_material_issues mi
    JOIN public.feed_raw_materials rm ON rm.id = mi.raw_material_id
    WHERE mi.order_id = b.order_id AND rm.is_packaging = true
  ), 0)
  WHERE b.id = p_batch;

  -- Trigger recompute by touching the row
  UPDATE public.feed_invoice_batches
  SET updated_at = now()
  WHERE id = p_batch;

  SELECT final_unit_cost INTO v_unit
  FROM public.feed_invoice_batches WHERE id = p_batch;

  RETURN v_unit;
END $$;

-- 4. Approve & post to inventory
CREATE OR REPLACE FUNCTION public.approve_feed_batch_cost(
  p_batch uuid,
  p_final_qty numeric,
  p_destination text DEFAULT 'مخزن أعلاف وأدوية',
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_batch public.feed_invoice_batches%ROWTYPE;
  v_qc_passed boolean;
  v_review_id uuid;
BEGIN
  IF NOT public.can_approve_feed_cost(auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN: only accounting/management can approve cost';
  END IF;

  SELECT * INTO v_batch FROM public.feed_invoice_batches WHERE id = p_batch FOR UPDATE;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'BATCH_NOT_FOUND';
  END IF;

  IF v_batch.posted_to_inventory THEN
    RAISE EXCEPTION 'ALREADY_POSTED';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.feed_qc_checks
    WHERE batch_id = p_batch AND result = 'passed'
  ) INTO v_qc_passed;

  IF NOT v_qc_passed THEN
    RAISE EXCEPTION 'QC_NOT_PASSED: لا يمكن اعتماد التكلفة قبل اجتياز فحص الجودة';
  END IF;

  IF p_final_qty IS NULL OR p_final_qty <= 0 THEN
    RAISE EXCEPTION 'INVALID_QTY';
  END IF;

  -- Update batch with approved values; trigger recomputes final_unit_cost
  UPDATE public.feed_invoice_batches
  SET approved_output_qty = p_final_qty,
      destination_warehouse = COALESCE(p_destination, warehouse_name, 'مخزن أعلاف وأدوية'),
      cost_approved_by = auth.uid(),
      cost_approved_at = now(),
      posted_to_inventory = true,
      posted_at = now(),
      status = 'approved'
  WHERE id = p_batch;

  -- Insert cost review record
  INSERT INTO public.feed_cost_reviews (batch_id, reviewed_by, decision, notes)
  VALUES (p_batch, auth.uid(), 'approved', p_notes)
  RETURNING id INTO v_review_id;

  -- Insert finished goods movement (in)
  INSERT INTO public.feed_finished_goods_moves (
    batch_id, feed_product_id, movement_type, qty_kg, destination, performed_by, notes
  ) VALUES (
    p_batch, v_batch.feed_product_id, 'in', p_final_qty,
    COALESCE(p_destination, v_batch.warehouse_name, 'مخزن أعلاف وأدوية'),
    auth.uid(), p_notes
  );

  -- Update product stock and latest cost
  UPDATE public.feed_products
  SET current_stock = current_stock + p_final_qty,
      latest_unit_cost = (SELECT final_unit_cost FROM public.feed_invoice_batches WHERE id = p_batch),
      updated_at = now()
  WHERE id = v_batch.feed_product_id;

  RETURN v_review_id;
END $$;

-- 5. Negative-stock soft alert: extend feed_apply_issue with data_quality_tasks log on near-empty
-- Keep hard block on insufficient stock but additionally log low-stock alerts
CREATE OR REPLACE FUNCTION public.feed_apply_issue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_stock numeric;
  v_threshold numeric;
  v_name text;
BEGIN
  SELECT stock, low_stock_threshold, name
    INTO v_stock, v_threshold, v_name
    FROM public.feed_raw_materials WHERE id = NEW.raw_material_id FOR UPDATE;

  IF v_stock IS NULL THEN RAISE EXCEPTION 'Raw material not found'; END IF;
  IF v_stock < NEW.qty THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: متاح % وطلب %', v_stock, NEW.qty;
  END IF;

  UPDATE public.feed_raw_materials
     SET stock = stock - NEW.qty, updated_at = now()
   WHERE id = NEW.raw_material_id;

  -- Soft alert when remaining stock falls below threshold
  IF (v_stock - NEW.qty) < COALESCE(v_threshold, 0) THEN
    BEGIN
      INSERT INTO public.data_quality_tasks (
        module, task_type, severity, entity_type, entity_id, description, status
      ) VALUES (
        'feed', 'low_stock', 'warning', 'feed_raw_material', NEW.raw_material_id,
        format('المادة "%s" أصبحت تحت حد التنبيه (%s)', v_name, (v_stock - NEW.qty)),
        'open'
      );
    EXCEPTION WHEN OTHERS THEN
      NULL; -- never block issuance for logging
    END;
  END IF;

  RETURN NEW;
END $function$;
