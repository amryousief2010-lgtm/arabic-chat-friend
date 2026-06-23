
-- Sessions
CREATE TABLE public.stocktaking_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_no text NOT NULL UNIQUE,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  count_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Cairo')::date,
  stocktaker_name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','cancelled')),
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id),
  cancelled_at timestamptz,
  total_increase numeric NOT NULL DEFAULT 0,
  total_decrease numeric NOT NULL DEFAULT 0,
  net_value numeric NOT NULL DEFAULT 0,
  reference_id text
);

GRANT SELECT, INSERT, UPDATE ON public.stocktaking_sessions TO authenticated;
GRANT ALL ON public.stocktaking_sessions TO service_role;

ALTER TABLE public.stocktaking_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stocktaking_sessions_read"
  ON public.stocktaking_sessions FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager'::app_role)
    OR public.has_role(auth.uid(), 'executive_manager'::app_role)
    OR public.has_role(auth.uid(), 'warehouse_supervisor'::app_role)
    OR public.has_role(auth.uid(), 'financial_manager'::app_role)
    OR public.has_role(auth.uid(), 'accountant'::app_role)
  );

CREATE POLICY "stocktaking_sessions_write_via_rpc"
  ON public.stocktaking_sessions FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- Lines
CREATE TABLE public.stocktaking_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.stocktaking_sessions(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  system_qty numeric NOT NULL DEFAULT 0,
  actual_qty numeric NOT NULL,
  unit_cost numeric NOT NULL DEFAULT 0,
  diff numeric GENERATED ALWAYS AS (actual_qty - system_qty) STORED,
  diff_value numeric GENERATED ALWAYS AS ((actual_qty - system_qty) * unit_cost) STORED,
  reason text NOT NULL,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, item_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stocktaking_lines TO authenticated;
GRANT ALL ON public.stocktaking_lines TO service_role;

ALTER TABLE public.stocktaking_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stocktaking_lines_read"
  ON public.stocktaking_lines FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager'::app_role)
    OR public.has_role(auth.uid(), 'executive_manager'::app_role)
    OR public.has_role(auth.uid(), 'warehouse_supervisor'::app_role)
    OR public.has_role(auth.uid(), 'financial_manager'::app_role)
    OR public.has_role(auth.uid(), 'accountant'::app_role)
  );

CREATE POLICY "stocktaking_lines_write_via_rpc"
  ON public.stocktaking_lines FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

CREATE INDEX idx_stocktaking_lines_session ON public.stocktaking_lines(session_id);
CREATE INDEX idx_stocktaking_sessions_wh_status ON public.stocktaking_sessions(warehouse_id, status);

-- ============ RPCs ============

-- Create a new draft session
CREATE OR REPLACE FUNCTION public.create_stocktaking_session(
  p_warehouse_id uuid,
  p_stocktaker_name text,
  p_count_date date DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_no text;
BEGIN
  IF NOT (
    public.has_role(v_uid, 'general_manager'::app_role)
    OR public.has_role(v_uid, 'executive_manager'::app_role)
    OR public.has_role(v_uid, 'warehouse_supervisor'::app_role)
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF p_stocktaker_name IS NULL OR length(btrim(p_stocktaker_name)) = 0 THEN
    RAISE EXCEPTION 'STOCKTAKER_REQUIRED';
  END IF;

  v_no := 'STK-' || to_char(now() AT TIME ZONE 'Africa/Cairo', 'YYYYMMDD-HH24MISS');

  INSERT INTO public.stocktaking_sessions(
    session_no, warehouse_id, count_date, stocktaker_name, notes, created_by
  ) VALUES (
    v_no, p_warehouse_id, COALESCE(p_count_date, (now() AT TIME ZONE 'Africa/Cairo')::date),
    btrim(p_stocktaker_name), p_notes, v_uid
  ) RETURNING id INTO v_id;

  RETURN v_id;
END $$;

-- Upsert a single line (draft only)
CREATE OR REPLACE FUNCTION public.upsert_stocktaking_line(
  p_session_id uuid,
  p_item_id uuid,
  p_actual_qty numeric,
  p_reason text,
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.stocktaking_sessions%ROWTYPE;
  v_item public.inventory_items%ROWTYPE;
  v_id uuid;
BEGIN
  IF NOT (
    public.has_role(v_uid, 'general_manager'::app_role)
    OR public.has_role(v_uid, 'executive_manager'::app_role)
    OR public.has_role(v_uid, 'warehouse_supervisor'::app_role)
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;
  IF p_actual_qty IS NULL OR p_actual_qty < 0 THEN
    RAISE EXCEPTION 'INVALID_QTY';
  END IF;

  SELECT * INTO v_session FROM public.stocktaking_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;
  IF v_session.status <> 'draft' THEN RAISE EXCEPTION 'SESSION_NOT_DRAFT'; END IF;

  SELECT * INTO v_item FROM public.inventory_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NOT_FOUND'; END IF;
  IF v_item.warehouse_id <> v_session.warehouse_id THEN
    RAISE EXCEPTION 'ITEM_WAREHOUSE_MISMATCH';
  END IF;

  INSERT INTO public.stocktaking_lines(
    session_id, item_id, system_qty, actual_qty, unit_cost, reason, notes, created_by
  ) VALUES (
    p_session_id, p_item_id, v_item.stock, p_actual_qty, COALESCE(v_item.unit_cost,0),
    btrim(p_reason), p_notes, v_uid
  )
  ON CONFLICT (session_id, item_id) DO UPDATE
    SET actual_qty = EXCLUDED.actual_qty,
        system_qty = EXCLUDED.system_qty,
        unit_cost  = EXCLUDED.unit_cost,
        reason     = EXCLUDED.reason,
        notes      = EXCLUDED.notes,
        updated_at = now()
  RETURNING id INTO v_id;

  -- recompute totals
  UPDATE public.stocktaking_sessions s
    SET total_increase = COALESCE((SELECT SUM(diff_value) FROM public.stocktaking_lines WHERE session_id = s.id AND diff > 0),0),
        total_decrease = COALESCE((SELECT SUM(diff_value) FROM public.stocktaking_lines WHERE session_id = s.id AND diff < 0),0),
        net_value      = COALESCE((SELECT SUM(diff_value) FROM public.stocktaking_lines WHERE session_id = s.id),0)
    WHERE s.id = p_session_id;

  RETURN v_id;
END $$;

-- Delete a draft line
CREATE OR REPLACE FUNCTION public.delete_stocktaking_line(p_line_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sid uuid;
  v_status text;
BEGIN
  IF NOT (
    public.has_role(v_uid, 'general_manager'::app_role)
    OR public.has_role(v_uid, 'executive_manager'::app_role)
    OR public.has_role(v_uid, 'warehouse_supervisor'::app_role)
  ) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT l.session_id, s.status INTO v_sid, v_status
    FROM public.stocktaking_lines l
    JOIN public.stocktaking_sessions s ON s.id = l.session_id
    WHERE l.id = p_line_id;
  IF v_sid IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'SESSION_NOT_DRAFT'; END IF;

  DELETE FROM public.stocktaking_lines WHERE id = p_line_id;

  UPDATE public.stocktaking_sessions s
    SET total_increase = COALESCE((SELECT SUM(diff_value) FROM public.stocktaking_lines WHERE session_id = s.id AND diff > 0),0),
        total_decrease = COALESCE((SELECT SUM(diff_value) FROM public.stocktaking_lines WHERE session_id = s.id AND diff < 0),0),
        net_value      = COALESCE((SELECT SUM(diff_value) FROM public.stocktaking_lines WHERE session_id = s.id),0)
    WHERE s.id = v_sid;
END $$;

-- Approve a session: post adjustments, lock stock
CREATE OR REPLACE FUNCTION public.approve_stocktaking_session(p_session_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.stocktaking_sessions%ROWTYPE;
  v_ref text;
  v_line RECORD;
BEGIN
  IF NOT (
    public.has_role(v_uid, 'general_manager'::app_role)
    OR public.has_role(v_uid, 'executive_manager'::app_role)
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: اعتماد الجرد متاح فقط للمدير العام أو التنفيذي';
  END IF;

  SELECT * INTO v_session FROM public.stocktaking_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;
  IF v_session.status <> 'draft' THEN RAISE EXCEPTION 'SESSION_NOT_DRAFT'; END IF;

  v_ref := 'stocktaking_' || v_session.session_no;

  FOR v_line IN
    SELECT l.*, i.stock AS current_stock
      FROM public.stocktaking_lines l
      JOIN public.inventory_items i ON i.id = l.item_id
      WHERE l.session_id = p_session_id
        AND (l.actual_qty - i.stock) <> 0
      FOR UPDATE OF i
  LOOP
    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, movement_type, quantity, unit_cost,
      performed_by, performed_at, module, reference_type, reference_id,
      approval_status, reason, notes, approved_by, approved_at
    ) VALUES (
      v_line.item_id, v_session.warehouse_id, 'adjustment', v_line.actual_qty, COALESCE(v_line.unit_cost,0),
      v_uid, now(), 'warehouse', 'stocktaking', v_ref || '_' || v_line.item_id::text,
      'posted', v_line.reason,
      'تسوية جرد جلسة ' || v_session.session_no || ': قبل=' || v_line.current_stock || ' بعد=' || v_line.actual_qty,
      v_uid, now()
    );
  END LOOP;

  UPDATE public.stocktaking_sessions
    SET status='approved', approved_by=v_uid, approved_at=now(), reference_id=v_ref
    WHERE id = p_session_id;

  RETURN p_session_id;
END $$;

-- Cancel a draft
CREATE OR REPLACE FUNCTION public.cancel_stocktaking_session(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
BEGIN
  IF NOT (
    public.has_role(v_uid, 'general_manager'::app_role)
    OR public.has_role(v_uid, 'executive_manager'::app_role)
  ) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT status INTO v_status FROM public.stocktaking_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'SESSION_NOT_DRAFT'; END IF;

  UPDATE public.stocktaking_sessions
    SET status='cancelled', cancelled_by=v_uid, cancelled_at=now()
    WHERE id = p_session_id;
END $$;
