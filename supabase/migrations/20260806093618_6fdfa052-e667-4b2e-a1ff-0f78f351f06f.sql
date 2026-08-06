-- 1) Resolve inventory item by normalized Arabic name inside a warehouse
CREATE OR REPLACE FUNCTION public.resolve_wh_item_by_name(p_warehouse_id uuid, p_name text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT id FROM public.inventory_items
  WHERE warehouse_id = p_warehouse_id
    AND public.normalize_ar_name(name) = public.normalize_ar_name(p_name)
  ORDER BY (COALESCE(is_active, true)) DESC, COALESCE(stock,0) DESC
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.resolve_wh_item_by_name(uuid, text) TO authenticated, service_role;

-- 2) Receive one slaughter output; supports repairing rows already flagged
--    as received but that never produced an inventory movement.
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
  -- Already received AND already posted to stock -> nothing to do
  IF v_out.received_status = 'received' AND v_out.received_inventory_item_id IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_RECEIVED: تم استلام هذا المخرج مسبقا';
  END IF;
  IF p_warehouse_id IS NULL THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED: يجب اختيار المخزن'; END IF;

  SELECT batch_number INTO v_batch_no FROM public.slaughter_batches WHERE id = v_out.batch_id;

  IF v_out.quality_status = 'accepted' AND COALESCE(v_out.actual_weight_kg,0) > 0 THEN
    v_item_id := public.resolve_wh_item_by_name(p_warehouse_id, v_out.cut_name_ar);

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
      received_at = COALESCE(received_at, now()),
      received_by = COALESCE(received_by, v_uid),
      received_warehouse_id = p_warehouse_id,
      received_inventory_item_id = v_item_id
  WHERE id = p_output_id;

  INSERT INTO public.slaughter_audit_log (action, target_type, target_id, batch_id, performed_by, new_value, notes)
  VALUES ('warehouse_receipt', 'output', p_output_id, v_out.batch_id, v_uid,
          jsonb_build_object('warehouse_id', p_warehouse_id, 'item_id', v_item_id, 'qty', v_out.actual_weight_kg, 'added_to_stock', v_added),
          'استلام مخرج المجزر بالمخزن');

  RETURN jsonb_build_object('success', true, 'added_to_stock', v_added, 'item_id', v_item_id);
END;
$function$;

-- 3) Batch receive: also picks up rows flagged received without stock posting
CREATE OR REPLACE FUNCTION public.receive_slaughter_batch(p_batch_id uuid, p_warehouse_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_count int := 0;
  v_added int := 0;
  v_total numeric := 0;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'warehouse_supervisor'::app_role,
    'slaughterhouse_manager'::app_role
  ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: غير مصرح لك باستلام مخرجات المجزر';
  END IF;

  FOR r IN
    SELECT id, actual_weight_kg, quality_status, received_warehouse_id
    FROM public.slaughter_batch_outputs
    WHERE batch_id = p_batch_id
      AND destination IN ('warehouse','branch','meat_factory')
      AND (received_status <> 'received' OR received_inventory_item_id IS NULL)
      AND COALESCE(received_status,'pending') <> 'received_previously'
  LOOP
    PERFORM public.receive_slaughter_output(r.id, COALESCE(r.received_warehouse_id, p_warehouse_id));
    v_count := v_count + 1;
    v_total := v_total + COALESCE(r.actual_weight_kg, 0);
    IF r.quality_status = 'accepted' THEN v_added := v_added + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'received_count', v_count, 'added_to_stock', v_added, 'total_kg', v_total);
END;
$function$;

-- 4) Repair batch SB-20260805-5542: post the missing quantities to stock
DO $$
DECLARE
  r RECORD;
  v_item uuid;
  v_batch_no text;
BEGIN
  SELECT batch_number INTO v_batch_no FROM public.slaughter_batches
   WHERE id = 'c0fde34c-1ccd-4f3a-a39d-2e62307a1b19';

  FOR r IN
    SELECT * FROM public.slaughter_batch_outputs
    WHERE batch_id = 'c0fde34c-1ccd-4f3a-a39d-2e62307a1b19'
      AND received_inventory_item_id IS NULL
      AND quality_status = 'accepted'
      AND COALESCE(actual_weight_kg,0) > 0
      AND received_warehouse_id IS NOT NULL
  LOOP
    v_item := public.resolve_wh_item_by_name(r.received_warehouse_id, r.cut_name_ar);
    IF v_item IS NULL THEN
      INSERT INTO public.inventory_items (warehouse_id, name, category, unit, stock, unit_cost, low_stock_threshold)
      VALUES (r.received_warehouse_id, r.cut_name_ar, 'لحوم', 'كجم', 0, COALESCE(r.unit_cost,0), 5)
      RETURNING id INTO v_item;
    END IF;

    INSERT INTO public.inventory_movements (item_id, warehouse_id, movement_type, quantity, reference, party, unit_cost, performed_by, notes)
    VALUES (v_item, r.received_warehouse_id, 'in', r.actual_weight_kg,
            'استلام من دفعة ذبح ' || COALESCE(v_batch_no,''),
            'المجزر', COALESCE(r.unit_cost,0), r.received_by,
            'تصحيح: إدخال كمية لم تُسجَّل عند اعتماد الاستلام');

    UPDATE public.slaughter_batch_outputs
      SET received_inventory_item_id = v_item
    WHERE id = r.id;
  END LOOP;
END $$;