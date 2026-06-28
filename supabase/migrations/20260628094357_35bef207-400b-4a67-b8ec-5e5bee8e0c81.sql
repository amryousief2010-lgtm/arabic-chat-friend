CREATE OR REPLACE FUNCTION public.approve_distribution_dispatch(p_custody_id uuid, p_warehouse_id uuid, p_order_ids uuid[], p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_custody RECORD;
  v_courier text;
  v_reference text;
  v_existing_count int;
  v_movement_ids uuid[] := ARRAY[]::uuid[];
  v_unresolved text[] := ARRAY[]::text[];
  v_items_count int := 0;
  v_orders_count int := 0;
  v_item RECORD;
  v_inv RECORD;
  v_order RECORD;
  v_mov_id uuid;
  v_assigned_existing int;
BEGIN
  IF p_custody_id IS NULL THEN RAISE EXCEPTION 'custody_id is required'; END IF;
  IF p_warehouse_id IS NULL THEN RAISE EXCEPTION 'warehouse_id is required'; END IF;
  IF p_order_ids IS NULL OR array_length(p_order_ids,1) IS NULL THEN
    RAISE EXCEPTION 'يجب اختيار طلب واحد على الأقل';
  END IF;

  SELECT id, courier_name, status INTO v_custody
  FROM public.courier_goods_custodies
  WHERE id = p_custody_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'العهدة غير موجودة'; END IF;
  IF v_custody.status <> 'open' THEN RAISE EXCEPTION 'العهدة ليست مفتوحة (الحالة: %)', v_custody.status; END IF;
  v_courier := v_custody.courier_name;

  IF p_idempotency_key IS NOT NULL AND length(p_idempotency_key) > 0 THEN
    v_reference := 'DIST-' || p_idempotency_key;
    SELECT count(*) INTO v_existing_count
    FROM public.inventory_movements
    WHERE reference = v_reference;
    IF v_existing_count > 0 THEN
      SELECT array_agg(id) INTO v_movement_ids
      FROM public.inventory_movements WHERE reference = v_reference;
      RETURN jsonb_build_object(
        'reference', v_reference,
        'movement_ids', to_jsonb(v_movement_ids),
        'orders_count', array_length(p_order_ids,1),
        'items_count', v_existing_count,
        'unresolved', to_jsonb(ARRAY[]::text[]),
        'idempotent_hit', true
      );
    END IF;
  ELSE
    v_reference := 'DIST-' || to_char(now() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS') || '-' || substr(p_custody_id::text,1,6);
  END IF;

  SELECT count(*) INTO v_assigned_existing
  FROM public.courier_order_assignments
  WHERE order_id = ANY(p_order_ids)
    AND status NOT IN ('fully_returned','cancelled');
  IF v_assigned_existing > 0 THEN
    RAISE EXCEPTION 'يوجد % طلب مرتبط بالفعل بعهدة نشطة', v_assigned_existing;
  END IF;

  FOR v_item IN
    SELECT oi.id, oi.order_id, oi.product_id, oi.product_name, oi.quantity, oi.unit_price, NULL::text AS unit
    FROM public.order_items oi
    WHERE oi.order_id = ANY(p_order_ids)
  LOOP
    SELECT o.id, o.order_number, o.status, o.customer_id, c.name AS customer_name
    INTO v_order
    FROM public.orders o
    LEFT JOIN public.customers c ON c.id = o.customer_id
    WHERE o.id = v_item.order_id;

    SELECT id, unit_cost INTO v_inv
    FROM public.inventory_items
    WHERE warehouse_id = p_warehouse_id
      AND is_active = true
      AND product_id = v_item.product_id
    LIMIT 1;

    IF NOT FOUND THEN
      v_unresolved := array_append(v_unresolved, v_item.product_name);
      CONTINUE;
    END IF;

    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, source_warehouse_id, movement_type, quantity,
      unit_cost, party, reference, reference_type, reference_id, module,
      reason, notes, performed_by, performed_at, product_id, order_item_id, approval_status
    ) VALUES (
      v_inv.id, p_warehouse_id, p_warehouse_id, 'out', COALESCE(v_item.quantity,0),
      COALESCE(v_inv.unit_cost,0), 'عهدة المندوب — ' || v_courier, v_reference,
      'courier_custody', p_custody_id::text, 'courier_distribution',
      'صرف خط توزيع',
      trim(coalesce(v_order.order_number,'') || ' — ' || coalesce(v_order.customer_name,'')),
      v_user, now(), v_item.product_id, v_item.id, 'posted'
    ) RETURNING id INTO v_mov_id;

    v_movement_ids := array_append(v_movement_ids, v_mov_id);
    v_items_count := v_items_count + 1;

    INSERT INTO public.courier_goods_custody_lines(
      custody_id, line_type, customer_id, customer_name, order_id,
      inventory_item_id, inventory_movement_id, product_name,
      quantity, unit, unit_price, total_value, cash_collected,
      performed_at, performed_by, notes
    ) VALUES (
      p_custody_id, 'issue', v_order.customer_id, v_order.customer_name, v_item.order_id,
      v_inv.id, v_mov_id, v_item.product_name,
      COALESCE(v_item.quantity,0), COALESCE(v_item.unit,'وحدة'),
      COALESCE(v_item.unit_price,0),
      COALESCE(v_item.quantity,0) * COALESCE(v_item.unit_price,0), 0,
      now(), v_user,
      'صرف خط ' || v_reference || ' — ' || coalesce(v_order.order_number,'')
    );
  END LOOP;

  IF v_items_count = 0 THEN
    RAISE EXCEPTION 'لم يتم إنشاء أي حركة. الأصناف غير مرتبطة بالمخزن المحدد: %', array_to_string(v_unresolved, ', ');
  END IF;

  -- Order assignments + status updates
  FOR v_order IN
    SELECT id, order_number FROM public.orders WHERE id = ANY(p_order_ids)
  LOOP
    INSERT INTO public.courier_order_assignments(order_id, custody_id, status, assigned_at, assigned_by)
    VALUES (v_order.id, p_custody_id, 'with_courier', now(), v_user);
    v_orders_count := v_orders_count + 1;
  END LOOP;

  UPDATE public.orders
    SET status = 'processing', stock_status = 'dispatched', updated_at = now()
    WHERE id = ANY(p_order_ids);

  RETURN jsonb_build_object(
    'reference', v_reference,
    'movement_ids', to_jsonb(v_movement_ids),
    'orders_count', v_orders_count,
    'items_count', v_items_count,
    'unresolved', to_jsonb(v_unresolved),
    'idempotent_hit', false
  );
END;
$function$;