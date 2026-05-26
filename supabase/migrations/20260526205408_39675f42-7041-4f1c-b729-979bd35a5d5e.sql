
-- Phase 1: Warehouse transfer approval workflow
-- 1) Add new columns for approval tracking
ALTER TABLE public.warehouse_transfers
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz;

ALTER TABLE public.warehouse_transfer_items
  ADD COLUMN IF NOT EXISTS approved_qty numeric;

-- 2) Authorization helper: who can approve transfers?
CREATE OR REPLACE FUNCTION public.can_approve_warehouse_transfer(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _uid
      AND ur.role IN ('general_manager','executive_manager','warehouse_supervisor')
  );
$$;

-- 3) Request a transfer (NO stock deduction; status = pending_approval)
CREATE OR REPLACE FUNCTION public.request_warehouse_transfer(
  p_source_warehouse_id uuid,
  p_destination_warehouse_id uuid,
  p_lines jsonb,
  p_notes text DEFAULT NULL
) RETURNS jsonb
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
  v_qty numeric;
  v_lines_created int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

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

  IF v_lines_created = 0 THEN RAISE EXCEPTION 'no_valid_lines'; END IF;

  RETURN jsonb_build_object('ok',true,'transfer_id',v_transfer_id,'transfer_no',v_transfer_no,'lines',v_lines_created,'status','pending_approval');
END;
$$;

-- 4) Approve (with optional qty adjustments) and ship from source warehouse
CREATE OR REPLACE FUNCTION public.approve_warehouse_transfer(
  p_transfer_id uuid,
  p_approved_lines jsonb DEFAULT NULL  -- [{line_id, approved_qty}] optional override
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_transfer record;
  v_line record;
  v_src_item record;
  v_dest_item public.inventory_items%ROWTYPE;
  v_approved numeric;
  v_override numeric;
  v_src_mv_id uuid;
  v_lines int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.can_approve_warehouse_transfer(v_uid) THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;

  SELECT * INTO v_transfer FROM public.warehouse_transfers
    WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_not_found'; END IF;
  IF v_transfer.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'invalid_status: %', v_transfer.status;
  END IF;

  FOR v_line IN
    SELECT ti.* FROM public.warehouse_transfer_items ti WHERE ti.transfer_id = p_transfer_id
  LOOP
    v_override := NULL;
    IF p_approved_lines IS NOT NULL THEN
      SELECT (x->>'approved_qty')::numeric INTO v_override
        FROM jsonb_array_elements(p_approved_lines) x
       WHERE (x->>'line_id')::uuid = v_line.id LIMIT 1;
    END IF;
    v_approved := COALESCE(v_override, v_line.requested_qty);
    IF v_approved IS NULL OR v_approved <= 0 THEN
      UPDATE public.warehouse_transfer_items
         SET approved_qty = 0, sent_qty = 0, line_status = 'rejected'
       WHERE id = v_line.id;
      CONTINUE;
    END IF;

    SELECT * INTO v_src_item FROM public.inventory_items
      WHERE id = v_line.source_item_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'source_item_missing: %', v_line.item_name;
    END IF;
    IF v_src_item.stock < v_approved THEN
      RAISE EXCEPTION 'insufficient_stock: % (have %, need %)', v_src_item.name, v_src_item.stock, v_approved;
    END IF;

    -- Pre-provision destination row
    SELECT * INTO v_dest_item FROM public.inventory_items
      WHERE warehouse_id = v_transfer.destination_warehouse_id
        AND trim(name) = trim(v_src_item.name) LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO public.inventory_items(warehouse_id,name,category,sku,unit,stock,low_stock_threshold,unit_cost)
        VALUES (v_transfer.destination_warehouse_id, v_src_item.name, v_src_item.category, v_src_item.sku, v_src_item.unit, 0, v_src_item.low_stock_threshold, v_src_item.unit_cost)
        RETURNING * INTO v_dest_item;
    END IF;

    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, movement_type, quantity, destination_warehouse_id,
      unit_cost, performed_by, notes, reference
    ) VALUES (
      v_src_item.id, v_transfer.source_warehouse_id, 'transfer', v_approved,
      v_transfer.destination_warehouse_id, v_src_item.unit_cost, v_uid,
      'تحويل صادر (' || v_transfer.transfer_no || ')', v_transfer.transfer_no
    ) RETURNING id INTO v_src_mv_id;

    UPDATE public.warehouse_transfer_items
       SET approved_qty = v_approved, sent_qty = v_approved,
           destination_item_id = v_dest_item.id, source_movement_id = v_src_mv_id,
           line_status = 'pending'
     WHERE id = v_line.id;
    v_lines := v_lines + 1;
  END LOOP;

  UPDATE public.warehouse_transfers
     SET status = 'pending_receipt', approved_by = v_uid, approved_at = now(),
         sent_by = v_uid, sent_at = now(),
         audit_log = COALESCE(audit_log,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('event','approved_and_sent','by',v_uid,'at',now(),'lines',v_lines))
   WHERE id = p_transfer_id;

  RETURN jsonb_build_object('ok',true,'transfer_id',p_transfer_id,'status','pending_receipt','lines',v_lines);
END;
$$;

-- 5) Reject a request
CREATE OR REPLACE FUNCTION public.reject_warehouse_transfer(
  p_transfer_id uuid, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_transfer record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.can_approve_warehouse_transfer(v_uid) THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  SELECT * INTO v_transfer FROM public.warehouse_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_not_found'; END IF;
  IF v_transfer.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'invalid_status: %', v_transfer.status;
  END IF;

  UPDATE public.warehouse_transfers
     SET status='rejected', rejected_by=v_uid, rejected_at=now(), rejection_reason=p_reason,
         audit_log = COALESCE(audit_log,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('event','rejected','by',v_uid,'at',now(),'reason',p_reason))
   WHERE id = p_transfer_id;
  UPDATE public.warehouse_transfer_items SET line_status='rejected' WHERE transfer_id = p_transfer_id;

  RETURN jsonb_build_object('ok',true,'transfer_id',p_transfer_id,'status','rejected');
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_approve_warehouse_transfer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_warehouse_transfer(uuid,uuid,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_warehouse_transfer(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_warehouse_transfer(uuid,text) TO authenticated;

-- Phase 2: Fulfillment source on orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fulfillment_type text;  -- 'pickup' | 'delivery'

-- Optional helper: detect shortages and create production_dispatch_orders for an order
CREATE OR REPLACE FUNCTION public.request_production_for_order_shortages(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_order record;
  v_item record;
  v_inv record;
  v_avail numeric;
  v_short numeric;
  v_created int := 0;
  v_creator_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT id, order_number, source_warehouse_id, shipping_company INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.source_warehouse_id IS NULL THEN RAISE EXCEPTION 'source_warehouse_unresolved'; END IF;

  SELECT full_name INTO v_creator_name FROM public.profiles WHERE id = v_uid;

  FOR v_item IN
    SELECT oi.id AS oi_id, oi.product_id, oi.product_name, oi.unit, oi.quantity::numeric AS qty
    FROM public.order_items oi WHERE oi.order_id = p_order_id
  LOOP
    IF v_item.product_id IS NULL THEN CONTINUE; END IF;
    SELECT id, stock, reserved_qty, blocked_qty INTO v_inv
      FROM public.inventory_items
     WHERE product_id = v_item.product_id AND warehouse_id = v_order.source_warehouse_id;
    v_avail := COALESCE(v_inv.stock,0) - COALESCE(v_inv.reserved_qty,0) - COALESCE(v_inv.blocked_qty,0);
    v_short := v_item.qty - v_avail;
    IF v_short > 0 THEN
      INSERT INTO public.production_dispatch_orders(
        product_id, product_name, unit, required_qty, current_stock,
        pending_qty, destination, priority, status, affected_orders,
        notes, created_by, created_by_name
      ) VALUES (
        v_item.product_id, v_item.product_name, v_item.unit, v_short, v_avail,
        v_short, COALESCE(v_order.shipping_company,'order'), 'high', 'pending',
        jsonb_build_array(jsonb_build_object('order_id',p_order_id,'order_number',v_order.order_number,'order_item_id',v_item.oi_id,'qty',v_item.qty)),
        'تلقائى من أوردر ' || v_order.order_number, v_uid, v_creator_name
      );
      v_created := v_created + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok',true,'order_id',p_order_id,'shortage_lines',v_created);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_production_for_order_shortages(uuid) TO authenticated;
