
-- 1) Add lock fields on slaughter_batches
ALTER TABLE public.slaughter_batches
  ADD COLUMN IF NOT EXISTS cost_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS cost_locked_by uuid;

-- 2) Distribution function now filters to ready_for_slaughter only
CREATE OR REPLACE FUNCTION public.distribute_slaughter_cost_event(
  p_event_type text,
  p_source_table text,
  p_source_id uuid,
  p_total_cost numeric,
  p_event_date date,
  p_created_by uuid,
  p_exclude_receipt_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_alloc_id uuid;
  v_total_alive integer := 0;
  r RECORD;
BEGIN
  INSERT INTO public.slaughter_cost_allocations
    (event_type, source_table, source_id, event_date, total_cost,
     status, excluded_receipt_id, notes, created_by)
  VALUES
    (p_event_type, p_source_table, p_source_id, p_event_date, COALESCE(p_total_cost,0),
     'allocated', p_exclude_receipt_id, p_notes, p_created_by)
  ON CONFLICT (source_table, source_id, event_type) DO UPDATE
    SET total_cost = EXCLUDED.total_cost,
        event_date = EXCLUDED.event_date,
        excluded_receipt_id = EXCLUDED.excluded_receipt_id,
        notes = COALESCE(EXCLUDED.notes, slaughter_cost_allocations.notes),
        status = 'allocated',
        updated_at = now()
  RETURNING id INTO v_alloc_id;

  DELETE FROM public.slaughter_cost_allocation_lines WHERE allocation_id = v_alloc_id;

  IF COALESCE(p_total_cost,0) <= 0 THEN
    RETURN v_alloc_id;
  END IF;

  -- Only ready_for_slaughter receipts with alive birds
  SELECT COALESCE(SUM(current_alive_count),0)::int INTO v_total_alive
  FROM public.slaughter_live_receipts
  WHERE COALESCE(current_alive_count,0) > 0
    AND status = 'ready_for_slaughter'
    AND (p_exclude_receipt_id IS NULL OR id <> p_exclude_receipt_id);

  IF v_total_alive <= 0 THEN
    UPDATE public.slaughter_cost_allocations
       SET status='pending', updated_at=now(),
           notes = COALESCE(notes,'') || ' [لا توجد دفعات جاهزة للدبح]'
     WHERE id = v_alloc_id;
    RETURN v_alloc_id;
  END IF;

  FOR r IN
    SELECT id AS receipt_id, current_alive_count AS alive
    FROM public.slaughter_live_receipts
    WHERE COALESCE(current_alive_count,0) > 0
      AND status = 'ready_for_slaughter'
      AND (p_exclude_receipt_id IS NULL OR id <> p_exclude_receipt_id)
  LOOP
    INSERT INTO public.slaughter_cost_allocation_lines
      (allocation_id, receipt_id, birds_at_allocation, share_ratio, allocated_cost)
    VALUES
      (v_alloc_id, r.receipt_id, r.alive,
       (r.alive::numeric / v_total_alive::numeric),
       (r.alive::numeric / v_total_alive::numeric) * p_total_cost);
    PERFORM public.recalc_live_batch_cost(r.receipt_id);
  END LOOP;

  RETURN v_alloc_id;
END;
$$;

-- 3) Trigger on slaughter_batch_live_sources: snapshot cost at insert time
CREATE OR REPLACE FUNCTION public.snapshot_slaughter_source_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cpb numeric := 0;
BEGIN
  IF NEW.cost_per_bird_snapshot IS NULL OR NEW.cost_per_bird_snapshot = 0 THEN
    SELECT COALESCE(cost_per_bird_current,0) INTO v_cpb
      FROM public.slaughter_live_receipts WHERE id = NEW.live_receipt_id;
    NEW.cost_per_bird_snapshot := v_cpb;
  END IF;
  NEW.total_birds_cost := COALESCE(NEW.cost_per_bird_snapshot,0) * COALESCE(NEW.birds_count,0);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_slaughter_source_cost ON public.slaughter_batch_live_sources;
CREATE TRIGGER trg_snapshot_slaughter_source_cost
  BEFORE INSERT ON public.slaughter_batch_live_sources
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_slaughter_source_cost();

-- 4) After insert on slaughter_batch_live_sources: lock cost on the batch
CREATE OR REPLACE FUNCTION public.lock_slaughter_batch_cost_on_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.slaughter_batches
     SET cost_locked_at = COALESCE(cost_locked_at, now()),
         cost_locked_by = COALESCE(cost_locked_by, NEW.created_by),
         updated_at = now()
   WHERE id = NEW.slaughter_batch_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_slaughter_batch_cost_on_source ON public.slaughter_batch_live_sources;
CREATE TRIGGER trg_lock_slaughter_batch_cost_on_source
  AFTER INSERT ON public.slaughter_batch_live_sources
  FOR EACH ROW EXECUTE FUNCTION public.lock_slaughter_batch_cost_on_source();

-- 5) Rewrite recompute_slaughter_batch_cost to use the LOCKED snapshot, not current cost
CREATE OR REPLACE FUNCTION public.recompute_slaughter_batch_cost(p_slaughter_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_birds_cost numeric := 0;
  v_birds_count int := 0;
  v_direct numeric := 0;
  v_total numeric := 0;
  v_kg numeric := 0;
  v_cpk numeric := 0;
  v_old_cpk numeric := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')) THEN
    RAISE EXCEPTION 'صلاحية غير كافية لإعادة الحساب';
  END IF;

  -- Use the LOCKED snapshot already in slaughter_batch_live_sources
  SELECT COALESCE(SUM(s.total_birds_cost),0),
         COALESCE(SUM(s.birds_count),0)
    INTO v_birds_cost, v_birds_count
  FROM public.slaughter_batch_live_sources s
  WHERE s.slaughter_batch_id = p_slaughter_batch_id;

  SELECT COALESCE(direct_slaughter_expenses,0), COALESCE(cost_per_kg_meat,0)
    INTO v_direct, v_old_cpk
    FROM public.slaughter_batches WHERE id = p_slaughter_batch_id;

  SELECT COALESCE(SUM(actual_weight_kg),0) INTO v_kg
    FROM public.slaughter_batch_outputs WHERE batch_id = p_slaughter_batch_id;

  v_total := v_birds_cost + v_direct;
  v_cpk := CASE WHEN v_kg > 0 THEN v_total / v_kg ELSE 0 END;

  UPDATE public.slaughter_batch_outputs SET unit_cost = v_cpk WHERE batch_id = p_slaughter_batch_id;

  UPDATE public.slaughter_batches
     SET total_birds_cost = v_birds_cost,
         total_allocatable_cost = v_total,
         cost_per_kg_meat = v_cpk,
         cost_per_bird_snapshot = CASE WHEN v_birds_count>0 THEN v_birds_cost/v_birds_count ELSE 0 END,
         cost_allocation_done = true,
         cost_locked_at = COALESCE(cost_locked_at, now()),
         updated_at = now()
   WHERE id = p_slaughter_batch_id;

  INSERT INTO public.slaughter_audit_log
    (action, target_type, target_id, batch_id, performed_by, old_value, new_value, notes)
  VALUES
    ('recompute_locked_cost','slaughter_batch', p_slaughter_batch_id, p_slaughter_batch_id, auth.uid(),
     jsonb_build_object('old_cost_per_kg', v_old_cpk),
     jsonb_build_object('birds_cost', v_birds_cost, 'direct', v_direct,
                       'total_cost', v_total, 'output_kg', v_kg, 'cost_per_kg', v_cpk),
     'إعادة حساب تكلفة دفعة الذبح من snapshot المثبَّت لمصادر النعام');

  RETURN jsonb_build_object('status','ok','cost_per_kg',v_cpk,'total_cost',v_total,'output_kg',v_kg);
END;
$$;
