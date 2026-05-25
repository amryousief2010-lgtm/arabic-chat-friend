
-- ============================================================================
-- Phase 6: Warehouse Transfer Receiving Workflow
-- ============================================================================

-- 1) HEADER TABLE
CREATE TABLE public.warehouse_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_no text UNIQUE,
  source_warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  destination_warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  status text NOT NULL DEFAULT 'pending_receipt',
  created_by uuid,
  sent_by uuid,
  received_by uuid,
  cancelled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  notes text,
  cancel_reason text,
  audit_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT warehouse_transfers_diff_wh CHECK (source_warehouse_id <> destination_warehouse_id)
);

CREATE INDEX idx_wt_source ON public.warehouse_transfers(source_warehouse_id);
CREATE INDEX idx_wt_dest ON public.warehouse_transfers(destination_warehouse_id);
CREATE INDEX idx_wt_status ON public.warehouse_transfers(status);

-- 2) LINES TABLE
CREATE TABLE public.warehouse_transfer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES public.warehouse_transfers(id) ON DELETE CASCADE,
  source_item_id uuid REFERENCES public.inventory_items(id),
  destination_item_id uuid REFERENCES public.inventory_items(id),
  item_name text NOT NULL,
  unit text,
  requested_qty numeric NOT NULL DEFAULT 0,
  sent_qty numeric NOT NULL DEFAULT 0,
  received_qty numeric,
  shortage_qty numeric GENERATED ALWAYS AS (
    GREATEST(sent_qty - COALESCE(received_qty, 0), 0)
  ) STORED,
  unit_cost numeric,
  total_cost numeric,
  receive_notes text,
  source_movement_id uuid REFERENCES public.inventory_movements(id),
  destination_movement_id uuid REFERENCES public.inventory_movements(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wti_transfer ON public.warehouse_transfer_items(transfer_id);

-- 3) STATUS VALIDATION TRIGGER (per project memory: no CHECK constraints for enums)
CREATE OR REPLACE FUNCTION public.validate_warehouse_transfer_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN (
    'draft','sent','pending_receipt','partially_received',
    'received','needs_manager_review','cancelled'
  ) THEN
    RAISE EXCEPTION 'invalid_status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_wt_status
BEFORE INSERT OR UPDATE OF status ON public.warehouse_transfers
FOR EACH ROW EXECUTE FUNCTION public.validate_warehouse_transfer_status();

-- 4) TRANSFER NUMBER GENERATOR
CREATE OR REPLACE FUNCTION public.gen_transfer_no()
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_no text;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.warehouse_transfers
  WHERE created_at >= date_trunc('month', now());
  v_no := 'TR-' || to_char(now(), 'YYYYMM') || '-' || lpad((v_count + 1)::text, 4, '0');
  RETURN v_no;
END;
$$;

-- 5) RLS
ALTER TABLE public.warehouse_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_transfer_items ENABLE ROW LEVEL SECURITY;

-- READ: source/dest supervisors + managers
CREATE POLICY "wt_select_authorized"
ON public.warehouse_transfers FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'general_manager')
  OR public.has_role(auth.uid(), 'executive_manager')
  OR public.has_role(auth.uid(), 'warehouse_supervisor')
);

CREATE POLICY "wti_select_authorized"
ON public.warehouse_transfer_items FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.warehouse_transfers t
    WHERE t.id = transfer_id
      AND (
        public.has_role(auth.uid(), 'general_manager')
        OR public.has_role(auth.uid(), 'executive_manager')
        OR public.has_role(auth.uid(), 'warehouse_supervisor')
      )
  )
);

-- WRITE: blocked; only SECURITY DEFINER RPCs may write
-- (no INSERT/UPDATE/DELETE policy = denied for authenticated, denied for anon)

-- ============================================================================
-- 6) RPC: create_and_send_transfer
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_and_send_transfer(
  p_source_warehouse_id uuid,
  p_destination_warehouse_id uuid,
  p_lines jsonb,         -- [{ "source_item_id": uuid, "qty": number, "notes": text? }]
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_transfer_id uuid;
  v_transfer_no text;
  v_line jsonb;
  v_src_item record;
  v_dest_item public.inventory_items%ROWTYPE;
  v_qty numeric;
  v_src_mv_id uuid;
  v_dest_mv_id uuid;
  v_lines_created int := 0;
  v_audit jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT (
    public.has_role(v_uid, 'general_manager')
    OR public.has_role(v_uid, 'executive_manager')
    OR public.has_role(v_uid, 'warehouse_supervisor')
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;

  IF p_source_warehouse_id = p_destination_warehouse_id THEN
    RAISE EXCEPTION 'same_warehouse';
  END IF;

  IF jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'no_lines';
  END IF;

  v_transfer_no := public.gen_transfer_no();

  INSERT INTO public.warehouse_transfers(
    transfer_no, source_warehouse_id, destination_warehouse_id,
    status, created_by, sent_by, sent_at, notes, audit_log
  ) VALUES (
    v_transfer_no, p_source_warehouse_id, p_destination_warehouse_id,
    'pending_receipt', v_uid, v_uid, now(), p_notes,
    jsonb_build_array(jsonb_build_object(
      'event','created_and_sent','by',v_uid,'at',now()
    ))
  ) RETURNING id INTO v_transfer_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := (v_line->>'qty')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_src_item FROM public.inventory_items
      WHERE id = (v_line->>'source_item_id')::uuid
        AND warehouse_id = p_source_warehouse_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'source_item_not_found: %', v_line->>'source_item_id';
    END IF;
    IF v_src_item.stock < v_qty THEN
      RAISE EXCEPTION 'insufficient_stock: % (have %, need %)', v_src_item.name, v_src_item.stock, v_qty;
    END IF;

    -- ensure destination item exists (by trimmed name)
    SELECT * INTO v_dest_item FROM public.inventory_items
      WHERE warehouse_id = p_destination_warehouse_id
        AND trim(name) = trim(v_src_item.name)
      LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO public.inventory_items(
        warehouse_id, name, category, sku, unit, stock,
        low_stock_threshold, unit_cost
      ) VALUES (
        p_destination_warehouse_id, v_src_item.name, v_src_item.category, v_src_item.sku,
        v_src_item.unit, 0, v_src_item.low_stock_threshold, v_src_item.unit_cost
      ) RETURNING * INTO v_dest_item;
    END IF;

    -- 1) source: transfer-out (existing trigger decrements stock)
    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, movement_type, quantity,
      destination_warehouse_id, unit_cost, performed_by,
      notes, reference
    ) VALUES (
      v_src_item.id, p_source_warehouse_id, 'transfer', v_qty,
      p_destination_warehouse_id, v_src_item.unit_cost, v_uid,
      'تحويل (' || v_transfer_no || ')', v_transfer_no
    ) RETURNING id INTO v_src_mv_id;

    -- 2) destination: in (existing trigger increments stock)
    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, movement_type, quantity,
      unit_cost, performed_by, notes, reference
    ) VALUES (
      v_dest_item.id, p_destination_warehouse_id, 'in', v_qty,
      v_src_item.unit_cost, v_uid,
      'استلام تحويل (' || v_transfer_no || ')', v_transfer_no
    ) RETURNING id INTO v_dest_mv_id;

    INSERT INTO public.warehouse_transfer_items(
      transfer_id, source_item_id, destination_item_id, item_name, unit,
      requested_qty, sent_qty, unit_cost, total_cost,
      source_movement_id, destination_movement_id
    ) VALUES (
      v_transfer_id, v_src_item.id, v_dest_item.id, v_src_item.name, v_src_item.unit,
      v_qty, v_qty, v_src_item.unit_cost, v_qty * COALESCE(v_src_item.unit_cost, 0),
      v_src_mv_id, v_dest_mv_id
    );

    v_lines_created := v_lines_created + 1;
  END LOOP;

  IF v_lines_created = 0 THEN
    RAISE EXCEPTION 'no_valid_lines';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'transfer_id', v_transfer_id,
    'transfer_no', v_transfer_no,
    'lines', v_lines_created
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_and_send_transfer(uuid,uuid,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_and_send_transfer(uuid,uuid,jsonb,text) TO authenticated;

-- ============================================================================
-- 7) RPC: confirm_transfer_receipt  (STATUS-ONLY, NEVER touches stock)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.confirm_transfer_receipt(
  p_transfer_id uuid,
  p_lines jsonb,   -- [{ "line_id": uuid, "received_qty": number, "notes": text? }]
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_t public.warehouse_transfers%ROWTYPE;
  v_line jsonb;
  v_li public.warehouse_transfer_items%ROWTYPE;
  v_rq numeric;
  v_total_sent numeric := 0;
  v_total_recv numeric := 0;
  v_new_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT (
    public.has_role(v_uid, 'general_manager')
    OR public.has_role(v_uid, 'executive_manager')
    OR public.has_role(v_uid, 'warehouse_supervisor')
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;

  SELECT * INTO v_t FROM public.warehouse_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_not_found'; END IF;

  -- Idempotent: already finalized
  IF v_t.status IN ('received','partially_received') THEN
    RETURN jsonb_build_object('ok', true, 'already_received', true, 'status', v_t.status);
  END IF;
  IF v_t.status = 'cancelled' THEN
    RAISE EXCEPTION 'transfer_cancelled';
  END IF;

  -- Apply per-line updates (status/metadata ONLY — no stock writes anywhere below)
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_li FROM public.warehouse_transfer_items
      WHERE id = (v_line->>'line_id')::uuid AND transfer_id = p_transfer_id
      FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_rq := COALESCE((v_line->>'received_qty')::numeric, v_li.sent_qty);
    IF v_rq < 0 THEN v_rq := 0; END IF;
    IF v_rq > v_li.sent_qty THEN v_rq := v_li.sent_qty; END IF;

    -- Require notes when received_qty differs from sent_qty
    IF v_rq <> v_li.sent_qty
       AND COALESCE(trim(v_line->>'notes'), '') = '' THEN
      RAISE EXCEPTION 'notes_required_for_partial: %', v_li.item_name;
    END IF;

    UPDATE public.warehouse_transfer_items
       SET received_qty = v_rq,
           receive_notes = NULLIF(v_line->>'notes','')
     WHERE id = v_li.id;
  END LOOP;

  -- Decide header status
  SELECT COALESCE(SUM(sent_qty),0), COALESCE(SUM(received_qty),0)
    INTO v_total_sent, v_total_recv
  FROM public.warehouse_transfer_items WHERE transfer_id = p_transfer_id;

  IF v_total_recv = v_total_sent THEN v_new_status := 'received';
  ELSIF v_total_recv = 0           THEN v_new_status := 'pending_receipt';
  ELSE                                  v_new_status := 'partially_received';
  END IF;

  UPDATE public.warehouse_transfers
     SET status = v_new_status,
         received_by = v_uid,
         received_at = now(),
         notes = COALESCE(p_notes, notes),
         audit_log = audit_log || jsonb_build_array(jsonb_build_object(
           'event','receipt_confirmed','by',v_uid,'at',now(),
           'total_sent',v_total_sent,'total_received',v_total_recv,
           'status',v_new_status
         ))
   WHERE id = p_transfer_id;

  RETURN jsonb_build_object(
    'ok', true,
    'status', v_new_status,
    'total_sent', v_total_sent,
    'total_received', v_total_recv
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_transfer_receipt(uuid,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_transfer_receipt(uuid,jsonb,text) TO authenticated;

-- ============================================================================
-- 8) RPC: cancel_transfer (blocked once stock has posted)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_transfer(
  p_transfer_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_t public.warehouse_transfers%ROWTYPE;
  v_has_movements boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  IF NOT (
    public.has_role(v_uid, 'general_manager')
    OR public.has_role(v_uid, 'executive_manager')
    OR public.has_role(v_uid, 'warehouse_supervisor')
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;

  IF COALESCE(trim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  SELECT * INTO v_t FROM public.warehouse_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_not_found'; END IF;

  IF v_t.status IN ('received','partially_received','cancelled') THEN
    RAISE EXCEPTION 'cannot_cancel_in_status: %', v_t.status;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.warehouse_transfer_items
    WHERE transfer_id = p_transfer_id
      AND (source_movement_id IS NOT NULL OR destination_movement_id IS NOT NULL)
  ) INTO v_has_movements;

  IF v_has_movements THEN
    RAISE EXCEPTION 'stock_already_posted_use_manager_reversal';
  END IF;

  UPDATE public.warehouse_transfers
     SET status = 'cancelled',
         cancelled_by = v_uid,
         cancelled_at = now(),
         cancel_reason = p_reason,
         audit_log = audit_log || jsonb_build_array(jsonb_build_object(
           'event','cancelled','by',v_uid,'at',now(),'reason',p_reason
         ))
   WHERE id = p_transfer_id;

  RETURN jsonb_build_object('ok', true, 'status','cancelled');
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_transfer(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_transfer(uuid,text) TO authenticated;

-- ============================================================================
-- 9) BACKFILL existing clean pairs (METADATA ONLY — no stock writes)
-- ============================================================================
DO $$
DECLARE
  v_src record;
  v_dest record;
  v_transfer_id uuid;
  v_no text;
  v_count int := 0;
  v_src_item public.inventory_items%ROWTYPE;
  v_dest_item public.inventory_items%ROWTYPE;
BEGIN
  FOR v_src IN
    SELECT m.* FROM public.inventory_movements m
    WHERE m.movement_type = 'transfer'
      AND m.destination_warehouse_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.warehouse_transfer_items wti
        WHERE wti.source_movement_id = m.id
      )
    ORDER BY m.performed_at ASC
  LOOP
    SELECT * INTO v_src_item FROM public.inventory_items WHERE id = v_src.item_id;
    IF v_src_item IS NULL THEN CONTINUE; END IF;

    -- find paired destination 'in' movement: same qty, same performed_by,
    -- within 2 seconds, matching item name in destination warehouse
    SELECT m.* INTO v_dest
    FROM public.inventory_movements m
    JOIN public.inventory_items i ON i.id = m.item_id
    WHERE m.movement_type = 'in'
      AND m.warehouse_id = v_src.destination_warehouse_id
      AND m.quantity = v_src.quantity
      AND m.performed_by IS NOT DISTINCT FROM v_src.performed_by
      AND ABS(EXTRACT(EPOCH FROM (m.performed_at - v_src.performed_at))) <= 2
      AND trim(i.name) = trim(v_src_item.name)
      AND NOT EXISTS (
        SELECT 1 FROM public.warehouse_transfer_items wti
        WHERE wti.destination_movement_id = m.id
      )
    ORDER BY ABS(EXTRACT(EPOCH FROM (m.performed_at - v_src.performed_at))) ASC
    LIMIT 1;

    v_no := 'TR-BF-' || lpad((v_count + 1)::text, 4, '0');

    IF v_dest.id IS NOT NULL THEN
      SELECT * INTO v_dest_item FROM public.inventory_items WHERE id = v_dest.item_id;

      INSERT INTO public.warehouse_transfers(
        transfer_no, source_warehouse_id, destination_warehouse_id,
        status, created_by, sent_by, received_by,
        created_at, sent_at, received_at, notes, audit_log
      ) VALUES (
        v_no, v_src.warehouse_id, v_src.destination_warehouse_id,
        'received', v_src.performed_by, v_src.performed_by, v_src.performed_by,
        v_src.performed_at, v_src.performed_at, v_dest.performed_at,
        'Backfilled from existing movement pair',
        jsonb_build_array(jsonb_build_object(
          'event','backfilled','at',now(),'kind','clean_pair'
        ))
      ) RETURNING id INTO v_transfer_id;

      INSERT INTO public.warehouse_transfer_items(
        transfer_id, source_item_id, destination_item_id, item_name, unit,
        requested_qty, sent_qty, received_qty,
        unit_cost, total_cost,
        source_movement_id, destination_movement_id
      ) VALUES (
        v_transfer_id, v_src.item_id, v_dest.item_id, v_src_item.name, v_src_item.unit,
        v_src.quantity, v_src.quantity, v_src.quantity,
        v_src.unit_cost, v_src.quantity * COALESCE(v_src.unit_cost, 0),
        v_src.id, v_dest.id
      );
    ELSE
      INSERT INTO public.warehouse_transfers(
        transfer_no, source_warehouse_id, destination_warehouse_id,
        status, created_by, sent_by,
        created_at, sent_at, notes, audit_log
      ) VALUES (
        v_no, v_src.warehouse_id, v_src.destination_warehouse_id,
        'needs_manager_review', v_src.performed_by, v_src.performed_by,
        v_src.performed_at, v_src.performed_at,
        'Backfilled — no matching destination movement found',
        jsonb_build_array(jsonb_build_object(
          'event','backfilled','at',now(),'kind','no_pair'
        ))
      ) RETURNING id INTO v_transfer_id;

      INSERT INTO public.warehouse_transfer_items(
        transfer_id, source_item_id, item_name, unit,
        requested_qty, sent_qty,
        unit_cost, total_cost, source_movement_id
      ) VALUES (
        v_transfer_id, v_src.item_id, v_src_item.name, v_src_item.unit,
        v_src.quantity, v_src.quantity,
        v_src.unit_cost, v_src.quantity * COALESCE(v_src.unit_cost, 0),
        v_src.id
      );
    END IF;

    v_count := v_count + 1;
  END LOOP;
END$$;
