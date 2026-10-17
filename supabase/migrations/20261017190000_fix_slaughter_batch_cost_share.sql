-- Fix slaughter-batch costing.
--
-- finalize_slaughter_batch used the FULL purchase cost of slaughter_batches.live_receipt_id
-- (the first receipt only) divided by output kilograms. A batch that slaughtered part of a
-- receipt, or birds from two receipts, was still charged one entire receipt.
--
-- The share is already stored on slaughter_batch_live_sources when the batch is created.
-- This migration makes every cost path use that share:
--   * live weight taken from the receipt, when that weight is recorded on the source
--   * otherwise bird count / receipt bird count
-- and refuses a draw that would take more birds, live weight, or cost than the receipt
-- has left. Existing batches are not updated; scripts/slaughter-october-2026-corrected-costs.sql
-- is the read-only review.

ALTER TABLE public.slaughter_batch_live_sources
  ADD COLUMN IF NOT EXISTS live_weight_kg numeric(14,3);

COMMENT ON COLUMN public.slaughter_batch_live_sources.live_weight_kg IS
  'Live kilograms drawn from this receipt. When set, cost is pro-rated by this weight; otherwise by bird count.';

-- Purchase + opening + feed + mortality + other + per-bird feed already on the receipt.
CREATE OR REPLACE FUNCTION public.slaughter_receipt_allocatable_cost(p_receipt_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(r.total_cost, 0)
       + COALESCE(r.opening_cost_total, 0)
       + COALESCE(r.feed_cost_loaded, 0)
       + COALESCE(r.mortality_cost_loaded, 0)
       + COALESCE(r.other_costs_loaded, 0)
       + COALESCE((
           SELECT SUM(b.feed_cost)
           FROM public.slaughter_live_birds b
           WHERE b.receipt_id = r.id
         ), 0)
  FROM public.slaughter_live_receipts r
  WHERE r.id = p_receipt_id;
$$;

CREATE OR REPLACE FUNCTION public.sync_slaughter_receipt_alive(p_receipt_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_bird_count integer := 0;
  v_doa integer := 0;
  v_manual integer := 0;
  v_mortality integer := 0;
  v_slaughtered integer := 0;
  v_sold integer := 0;
  v_alive integer := 0;
BEGIN
  SELECT COALESCE(bird_count, 0), COALESCE(dead_on_arrival, 0), COALESCE(manual_available_adjustment, 0)
    INTO v_bird_count, v_doa, v_manual
  FROM public.slaughter_live_receipts
  WHERE id = p_receipt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(dead_count), 0)::int
    INTO v_mortality
  FROM public.slaughter_live_mortality
  WHERE live_batch_id = p_receipt_id
    AND reversed_at IS NULL;

  SELECT COALESCE(SUM(birds_count), 0)::int
    INTO v_slaughtered
  FROM public.slaughter_batch_live_sources
  WHERE live_receipt_id = p_receipt_id;

  SELECT COALESCE(SUM(bird_count), 0)::int
    INTO v_sold
  FROM public.slaughter_live_sales
  WHERE live_receipt_id = p_receipt_id;

  -- A manual stock adjustment already states the balance after mortality.
  IF v_manual <> 0 THEN
    v_mortality := 0;
  END IF;

  v_alive := GREATEST(v_bird_count - v_doa - v_mortality - v_slaughtered - v_sold + v_manual, 0);

  UPDATE public.slaughter_live_receipts
     SET current_alive_count = v_alive,
         updated_at = now()
   WHERE id = p_receipt_id;

  RETURN v_alive;
END;
$$;

-- Cost of one draw. Caps at the receipt cost not yet allocated to slaughter or live sales.
CREATE OR REPLACE FUNCTION public.slaughter_source_draw_cost(
  p_receipt_id uuid,
  p_birds integer,
  p_live_weight_kg numeric
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_alloc numeric := 0;
  v_birds integer := 0;
  v_weight numeric := 0;
  v_used numeric := 0;
  v_share numeric := 0;
  v_cost numeric := 0;
  v_remaining numeric := 0;
BEGIN
  SELECT public.slaughter_receipt_allocatable_cost(p_receipt_id),
         COALESCE(bird_count, 0),
         COALESCE(total_weight_kg, 0)
    INTO v_alloc, v_birds, v_weight
  FROM public.slaughter_live_receipts
  WHERE id = p_receipt_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'دفعة النعام المصدر غير موجودة';
  END IF;

  IF COALESCE(p_live_weight_kg, 0) > 0 AND v_weight > 0 THEN
    v_share := p_live_weight_kg / v_weight;
  ELSIF v_birds > 0 THEN
    v_share := COALESCE(p_birds, 0)::numeric / v_birds::numeric;
  ELSE
    RAISE EXCEPTION 'إيصال الاستلام لا يحتوي عدد طيور';
  END IF;

  SELECT COALESCE(SUM(total_birds_cost), 0)
    INTO v_used
  FROM public.slaughter_batch_live_sources
  WHERE live_receipt_id = p_receipt_id;

  v_used := v_used + COALESCE((
    SELECT SUM(total_cost_at_sale)
    FROM public.slaughter_live_sales
    WHERE live_receipt_id = p_receipt_id
  ), 0);

  v_cost := ROUND(COALESCE(v_alloc, 0) * v_share, 4);
  v_remaining := ROUND(GREATEST(COALESCE(v_alloc, 0) - v_used, 0), 4);

  IF v_cost > v_remaining + 0.05 THEN
    RAISE EXCEPTION 'تكلفة هذه الدفعة تتجاوز تكلفة الإيصال المتبقية';
  END IF;

  RETURN LEAST(v_cost, v_remaining);
END;
$$;

CREATE OR REPLACE FUNCTION public.sbls_validate_and_deduct()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_bird_count integer := 0;
  v_doa integer := 0;
  v_manual integer := 0;
  v_mortality integer := 0;
  v_slaughtered integer := 0;
  v_sold integer := 0;
  v_available integer := 0;
  v_receipt_weight numeric := 0;
  v_used_weight numeric := 0;
  v_sold_weight numeric := 0;
  v_receipt_no text;
  v_cost numeric := 0;
BEGIN
  SELECT COALESCE(bird_count, 0),
         COALESCE(dead_on_arrival, 0),
         COALESCE(manual_available_adjustment, 0),
         COALESCE(total_weight_kg, 0),
         receipt_number
    INTO v_bird_count, v_doa, v_manual, v_receipt_weight, v_receipt_no
  FROM public.slaughter_live_receipts
  WHERE id = NEW.live_receipt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'دفعة النعام المصدر غير موجودة';
  END IF;

  IF NEW.birds_count IS NULL OR NEW.birds_count <= 0 THEN
    RAISE EXCEPTION 'عدد النعام المطلوب دبحه يجب أن يكون أكبر من صفر';
  END IF;

  SELECT COALESCE(SUM(dead_count), 0)::int
    INTO v_mortality
  FROM public.slaughter_live_mortality
  WHERE live_batch_id = NEW.live_receipt_id
    AND reversed_at IS NULL;

  IF v_manual <> 0 THEN
    v_mortality := 0;
  END IF;

  SELECT COALESCE(SUM(birds_count), 0)::int
    INTO v_slaughtered
  FROM public.slaughter_batch_live_sources
  WHERE live_receipt_id = NEW.live_receipt_id;

  SELECT COALESCE(SUM(bird_count), 0)::int,
         COALESCE(SUM(sale_weight_kg), 0)
    INTO v_sold, v_sold_weight
  FROM public.slaughter_live_sales
  WHERE live_receipt_id = NEW.live_receipt_id;

  v_available := v_bird_count - v_doa - v_mortality - v_slaughtered - v_sold + v_manual;
  IF NEW.birds_count > v_available THEN
    RAISE EXCEPTION 'العدد المطلوب دبحه (%) أكبر من المتاح في الدفعة % (المتاح: %)',
      NEW.birds_count, COALESCE(v_receipt_no, '?'), GREATEST(v_available, 0);
  END IF;

  IF COALESCE(NEW.live_weight_kg, 0) > 0 THEN
    SELECT COALESCE(SUM(live_weight_kg), 0)
      INTO v_used_weight
    FROM public.slaughter_batch_live_sources
    WHERE live_receipt_id = NEW.live_receipt_id
      AND live_weight_kg IS NOT NULL;

    IF v_receipt_weight <= 0
       OR v_used_weight + v_sold_weight + NEW.live_weight_kg > v_receipt_weight + 0.001 THEN
      RAISE EXCEPTION 'الوزن الحي المطلوب أكبر من الوزن المتبقي في إيصال %', COALESCE(v_receipt_no, '?');
    END IF;
  END IF;

  -- Always recompute. A client-supplied snapshot must not charge the whole receipt.
  v_cost := public.slaughter_source_draw_cost(NEW.live_receipt_id, NEW.birds_count, NEW.live_weight_kg);
  NEW.total_birds_cost := v_cost;
  NEW.cost_per_bird_snapshot := CASE
    WHEN NEW.birds_count > 0 THEN ROUND(v_cost / NEW.birds_count, 4)
    ELSE 0
  END;

  IF NEW.reference_id IS NULL OR NEW.reference_id = '' THEN
    NEW.reference_id := 'slaughter_source_' || NEW.slaughter_batch_id::text || '_' || NEW.live_receipt_id::text;
  END IF;

  INSERT INTO public.slaughter_audit_log (action, target_type, target_id, batch_id, old_value, new_value, notes)
  VALUES (
    'slaughter_source_added',
    'slaughter_live_receipts',
    NEW.live_receipt_id,
    NEW.slaughter_batch_id,
    jsonb_build_object('available_before', v_available, 'receipt_weight_kg', v_receipt_weight),
    jsonb_build_object(
      'birds_taken', NEW.birds_count,
      'live_weight_kg', NEW.live_weight_kg,
      'cost_snapshot', NEW.cost_per_bird_snapshot,
      'total_cost', NEW.total_birds_cost
    ),
    'سحب نعام للدبح من دفعة ' || COALESCE(v_receipt_no, '?') || ' — reference_id=' || NEW.reference_id
  );

  RETURN NEW;
END;
$$;

-- Kept so the existing BEFORE INSERT trigger cannot overwrite the share with cost_per_bird_current.
CREATE OR REPLACE FUNCTION public.snapshot_slaughter_source_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sbls_restore_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.slaughter_audit_log (action, target_type, target_id, batch_id, old_value, new_value, notes)
  VALUES (
    'slaughter_source_removed',
    'slaughter_live_receipts',
    OLD.live_receipt_id,
    OLD.slaughter_batch_id,
    jsonb_build_object('birds_taken', OLD.birds_count, 'cost_snapshot', OLD.cost_per_bird_snapshot, 'total_cost', OLD.total_birds_cost),
    NULL,
    'إعادة نعام لدفعة المصدر بعد حذف مصدر الدبح — reference_id=' || COALESCE(OLD.reference_id, '')
  );
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.sbls_sync_alive_after()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.sync_slaughter_receipt_alive(COALESCE(NEW.live_receipt_id, OLD.live_receipt_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sbls_sync_alive ON public.slaughter_batch_live_sources;
CREATE TRIGGER trg_sbls_sync_alive
  AFTER INSERT OR DELETE ON public.slaughter_batch_live_sources
  FOR EACH ROW EXECUTE FUNCTION public.sbls_sync_alive_after();

CREATE OR REPLACE FUNCTION public.sbls_block_quantity_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.birds_count IS DISTINCT FROM OLD.birds_count
     OR NEW.live_receipt_id IS DISTINCT FROM OLD.live_receipt_id
     OR NEW.live_weight_kg IS DISTINCT FROM OLD.live_weight_kg THEN
    RAISE EXCEPTION 'لا يمكن تعديل كمية مصدر الدبح بعد تسجيله؛ احذف المصدر وأعد إدخاله';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sbls_block_quantity_update ON public.slaughter_batch_live_sources;
CREATE TRIGGER trg_sbls_block_quantity_update
  BEFORE UPDATE ON public.slaughter_batch_live_sources
  FOR EACH ROW EXECUTE FUNCTION public.sbls_block_quantity_update();

-- Live sales use the same remaining-bird count, instead of decrementing a stale counter.
CREATE OR REPLACE FUNCTION public.apply_live_sale_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.sync_slaughter_receipt_alive(COALESCE(NEW.live_receipt_id, OLD.live_receipt_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_live_sale_stock ON public.slaughter_live_sales;
CREATE TRIGGER trg_live_sale_stock
  AFTER INSERT ON public.slaughter_live_sales
  FOR EACH ROW EXECUTE FUNCTION public.apply_live_sale_stock();

CREATE OR REPLACE FUNCTION public.recalc_live_batch_cost(p_live_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_original_cost numeric := 0;
  v_opening_cost numeric := 0;
  v_feed_cost numeric := 0;
  v_mortality_count integer := 0;
  v_mortality_cost numeric := 0;
  v_other_cost numeric := 0;
  v_bird_feed numeric := 0;
  v_alive integer := 0;
  v_total numeric := 0;
  v_used numeric := 0;
  v_remaining numeric := 0;
  v_cpb numeric := 0;
  v_manual_adj integer := 0;
  v_existing_total_batch_cost numeric := 0;
BEGIN
  SELECT total_cost, COALESCE(opening_cost_total, 0),
         COALESCE(other_costs_loaded, 0),
         COALESCE(manual_available_adjustment, 0), COALESCE(total_batch_cost, 0)
    INTO v_original_cost, v_opening_cost, v_other_cost, v_manual_adj, v_existing_total_batch_cost
  FROM public.slaughter_live_receipts
  WHERE id = p_live_batch_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(l.allocated_cost), 0)
    INTO v_feed_cost
  FROM public.slaughter_cost_allocation_lines l
  JOIN public.slaughter_cost_allocations a ON a.id = l.allocation_id
  WHERE l.receipt_id = p_live_batch_id
    AND a.event_type = 'feed'
    AND a.status = 'allocated';

  SELECT COALESCE(SUM(dead_count), 0)
    INTO v_mortality_count
  FROM public.slaughter_live_mortality
  WHERE live_batch_id = p_live_batch_id
    AND reversed_at IS NULL;

  SELECT COALESCE(SUM(l.allocated_cost), 0)
    INTO v_mortality_cost
  FROM public.slaughter_cost_allocation_lines l
  JOIN public.slaughter_cost_allocations a ON a.id = l.allocation_id
  WHERE l.receipt_id = p_live_batch_id
    AND a.event_type = 'mortality'
    AND a.status = 'allocated';

  SELECT COALESCE(SUM(feed_cost), 0)
    INTO v_bird_feed
  FROM public.slaughter_live_birds
  WHERE receipt_id = p_live_batch_id;

  -- Keep a manually reconciled receipt total, otherwise the full loaded cost.
  -- cost_per_bird_current is the UNALLOCATED remainder per bird still alive,
  -- so a later slaughter cannot be charged the birds already taken.
  IF v_manual_adj <> 0 AND v_existing_total_batch_cost > 0 THEN
    v_total := v_existing_total_batch_cost;
  ELSE
    v_total := COALESCE(v_original_cost, 0) + v_opening_cost + v_feed_cost + v_mortality_cost + v_other_cost + v_bird_feed;
  END IF;

  SELECT COALESCE(SUM(total_birds_cost), 0)
    INTO v_used
  FROM public.slaughter_batch_live_sources
  WHERE live_receipt_id = p_live_batch_id;

  v_used := v_used + COALESCE((
    SELECT SUM(total_cost_at_sale)
    FROM public.slaughter_live_sales
    WHERE live_receipt_id = p_live_batch_id
  ), 0);

  v_remaining := GREATEST(v_total - v_used, 0);
  v_alive := public.sync_slaughter_receipt_alive(p_live_batch_id);
  v_cpb := CASE WHEN v_alive > 0 THEN v_remaining / v_alive ELSE 0 END;

  UPDATE public.slaughter_live_receipts
     SET mortality_count = v_mortality_count,
         feed_cost_loaded = v_feed_cost,
         mortality_cost_loaded = v_mortality_cost,
         total_batch_cost = v_total,
         cost_per_bird_current = v_cpb,
         updated_at = now()
   WHERE id = p_live_batch_id;
END;
$$;

-- One writer for batch cost, output unit cost, and auto cost per kg.
CREATE OR REPLACE FUNCTION public.refresh_slaughter_batch_output_costs(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_birds_cost numeric := 0;
  v_birds_count integer := 0;
  v_sources integer := 0;
  v_direct numeric := 0;
  v_live uuid;
  v_batch_birds integer := 0;
  v_total numeric := 0;
  v_accepted numeric := 0;
  v_gross numeric := 0;
  v_kg numeric := 0;
  v_cpk numeric := 0;
  v_first_live uuid;
  v_receipt_birds integer := 0;
  v_receipt_cost numeric := 0;
BEGIN
  SELECT COALESCE(direct_slaughter_expenses, 0), live_receipt_id, COALESCE(birds_slaughtered, 0)
    INTO v_direct, v_live, v_batch_birds
  FROM public.slaughter_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;

  SELECT COALESCE(SUM(total_birds_cost), 0), COALESCE(SUM(birds_count), 0), COUNT(*)
    INTO v_birds_cost, v_birds_count, v_sources
  FROM public.slaughter_batch_live_sources
  WHERE slaughter_batch_id = p_batch_id;

  -- Legacy batches that only stored live_receipt_id: same bird share, never the whole receipt
  -- unless this batch slaughtered every bird.
  IF v_sources = 0 AND v_live IS NOT NULL THEN
    SELECT COALESCE(bird_count, 0)
      INTO v_receipt_birds
    FROM public.slaughter_live_receipts
    WHERE id = v_live;
    v_receipt_cost := public.slaughter_receipt_allocatable_cost(v_live);
    IF v_receipt_birds > 0 AND v_batch_birds > 0 THEN
      v_birds_count := LEAST(v_batch_birds, v_receipt_birds);
      v_birds_cost := ROUND(v_receipt_cost * v_birds_count::numeric / v_receipt_birds::numeric, 4);
    END IF;
  END IF;

  SELECT COALESCE(SUM(GREATEST(
           actual_weight_kg - COALESCE(damaged_weight_kg, 0) - COALESCE(quarantined_weight_kg, 0),
           0
         )), 0)
    INTO v_accepted
  FROM public.slaughter_batch_outputs
  WHERE batch_id = p_batch_id
    AND destination IS DISTINCT FROM 'waste';

  SELECT COALESCE(SUM(actual_weight_kg), 0)
    INTO v_gross
  FROM public.slaughter_batch_outputs
  WHERE batch_id = p_batch_id;

  v_kg := CASE WHEN v_accepted > 0 THEN v_accepted ELSE v_gross END;
  v_total := COALESCE(v_birds_cost, 0) + COALESCE(v_direct, 0);
  v_cpk := CASE WHEN v_kg > 0 THEN v_total / v_kg ELSE 0 END;

  UPDATE public.slaughter_batch_outputs
     SET auto_cost_per_kg = CASE
           WHEN destination = 'waste' THEN 0
           ELSE ROUND(v_cpk, 4)
         END,
         unit_cost = CASE
           WHEN manual_cost_per_kg IS NOT NULL THEN manual_cost_per_kg
           WHEN destination = 'waste' THEN 0
           ELSE v_cpk
         END
   WHERE batch_id = p_batch_id;

  UPDATE public.slaughter_batches
     SET total_birds_cost = v_birds_cost,
         total_allocatable_cost = v_total,
         cost_per_kg_meat = v_cpk,
         cost_per_bird_snapshot = CASE WHEN v_birds_count > 0 THEN v_birds_cost / v_birds_count ELSE 0 END,
         cost_allocation_done = true,
         cost_allocation_ref = COALESCE(cost_allocation_ref, 'slaughter_cost_allocation_' || p_batch_id::text),
         updated_at = now()
   WHERE id = p_batch_id;

  SELECT live_receipt_id
    INTO v_first_live
  FROM public.slaughter_batch_live_sources
  WHERE slaughter_batch_id = p_batch_id
  ORDER BY created_at
  LIMIT 1;

  INSERT INTO public.slaughter_batch_cost_breakdown
    (slaughter_batch_id, live_batch_id, birds_count,
     birds_original_cost, feed_cost, mortality_cost, other_costs,
     direct_expenses, total_cost, total_output_kg, cost_per_kg)
  VALUES
    (p_batch_id, COALESCE(v_first_live, v_live), v_birds_count,
     v_birds_cost, 0, 0, 0,
     COALESCE(v_direct, 0), v_total, v_kg, v_cpk)
  ON CONFLICT (slaughter_batch_id) DO UPDATE
    SET live_batch_id = EXCLUDED.live_batch_id,
        birds_count = EXCLUDED.birds_count,
        birds_original_cost = EXCLUDED.birds_original_cost,
        feed_cost = 0,
        mortality_cost = 0,
        other_costs = 0,
        direct_expenses = EXCLUDED.direct_expenses,
        total_cost = EXCLUDED.total_cost,
        total_output_kg = EXCLUDED.total_output_kg,
        cost_per_kg = EXCLUDED.cost_per_kg,
        updated_at = now();

  RETURN jsonb_build_object(
    'status', 'ok',
    'birds_cost', v_birds_cost,
    'direct', COALESCE(v_direct, 0),
    'total_cost', v_total,
    'output_kg', v_kg,
    'cost_per_kg', v_cpk,
    'sources_count', v_sources
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_slaughter_batch(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_batch public.slaughter_batches%ROWTYPE;
  v_old public.slaughter_batches%ROWTYPE;
  v_meat numeric := 0;
  v_transfers integer := 0;
  v_yield_pct numeric := 0;
  v_cost jsonb;
BEGIN
  SELECT * INTO v_batch FROM public.slaughter_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;
  v_old := v_batch;

  SELECT COALESCE(SUM(actual_weight_kg), 0)
    INTO v_meat
  FROM public.slaughter_batch_outputs
  WHERE batch_id = p_batch_id;

  IF v_batch.total_live_weight_kg > 0 THEN
    v_yield_pct := (v_meat / v_batch.total_live_weight_kg) * 100;
  END IF;

  UPDATE public.slaughter_batches
     SET total_meat_kg = v_meat,
         status = 'completed',
         end_time = COALESCE(end_time, CURRENT_TIME)
   WHERE id = p_batch_id;

  v_cost := public.refresh_slaughter_batch_output_costs(p_batch_id);

  INSERT INTO public.slaughter_branch_transfers (batch_id, output_id, branch_id, cut_name_ar, weight_kg, unit_price)
  SELECT o.batch_id, o.id, o.branch_id, o.cut_name_ar, o.actual_weight_kg, o.unit_price
  FROM public.slaughter_batch_outputs o
  WHERE o.batch_id = p_batch_id
    AND o.branch_id IS NOT NULL
    AND o.actual_weight_kg > 0
    AND NOT EXISTS (SELECT 1 FROM public.slaughter_branch_transfers t WHERE t.output_id = o.id);
  GET DIAGNOSTICS v_transfers = ROW_COUNT;

  INSERT INTO public.slaughter_audit_log
    (action, target_type, target_id, batch_id, performed_by, old_value, new_value, notes)
  VALUES
    ('finalize_batch', 'batch', p_batch_id, p_batch_id, auth.uid(),
     jsonb_build_object(
       'status', v_old.status,
       'total_meat_kg', v_old.total_meat_kg,
       'cost_per_kg_meat', v_old.cost_per_kg_meat
     ),
     v_cost || jsonb_build_object('total_meat_kg', v_meat, 'transfers_created', v_transfers, 'actual_yield_pct', v_yield_pct),
     'Finalized batch ' || v_batch.batch_number || ' using the live-bird share actually slaughtered');

  RETURN v_cost || jsonb_build_object(
    'batch_id', p_batch_id,
    'total_meat_kg', v_meat,
    'actual_yield_pct', v_yield_pct,
    'transfers_created', v_transfers
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_slaughter_cost_allocation(p_slaughter_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cost jsonb;
BEGIN
  v_cost := public.refresh_slaughter_batch_output_costs(p_slaughter_batch_id);
  RETURN v_cost || jsonb_build_object('ref', 'slaughter_cost_allocation_' || p_slaughter_batch_id::text);
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_slaughter_batch_cost(p_slaughter_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old numeric := 0;
  v_cost jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager')) THEN
    RAISE EXCEPTION 'صلاحية غير كافية لإعادة الحساب';
  END IF;

  SELECT COALESCE(cost_per_kg_meat, 0)
    INTO v_old
  FROM public.slaughter_batches
  WHERE id = p_slaughter_batch_id;

  v_cost := public.refresh_slaughter_batch_output_costs(p_slaughter_batch_id);

  INSERT INTO public.slaughter_audit_log
    (action, target_type, target_id, batch_id, performed_by, old_value, new_value, notes)
  VALUES
    ('recompute_locked_cost', 'slaughter_batch', p_slaughter_batch_id, p_slaughter_batch_id, auth.uid(),
     jsonb_build_object('old_cost_per_kg', v_old),
     v_cost,
     'إعادة حساب تكلفة دفعة الذبح من حصة الطيور المستخدمة فعليًا');

  RETURN v_cost;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalc_slaughter_output_auto_costs(p_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.refresh_slaughter_batch_output_costs(p_batch_id);
END;
$$;

REVOKE ALL ON FUNCTION public.slaughter_receipt_allocatable_cost(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_slaughter_receipt_alive(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.slaughter_source_draw_cost(uuid, integer, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_slaughter_batch_output_costs(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.slaughter_receipt_allocatable_cost(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_slaughter_receipt_alive(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.slaughter_source_draw_cost(uuid, integer, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_slaughter_batch_output_costs(uuid) TO authenticated, service_role;
