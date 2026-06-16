
-- ============================================================
-- 1) Extend slaughter_live_receipts with cost tracking columns
-- ============================================================
ALTER TABLE public.slaughter_live_receipts
  ADD COLUMN IF NOT EXISTS mortality_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS feed_cost_loaded numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mortality_cost_loaded numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_costs_loaded numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_alive_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_batch_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_per_bird_current numeric NOT NULL DEFAULT 0;

-- backfill current_alive_count for existing rows
UPDATE public.slaughter_live_receipts
   SET current_alive_count = GREATEST(bird_count - COALESCE(dead_on_arrival,0) - COALESCE(mortality_count,0), 0)
 WHERE current_alive_count = 0 AND bird_count > 0;

-- ============================================================
-- 2) Extend slaughter_batches with cost allocation columns
-- ============================================================
ALTER TABLE public.slaughter_batches
  ADD COLUMN IF NOT EXISTS cost_per_bird_snapshot numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_birds_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS direct_slaughter_expenses numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_allocatable_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_allocation_done boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cost_allocation_ref text;

CREATE UNIQUE INDEX IF NOT EXISTS slaughter_batches_cost_alloc_ref_uniq
  ON public.slaughter_batches(cost_allocation_ref)
  WHERE cost_allocation_ref IS NOT NULL;

-- ============================================================
-- 3) New table: slaughter_ostrich_feed_consumption
-- ============================================================
CREATE TABLE IF NOT EXISTS public.slaughter_ostrich_feed_consumption (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consumption_date date NOT NULL DEFAULT CURRENT_DATE,
  live_batch_id uuid NOT NULL REFERENCES public.slaughter_live_receipts(id) ON DELETE RESTRICT,
  feed_inventory_id uuid NOT NULL REFERENCES public.slaughterhouse_feed_inventory(id) ON DELETE RESTRICT,
  feed_name text NOT NULL,
  quantity_kg numeric NOT NULL CHECK (quantity_kg > 0),
  birds_count_at_time integer NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  stock_before numeric NOT NULL DEFAULT 0,
  stock_after numeric NOT NULL DEFAULT 0,
  responsible_user_id uuid,
  notes text,
  reference_id text NOT NULL UNIQUE,
  reversed_at timestamptz,
  reversed_by uuid,
  reversal_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.slaughter_ostrich_feed_consumption TO authenticated;
GRANT ALL ON public.slaughter_ostrich_feed_consumption TO service_role;

ALTER TABLE public.slaughter_ostrich_feed_consumption ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sofc_read" ON public.slaughter_ostrich_feed_consumption
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "sofc_insert" ON public.slaughter_ostrich_feed_consumption
  FOR INSERT TO authenticated
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'slaughterhouse_manager'::app_role])
  );

CREATE POLICY "sofc_update_admin" ON public.slaughter_ostrich_feed_consumption
  FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role]));

-- ============================================================
-- 4) New table: slaughter_live_mortality
-- ============================================================
CREATE TABLE IF NOT EXISTS public.slaughter_live_mortality (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_batch_id uuid NOT NULL REFERENCES public.slaughter_live_receipts(id) ON DELETE RESTRICT,
  mortality_date date NOT NULL DEFAULT CURRENT_DATE,
  dead_count integer NOT NULL CHECK (dead_count > 0),
  reason text,
  cost_per_bird_before numeric NOT NULL DEFAULT 0,
  total_loss_cost numeric NOT NULL DEFAULT 0,
  load_on_remaining boolean NOT NULL DEFAULT true,
  notes text,
  reference_id text NOT NULL UNIQUE,
  reversed_at timestamptz,
  reversed_by uuid,
  reversal_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.slaughter_live_mortality TO authenticated;
GRANT ALL ON public.slaughter_live_mortality TO service_role;

ALTER TABLE public.slaughter_live_mortality ENABLE ROW LEVEL SECURITY;

CREATE POLICY "slm_read" ON public.slaughter_live_mortality
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "slm_insert" ON public.slaughter_live_mortality
  FOR INSERT TO authenticated
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'slaughterhouse_manager'::app_role])
  );

CREATE POLICY "slm_update_admin" ON public.slaughter_live_mortality
  FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role]));

-- ============================================================
-- 5) New table: slaughter_batch_cost_breakdown (snapshot)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.slaughter_batch_cost_breakdown (
  slaughter_batch_id uuid PRIMARY KEY REFERENCES public.slaughter_batches(id) ON DELETE CASCADE,
  live_batch_id uuid REFERENCES public.slaughter_live_receipts(id) ON DELETE SET NULL,
  birds_count integer NOT NULL DEFAULT 0,
  birds_original_cost numeric NOT NULL DEFAULT 0,
  feed_cost numeric NOT NULL DEFAULT 0,
  mortality_cost numeric NOT NULL DEFAULT 0,
  other_costs numeric NOT NULL DEFAULT 0,
  direct_expenses numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  total_output_kg numeric NOT NULL DEFAULT 0,
  cost_per_kg numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.slaughter_batch_cost_breakdown TO authenticated;
GRANT ALL ON public.slaughter_batch_cost_breakdown TO service_role;

ALTER TABLE public.slaughter_batch_cost_breakdown ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sbcb_read" ON public.slaughter_batch_cost_breakdown
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "sbcb_write_admin" ON public.slaughter_batch_cost_breakdown
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'slaughterhouse_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'slaughterhouse_manager'::app_role]));

-- ============================================================
-- 6) Function: recalc_live_batch_cost
-- ============================================================
CREATE OR REPLACE FUNCTION public.recalc_live_batch_cost(p_live_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_original_cost numeric := 0;
  v_bird_count integer := 0;
  v_doa integer := 0;
  v_feed_cost numeric := 0;
  v_mortality_count integer := 0;
  v_mortality_cost numeric := 0;
  v_other_cost numeric := 0;
  v_alive integer := 0;
  v_total numeric := 0;
  v_cpb numeric := 0;
BEGIN
  SELECT total_cost, bird_count, COALESCE(dead_on_arrival,0), COALESCE(other_costs_loaded,0)
    INTO v_original_cost, v_bird_count, v_doa, v_other_cost
  FROM public.slaughter_live_receipts WHERE id = p_live_batch_id;

  SELECT COALESCE(SUM(total_cost),0) INTO v_feed_cost
    FROM public.slaughter_ostrich_feed_consumption
   WHERE live_batch_id = p_live_batch_id AND reversed_at IS NULL;

  SELECT COALESCE(SUM(dead_count),0), COALESCE(SUM(total_loss_cost) FILTER (WHERE load_on_remaining),0)
    INTO v_mortality_count, v_mortality_cost
    FROM public.slaughter_live_mortality
   WHERE live_batch_id = p_live_batch_id AND reversed_at IS NULL;

  v_alive := GREATEST(v_bird_count - v_doa - v_mortality_count, 0);
  v_total := v_original_cost + v_feed_cost + v_mortality_cost + v_other_cost;
  v_cpb := CASE WHEN v_alive > 0 THEN v_total / v_alive ELSE 0 END;

  UPDATE public.slaughter_live_receipts
     SET mortality_count = v_mortality_count,
         feed_cost_loaded = v_feed_cost,
         mortality_cost_loaded = v_mortality_cost,
         current_alive_count = v_alive,
         total_batch_cost = v_total,
         cost_per_bird_current = v_cpb,
         updated_at = now()
   WHERE id = p_live_batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalc_live_batch_cost(uuid) TO authenticated, service_role;

-- ============================================================
-- 7) Trigger: after feed consumption insert -> deduct stock, log movement, recalc cost
-- ============================================================
CREATE OR REPLACE FUNCTION public.slaughter_ostrich_feed_consumption_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock_before numeric;
  v_unit_cost numeric;
BEGIN
  SELECT current_kg, last_unit_cost INTO v_stock_before, v_unit_cost
    FROM public.slaughterhouse_feed_inventory
   WHERE id = NEW.feed_inventory_id
   FOR UPDATE;

  IF v_stock_before IS NULL THEN
    RAISE EXCEPTION 'Feed inventory item not found';
  END IF;

  IF v_stock_before < NEW.quantity_kg THEN
    RAISE EXCEPTION 'الكمية المطلوبة (%) أكبر من رصيد العلف المتاح (%)', NEW.quantity_kg, v_stock_before;
  END IF;

  -- snapshot stock_before / unit_cost / totals on the row itself
  NEW.stock_before := v_stock_before;
  NEW.stock_after := v_stock_before - NEW.quantity_kg;
  IF NEW.unit_cost IS NULL OR NEW.unit_cost = 0 THEN
    NEW.unit_cost := COALESCE(v_unit_cost, 0);
  END IF;
  NEW.total_cost := NEW.quantity_kg * NEW.unit_cost;

  -- deduct from feed inventory
  UPDATE public.slaughterhouse_feed_inventory
     SET current_kg = current_kg - NEW.quantity_kg,
         updated_at = now()
   WHERE id = NEW.feed_inventory_id;

  -- log a movement row (movement_type = 'consumption')
  INSERT INTO public.slaughterhouse_feed_movements
    (feed_id, movement_type, quantity_kg, unit_cost, total_cost,
     source_type, source_id, reference_no, notes, performed_by)
  VALUES
    (NEW.feed_inventory_id, 'consumption', NEW.quantity_kg, NEW.unit_cost, NEW.total_cost,
     'slaughter_ostrich_feed_consumption', NEW.id, NEW.reference_id,
     COALESCE(NEW.notes,'صرف علف لدفعة نعام'), COALESCE(NEW.responsible_user_id, NEW.created_by));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sofc_before_insert ON public.slaughter_ostrich_feed_consumption;
CREATE TRIGGER trg_sofc_before_insert
  BEFORE INSERT ON public.slaughter_ostrich_feed_consumption
  FOR EACH ROW EXECUTE FUNCTION public.slaughter_ostrich_feed_consumption_after_insert();

CREATE OR REPLACE FUNCTION public.slaughter_ostrich_feed_consumption_after_recalc()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recalc_live_batch_cost(COALESCE(NEW.live_batch_id, OLD.live_batch_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sofc_after_insert ON public.slaughter_ostrich_feed_consumption;
CREATE TRIGGER trg_sofc_after_insert
  AFTER INSERT OR UPDATE ON public.slaughter_ostrich_feed_consumption
  FOR EACH ROW EXECUTE FUNCTION public.slaughter_ostrich_feed_consumption_after_recalc();

-- ============================================================
-- 8) Trigger: mortality before insert (compute cost) + after (recalc)
-- ============================================================
CREATE OR REPLACE FUNCTION public.slaughter_live_mortality_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cpb numeric := 0;
BEGIN
  SELECT cost_per_bird_current INTO v_cpb
    FROM public.slaughter_live_receipts WHERE id = NEW.live_batch_id;

  IF NEW.cost_per_bird_before IS NULL OR NEW.cost_per_bird_before = 0 THEN
    NEW.cost_per_bird_before := COALESCE(v_cpb, 0);
  END IF;
  NEW.total_loss_cost := NEW.cost_per_bird_before * NEW.dead_count;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_slm_before_insert ON public.slaughter_live_mortality;
CREATE TRIGGER trg_slm_before_insert
  BEFORE INSERT ON public.slaughter_live_mortality
  FOR EACH ROW EXECUTE FUNCTION public.slaughter_live_mortality_before_insert();

CREATE OR REPLACE FUNCTION public.slaughter_live_mortality_after_recalc()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recalc_live_batch_cost(COALESCE(NEW.live_batch_id, OLD.live_batch_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_slm_after_insert ON public.slaughter_live_mortality;
CREATE TRIGGER trg_slm_after_insert
  AFTER INSERT OR UPDATE ON public.slaughter_live_mortality
  FOR EACH ROW EXECUTE FUNCTION public.slaughter_live_mortality_after_recalc();

-- ============================================================
-- 9) Function: apply_slaughter_cost_allocation
-- Idempotent: if cost_allocation_done = true skip; uses cost_allocation_ref
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_slaughter_cost_allocation(p_slaughter_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_live_id uuid;
  v_birds integer;
  v_cpb numeric := 0;
  v_birds_cost numeric := 0;
  v_direct numeric := 0;
  v_total_alloc numeric := 0;
  v_output_kg numeric := 0;
  v_cost_per_kg numeric := 0;
  v_done boolean;
  v_ref text;
  v_feed_cost numeric := 0;
  v_mort_cost numeric := 0;
  v_other_cost numeric := 0;
  v_orig_cost numeric := 0;
BEGIN
  SELECT live_receipt_id, birds_slaughtered, direct_slaughter_expenses,
         cost_allocation_done, cost_allocation_ref
    INTO v_live_id, v_birds, v_direct, v_done, v_ref
  FROM public.slaughter_batches WHERE id = p_slaughter_batch_id
  FOR UPDATE;

  IF v_done THEN
    RETURN jsonb_build_object('status','already_allocated','ref',v_ref);
  END IF;

  IF v_live_id IS NOT NULL THEN
    SELECT cost_per_bird_current, total_cost, feed_cost_loaded, mortality_cost_loaded, other_costs_loaded
      INTO v_cpb, v_orig_cost, v_feed_cost, v_mort_cost, v_other_cost
    FROM public.slaughter_live_receipts WHERE id = v_live_id;
  END IF;

  v_birds_cost := COALESCE(v_cpb,0) * COALESCE(v_birds,0);
  v_total_alloc := v_birds_cost + COALESCE(v_direct,0);

  SELECT COALESCE(SUM(actual_weight_kg),0) INTO v_output_kg
    FROM public.slaughter_batch_outputs WHERE batch_id = p_slaughter_batch_id;

  v_cost_per_kg := CASE WHEN v_output_kg > 0 THEN v_total_alloc / v_output_kg ELSE 0 END;

  -- Update outputs unit_cost
  UPDATE public.slaughter_batch_outputs
     SET unit_cost = v_cost_per_kg
   WHERE batch_id = p_slaughter_batch_id;

  -- Update slaughter_batches snapshot
  v_ref := 'slaughter_cost_allocation_' || p_slaughter_batch_id::text;
  UPDATE public.slaughter_batches
     SET cost_per_bird_snapshot = COALESCE(v_cpb,0),
         total_birds_cost = v_birds_cost,
         total_allocatable_cost = v_total_alloc,
         cost_per_kg_meat = v_cost_per_kg,
         cost_allocation_done = true,
         cost_allocation_ref = v_ref,
         updated_at = now()
   WHERE id = p_slaughter_batch_id;

  -- Upsert breakdown snapshot
  INSERT INTO public.slaughter_batch_cost_breakdown
    (slaughter_batch_id, live_batch_id, birds_count,
     birds_original_cost, feed_cost, mortality_cost, other_costs,
     direct_expenses, total_cost, total_output_kg, cost_per_kg)
  VALUES
    (p_slaughter_batch_id, v_live_id, COALESCE(v_birds,0),
     COALESCE(v_orig_cost,0) * CASE WHEN v_birds > 0 THEN v_birds::numeric / NULLIF((SELECT bird_count FROM slaughter_live_receipts WHERE id = v_live_id),0) ELSE 0 END,
     COALESCE(v_feed_cost,0) * CASE WHEN v_birds > 0 THEN v_birds::numeric / NULLIF((SELECT bird_count FROM slaughter_live_receipts WHERE id = v_live_id),0) ELSE 0 END,
     COALESCE(v_mort_cost,0) * CASE WHEN v_birds > 0 THEN v_birds::numeric / NULLIF((SELECT bird_count FROM slaughter_live_receipts WHERE id = v_live_id),0) ELSE 0 END,
     COALESCE(v_other_cost,0),
     COALESCE(v_direct,0), v_total_alloc, v_output_kg, v_cost_per_kg)
  ON CONFLICT (slaughter_batch_id) DO UPDATE
    SET birds_count = EXCLUDED.birds_count,
        birds_original_cost = EXCLUDED.birds_original_cost,
        feed_cost = EXCLUDED.feed_cost,
        mortality_cost = EXCLUDED.mortality_cost,
        other_costs = EXCLUDED.other_costs,
        direct_expenses = EXCLUDED.direct_expenses,
        total_cost = EXCLUDED.total_cost,
        total_output_kg = EXCLUDED.total_output_kg,
        cost_per_kg = EXCLUDED.cost_per_kg,
        updated_at = now();

  RETURN jsonb_build_object(
    'status','ok',
    'cost_per_kg', v_cost_per_kg,
    'total_cost', v_total_alloc,
    'output_kg', v_output_kg,
    'ref', v_ref
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_slaughter_cost_allocation(uuid) TO authenticated, service_role;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_sofc_live_batch ON public.slaughter_ostrich_feed_consumption(live_batch_id);
CREATE INDEX IF NOT EXISTS idx_sofc_date ON public.slaughter_ostrich_feed_consumption(consumption_date DESC);
CREATE INDEX IF NOT EXISTS idx_slm_live_batch ON public.slaughter_live_mortality(live_batch_id);
CREATE INDEX IF NOT EXISTS idx_slm_date ON public.slaughter_live_mortality(mortality_date DESC);
