
-- 1) Stop transfer_slaughter_partial from auto-receiving. Instead it stages
--    the intended destination warehouse on the output row and leaves it
--    pending for the destination warehouse supervisor to confirm via
--    receive_slaughter_batch_verified.
CREATE OR REPLACE FUNCTION public.transfer_slaughter_partial(
  p_batch_id uuid, p_warehouse_id uuid, p_items jsonb
) RETURNS jsonb
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

    -- Stage the intended destination warehouse and keep status pending so it
    -- shows up in the destination warehouse inbox for supervisor confirmation.
    UPDATE public.slaughter_batch_outputs
      SET received_warehouse_id = p_warehouse_id,
          received_status = 'pending'
      WHERE id = v_out.id;

    v_count := v_count + 1;
    v_total := v_total + v_qty;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'received_count', v_count,
    'total_kg', v_total,
    'staged', true,
    'message', 'تم إرسال التقسيم لأمين المخزن المستلم لاعتماد الاستلام'
  );
END;
$function$;

-- 2) Revert today's batch (SB-20260715-5778) so عبدالمنعم can confirm it
--    fresh in the inbox. Remove the auto-created inventory movements and
--    reset the outputs to pending.
DO $$
DECLARE
  v_batch_id uuid := '44b80d8c-5074-46ff-9062-816463397980';
  r record;
BEGIN
  -- Delete the "in" movements this batch created and update running stock.
  FOR r IN
    SELECT m.id AS mv_id, m.item_id, m.quantity
    FROM public.inventory_movements m
    WHERE m.reference = 'استلام من دفعة ذبح ' || (SELECT batch_number FROM public.slaughter_batches WHERE id = v_batch_id)
      AND m.movement_type = 'in'
  LOOP
    UPDATE public.inventory_items
      SET stock = GREATEST(0, COALESCE(stock,0) - r.quantity)
      WHERE id = r.item_id;
    DELETE FROM public.inventory_movements WHERE id = r.mv_id;
  END LOOP;

  UPDATE public.slaughter_batch_outputs
    SET received_status = 'pending',
        received_at = NULL,
        received_by = NULL,
        received_inventory_item_id = NULL
        -- keep received_warehouse_id so it shows in the correct inbox
    WHERE batch_id = v_batch_id;
END $$;
