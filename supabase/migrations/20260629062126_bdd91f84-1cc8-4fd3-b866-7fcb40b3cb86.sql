
-- M5-B: Tighten warehouse transfer permissions (Main ↔ Agouza)
-- Adds two SECURITY DEFINER helpers and rewires request/confirm RPCs to use them.
-- Does NOT change inventory, movements, statuses, or approve logic.

-- 1) Helper: can_receive_warehouse_transfer
CREATE OR REPLACE FUNCTION public.can_receive_warehouse_transfer(
  _uid uuid,
  _destination_warehouse_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.has_role(_uid, 'general_manager'::app_role)
    OR public.has_role(_uid, 'executive_manager'::app_role)
    OR (
      public.has_role(_uid, 'agouza_warehouse_keeper'::app_role)
      AND EXISTS (
        SELECT 1 FROM public.warehouses w
        WHERE w.id = _destination_warehouse_id
          AND w.name ILIKE '%العجوزة%'
      )
    )
    OR (
      public.has_role(_uid, 'warehouse_supervisor'::app_role)
      AND EXISTS (
        SELECT 1 FROM public.warehouses w
        WHERE w.id = _destination_warehouse_id
          AND w.name NOT ILIKE '%العجوزة%'
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_receive_warehouse_transfer(uuid, uuid) TO authenticated, service_role;

-- 2) Helper: can_request_warehouse_transfer
CREATE OR REPLACE FUNCTION public.can_request_warehouse_transfer(
  _uid uuid,
  _src uuid,
  _dest uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.has_role(_uid, 'general_manager'::app_role)
    OR public.has_role(_uid, 'executive_manager'::app_role)
    OR (
      public.has_role(_uid, 'agouza_warehouse_keeper'::app_role)
      AND EXISTS (
        SELECT 1 FROM public.warehouses w
        WHERE (w.id = _src OR w.id = _dest)
          AND w.name ILIKE '%العجوزة%'
      )
    )
    OR (
      public.has_role(_uid, 'warehouse_supervisor'::app_role)
      AND EXISTS (
        SELECT 1 FROM public.warehouses w
        WHERE (w.id = _src OR w.id = _dest)
          AND w.name NOT ILIKE '%العجوزة%'
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_request_warehouse_transfer(uuid, uuid, uuid) TO authenticated, service_role;

-- 3) Rewire request_warehouse_transfer to enforce can_request_*
CREATE OR REPLACE FUNCTION public.request_warehouse_transfer(
  p_source_warehouse_id uuid,
  p_destination_warehouse_id uuid,
  p_lines jsonb,
  p_notes text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_transfer_id uuid;
  v_transfer_no text;
  v_line jsonb;
  v_src_item record;
  v_qty numeric;
  v_lines_created int := 0;
  v_dest_name text;
  v_src_name text;
  v_hadi_id uuid;
  v_supervisor_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  IF NOT public.can_request_warehouse_transfer(v_uid, p_source_warehouse_id, p_destination_warehouse_id) THEN
    RAISE EXCEPTION 'insufficient_privilege_request_transfer';
  END IF;

  IF p_source_warehouse_id = p_destination_warehouse_id THEN
    RAISE EXCEPTION 'same_warehouse';
  END IF;
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'no_lines';
  END IF;

  v_transfer_no := public.gen_transfer_no();

  INSERT INTO public.warehouse_transfers(
    transfer_no, source_warehouse_id, destination_warehouse_id,
    status, created_by, notes, legacy_dual_post, audit_log
  ) VALUES (
    v_transfer_no, p_source_warehouse_id, p_destination_warehouse_id,
    'pending_approval', v_uid, p_notes, false,
    jsonb_build_array(jsonb_build_object('event','requested','by',v_uid,'at',now()))
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

    INSERT INTO public.warehouse_transfer_items(
      transfer_id, source_item_id, item_name, unit,
      requested_qty, unit_cost, total_cost, line_status
    ) VALUES (
      v_transfer_id, v_src_item.id, v_src_item.name, v_src_item.unit,
      v_qty, v_src_item.unit_cost, v_qty * COALESCE(v_src_item.unit_cost, 0),
      'pending_approval'
    );
    v_lines_created := v_lines_created + 1;
  END LOOP;

  SELECT name INTO v_dest_name FROM public.warehouses WHERE id = p_destination_warehouse_id;
  SELECT name INTO v_src_name  FROM public.warehouses WHERE id = p_source_warehouse_id;

  SELECT id INTO v_hadi_id FROM public.profiles WHERE email = 'abdelhady.ali@coceg.net' LIMIT 1;
  IF v_hadi_id IS NOT NULL THEN
    INSERT INTO public.notifications(title, description, type, target_user_id)
    VALUES (
      'طلب توريد جديد — ' || v_transfer_no,
      'يوجد طلب توريد بانتظار موافقتك من ' || COALESCE(v_src_name,'') ||
      ' إلى ' || COALESCE(v_dest_name,'') || ' (' || v_lines_created || ' صنف).',
      'warehouse_transfer',
      v_hadi_id
    );
  END IF;

  FOR v_supervisor_id IN
    SELECT ur.user_id FROM public.user_roles ur
     WHERE ur.role = 'warehouse_supervisor'::app_role
       AND (v_hadi_id IS NULL OR ur.user_id <> v_hadi_id)
  LOOP
    INSERT INTO public.notifications(title, description, type, target_user_id)
    VALUES (
      'طلب توريد جديد — ' || v_transfer_no,
      'يوجد طلب توريد بانتظار الموافقة من ' || COALESCE(v_src_name,'') ||
      ' إلى ' || COALESCE(v_dest_name,'') || ' (' || v_lines_created || ' صنف).',
      'warehouse_transfer',
      v_supervisor_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'transfer_id', v_transfer_id,
    'transfer_no', v_transfer_no,
    'lines', v_lines_created
  );
END;
$function$;

-- 4) Rewire confirm_transfer_receipt to enforce can_receive_*
CREATE OR REPLACE FUNCTION public.confirm_transfer_receipt(
  p_transfer_id uuid,
  p_lines jsonb,
  p_notes text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
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

  SELECT * INTO v_t FROM public.warehouse_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_not_found'; END IF;

  IF NOT public.can_receive_warehouse_transfer(v_uid, v_t.destination_warehouse_id) THEN
    RAISE EXCEPTION 'insufficient_privilege_receive_transfer';
  END IF;

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

    IF v_li.line_status IN ('received','partial','rejected') THEN CONTINUE; END IF;

    v_rq := COALESCE((v_line->>'received_qty')::numeric, v_li.sent_qty);
    IF v_rq < 0 THEN v_rq := 0; END IF;
    IF v_rq > v_li.sent_qty THEN v_rq := v_li.sent_qty; END IF;

    IF v_rq <> v_li.sent_qty
       AND COALESCE(trim(v_line->>'notes'), '') = '' THEN
      RAISE EXCEPTION 'notes_required_for_partial: %', v_li.item_name;
    END IF;

    v_dest_mv_id := NULL;

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
$function$;
