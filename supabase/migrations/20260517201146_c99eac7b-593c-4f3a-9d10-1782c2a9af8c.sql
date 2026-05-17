
-- 1) Quality status per output
ALTER TABLE public.slaughter_batch_outputs
  ADD COLUMN IF NOT EXISTS quality_status text NOT NULL DEFAULT 'accepted';

ALTER TABLE public.slaughter_batch_outputs
  DROP CONSTRAINT IF EXISTS slaughter_batch_outputs_quality_status_check;
ALTER TABLE public.slaughter_batch_outputs
  ADD CONSTRAINT slaughter_batch_outputs_quality_status_check
  CHECK (quality_status IN ('accepted','rejected','quarantine'));

-- 2) Update receive function to honor quality status
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
  v_added boolean := false;
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

  IF v_out.quality_status = 'accepted' THEN
    -- find or update matching inventory item by name in target warehouse (no duplicates)
    SELECT id INTO v_item_id
    FROM public.inventory_items
    WHERE warehouse_id = p_warehouse_id AND name = v_out.cut_name_ar
    LIMIT 1;

    IF v_item_id IS NULL THEN
      INSERT INTO public.inventory_items (warehouse_id, name, category, unit, stock, unit_cost, low_stock_threshold)
      VALUES (p_warehouse_id, v_out.cut_name_ar, 'لحوم', 'كجم', 0, COALESCE(v_out.unit_cost,0), 5)
      RETURNING id INTO v_item_id;
    END IF;

    -- inventory_movements trigger updates stock on the existing item (no new item created)
    INSERT INTO public.inventory_movements (item_id, warehouse_id, movement_type, quantity, reference, party, unit_cost, performed_by, notes)
    VALUES (
      v_item_id, p_warehouse_id, 'in', v_out.actual_weight_kg,
      'استلام من دفعة ذبح ' || COALESCE(v_batch_no,''),
      'المجزر', COALESCE(v_out.unit_cost,0), v_uid,
      'استلام صنف ' || v_out.cut_name_ar || ' — جودة: مقبول'
    );
    v_added := true;
  END IF;

  UPDATE public.slaughter_batch_outputs
  SET received_status = 'received',
      received_at = now(),
      received_by = v_uid,
      received_warehouse_id = p_warehouse_id,
      received_inventory_item_id = v_item_id
  WHERE id = p_output_id;

  INSERT INTO public.slaughter_audit_log (action, target_type, target_id, batch_id, performed_by, new_value, notes)
  VALUES ('warehouse_receipt', 'output', p_output_id, v_out.batch_id, v_uid,
          jsonb_build_object(
            'warehouse_id', p_warehouse_id,
            'item_id', v_item_id,
            'qty', v_out.actual_weight_kg,
            'quality_status', v_out.quality_status,
            'added_to_stock', v_added
          ),
          format('استلام %s كجم من صنف %s (جودة: %s)%s',
                 v_out.actual_weight_kg, v_out.cut_name_ar, v_out.quality_status,
                 CASE WHEN v_added THEN '' ELSE ' — لم يُضف للمخزون' END));

  RETURN jsonb_build_object('success', true, 'item_id', v_item_id, 'quantity', v_out.actual_weight_kg, 'added_to_stock', v_added);
END;
$$;

-- 3) Bulk receive: receive an entire batch in one call
CREATE OR REPLACE FUNCTION public.receive_slaughter_batch(p_batch_id uuid, p_warehouse_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_count int := 0;
  v_added int := 0;
  v_total numeric := 0;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'warehouse_supervisor'::app_role
  ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: غير مصرح لك باستلام مخرجات المجزر';
  END IF;

  FOR r IN
    SELECT id, actual_weight_kg, quality_status
    FROM public.slaughter_batch_outputs
    WHERE batch_id = p_batch_id
      AND destination = 'warehouse'
      AND received_status <> 'received'
  LOOP
    PERFORM public.receive_slaughter_output(r.id, p_warehouse_id);
    v_count := v_count + 1;
    v_total := v_total + COALESCE(r.actual_weight_kg, 0);
    IF r.quality_status = 'accepted' THEN v_added := v_added + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'received_count', v_count, 'added_to_stock', v_added, 'total_kg', v_total);
END;
$$;
