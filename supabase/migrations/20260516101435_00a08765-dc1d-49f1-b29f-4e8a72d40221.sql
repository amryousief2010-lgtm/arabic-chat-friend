
-- Quality change log
CREATE TABLE IF NOT EXISTS public.meat_factory_quality_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.meat_factory_batches(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  actual_qty numeric,
  notes text,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meat_factory_quality_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "view quality log (auth)" ON public.meat_factory_quality_log;
CREATE POLICY "view quality log (auth)" ON public.meat_factory_quality_log FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert quality log (managers)" ON public.meat_factory_quality_log;
CREATE POLICY "insert quality log (managers)" ON public.meat_factory_quality_log FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'production_manager'::app_role,'quality_manager'::app_role]));

CREATE INDEX IF NOT EXISTS idx_meat_quality_log_batch ON public.meat_factory_quality_log(batch_id);

-- Trigger to auto-log when quality_status changes
CREATE OR REPLACE FUNCTION public.log_meat_batch_quality_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.quality_status,'') <> COALESCE(NEW.quality_status,'') THEN
    INSERT INTO public.meat_factory_quality_log(batch_id, from_status, to_status, actual_qty, notes, changed_by)
    VALUES (NEW.id, OLD.quality_status, NEW.quality_status, NEW.actual_qty, NEW.quality_notes, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_meat_batch_quality ON public.meat_factory_batches;
CREATE TRIGGER trg_log_meat_batch_quality
AFTER UPDATE ON public.meat_factory_batches
FOR EACH ROW EXECUTE FUNCTION public.log_meat_batch_quality_change();

-- Preview requirements RPC (no side effects)
CREATE OR REPLACE FUNCTION public.preview_meat_factory_batch_requirements(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.meat_factory_batches%ROWTYPE;
  v_template_qty numeric;
  v_scale numeric;
  v_items jsonb := '[]'::jsonb;
  v_shortages jsonb := '[]'::jsonb;
  v_materials_cost numeric := 0;
  r RECORD;
  v_scaled numeric;
  v_line_total numeric;
  v_stock numeric;
BEGIN
  SELECT * INTO v_batch FROM public.meat_factory_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found'; END IF;
  IF v_batch.source_invoice_no IS NULL THEN RAISE EXCEPTION 'Batch has no source template invoice'; END IF;

  SELECT output_qty INTO v_template_qty FROM public.meat_factory_invoices
   WHERE invoice_no = v_batch.source_invoice_no AND product_code = v_batch.product_code LIMIT 1;
  IF v_template_qty IS NULL OR v_template_qty <= 0 THEN
    RAISE EXCEPTION 'Template invoice % invalid', v_batch.source_invoice_no;
  END IF;
  v_scale := v_batch.planned_qty / v_template_qty;

  FOR r IN
    SELECT rcp.material_code, rcp.material_name_ar, rcp.quantity, rcp.unit, rcp.unit_cost,
           COALESCE(rm.stock, 0) AS stock
    FROM public.meat_factory_recipes rcp
    LEFT JOIN public.meat_factory_raw_materials rm ON rm.material_code = rcp.material_code
    WHERE rcp.invoice_no = v_batch.source_invoice_no
      AND rcp.product_code = v_batch.product_code
      AND rcp.line_type = 'Input'
      AND rcp.material_code IS NOT NULL
  LOOP
    v_scaled := ROUND((r.quantity * v_scale)::numeric, 3);
    v_line_total := ROUND((v_scaled * COALESCE(r.unit_cost,0))::numeric, 3);
    v_materials_cost := v_materials_cost + v_line_total;
    v_items := v_items || jsonb_build_object(
      'material_code', r.material_code,
      'material_name_ar', r.material_name_ar,
      'required_qty', v_scaled,
      'unit', r.unit,
      'stock', r.stock,
      'shortage', GREATEST(v_scaled - r.stock, 0),
      'unit_cost', COALESCE(r.unit_cost,0),
      'line_total', v_line_total,
      'sufficient', r.stock >= v_scaled
    );
    IF r.stock < v_scaled THEN
      v_shortages := v_shortages || jsonb_build_object(
        'material_code', r.material_code,
        'material_name_ar', r.material_name_ar,
        'required', v_scaled,
        'available', r.stock,
        'short_by', v_scaled - r.stock,
        'unit', r.unit
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'scale', v_scale,
    'materials_cost', v_materials_cost,
    'items', v_items,
    'shortages', v_shortages,
    'can_approve', jsonb_array_length(v_shortages) = 0
  );
END;
$$;

-- Updated approve function with stock validation
CREATE OR REPLACE FUNCTION public.approve_meat_factory_batch(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.meat_factory_batches%ROWTYPE;
  v_template_qty numeric;
  v_scale numeric;
  v_materials_cost numeric := 0;
  r RECORD;
  v_scaled_qty numeric;
  v_line_total numeric;
  v_shortages text := '';
  v_short_count integer := 0;
BEGIN
  IF NOT has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'production_manager'::app_role]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_batch FROM public.meat_factory_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found'; END IF;
  IF v_batch.status <> 'planned' THEN RAISE EXCEPTION 'Batch already %', v_batch.status; END IF;
  IF v_batch.source_invoice_no IS NULL THEN RAISE EXCEPTION 'Batch has no source template invoice'; END IF;

  SELECT output_qty INTO v_template_qty
  FROM public.meat_factory_invoices
  WHERE invoice_no = v_batch.source_invoice_no AND product_code = v_batch.product_code LIMIT 1;

  IF v_template_qty IS NULL OR v_template_qty <= 0 THEN
    RAISE EXCEPTION 'Template invoice % has no valid output_qty', v_batch.source_invoice_no;
  END IF;

  v_scale := v_batch.planned_qty / v_template_qty;

  -- Pre-check stock: detect any shortages before deducting
  FOR r IN
    SELECT rcp.material_code, rcp.material_name_ar, rcp.quantity, rcp.unit,
           ROUND((rcp.quantity * v_scale)::numeric, 3) AS scaled_qty,
           COALESCE(rm.stock, 0) AS stock
    FROM public.meat_factory_recipes rcp
    LEFT JOIN public.meat_factory_raw_materials rm ON rm.material_code = rcp.material_code
    WHERE rcp.invoice_no = v_batch.source_invoice_no
      AND rcp.product_code = v_batch.product_code
      AND rcp.line_type = 'Input'
      AND rcp.material_code IS NOT NULL
  LOOP
    IF r.stock < r.scaled_qty THEN
      v_short_count := v_short_count + 1;
      v_shortages := v_shortages || format('%s (%s): مطلوب %s %s — متاح %s | ',
        COALESCE(r.material_name_ar, r.material_code), r.material_code,
        r.scaled_qty, COALESCE(r.unit,''), r.stock);
    END IF;
  END LOOP;

  IF v_short_count > 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: مخزون غير كافٍ لـ % مادة. %', v_short_count, v_shortages;
  END IF;

  -- Now actually deduct
  FOR r IN
    SELECT material_code, material_name_ar, quantity, unit, unit_cost
    FROM public.meat_factory_recipes
    WHERE invoice_no = v_batch.source_invoice_no
      AND product_code = v_batch.product_code
      AND line_type = 'Input'
      AND material_code IS NOT NULL
  LOOP
    v_scaled_qty := ROUND((r.quantity * v_scale)::numeric, 3);
    v_line_total := ROUND((v_scaled_qty * COALESCE(r.unit_cost,0))::numeric, 3);
    v_materials_cost := v_materials_cost + v_line_total;

    UPDATE public.meat_factory_raw_materials
       SET stock = stock - v_scaled_qty, updated_at = now()
     WHERE material_code = r.material_code;

    INSERT INTO public.meat_factory_batch_consumption(batch_id, material_code, material_name_ar, quantity, unit, unit_cost, line_total)
    VALUES (p_batch_id, r.material_code, r.material_name_ar, v_scaled_qty, r.unit, COALESCE(r.unit_cost,0), v_line_total);
  END LOOP;

  UPDATE public.meat_factory_batches
     SET status = 'in_progress',
         started_at = now(),
         materials_cost = v_materials_cost,
         total_cost = v_materials_cost + COALESCE(labor_cost,0),
         unit_cost = CASE WHEN v_batch.planned_qty > 0 
                     THEN (v_materials_cost + COALESCE(labor_cost,0)) / v_batch.planned_qty ELSE NULL END,
         updated_at = now()
   WHERE id = p_batch_id;

  RETURN jsonb_build_object('success', true, 'materials_cost', v_materials_cost, 'scale', v_scale);
END;
$$;
