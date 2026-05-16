-- 1) extend batches
ALTER TABLE public.meat_factory_batches
  ADD COLUMN IF NOT EXISTS quality_status text NOT NULL DEFAULT 'pending'
    CHECK (quality_status IN ('pending','passed','failed')),
  ADD COLUMN IF NOT EXISTS quality_notes text,
  ADD COLUMN IF NOT EXISTS source_invoice_no integer;

-- 2) raw materials stock
ALTER TABLE public.meat_factory_raw_materials
  ADD COLUMN IF NOT EXISTS stock numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS low_stock_threshold numeric NOT NULL DEFAULT 10;

-- 3) consumption log table
CREATE TABLE IF NOT EXISTS public.meat_factory_batch_consumption (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.meat_factory_batches(id) ON DELETE CASCADE,
  material_code text NOT NULL,
  material_name_ar text,
  quantity numeric NOT NULL,
  unit text NOT NULL,
  unit_cost numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mfbc_batch ON public.meat_factory_batch_consumption(batch_id);

ALTER TABLE public.meat_factory_batch_consumption ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "view mf consumption" ON public.meat_factory_batch_consumption;
CREATE POLICY "view mf consumption" ON public.meat_factory_batch_consumption
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "manage mf consumption" ON public.meat_factory_batch_consumption;
CREATE POLICY "manage mf consumption" ON public.meat_factory_batch_consumption
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'production_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'production_manager'::app_role]));

-- 4) approve function: deduct stock & compute costs
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
  v_current_stock numeric;
BEGIN
  IF NOT has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'production_manager'::app_role]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_batch FROM public.meat_factory_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found'; END IF;
  IF v_batch.status <> 'planned' THEN RAISE EXCEPTION 'Batch already %', v_batch.status; END IF;
  IF v_batch.source_invoice_no IS NULL THEN RAISE EXCEPTION 'Batch has no source template invoice'; END IF;

  -- get template output qty
  SELECT output_qty INTO v_template_qty
  FROM public.meat_factory_invoices
  WHERE invoice_no = v_batch.source_invoice_no AND product_code = v_batch.product_code
  LIMIT 1;

  IF v_template_qty IS NULL OR v_template_qty <= 0 THEN
    RAISE EXCEPTION 'Template invoice % has no valid output_qty', v_batch.source_invoice_no;
  END IF;

  v_scale := v_batch.planned_qty / v_template_qty;

  -- loop inputs, deduct, log
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

    -- deduct stock if material exists
    UPDATE public.meat_factory_raw_materials
       SET stock = stock - v_scaled_qty, updated_at = now()
     WHERE material_code = r.material_code
     RETURNING stock INTO v_current_stock;

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

  RETURN jsonb_build_object(
    'success', true,
    'materials_cost', v_materials_cost,
    'scale', v_scale
  );
END;
$$;