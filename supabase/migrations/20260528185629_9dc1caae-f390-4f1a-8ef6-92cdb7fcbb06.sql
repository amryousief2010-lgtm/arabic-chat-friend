CREATE OR REPLACE FUNCTION public.update_transfer_request_quantities(p_transfer_id uuid, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_transfer warehouse_transfers%ROWTYPE;
  v_line jsonb;
  v_line_id uuid;
  v_qty numeric;
  v_updated int := 0;
  v_removed int := 0;
BEGIN
  SELECT * INTO v_transfer
  FROM public.warehouse_transfers
  WHERE id = p_transfer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'transfer_not_found';
  END IF;

  IF v_transfer.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'cannot_edit_after_approval';
  END IF;

  IF v_transfer.created_by IS DISTINCT FROM auth.uid()
     AND NOT public.has_role(auth.uid(), 'general_manager'::public.app_role)
     AND NOT public.has_role(auth.uid(), 'executive_manager'::public.app_role)
     AND NOT public.has_role(auth.uid(), 'agouza_warehouse_keeper'::public.app_role)
     AND NOT public.has_role(auth.uid(), 'warehouse_supervisor'::public.app_role) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  FOR v_line IN
    SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_id := (v_line->>'line_id')::uuid;
    v_qty := COALESCE((v_line->>'qty')::numeric, 0);

    IF v_qty < 0 THEN
      v_qty := 0;
    END IF;

    IF v_qty > 10 THEN
      v_qty := 10;
    END IF;

    IF v_qty = 0 THEN
      DELETE FROM public.warehouse_transfer_items
      WHERE id = v_line_id
        AND transfer_id = p_transfer_id;
      v_removed := v_removed + 1;
    ELSE
      UPDATE public.warehouse_transfer_items
      SET requested_qty = v_qty
      WHERE id = v_line_id
        AND transfer_id = p_transfer_id;
      v_updated := v_updated + 1;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM public.warehouse_transfer_items
    WHERE transfer_id = p_transfer_id
  ) THEN
    UPDATE public.warehouse_transfers
    SET status = 'rejected',
        rejection_reason = 'تم إلغاء جميع الأصناف من قِبل مقدّم الطلب'
    WHERE id = p_transfer_id;
  END IF;

  RETURN jsonb_build_object('updated', v_updated, 'removed', v_removed);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.update_transfer_request_quantities(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_transfer_request_quantities(uuid, jsonb) TO service_role;