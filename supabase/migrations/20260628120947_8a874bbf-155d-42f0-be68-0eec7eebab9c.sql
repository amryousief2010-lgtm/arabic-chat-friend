CREATE OR REPLACE FUNCTION public.record_courier_return(
  p_assignment_id uuid,
  p_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_asn RECORD;
  v_order RECORD;
  v_courier text;
  v_custody_id uuid;
  v_reference text;
  v_existing int;
  v_line RECORD;
  v_mov_id uuid;
  v_returned_lines int := 0;
  v_total_value numeric := 0;
BEGIN
  IF p_assignment_id IS NULL THEN RAISE EXCEPTION 'assignment_id is required'; END IF;

  SELECT a.id, a.custody_id, a.order_id, a.courier_name, a.status
    INTO v_asn
  FROM public.courier_order_assignments a
  WHERE a.id = p_assignment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'التعيين غير موجود'; END IF;
  IF v_asn.status IN ('fully_returned','cancelled','completed') THEN
    RAISE EXCEPTION 'لا يمكن تسجيل مرتجع — الحالة الحالية: %', v_asn.status;
  END IF;

  v_courier := v_asn.courier_name;
  v_custody_id := v_asn.custody_id;

  SELECT o.id, o.order_number, o.customer_id, o.total
    INTO v_order
  FROM public.orders o WHERE o.id = v_asn.order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الأوردر غير موجود'; END IF;

  v_reference := 'RET-' || COALESCE(NULLIF(p_idempotency_key,''),
                  to_char(now() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS') || '-' || substr(v_asn.id::text,1,6));

  SELECT count(*) INTO v_existing
  FROM public.inventory_movements WHERE reference = v_reference;
  IF v_existing > 0 THEN
    RETURN jsonb_build_object('reference', v_reference, 'idempotent_hit', true);
  END IF;

  -- For each previously issued line for this order in this custody, create a reversal
  FOR v_line IN
    SELECT l.id, l.inventory_item_id, l.inventory_movement_id, l.product_name,
           l.quantity, l.unit, l.unit_price, l.total_value, l.customer_id, l.customer_name
    FROM public.courier_goods_custody_lines l
    WHERE l.custody_id = v_custody_id
      AND l.order_id = v_asn.order_id
      AND l.line_type = 'issue'
  LOOP
    -- Find source warehouse from original movement
    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, source_warehouse_id, movement_type, quantity,
      unit_cost, party, reference, reference_type, reference_id, module,
      reason, notes, performed_by, performed_at, product_id, approval_status
    )
    SELECT
      v_line.inventory_item_id,
      m.source_warehouse_id,
      m.source_warehouse_id,
      'in',
      v_line.quantity,
      COALESCE(m.unit_cost, 0),
      'مرتجع من المندوب — ' || v_courier,
      v_reference,
      'courier_return',
      p_assignment_id::text,
      'courier_distribution',
      COALESCE(NULLIF(p_reason,''), 'مرتجع كامل من العميل'),
      trim(coalesce(v_order.order_number,'') || ' — ' || coalesce(v_line.customer_name,'')),
      v_user, now(), m.product_id, 'posted'
    FROM public.inventory_movements m
    WHERE m.id = v_line.inventory_movement_id
    RETURNING id INTO v_mov_id;

    INSERT INTO public.courier_goods_custody_lines(
      custody_id, line_type, customer_id, customer_name, order_id,
      inventory_item_id, inventory_movement_id, product_name,
      quantity, unit, unit_price, total_value, cash_collected,
      performed_at, performed_by, notes
    ) VALUES (
      v_custody_id, 'return', v_line.customer_id, v_line.customer_name, v_asn.order_id,
      v_line.inventory_item_id, v_mov_id, v_line.product_name,
      v_line.quantity, v_line.unit, v_line.unit_price, v_line.total_value, 0,
      now(), v_user,
      'مرتجع — ' || v_reference || COALESCE(' | ' || NULLIF(p_reason,''), '') || COALESCE(' | ' || NULLIF(p_notes,''), '')
    );

    v_returned_lines := v_returned_lines + 1;
    v_total_value := v_total_value + COALESCE(v_line.total_value, 0);
  END LOOP;

  UPDATE public.courier_order_assignments
     SET status = 'fully_returned',
         returned_at = now(),
         notes = COALESCE(NULLIF(p_notes,''), notes),
         updated_at = now()
   WHERE id = p_assignment_id;

  INSERT INTO public.pc_order_tracking(order_id, courier_status, last_updated_by)
  VALUES (v_order.id, 'returned_to_warehouse'::pc_courier_status, v_user)
  ON CONFLICT (order_id) DO UPDATE SET
    courier_status = EXCLUDED.courier_status,
    last_updated_by = EXCLUDED.last_updated_by,
    updated_at = now();

  UPDATE public.orders
     SET status = 'returned',
         updated_at = now()
   WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'reference', v_reference,
    'returned_lines', v_returned_lines,
    'total_value', v_total_value,
    'idempotent_hit', false
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.record_courier_return(uuid, text, text, text) TO authenticated;