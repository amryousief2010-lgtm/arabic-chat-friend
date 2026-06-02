CREATE OR REPLACE FUNCTION public.transfer_slaughter_partial(
  p_batch_id uuid,
  p_warehouse_id uuid,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    'warehouse_supervisor'::app_role
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

    -- Split if partial
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
$$;

GRANT EXECUTE ON FUNCTION public.transfer_slaughter_partial(uuid, uuid, jsonb)
  TO authenticated, service_role;