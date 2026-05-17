-- 1) Loosen destination check in receive_slaughter_output to accept branch & meat_factory too
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

-- 2) Same in bulk receive (destination filter)
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
      AND destination IN ('warehouse','branch','meat_factory')
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

-- 3) Verified receive: per-item received weight and quality status with variance audit
CREATE OR REPLACE FUNCTION public.receive_slaughter_batch_verified(
  p_batch_id uuid,
  p_warehouse_id uuid,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it jsonb;
  v_out_id uuid;
  v_new_qty numeric;
  v_new_quality text;
  v_note text;
  v_orig public.slaughter_batch_outputs%ROWTYPE;
  v_count int := 0;
  v_added int := 0;
  v_total numeric := 0;
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_any_role(v_uid, ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'warehouse_supervisor'::app_role
  ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: غير مصرح لك باستلام مخرجات المجزر';
  END IF;

  IF p_warehouse_id IS NULL THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'ITEMS_REQUIRED'; END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_out_id     := (it->>'id')::uuid;
    v_new_qty    := NULLIF(it->>'received_weight_kg','')::numeric;
    v_new_quality:= COALESCE(NULLIF(it->>'quality_status',''), 'accepted');
    v_note       := it->>'notes';

    SELECT * INTO v_orig FROM public.slaughter_batch_outputs
      WHERE id = v_out_id AND batch_id = p_batch_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF v_orig.received_status = 'received' THEN CONTINUE; END IF;

    -- Apply verified adjustments (qty + quality) and log variance
    IF v_new_qty IS NOT NULL AND v_new_qty <> v_orig.actual_weight_kg THEN
      INSERT INTO public.slaughter_audit_log (action, target_type, target_id, batch_id, performed_by, old_value, new_value, notes)
      VALUES ('receipt_qty_adjustment','output', v_out_id, p_batch_id, v_uid,
              jsonb_build_object('qty', v_orig.actual_weight_kg),
              jsonb_build_object('qty', v_new_qty),
              format('تعديل كمية الاستلام للصنف %s من %s إلى %s كجم%s',
                     v_orig.cut_name_ar, v_orig.actual_weight_kg, v_new_qty,
                     CASE WHEN v_note IS NOT NULL AND v_note <> '' THEN ' — ' || v_note ELSE '' END));
      UPDATE public.slaughter_batch_outputs SET actual_weight_kg = v_new_qty WHERE id = v_out_id;
    END IF;

    IF v_new_quality <> v_orig.quality_status THEN
      INSERT INTO public.slaughter_audit_log (action, target_type, target_id, batch_id, performed_by, old_value, new_value, notes)
      VALUES ('receipt_quality_adjustment','output', v_out_id, p_batch_id, v_uid,
              jsonb_build_object('quality_status', v_orig.quality_status),
              jsonb_build_object('quality_status', v_new_quality),
              format('تعديل حالة الجودة للصنف %s من %s إلى %s%s',
                     v_orig.cut_name_ar, v_orig.quality_status, v_new_quality,
                     CASE WHEN v_note IS NOT NULL AND v_note <> '' THEN ' — ' || v_note ELSE '' END));
      UPDATE public.slaughter_batch_outputs SET quality_status = v_new_quality WHERE id = v_out_id;
    END IF;

    PERFORM public.receive_slaughter_output(v_out_id, p_warehouse_id);
    v_count := v_count + 1;
    v_total := v_total + COALESCE(v_new_qty, v_orig.actual_weight_kg, 0);
    IF v_new_quality = 'accepted' THEN v_added := v_added + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'received_count', v_count, 'added_to_stock', v_added, 'total_kg', v_total);
END;
$$;