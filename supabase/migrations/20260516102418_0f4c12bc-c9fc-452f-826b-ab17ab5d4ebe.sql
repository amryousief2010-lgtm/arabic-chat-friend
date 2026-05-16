
CREATE TABLE IF NOT EXISTS public.meat_factory_approval_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.meat_factory_batches(id) ON DELETE CASCADE,
  batch_number text,
  product_code text,
  product_name_ar text,
  planned_qty numeric,
  scale numeric,
  attempted_by uuid,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  outcome text NOT NULL, -- 'success' | 'insufficient_stock' | 'error'
  error_message text,
  materials_cost numeric,
  shortages jsonb DEFAULT '[]'::jsonb,
  impact jsonb DEFAULT '[]'::jsonb -- [{material_code, name, required, stock_before, stock_after, line_total}]
);
ALTER TABLE public.meat_factory_approval_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "view audit (auth)" ON public.meat_factory_approval_audit;
CREATE POLICY "view audit (auth)" ON public.meat_factory_approval_audit FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_meat_audit_batch ON public.meat_factory_approval_audit(batch_id);
CREATE INDEX IF NOT EXISTS idx_meat_audit_time ON public.meat_factory_approval_audit(attempted_at DESC);

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
  v_shortages jsonb := '[]'::jsonb;
  v_short_count integer := 0;
  v_impact jsonb := '[]'::jsonb;
  v_short_text text := '';
  v_stock_before numeric;
  v_stock_after numeric;
  v_uid uuid := auth.uid();
BEGIN
  IF NOT has_any_role(v_uid, ARRAY['general_manager'::app_role,'executive_manager'::app_role,'production_manager'::app_role]) THEN
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

  -- Pre-check stock
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
      v_shortages := v_shortages || jsonb_build_object(
        'material_code', r.material_code,
        'material_name_ar', r.material_name_ar,
        'required', r.scaled_qty,
        'available', r.stock,
        'short_by', r.scaled_qty - r.stock,
        'unit', r.unit
      );
      v_short_text := v_short_text || format('%s (%s): مطلوب %s %s، متاح %s | ',
        COALESCE(r.material_name_ar, r.material_code), r.material_code,
        r.scaled_qty, COALESCE(r.unit,''), r.stock);
    END IF;
  END LOOP;

  IF v_short_count > 0 THEN
    -- Audit failure
    INSERT INTO public.meat_factory_approval_audit
      (batch_id, batch_number, product_code, product_name_ar, planned_qty, scale,
       attempted_by, outcome, error_message, shortages)
    VALUES (p_batch_id, v_batch.batch_number, v_batch.product_code, v_batch.product_name_ar,
       v_batch.planned_qty, v_scale, v_uid, 'insufficient_stock',
       format('مخزون غير كافٍ لـ %s مادة', v_short_count), v_shortages);

    RAISE EXCEPTION 'INSUFFICIENT_STOCK::%::%', v_short_count, v_shortages::text;
  END IF;

  -- Deduct and build impact
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

    SELECT stock INTO v_stock_before FROM public.meat_factory_raw_materials WHERE material_code = r.material_code;
    UPDATE public.meat_factory_raw_materials
       SET stock = stock - v_scaled_qty, updated_at = now()
     WHERE material_code = r.material_code
     RETURNING stock INTO v_stock_after;

    v_impact := v_impact || jsonb_build_object(
      'material_code', r.material_code,
      'material_name_ar', r.material_name_ar,
      'required', v_scaled_qty,
      'unit', r.unit,
      'stock_before', COALESCE(v_stock_before, 0),
      'stock_after', COALESCE(v_stock_after, 0),
      'unit_cost', COALESCE(r.unit_cost, 0),
      'line_total', v_line_total
    );

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

  INSERT INTO public.meat_factory_approval_audit
    (batch_id, batch_number, product_code, product_name_ar, planned_qty, scale,
     attempted_by, outcome, materials_cost, impact)
  VALUES (p_batch_id, v_batch.batch_number, v_batch.product_code, v_batch.product_name_ar,
     v_batch.planned_qty, v_scale, v_uid, 'success', v_materials_cost, v_impact);

  RETURN jsonb_build_object('success', true, 'materials_cost', v_materials_cost, 'scale', v_scale, 'impact', v_impact);
END;
$$;
