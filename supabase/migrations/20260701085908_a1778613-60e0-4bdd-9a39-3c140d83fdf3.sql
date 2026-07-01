
-- 1) Extend slaughter_batch_outputs with pricing detail columns
ALTER TABLE public.slaughter_batch_outputs
  ADD COLUMN IF NOT EXISTS auto_cost_per_kg numeric,
  ADD COLUMN IF NOT EXISTS manual_cost_per_kg numeric,
  ADD COLUMN IF NOT EXISTS suggested_sale_price_per_kg numeric,
  ADD COLUMN IF NOT EXISTS manual_sale_price_per_kg numeric,
  ADD COLUMN IF NOT EXISTS price_edit_reason text,
  ADD COLUMN IF NOT EXISTS price_updated_by uuid,
  ADD COLUMN IF NOT EXISTS price_updated_at timestamptz;

-- 2) Audit table
CREATE TABLE IF NOT EXISTS public.slaughter_output_price_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  output_id uuid NOT NULL REFERENCES public.slaughter_batch_outputs(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.slaughter_batches(id) ON DELETE CASCADE,
  product_id uuid,
  field text NOT NULL CHECK (field IN ('cost_per_kg','sale_price_per_kg')),
  old_value numeric,
  new_value numeric,
  reason text,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_slaughter_output_price_audit_output ON public.slaughter_output_price_audit(output_id);
CREATE INDEX IF NOT EXISTS idx_slaughter_output_price_audit_batch ON public.slaughter_output_price_audit(batch_id);

GRANT SELECT ON public.slaughter_output_price_audit TO authenticated;
GRANT ALL ON public.slaughter_output_price_audit TO service_role;
ALTER TABLE public.slaughter_output_price_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "view slaughter output price audit" ON public.slaughter_output_price_audit;
CREATE POLICY "view slaughter output price audit"
  ON public.slaughter_output_price_audit
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'slaughterhouse_manager'::app_role, 'production_manager'::app_role, 'warehouse_supervisor'::app_role]));

-- 3) Recalculate auto cost per kg for a batch — unified allocation
CREATE OR REPLACE FUNCTION public.recalc_slaughter_output_auto_costs(p_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_cost numeric;
  v_total_weight numeric;
  v_unit numeric;
BEGIN
  SELECT COALESCE(NULLIF(total_allocatable_cost,0), total_birds_cost, 0)
    INTO v_total_cost
    FROM slaughter_batches WHERE id = p_batch_id;

  SELECT COALESCE(SUM(GREATEST(actual_weight_kg - COALESCE(damaged_weight_kg,0) - COALESCE(quarantined_weight_kg,0), 0)), 0)
    INTO v_total_weight
    FROM slaughter_batch_outputs
    WHERE batch_id = p_batch_id AND destination <> 'waste';

  IF v_total_weight > 0 AND v_total_cost > 0 THEN
    v_unit := v_total_cost / v_total_weight;
  ELSE
    v_unit := 0;
  END IF;

  UPDATE slaughter_batch_outputs
     SET auto_cost_per_kg = ROUND(v_unit::numeric, 4)
   WHERE batch_id = p_batch_id AND destination <> 'waste';
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalc_slaughter_output_auto_costs(uuid) TO authenticated;

-- 4) Apply manual price update (cost or sale) with audit + role gate
CREATE OR REPLACE FUNCTION public.apply_slaughter_output_price_update(
  p_output_id uuid,
  p_manual_cost_per_kg numeric,
  p_manual_sale_price_per_kg numeric,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row slaughter_batch_outputs%ROWTYPE;
BEGIN
  IF NOT has_any_role(v_uid, ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'slaughterhouse_manager'::app_role, 'production_manager'::app_role]) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية تعديل تكلفة أو سعر بيع مخرجات الدبح';
  END IF;

  SELECT * INTO v_row FROM slaughter_batch_outputs WHERE id = p_output_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'مخرج الدبح غير موجود'; END IF;

  -- cost edit
  IF p_manual_cost_per_kg IS DISTINCT FROM v_row.manual_cost_per_kg THEN
    INSERT INTO slaughter_output_price_audit(output_id, batch_id, product_id, field, old_value, new_value, reason, changed_by)
    VALUES (v_row.id, v_row.batch_id, v_row.product_id, 'cost_per_kg',
            COALESCE(v_row.manual_cost_per_kg, v_row.auto_cost_per_kg),
            p_manual_cost_per_kg, p_reason, v_uid);
  END IF;

  -- sale edit
  IF p_manual_sale_price_per_kg IS DISTINCT FROM v_row.manual_sale_price_per_kg THEN
    INSERT INTO slaughter_output_price_audit(output_id, batch_id, product_id, field, old_value, new_value, reason, changed_by)
    VALUES (v_row.id, v_row.batch_id, v_row.product_id, 'sale_price_per_kg',
            COALESCE(v_row.manual_sale_price_per_kg, v_row.suggested_sale_price_per_kg),
            p_manual_sale_price_per_kg, p_reason, v_uid);
  END IF;

  UPDATE slaughter_batch_outputs
     SET manual_cost_per_kg = p_manual_cost_per_kg,
         manual_sale_price_per_kg = p_manual_sale_price_per_kg,
         price_edit_reason = p_reason,
         price_updated_by = v_uid,
         price_updated_at = now()
   WHERE id = p_output_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_slaughter_output_price_update(uuid, numeric, numeric, text) TO authenticated;
