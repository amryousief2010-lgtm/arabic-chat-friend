-- 1) Columns
ALTER TABLE public.slaughter_live_receipts
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS excluded_from_costing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archive_reason text;

-- 2) Replace distribute function to filter out archived/excluded/opening
CREATE OR REPLACE FUNCTION public.distribute_slaughter_cost_event(
  p_event_type text,
  p_source_table text,
  p_source_id uuid,
  p_total_cost numeric,
  p_event_date date,
  p_created_by uuid,
  p_exclude_receipt_id uuid DEFAULT NULL::uuid,
  p_notes text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  SELECT COALESCE(SUM(current_alive_count),0)::int INTO v_total_alive
  FROM public.slaughter_live_receipts
  WHERE COALESCE(current_alive_count,0) > 0
    AND status = 'ready_for_slaughter'
    AND COALESCE(archived,false) = false
    AND COALESCE(excluded_from_costing,false) = false
    AND COALESCE(source_type,'') <> 'opening_balance'
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
      AND COALESCE(archived,false) = false
      AND COALESCE(excluded_from_costing,false) = false
      AND COALESCE(source_type,'') <> 'opening_balance'
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
$function$;

-- 3) Guard: prevent marking opening/archived/excluded as ready_for_slaughter
CREATE OR REPLACE FUNCTION public.guard_ready_for_slaughter()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'ready_for_slaughter' THEN
    IF COALESCE(NEW.archived,false) THEN
      RAISE EXCEPTION 'لا يمكن تعليم دفعة مؤرشفة كجاهزة للدبح';
    END IF;
    IF COALESCE(NEW.excluded_from_costing,false) THEN
      RAISE EXCEPTION 'لا يمكن تعليم دفعة مستبعدة من التكلفة كجاهزة للدبح';
    END IF;
    IF COALESCE(NEW.source_type,'') = 'opening_balance' THEN
      RAISE EXCEPTION 'لا يمكن تعليم دفعة افتتاحية كجاهزة للدبح';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_ready_for_slaughter ON public.slaughter_live_receipts;
CREATE TRIGGER trg_guard_ready_for_slaughter
  BEFORE INSERT OR UPDATE OF status, archived, excluded_from_costing ON public.slaughter_live_receipts
  FOR EACH ROW EXECUTE FUNCTION public.guard_ready_for_slaughter();

-- 4) Archive + exclude the opening receipt, and reverse its allocations
DO $$
DECLARE
  v_receipt uuid := '89974557-484b-4f99-a47c-3d00cc35c514';
  v_alloc RECORD;
  v_remaining int;
BEGIN
  -- Reverse all allocation LINES that target this receipt
  FOR v_alloc IN
    SELECT DISTINCT a.id
    FROM public.slaughter_cost_allocations a
    JOIN public.slaughter_cost_allocation_lines l ON l.allocation_id = a.id
    WHERE l.receipt_id = v_receipt
  LOOP
    DELETE FROM public.slaughter_cost_allocation_lines
      WHERE allocation_id = v_alloc.id AND receipt_id = v_receipt;

    SELECT COUNT(*) INTO v_remaining
      FROM public.slaughter_cost_allocation_lines
      WHERE allocation_id = v_alloc.id;

    IF v_remaining = 0 THEN
      UPDATE public.slaughter_cost_allocations
         SET status = 'reversed',
             notes  = COALESCE(notes,'') || ' [reversed: opening receipt excluded]',
             updated_at = now()
       WHERE id = v_alloc.id;
    END IF;
  END LOOP;

  -- Zero out cost loaded fields on opening receipt (does NOT touch feed inventory or original movements)
  UPDATE public.slaughter_live_receipts
     SET archived = true,
         excluded_from_costing = true,
         archived_at = now(),
         archive_reason = 'دفعة افتتاحية مستبعدة من التكلفة',
         feed_cost_loaded = 0,
         mortality_cost_loaded = 0
   WHERE id = v_receipt;

  -- Recalc derived totals for opening receipt
  PERFORM public.recalc_live_batch_cost(v_receipt);
END $$;