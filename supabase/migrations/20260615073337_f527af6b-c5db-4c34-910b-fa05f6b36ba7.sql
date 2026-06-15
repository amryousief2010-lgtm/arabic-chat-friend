
-- 1) Duplicate guard for inbound-from-slaughter into meat factory raw inventory
CREATE UNIQUE INDEX IF NOT EXISTS uq_meat_moves_slaughter_output
  ON public.meat_factory_inventory_moves (ref_id, item_id, direction)
  WHERE ref_table = 'slaughter_batch_outputs';

-- 2) RPC: receive one slaughter output into meat_factory_raw_items + meat_factory_inventory_moves
CREATE OR REPLACE FUNCTION public.receive_slaughter_output_to_meat_factory(p_output_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_out public.slaughter_batch_outputs%ROWTYPE;
  v_uid uuid := auth.uid();
  v_item_id uuid;
  v_old_stock numeric := 0;
  v_old_cost numeric := 0;
  v_new_stock numeric;
  v_new_cost numeric;
  v_qty numeric;
  v_cost numeric;
  v_batch_no text;
BEGIN
  IF NOT public.has_any_role(v_uid, ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'meat_factory_manager'::app_role,
    'warehouse_supervisor'::app_role
  ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: غير مصرح لك باستلام مخرجات المجزر إلى مصنع اللحوم';
  END IF;

  SELECT * INTO v_out FROM public.slaughter_batch_outputs WHERE id = p_output_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OUTPUT_NOT_FOUND'; END IF;
  IF v_out.destination <> 'meat_factory' THEN
    RAISE EXCEPTION 'INVALID_DESTINATION: المخرج ليس موجها إلى مصنع اللحوم';
  END IF;
  IF v_out.received_status = 'received' THEN
    RAISE EXCEPTION 'ALREADY_RECEIVED: تم تسجيل هذا التحويل إلى مصنع اللحوم من قبل';
  END IF;
  IF v_out.quality_status <> 'accepted' THEN
    -- Just mark received (no stock add) for non-accepted quality
    UPDATE public.slaughter_batch_outputs
      SET received_status = 'received', received_at = now(), received_by = v_uid
      WHERE id = p_output_id;
    RETURN jsonb_build_object('success', true, 'added_to_stock', false, 'reason', 'non_accepted_quality');
  END IF;

  v_qty := COALESCE(v_out.actual_weight_kg, 0);
  v_cost := COALESCE(v_out.unit_cost, 0);

  SELECT batch_number INTO v_batch_no FROM public.slaughter_batches WHERE id = v_out.batch_id;

  -- Upsert raw item by name (kind=raw, unit=kg)
  SELECT id, current_stock, avg_cost INTO v_item_id, v_old_stock, v_old_cost
  FROM public.meat_factory_raw_items
  WHERE name = v_out.cut_name_ar AND kind = 'raw'
  LIMIT 1;

  IF v_item_id IS NULL THEN
    INSERT INTO public.meat_factory_raw_items (name, kind, unit, current_stock, avg_cost, low_stock_threshold)
    VALUES (v_out.cut_name_ar, 'raw', 'كجم', 0, 0, 5)
    RETURNING id, current_stock, avg_cost INTO v_item_id, v_old_stock, v_old_cost;
  END IF;

  -- Weighted-average cost
  IF (v_old_stock + v_qty) > 0 THEN
    v_new_cost := ((v_old_stock * v_old_cost) + (v_qty * v_cost)) / (v_old_stock + v_qty);
  ELSE
    v_new_cost := v_cost;
  END IF;
  v_new_stock := v_old_stock + v_qty;

  UPDATE public.meat_factory_raw_items
    SET current_stock = v_new_stock, avg_cost = v_new_cost, updated_at = now()
    WHERE id = v_item_id;

  -- Inbound movement (unique on ref_id + item_id + direction WHERE ref_table='slaughter_batch_outputs')
  INSERT INTO public.meat_factory_inventory_moves
    (item_kind, item_id, item_name, direction, quantity, unit_cost, reason, ref_table, ref_id, created_by, stock_before, stock_after)
  VALUES
    ('raw', v_item_id, v_out.cut_name_ar, 'IN', v_qty, v_cost,
     'وارد من المجزر — دفعة ' || COALESCE(v_batch_no, ''),
     'slaughter_batch_outputs', p_output_id, v_uid, v_old_stock, v_new_stock);

  -- Mark output received
  UPDATE public.slaughter_batch_outputs
    SET received_status = 'received',
        received_at = now(),
        received_by = v_uid,
        received_warehouse_id = NULL
    WHERE id = p_output_id;

  -- Audit log
  INSERT INTO public.slaughter_audit_log
    (action, target_type, target_id, batch_id, performed_by, new_value, notes)
  VALUES
    ('meat_factory_receipt', 'output', p_output_id, v_out.batch_id, v_uid,
     jsonb_build_object('item_id', v_item_id, 'qty', v_qty, 'unit_cost', v_cost,
                        'stock_before', v_old_stock, 'stock_after', v_new_stock),
     'استلام في مصنع اللحوم: ' || v_out.cut_name_ar || ' — ' || v_qty || ' كجم');

  RETURN jsonb_build_object(
    'success', true,
    'added_to_stock', true,
    'item_id', v_item_id,
    'item_name', v_out.cut_name_ar,
    'qty', v_qty,
    'stock_before', v_old_stock,
    'stock_after', v_new_stock,
    'avg_cost', v_new_cost
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'ALREADY_RECEIVED: تم تسجيل هذا التحويل إلى مصنع اللحوم من قبل';
END;
$function$;

GRANT EXECUTE ON FUNCTION public.receive_slaughter_output_to_meat_factory(uuid) TO authenticated;
