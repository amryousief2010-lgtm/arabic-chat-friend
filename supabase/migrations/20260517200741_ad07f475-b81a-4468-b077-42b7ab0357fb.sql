
-- Track warehouse receipts for slaughter outputs
ALTER TABLE public.slaughter_batch_outputs
  ADD COLUMN IF NOT EXISTS received_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS received_by uuid,
  ADD COLUMN IF NOT EXISTS received_warehouse_id uuid REFERENCES public.warehouses(id),
  ADD COLUMN IF NOT EXISTS received_inventory_item_id uuid REFERENCES public.inventory_items(id);

-- Mark non-warehouse outputs as not applicable
UPDATE public.slaughter_batch_outputs SET received_status = 'n/a' WHERE destination <> 'warehouse';

-- Function: warehouse supervisor receives a slaughter output into inventory
CREATE OR REPLACE FUNCTION public.receive_slaughter_output(p_output_id uuid, p_warehouse_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out public.slaughter_batch_outputs%ROWTYPE;
  v_item_id uuid;
  v_uid uuid := auth.uid();
  v_batch_no text;
BEGIN
  IF NOT public.has_any_role(v_uid, ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'warehouse_supervisor'::app_role
  ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: غير مصرح لك باستلام مخرجات المجزر';
  END IF;

  SELECT * INTO v_out FROM public.slaughter_batch_outputs WHERE id = p_output_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OUTPUT_NOT_FOUND'; END IF;
  IF v_out.destination <> 'warehouse' THEN RAISE EXCEPTION 'INVALID_DESTINATION: المخرج ليس موجها للمخزن'; END IF;
  IF v_out.received_status = 'received' THEN RAISE EXCEPTION 'ALREADY_RECEIVED: تم استلام هذا المخرج مسبقا'; END IF;
  IF p_warehouse_id IS NULL THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED: يجب اختيار المخزن'; END IF;

  SELECT batch_number INTO v_batch_no FROM public.slaughter_batches WHERE id = v_out.batch_id;

  -- find or create matching inventory item by name in target warehouse
  SELECT id INTO v_item_id
  FROM public.inventory_items
  WHERE warehouse_id = p_warehouse_id AND name = v_out.cut_name_ar
  LIMIT 1;

  IF v_item_id IS NULL THEN
    INSERT INTO public.inventory_items (warehouse_id, name, category, unit, stock, unit_cost, low_stock_threshold)
    VALUES (p_warehouse_id, v_out.cut_name_ar, 'لحوم', 'كجم', 0, COALESCE(v_out.unit_cost,0), 5)
    RETURNING id INTO v_item_id;
  END IF;

  -- movement triggers stock update via apply_inventory_movement
  INSERT INTO public.inventory_movements (item_id, warehouse_id, movement_type, quantity, reference, party, unit_cost, performed_by, notes)
  VALUES (
    v_item_id, p_warehouse_id, 'in', v_out.actual_weight_kg,
    'استلام من دفعة ذبح ' || COALESCE(v_batch_no,''),
    'المجزر', COALESCE(v_out.unit_cost,0), v_uid,
    'استلام صنف ' || v_out.cut_name_ar
  );

  UPDATE public.slaughter_batch_outputs
  SET received_status = 'received',
      received_at = now(),
      received_by = v_uid,
      received_warehouse_id = p_warehouse_id,
      received_inventory_item_id = v_item_id
  WHERE id = p_output_id;

  INSERT INTO public.slaughter_audit_log (action, target_type, target_id, batch_id, performed_by, new_value, notes)
  VALUES ('warehouse_receipt', 'output', p_output_id, v_out.batch_id, v_uid,
          jsonb_build_object('warehouse_id', p_warehouse_id, 'item_id', v_item_id, 'qty', v_out.actual_weight_kg),
          format('استلام %s كجم من صنف %s', v_out.actual_weight_kg, v_out.cut_name_ar));

  RETURN jsonb_build_object('success', true, 'item_id', v_item_id, 'quantity', v_out.actual_weight_kg);
END;
$$;
