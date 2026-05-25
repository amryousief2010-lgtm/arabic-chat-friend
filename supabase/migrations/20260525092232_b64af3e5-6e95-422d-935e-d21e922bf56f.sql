
-- 1) Add costing columns to batches
ALTER TABLE public.meat_factory_batches
  ADD COLUMN IF NOT EXISTS other_expenses numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS byproduct_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS packaging_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_output_qty numeric,
  ADD COLUMN IF NOT EXISTS cost_approved_by uuid,
  ADD COLUMN IF NOT EXISTS cost_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS cost_approval_notes text,
  ADD COLUMN IF NOT EXISTS posted_to_inventory boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS posted_warehouse_id uuid;

-- 2) Packaging usage table
CREATE TABLE IF NOT EXISTS public.meat_factory_batch_packaging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.meat_factory_batches(id) ON DELETE CASCADE,
  packaging_material_id uuid REFERENCES public.packaging_materials(id),
  packaging_name_ar text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'قطعة',
  unit_cost numeric NOT NULL DEFAULT 0,
  line_total numeric GENERATED ALWAYS AS (quantity * unit_cost) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX IF NOT EXISTS idx_mfbp_batch ON public.meat_factory_batch_packaging(batch_id);

ALTER TABLE public.meat_factory_batch_packaging ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read mf packaging" ON public.meat_factory_batch_packaging;
CREATE POLICY "read mf packaging" ON public.meat_factory_batch_packaging
FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY[
  'general_manager','executive_manager','meat_factory_manager','production_manager',
  'warehouse_supervisor','quality_manager','accountant','cost_accountant','financial_manager'
]::app_role[]));

DROP POLICY IF EXISTS "manage mf packaging" ON public.meat_factory_batch_packaging;
CREATE POLICY "manage mf packaging" ON public.meat_factory_batch_packaging
FOR ALL TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY[
  'general_manager','executive_manager','meat_factory_manager','production_manager','warehouse_supervisor'
]::app_role[]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY[
  'general_manager','executive_manager','meat_factory_manager','production_manager','warehouse_supervisor'
]::app_role[]));

-- 3) Recompute cost function
CREATE OR REPLACE FUNCTION public.recompute_meat_batch_cost(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_materials numeric := 0;
  v_packaging numeric := 0;
  v_b public.meat_factory_batches%ROWTYPE;
  v_denom numeric;
  v_total numeric;
  v_unit numeric;
BEGIN
  SELECT * INTO v_b FROM public.meat_factory_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;

  SELECT COALESCE(SUM(line_total),0) INTO v_materials
    FROM public.meat_factory_batch_consumption WHERE batch_id = p_batch_id;
  SELECT COALESCE(SUM(line_total),0) INTO v_packaging
    FROM public.meat_factory_batch_packaging WHERE batch_id = p_batch_id;

  v_total := COALESCE(v_materials,0) + COALESCE(v_b.labor_cost,0)
           + COALESCE(v_b.other_expenses,0) + COALESCE(v_packaging,0)
           - COALESCE(v_b.byproduct_value,0);

  v_denom := COALESCE(v_b.approved_output_qty, v_b.actual_qty, v_b.planned_qty, 0);
  v_unit := CASE WHEN v_denom > 0 THEN ROUND((v_total / v_denom)::numeric, 4) ELSE NULL END;

  UPDATE public.meat_factory_batches
    SET materials_cost = v_materials,
        packaging_cost = v_packaging,
        total_cost = v_total,
        unit_cost = v_unit,
        updated_at = now()
    WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'materials', v_materials, 'packaging', v_packaging,
    'labor', v_b.labor_cost, 'other_expenses', v_b.other_expenses,
    'byproduct_value', v_b.byproduct_value,
    'total_cost', v_total, 'unit_cost', v_unit,
    'denominator', v_denom
  );
END $$;

-- 4) Approve cost + post to inventory
CREATE OR REPLACE FUNCTION public.approve_meat_batch_cost(
  p_batch_id uuid,
  p_warehouse_id uuid,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_b public.meat_factory_batches%ROWTYPE;
  v_uid uuid := auth.uid();
  v_item_id uuid;
  v_recompute jsonb;
  v_qty numeric;
BEGIN
  IF NOT public.has_any_role(v_uid, ARRAY[
    'general_manager','executive_manager','accountant','cost_accountant','financial_manager'
  ]::app_role[]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: غير مصرح لك باعتماد التكلفة';
  END IF;

  SELECT * INTO v_b FROM public.meat_factory_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND'; END IF;
  IF v_b.quality_status <> 'passed' THEN RAISE EXCEPTION 'QC_NOT_PASSED: يجب اجتياز فحص الجودة أولا'; END IF;
  IF v_b.cost_approved_at IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_APPROVED'; END IF;
  IF p_warehouse_id IS NULL THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED'; END IF;

  v_recompute := public.recompute_meat_batch_cost(p_batch_id);
  v_qty := COALESCE(v_b.approved_output_qty, v_b.actual_qty, v_b.planned_qty, 0);
  IF v_qty <= 0 THEN RAISE EXCEPTION 'INVALID_OUTPUT_QTY'; END IF;

  -- Post finished goods to inventory
  SELECT id INTO v_item_id FROM public.inventory_items
    WHERE warehouse_id = p_warehouse_id AND name = COALESCE(v_b.product_name_ar, v_b.product_code) LIMIT 1;
  IF v_item_id IS NULL THEN
    INSERT INTO public.inventory_items (warehouse_id, name, category, unit, stock, unit_cost, low_stock_threshold)
    VALUES (p_warehouse_id, COALESCE(v_b.product_name_ar, v_b.product_code), 'لحوم مصنعة', v_b.unit, 0,
            (v_recompute->>'unit_cost')::numeric, 5)
    RETURNING id INTO v_item_id;
  END IF;

  INSERT INTO public.inventory_movements (item_id, warehouse_id, movement_type, quantity, reference, party, unit_cost, performed_by, notes)
  VALUES (v_item_id, p_warehouse_id, 'in', v_qty,
          'دفعة مصنع لحوم ' || v_b.batch_number, 'مصنع اللحوم',
          (v_recompute->>'unit_cost')::numeric, v_uid,
          'استلام منتج تام من دفعة معتمدة');

  UPDATE public.meat_factory_batches
    SET cost_approved_by = v_uid,
        cost_approved_at = now(),
        cost_approval_notes = p_notes,
        posted_to_inventory = true,
        posted_at = now(),
        posted_warehouse_id = p_warehouse_id,
        status = 'completed',
        updated_at = now()
    WHERE id = p_batch_id;

  INSERT INTO public.meat_factory_approval_audit (batch_id, batch_number, product_name_ar, planned_qty, attempted_by, outcome, materials_cost, impact)
  VALUES (p_batch_id, v_b.batch_number, v_b.product_name_ar, v_qty, v_uid, 'cost_approved',
          (v_recompute->>'total_cost')::numeric,
          jsonb_build_object('unit_cost',(v_recompute->>'unit_cost')::numeric,'warehouse_id',p_warehouse_id,'item_id',v_item_id));

  RETURN jsonb_build_object('success', true, 'unit_cost', (v_recompute->>'unit_cost')::numeric, 'total_cost', (v_recompute->>'total_cost')::numeric, 'item_id', v_item_id);
END $$;

-- 5) Negative stock check after consumption insert
CREATE OR REPLACE FUNCTION public.meat_batch_negative_stock_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_stock numeric;
BEGIN
  IF NEW.material_code IS NULL THEN RETURN NEW; END IF;
  SELECT stock INTO v_stock FROM public.meat_factory_raw_materials WHERE material_code = NEW.material_code;
  IF v_stock IS NOT NULL AND v_stock < 0 THEN
    INSERT INTO public.data_quality_tasks (module, task_type, severity, reference, description, status)
    VALUES ('meat', 'negative_stock', 'high', NEW.material_code,
      'رصيد سالب لخامة ' || COALESCE(NEW.material_name_ar, NEW.material_code) || ' بعد صرف ' || NEW.quantity || ' ' || COALESCE(NEW.unit,''),
      'open');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_meat_neg_stock ON public.meat_factory_batch_consumption;
CREATE TRIGGER trg_meat_neg_stock
AFTER INSERT ON public.meat_factory_batch_consumption
FOR EACH ROW EXECUTE FUNCTION public.meat_batch_negative_stock_check();
