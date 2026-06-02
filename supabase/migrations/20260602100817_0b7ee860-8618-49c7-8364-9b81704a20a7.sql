-- Allow slaughterhouse_manager and meat_factory_manager to dispatch/receive slaughter outputs
CREATE OR REPLACE FUNCTION public.transfer_slaughter_partial(p_batch_id uuid, p_warehouse_id uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  item jsonb;
  v_out public.slaughter_batch_outputs%ROWTYPE;
  v_qty numeric;
  v_count int := 0;
  v_total numeric := 0;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'warehouse_supervisor'::app_role,
    'slaughterhouse_manager'::app_role,
    'meat_factory_manager'::app_role,
    'production_manager'::app_role
  ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF p_warehouse_id IS NULL THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'ITEMS_REQUIRED';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_out FROM public.slaughter_batch_outputs
      WHERE id = (item->>'output_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF v_out.batch_id <> p_batch_id THEN CONTINUE; END IF;
    IF v_out.received_status = 'received' THEN CONTINUE; END IF;

    v_qty := COALESCE((item->>'qty')::numeric, 0);
    IF v_qty <= 0 THEN CONTINUE; END IF;
    IF v_qty > v_out.actual_weight_kg THEN v_qty := v_out.actual_weight_kg; END IF;

    IF v_qty < v_out.actual_weight_kg THEN
      INSERT INTO public.slaughter_batch_outputs(
        batch_id, yield_standard_id, cut_name_ar, product_id,
        actual_weight_kg, package_count, standard_weight_kg, unit_cost,
        expiry_date, destination, notes, branch_id, unit_price,
        received_status, quality_status, damaged_weight_kg, quarantined_weight_kg
      ) VALUES (
        v_out.batch_id, v_out.yield_standard_id, v_out.cut_name_ar, v_out.product_id,
        v_out.actual_weight_kg - v_qty, 0, 0, v_out.unit_cost,
        v_out.expiry_date, v_out.destination,
        COALESCE(v_out.notes,'') || ' (متبقي بعد توريد جزئي)',
        v_out.branch_id, v_out.unit_price,
        'pending', v_out.quality_status, 0, 0
      );
      UPDATE public.slaughter_batch_outputs
        SET actual_weight_kg = v_qty
        WHERE id = v_out.id;
    END IF;

    PERFORM public.receive_slaughter_output(v_out.id, p_warehouse_id);
    v_count := v_count + 1;
    v_total := v_total + v_qty;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'received_count', v_count, 'total_kg', v_total);
END;
$function$;

CREATE OR REPLACE FUNCTION public.receive_slaughter_output(p_output_id uuid, p_warehouse_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'warehouse_supervisor'::app_role,
    'slaughterhouse_manager'::app_role,
    'meat_factory_manager'::app_role,
    'production_manager'::app_role
  ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: غير مصرح لك باستلام مخرجات المجزر';
  END IF;

  SELECT * INTO v_out FROM public.slaughter_batch_outputs WHERE id = p_output_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OUTPUT_NOT_FOUND'; END IF;
  IF v_out.destination NOT IN ('warehouse','branch','meat_factory') THEN
    RAISE EXCEPTION 'INVALID_DESTINATION: المخرج ليس موجها للمخزن';
  END IF;
  IF v_out.received_status = 'received' THEN RAISE EXCEPTION 'ALREADY_RECEIVED: تم استلام هذا المخرج مسبقا'; END IF;
  IF p_warehouse_id IS NULL THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED: يجب اختيار المخزن'; END IF;

  SELECT batch_number INTO v_batch_no FROM public.slaughter_batches WHERE id = v_out.batch_id;

  IF v_out.quality_status = 'accepted' THEN
    SELECT id INTO v_item_id
    FROM public.inventory_items
    WHERE warehouse_id = p_warehouse_id AND name = v_out.cut_name_ar
    LIMIT 1;

    IF v_item_id IS NULL THEN
      INSERT INTO public.inventory_items (warehouse_id, name, category, unit, stock, unit_cost, low_stock_threshold)
      VALUES (p_warehouse_id, v_out.cut_name_ar, 'لحوم', 'كجم', 0, COALESCE(v_out.unit_cost,0), 5)
      RETURNING id INTO v_item_id;
    END IF;

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
            'qty', v_out.actual_weight_kg
          ),
          CASE WHEN v_added THEN 'تم إضافة الصنف للمخزون' ELSE 'تم وضع علامة استلام (بدون إضافة للمخزون - جودة غير مقبولة)' END);

  RETURN jsonb_build_object('success', true, 'added_to_inventory', v_added, 'item_id', v_item_id);
END;
$function$;