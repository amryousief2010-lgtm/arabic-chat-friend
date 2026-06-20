
CREATE TABLE IF NOT EXISTS public.slaughter_cost_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN ('feed','mortality','direct','opening')),
  source_table text NOT NULL,
  source_id uuid NOT NULL,
  event_date date NOT NULL DEFAULT CURRENT_DATE,
  total_cost numeric NOT NULL DEFAULT 0,
  distribution_method text NOT NULL DEFAULT 'alive_birds_proportional',
  status text NOT NULL DEFAULT 'allocated' CHECK (status IN ('allocated','pending','reversed')),
  excluded_receipt_id uuid REFERENCES public.slaughter_live_receipts(id) ON DELETE SET NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz,
  reversed_by uuid,
  UNIQUE (source_table, source_id, event_type)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.slaughter_cost_allocations TO authenticated;
GRANT ALL ON public.slaughter_cost_allocations TO service_role;

ALTER TABLE public.slaughter_cost_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view_slaughter_cost_allocations" ON public.slaughter_cost_allocations
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'general_manager') OR
    public.has_role(auth.uid(),'executive_manager') OR
    public.has_role(auth.uid(),'production_manager') OR
    public.has_role(auth.uid(),'slaughterhouse_manager') OR
    public.has_role(auth.uid(),'warehouse_supervisor')
  );

CREATE POLICY "manage_slaughter_cost_allocations" ON public.slaughter_cost_allocations
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(),'general_manager') OR
    public.has_role(auth.uid(),'executive_manager')
  ) WITH CHECK (
    public.has_role(auth.uid(),'general_manager') OR
    public.has_role(auth.uid(),'executive_manager')
  );

CREATE TABLE IF NOT EXISTS public.slaughter_cost_allocation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id uuid NOT NULL REFERENCES public.slaughter_cost_allocations(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES public.slaughter_live_receipts(id) ON DELETE CASCADE,
  birds_at_allocation integer NOT NULL DEFAULT 0,
  share_ratio numeric NOT NULL DEFAULT 0,
  allocated_cost numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scal_alloc ON public.slaughter_cost_allocation_lines(allocation_id);
CREATE INDEX IF NOT EXISTS idx_scal_receipt ON public.slaughter_cost_allocation_lines(receipt_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.slaughter_cost_allocation_lines TO authenticated;
GRANT ALL ON public.slaughter_cost_allocation_lines TO service_role;

ALTER TABLE public.slaughter_cost_allocation_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view_slaughter_cost_allocation_lines" ON public.slaughter_cost_allocation_lines
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'general_manager') OR
    public.has_role(auth.uid(),'executive_manager') OR
    public.has_role(auth.uid(),'production_manager') OR
    public.has_role(auth.uid(),'slaughterhouse_manager') OR
    public.has_role(auth.uid(),'warehouse_supervisor')
  );

CREATE POLICY "manage_slaughter_cost_allocation_lines" ON public.slaughter_cost_allocation_lines
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(),'general_manager') OR
    public.has_role(auth.uid(),'executive_manager')
  ) WITH CHECK (
    public.has_role(auth.uid(),'general_manager') OR
    public.has_role(auth.uid(),'executive_manager')
  );

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

  SELECT COALESCE(SUM(current_alive_count),0)::int INTO v_total_alive
  FROM public.slaughter_live_receipts
  WHERE COALESCE(current_alive_count,0) > 0
    AND (p_exclude_receipt_id IS NULL OR id <> p_exclude_receipt_id);

  IF v_total_alive <= 0 THEN
    UPDATE public.slaughter_cost_allocations
       SET status='pending', updated_at=now()
     WHERE id = v_alloc_id;
    RETURN v_alloc_id;
  END IF;

  FOR r IN
    SELECT id AS receipt_id, current_alive_count AS alive
    FROM public.slaughter_live_receipts
    WHERE COALESCE(current_alive_count,0) > 0
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

CREATE OR REPLACE FUNCTION public.reverse_slaughter_cost_event(
  p_source_table text,
  p_source_id uuid,
  p_event_type text,
  p_by uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_alloc_id uuid;
  r RECORD;
BEGIN
  SELECT id INTO v_alloc_id FROM public.slaughter_cost_allocations
   WHERE source_table=p_source_table AND source_id=p_source_id AND event_type=p_event_type
   FOR UPDATE;
  IF v_alloc_id IS NULL THEN RETURN; END IF;

  DELETE FROM public.slaughter_cost_allocation_lines WHERE allocation_id=v_alloc_id;
  UPDATE public.slaughter_cost_allocations
     SET status='reversed', reversed_at=now(), reversed_by=p_by, updated_at=now()
   WHERE id=v_alloc_id;

  FOR r IN SELECT id FROM public.slaughter_live_receipts LOOP
    PERFORM public.recalc_live_batch_cost(r.id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalc_live_batch_cost(p_live_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_original_cost numeric := 0;
  v_opening_cost numeric := 0;
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
  SELECT total_cost, COALESCE(opening_cost_total,0), bird_count,
         COALESCE(dead_on_arrival,0), COALESCE(other_costs_loaded,0)
    INTO v_original_cost, v_opening_cost, v_bird_count, v_doa, v_other_cost
  FROM public.slaughter_live_receipts WHERE id = p_live_batch_id;

  SELECT COALESCE(SUM(l.allocated_cost),0) INTO v_feed_cost
  FROM public.slaughter_cost_allocation_lines l
  JOIN public.slaughter_cost_allocations a ON a.id = l.allocation_id
  WHERE l.receipt_id = p_live_batch_id
    AND a.event_type = 'feed'
    AND a.status = 'allocated';

  SELECT COALESCE(SUM(dead_count),0)
    INTO v_mortality_count
    FROM public.slaughter_live_mortality
   WHERE live_batch_id = p_live_batch_id AND reversed_at IS NULL;

  SELECT COALESCE(SUM(l.allocated_cost),0) INTO v_mortality_cost
  FROM public.slaughter_cost_allocation_lines l
  JOIN public.slaughter_cost_allocations a ON a.id = l.allocation_id
  WHERE l.receipt_id = p_live_batch_id
    AND a.event_type = 'mortality'
    AND a.status = 'allocated';

  v_alive := GREATEST(v_bird_count - v_doa - v_mortality_count, 0);
  v_total := v_original_cost + v_opening_cost + v_feed_cost + v_mortality_cost + v_other_cost;
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

CREATE OR REPLACE FUNCTION public.slaughter_ostrich_feed_consumption_after_recalc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.distribute_slaughter_cost_event(
      'feed', 'slaughter_ostrich_feed_consumption', NEW.id,
      COALESCE(NEW.total_cost, NEW.quantity_kg * NEW.unit_cost, 0),
      COALESCE(NEW.consumption_date, CURRENT_DATE),
      COALESCE(NEW.responsible_user_id, NEW.created_by),
      NULL,
      COALESCE(NEW.notes,'صرف علف تلقائي')
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.reversed_at IS NOT NULL AND OLD.reversed_at IS NULL THEN
      PERFORM public.reverse_slaughter_cost_event(
        'slaughter_ostrich_feed_consumption', NEW.id, 'feed', NEW.reversed_by);
    ELSE
      PERFORM public.distribute_slaughter_cost_event(
        'feed', 'slaughter_ostrich_feed_consumption', NEW.id,
        COALESCE(NEW.total_cost, NEW.quantity_kg * NEW.unit_cost, 0),
        COALESCE(NEW.consumption_date, CURRENT_DATE),
        COALESCE(NEW.responsible_user_id, NEW.created_by),
        NULL,
        COALESCE(NEW.notes,'تعديل صرف علف')
      );
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.slaughter_live_mortality_after_recalc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rid uuid;
BEGIN
  v_rid := COALESCE(NEW.live_batch_id, OLD.live_batch_id);
  PERFORM public.recalc_live_batch_cost(v_rid);

  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.load_on_remaining,true) AND COALESCE(NEW.total_loss_cost,0) > 0 THEN
      PERFORM public.distribute_slaughter_cost_event(
        'mortality', 'slaughter_live_mortality', NEW.id,
        COALESCE(NEW.total_loss_cost,0),
        COALESCE(NEW.mortality_date, CURRENT_DATE),
        NEW.created_by,
        NEW.live_batch_id,
        COALESCE(NEW.notes,'تكلفة نافق موزعة')
      );
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.reversed_at IS NOT NULL AND OLD.reversed_at IS NULL THEN
      PERFORM public.reverse_slaughter_cost_event(
        'slaughter_live_mortality', NEW.id, 'mortality', NEW.reversed_by);
    ELSIF COALESCE(NEW.load_on_remaining,true) AND COALESCE(NEW.total_loss_cost,0) > 0 THEN
      PERFORM public.distribute_slaughter_cost_event(
        'mortality', 'slaughter_live_mortality', NEW.id,
        COALESCE(NEW.total_loss_cost,0),
        COALESCE(NEW.mortality_date, CURRENT_DATE),
        NEW.created_by,
        NEW.live_batch_id,
        COALESCE(NEW.notes,'تعديل تكلفة نافق')
      );
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- Backfill historical rows as 1-line legacy allocations
INSERT INTO public.slaughter_cost_allocations
  (event_type, source_table, source_id, event_date, total_cost, status, notes, created_by, created_at)
SELECT 'feed', 'slaughter_ostrich_feed_consumption', f.id, f.consumption_date,
       COALESCE(f.total_cost, f.quantity_kg * f.unit_cost, 0),
       'allocated', 'تحميل تاريخي (قبل التوزيع التلقائي)', f.created_by, f.created_at
FROM public.slaughter_ostrich_feed_consumption f
WHERE f.reversed_at IS NULL
ON CONFLICT (source_table, source_id, event_type) DO NOTHING;

INSERT INTO public.slaughter_cost_allocation_lines
  (allocation_id, receipt_id, birds_at_allocation, share_ratio, allocated_cost)
SELECT a.id, f.live_batch_id, COALESCE(f.birds_count_at_time,0), 1.0,
       COALESCE(f.total_cost, f.quantity_kg * f.unit_cost, 0)
FROM public.slaughter_ostrich_feed_consumption f
JOIN public.slaughter_cost_allocations a
  ON a.source_table='slaughter_ostrich_feed_consumption'
 AND a.source_id = f.id
 AND a.event_type='feed'
WHERE f.reversed_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.slaughter_cost_allocation_lines x WHERE x.allocation_id = a.id);

INSERT INTO public.slaughter_cost_allocations
  (event_type, source_table, source_id, event_date, total_cost, status, notes, created_by, created_at)
SELECT 'mortality', 'slaughter_live_mortality', m.id, m.mortality_date,
       COALESCE(m.total_loss_cost,0),
       'allocated', 'تحميل تاريخي (قبل التوزيع التلقائي)', m.created_by, m.created_at
FROM public.slaughter_live_mortality m
WHERE m.reversed_at IS NULL AND COALESCE(m.load_on_remaining,true)
ON CONFLICT (source_table, source_id, event_type) DO NOTHING;

INSERT INTO public.slaughter_cost_allocation_lines
  (allocation_id, receipt_id, birds_at_allocation, share_ratio, allocated_cost)
SELECT a.id, m.live_batch_id, 0, 1.0, COALESCE(m.total_loss_cost,0)
FROM public.slaughter_live_mortality m
JOIN public.slaughter_cost_allocations a
  ON a.source_table='slaughter_live_mortality'
 AND a.source_id = m.id
 AND a.event_type='mortality'
WHERE m.reversed_at IS NULL AND COALESCE(m.load_on_remaining,true)
  AND NOT EXISTS (SELECT 1 FROM public.slaughter_cost_allocation_lines x WHERE x.allocation_id = a.id);

DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT id FROM public.slaughter_live_receipts LOOP
    PERFORM public.recalc_live_batch_cost(r.id);
  END LOOP;
END $$;

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
BEGIN
  IF NOT (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')) THEN
    RAISE EXCEPTION 'صلاحية غير كافية لإعادة الحساب';
  END IF;

  SELECT COALESCE(SUM(s.birds_count * COALESCE(r.cost_per_bird_current,0)),0),
         COALESCE(SUM(s.birds_count),0)
    INTO v_birds_cost, v_birds_count
  FROM public.slaughter_batch_live_sources s
  LEFT JOIN public.slaughter_live_receipts r ON r.id = s.live_receipt_id
  WHERE s.slaughter_batch_id = p_slaughter_batch_id;

  SELECT COALESCE(direct_slaughter_expenses,0) INTO v_direct
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
         updated_at = now()
   WHERE id = p_slaughter_batch_id;

  RETURN jsonb_build_object('status','ok','cost_per_kg',v_cpk,'total_cost',v_total,'output_kg',v_kg);
END;
$$;
