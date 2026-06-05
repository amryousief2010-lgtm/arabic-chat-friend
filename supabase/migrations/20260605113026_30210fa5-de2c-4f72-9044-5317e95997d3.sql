
ALTER TABLE public.slaughter_batch_outputs
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid,
  ADD COLUMN IF NOT EXISTS reverse_movement_id uuid;

CREATE OR REPLACE FUNCTION public.reverse_slaughter_receipt(p_output_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_out public.slaughter_batch_outputs%ROWTYPE;
  v_uid uuid := auth.uid();
  v_batch_no text;
  v_mov_id uuid;
BEGIN
  IF NOT public.has_any_role(v_uid, ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'slaughterhouse_manager'::app_role,
    'warehouse_supervisor'::app_role,
    'meat_factory_manager'::app_role
  ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: غير مصرح لك بعكس الحركة';
  END IF;

  SELECT * INTO v_out FROM public.slaughter_batch_outputs WHERE id = p_output_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OUTPUT_NOT_FOUND'; END IF;
  IF v_out.received_status <> 'received' THEN
    RAISE EXCEPTION 'NOT_RECEIVED: لا يمكن عكس حركة لم يتم استلامها';
  END IF;
  IF v_out.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_REVERSED: تم عكس هذه الحركة مسبقا';
  END IF;
  IF v_out.received_inventory_item_id IS NULL OR v_out.received_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'NO_INVENTORY_LINK: لا يوجد رصيد للعكس';
  END IF;

  SELECT batch_number INTO v_batch_no FROM public.slaughter_batches WHERE id = v_out.batch_id;

  INSERT INTO public.inventory_movements (
    item_id, warehouse_id, movement_type, quantity, reference, party, unit_cost, performed_by, notes
  ) VALUES (
    v_out.received_inventory_item_id, v_out.received_warehouse_id, 'out',
    v_out.actual_weight_kg,
    'عكس استلام دفعة ذبح ' || COALESCE(v_batch_no,''),
    'تصحيح مخزون',
    COALESCE(v_out.unit_cost, 0),
    v_uid,
    COALESCE('عكس حركة استلام: ' || p_reason, 'عكس حركة استلام (تصحيح إدارة)')
  )
  RETURNING id INTO v_mov_id;

  UPDATE public.slaughter_batch_outputs
  SET reversed_at = now(),
      reversed_by = v_uid,
      reverse_movement_id = v_mov_id,
      received_status = 'reversed'
  WHERE id = p_output_id;

  INSERT INTO public.slaughter_audit_log (action, target_type, target_id, batch_id, performed_by, new_value, notes)
  VALUES ('receipt_reversed', 'output', p_output_id, v_out.batch_id, v_uid,
          jsonb_build_object(
            'warehouse_id', v_out.received_warehouse_id,
            'item_id', v_out.received_inventory_item_id,
            'qty', v_out.actual_weight_kg,
            'reverse_movement_id', v_mov_id
          ),
          COALESCE(p_reason, 'عكس حركة استلام (تصحيح إدارة)'));

  RETURN jsonb_build_object('success', true, 'reverse_movement_id', v_mov_id);
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_slaughter_receipt(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_slaughter_receipt(uuid, text) TO authenticated, service_role;
