
-- 1) Schema extensions
ALTER TABLE public.warehouse_transfers
  ADD COLUMN IF NOT EXISTS legacy_dual_post boolean NOT NULL DEFAULT false;

ALTER TABLE public.warehouse_transfer_items
  ADD COLUMN IF NOT EXISTS line_status text NOT NULL DEFAULT 'pending'
    CHECK (line_status IN ('pending','received','partial','rejected'));

-- Mark the 3 historical backfilled transfers as legacy (both movements already posted)
UPDATE public.warehouse_transfers
   SET legacy_dual_post = true
 WHERE transfer_no LIKE 'TR-BF-%';

UPDATE public.warehouse_transfer_items wti
   SET line_status = 'received'
  FROM public.warehouse_transfers wt
 WHERE wti.transfer_id = wt.id
   AND wt.legacy_dual_post = true;

-- 2) create_and_send_transfer — SOURCE movement only
CREATE OR REPLACE FUNCTION public.create_and_send_transfer(
  p_source_warehouse_id uuid,
  p_destination_warehouse_id uuid,
  p_lines jsonb,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_transfer_id uuid;
  v_transfer_no text;
  v_line jsonb;
  v_src_item record;
  v_dest_item public.inventory_items%ROWTYPE;
  v_qty numeric;
  v_src_mv_id uuid;
  v_lines_created int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

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
    status, created_by, sent_by, sent_at, notes,
    legacy_dual_post, audit_log
  ) VALUES (
    v_transfer_no, p_source_warehouse_id, p_destination_warehouse_id,
    'pending_receipt', v_uid, v_uid, now(), p_notes,
    false,
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

    -- Pre-provision destination row (stock stays 0 until receipt)
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

    -- SOURCE OUT only (trigger decrements source stock). NO destination movement here.
    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, movement_type, quantity,
      destination_warehouse_id, unit_cost, performed_by,
      notes, reference
    ) VALUES (
      v_src_item.id, p_source_warehouse_id, 'transfer', v_qty,
      p_destination_warehouse_id, v_src_item.unit_cost, v_uid,
      'تحويل صادر (' || v_transfer_no || ')', v_transfer_no
    ) RETURNING id INTO v_src_mv_id;

    INSERT INTO public.warehouse_transfer_items(
      transfer_id, source_item_id, destination_item_id, item_name, unit,
      requested_qty, sent_qty, unit_cost, total_cost,
      source_movement_id, destination_movement_id, line_status
    ) VALUES (
      v_transfer_id, v_src_item.id, v_dest_item.id, v_src_item.name, v_src_item.unit,
      v_qty, v_qty, v_src_item.unit_cost, v_qty * COALESCE(v_src_item.unit_cost, 0),
      v_src_mv_id, NULL, 'pending'
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

-- 3) confirm_transfer_receipt — now posts destination IN movements
CREATE OR REPLACE FUNCTION public.confirm_transfer_receipt(
  p_transfer_id uuid,
  p_lines jsonb,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_t public.warehouse_transfers%ROWTYPE;
  v_line jsonb;
  v_li public.warehouse_transfer_items%ROWTYPE;
  v_rq numeric;
  v_total_sent numeric := 0;
  v_total_recv numeric := 0;
  v_new_status text;
  v_dest_mv_id uuid;
  v_line_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  IF NOT (
    public.has_role(v_uid, 'general_manager')
    OR public.has_role(v_uid, 'executive_manager')
    OR public.has_role(v_uid, 'warehouse_supervisor')
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;

  SELECT * INTO v_t FROM public.warehouse_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_not_found'; END IF;

  IF v_t.status IN ('received','partially_received') THEN
    RETURN jsonb_build_object('ok', true, 'already_received', true, 'status', v_t.status);
  END IF;
  IF v_t.status = 'cancelled' THEN
    RAISE EXCEPTION 'transfer_cancelled';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_li FROM public.warehouse_transfer_items
      WHERE id = (v_line->>'line_id')::uuid AND transfer_id = p_transfer_id
      FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    -- Skip lines already rejected/received
    IF v_li.line_status IN ('received','partial','rejected') THEN CONTINUE; END IF;

    v_rq := COALESCE((v_line->>'received_qty')::numeric, v_li.sent_qty);
    IF v_rq < 0 THEN v_rq := 0; END IF;
    IF v_rq > v_li.sent_qty THEN v_rq := v_li.sent_qty; END IF;

    IF v_rq <> v_li.sent_qty
       AND COALESCE(trim(v_line->>'notes'), '') = '' THEN
      RAISE EXCEPTION 'notes_required_for_partial: %', v_li.item_name;
    END IF;

    v_dest_mv_id := NULL;

    -- Post destination IN movement ONLY for new (non-legacy) transfers, and only if rq>0
    IF v_t.legacy_dual_post = false AND v_rq > 0 AND v_li.destination_movement_id IS NULL THEN
      INSERT INTO public.inventory_movements(
        item_id, warehouse_id, movement_type, quantity,
        unit_cost, performed_by, notes, reference
      ) VALUES (
        v_li.destination_item_id, v_t.destination_warehouse_id, 'in', v_rq,
        v_li.unit_cost, v_uid,
        'استلام تحويل (' || v_t.transfer_no || ')'
          || CASE WHEN v_rq <> v_li.sent_qty
                  THEN ' — مستلم ' || v_rq || ' من ' || v_li.sent_qty
                  ELSE '' END,
        v_t.transfer_no
      ) RETURNING id INTO v_dest_mv_id;
    END IF;

    IF v_rq = 0 THEN
      v_line_status := 'rejected';
    ELSIF v_rq = v_li.sent_qty THEN
      v_line_status := 'received';
    ELSE
      v_line_status := 'partial';
    END IF;

    UPDATE public.warehouse_transfer_items
       SET received_qty = v_rq,
           receive_notes = NULLIF(v_line->>'notes',''),
           destination_movement_id = COALESCE(destination_movement_id, v_dest_mv_id),
           line_status = v_line_status
     WHERE id = v_li.id;
  END LOOP;

  SELECT COALESCE(SUM(sent_qty),0), COALESCE(SUM(received_qty),0)
    INTO v_total_sent, v_total_recv
  FROM public.warehouse_transfer_items WHERE transfer_id = p_transfer_id;

  IF v_total_recv = v_total_sent THEN v_new_status := 'received';
  ELSIF v_total_recv = 0          THEN v_new_status := 'pending_receipt';
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
           'status',v_new_status,'legacy_dual_post',v_t.legacy_dual_post
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

-- 4) reject_transfer_line — refuse a whole line on quality, reverse source out
CREATE OR REPLACE FUNCTION public.reject_transfer_line(
  p_line_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_li public.warehouse_transfer_items%ROWTYPE;
  v_t  public.warehouse_transfers%ROWTYPE;
  v_rev_mv_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT (
    public.has_role(v_uid, 'general_manager')
    OR public.has_role(v_uid, 'executive_manager')
    OR public.has_role(v_uid, 'warehouse_supervisor')
  ) THEN RAISE EXCEPTION 'insufficient_privilege'; END IF;

  IF COALESCE(trim(p_reason),'') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;

  SELECT * INTO v_li FROM public.warehouse_transfer_items WHERE id = p_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'line_not_found'; END IF;

  SELECT * INTO v_t FROM public.warehouse_transfers WHERE id = v_li.transfer_id FOR UPDATE;
  IF v_t.legacy_dual_post THEN RAISE EXCEPTION 'legacy_transfer_cannot_reject'; END IF;
  IF v_li.line_status IN ('received','partial','rejected') THEN
    RAISE EXCEPTION 'line_already_finalized: %', v_li.line_status;
  END IF;

  -- Reverse the source-out by posting an IN back to source
  INSERT INTO public.inventory_movements(
    item_id, warehouse_id, movement_type, quantity,
    unit_cost, performed_by, notes, reference
  ) VALUES (
    v_li.source_item_id, v_t.source_warehouse_id, 'in', v_li.sent_qty,
    v_li.unit_cost, v_uid,
    'رفض سطر تحويل (' || v_t.transfer_no || ') — ' || p_reason,
    v_t.transfer_no
  ) RETURNING id INTO v_rev_mv_id;

  UPDATE public.warehouse_transfer_items
     SET received_qty = 0,
         line_status = 'rejected',
         receive_notes = p_reason
   WHERE id = p_line_id;

  UPDATE public.warehouse_transfers
     SET audit_log = audit_log || jsonb_build_array(jsonb_build_object(
           'event','line_rejected','by',v_uid,'at',now(),
           'line_id',p_line_id,'reason',p_reason,'reversal_movement_id',v_rev_mv_id
         ))
   WHERE id = v_t.id;

  RETURN jsonb_build_object('ok', true, 'reversal_movement_id', v_rev_mv_id);
END;
$$;

-- 5) cancel_transfer — now safe to cancel after send (reverses source out for non-legacy)
CREATE OR REPLACE FUNCTION public.cancel_transfer(
  p_transfer_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_t public.warehouse_transfers%ROWTYPE;
  v_li public.warehouse_transfer_items%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  IF NOT (
    public.has_role(v_uid, 'general_manager')
    OR public.has_role(v_uid, 'executive_manager')
    OR public.has_role(v_uid, 'warehouse_supervisor')
  ) THEN RAISE EXCEPTION 'insufficient_privilege'; END IF;

  IF COALESCE(trim(p_reason),'') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;

  SELECT * INTO v_t FROM public.warehouse_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_not_found'; END IF;

  IF v_t.status IN ('received','partially_received','cancelled') THEN
    RAISE EXCEPTION 'cannot_cancel_in_status: %', v_t.status;
  END IF;

  IF v_t.legacy_dual_post THEN
    RAISE EXCEPTION 'legacy_transfer_use_manager_reversal';
  END IF;

  -- Reverse every pending line's source-out
  FOR v_li IN SELECT * FROM public.warehouse_transfer_items
              WHERE transfer_id = p_transfer_id AND line_status = 'pending'
  LOOP
    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, movement_type, quantity,
      unit_cost, performed_by, notes, reference
    ) VALUES (
      v_li.source_item_id, v_t.source_warehouse_id, 'in', v_li.sent_qty,
      v_li.unit_cost, v_uid,
      'إلغاء تحويل (' || v_t.transfer_no || ') — ' || p_reason,
      v_t.transfer_no
    );

    UPDATE public.warehouse_transfer_items
       SET line_status = 'rejected', received_qty = 0,
           receive_notes = 'إلغاء التحويل: ' || p_reason
     WHERE id = v_li.id;
  END LOOP;

  UPDATE public.warehouse_transfers
     SET status = 'cancelled',
         cancelled_by = v_uid,
         cancelled_at = now(),
         cancel_reason = p_reason,
         audit_log = audit_log || jsonb_build_array(jsonb_build_object(
           'event','cancelled_with_reversal','by',v_uid,'at',now(),'reason',p_reason
         ))
   WHERE id = p_transfer_id;

  RETURN jsonb_build_object('ok', true, 'status','cancelled');
END;
$$;
