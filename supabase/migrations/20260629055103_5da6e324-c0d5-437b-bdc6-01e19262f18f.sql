
DROP FUNCTION IF EXISTS public.release_agouza_stock_reservation(uuid, text);

CREATE OR REPLACE FUNCTION public.reserve_agouza_stock_for_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_agouza_wh constant uuid := 'a970d469-37df-40e1-b99f-a49195a3778e';
  v_src uuid;
  v_shortages jsonb := '[]'::jsonb;
  v_reserved jsonb := '[]'::jsonb;
  r record;
  v_item_id uuid;
  v_available numeric;
  v_active_resv numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  SELECT source_warehouse_id INTO v_src FROM public.orders WHERE id = p_order_id;
  IF v_src IS NULL OR v_src <> v_agouza_wh THEN
    RAISE EXCEPTION 'هذا الأوردر ليس تابعاً لمخزن العجوزة';
  END IF;

  FOR r IN
    SELECT oi.id AS order_item_id, oi.product_id, SUM(oi.quantity)::numeric AS qty
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id AND oi.product_id IS NOT NULL
    GROUP BY oi.id, oi.product_id
  LOOP
    SELECT id INTO v_item_id FROM public.inventory_items
    WHERE warehouse_id = v_agouza_wh AND product_id = r.product_id AND is_active = true LIMIT 1;

    IF v_item_id IS NULL THEN
      v_shortages := v_shortages || jsonb_build_object(
        'product_id', r.product_id, 'requested', r.qty, 'reason', 'الصنف غير موجود في مخزن العجوزة'
      );
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(quantity),0) INTO v_active_resv FROM public.agouza_stock_reservations
    WHERE inventory_item_id = v_item_id AND status='active' AND order_id <> p_order_id;

    SELECT (stock - v_active_resv) INTO v_available FROM public.inventory_items WHERE id = v_item_id;

    IF v_available < r.qty THEN
      v_shortages := v_shortages || jsonb_build_object(
        'product_id', r.product_id, 'inventory_item_id', v_item_id,
        'requested', r.qty, 'available', v_available, 'shortage', (r.qty - v_available)
      );
    ELSE
      v_reserved := v_reserved || jsonb_build_object(
        'inventory_item_id', v_item_id, 'product_id', r.product_id, 'quantity', r.qty
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(v_shortages) > 0 THEN
    INSERT INTO public.agouza_reservation_audit_log(order_id, action, reason, details)
    VALUES (p_order_id, 'failure', 'shortage', jsonb_build_object('shortages', v_shortages));
    RETURN jsonb_build_object('ok', false, 'shortages', v_shortages);
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(v_reserved) AS x(j)
  LOOP
    INSERT INTO public.agouza_stock_reservations(
      order_id, inventory_item_id, product_id, quantity, status, reserved_by
    ) VALUES (
      p_order_id,
      (r.j->>'inventory_item_id')::uuid,
      (r.j->>'product_id')::uuid,
      (r.j->>'quantity')::numeric,
      'active',
      auth.uid()
    ) ON CONFLICT DO NOTHING;
  END LOOP;

  INSERT INTO public.agouza_reservation_audit_log(order_id, action, reason, details)
  VALUES (p_order_id, 'reserve', 'order_created_or_updated', jsonb_build_object('reserved', v_reserved));

  RETURN jsonb_build_object('ok', true, 'reserved', v_reserved);
END;
$function$;

CREATE FUNCTION public.release_agouza_stock_reservation(p_order_id uuid, p_reason text DEFAULT 'manual')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  UPDATE public.agouza_stock_reservations
  SET status = 'released', released_at = now(), released_by = auth.uid(),
      release_reason = COALESCE(p_reason, 'manual')
  WHERE order_id = p_order_id AND status = 'active';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.agouza_reservation_audit_log(order_id, action, reason, details)
  VALUES (p_order_id, 'release', COALESCE(p_reason, 'manual'), jsonb_build_object('released_count', v_count));

  RETURN jsonb_build_object('ok', true, 'released_count', v_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.commit_agouza_stock_on_delivery(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_agouza_wh constant uuid := 'a970d469-37df-40e1-b99f-a49195a3778e';
  v_src uuid;
  v_committed jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  r record;
  v_unit_cost numeric;
  v_existing_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  SELECT source_warehouse_id INTO v_src FROM public.orders WHERE id = p_order_id;
  IF v_src IS NULL OR v_src <> v_agouza_wh THEN
    RAISE EXCEPTION 'هذا الأوردر ليس تابعاً لمخزن العجوزة';
  END IF;

  FOR r IN
    SELECT id, inventory_item_id, product_id, quantity
    FROM public.agouza_stock_reservations
    WHERE order_id = p_order_id AND status = 'active'
  LOOP
    SELECT COUNT(*) INTO v_existing_count FROM public.inventory_movements
    WHERE reference_type = 'order' AND reference_id = p_order_id::text
      AND item_id = r.inventory_item_id AND movement_type = 'sales_dispatch';

    IF v_existing_count > 0 THEN
      v_skipped := v_skipped || jsonb_build_object('inventory_item_id', r.inventory_item_id, 'reason', 'already_committed');
      UPDATE public.agouza_stock_reservations SET status='committed', committed_at=now(), committed_by=auth.uid() WHERE id = r.id;
      CONTINUE;
    END IF;

    SELECT unit_cost INTO v_unit_cost FROM public.inventory_items WHERE id = r.inventory_item_id;

    PERFORM 1 FROM public.inventory_items WHERE id = r.inventory_item_id AND stock >= r.quantity;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'رصيد غير كافٍ عند التنفيذ للصنف %', r.inventory_item_id;
    END IF;

    UPDATE public.inventory_items SET stock = stock - r.quantity, updated_at = now()
    WHERE id = r.inventory_item_id;

    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, movement_type, quantity, unit_cost,
      reference_type, reference_id, product_id, module, reason, approval_status
    ) VALUES (
      r.inventory_item_id, v_agouza_wh, 'sales_dispatch', r.quantity, COALESCE(v_unit_cost,0),
      'order', p_order_id::text, r.product_id, 'agouza_sales', 'تسليم أوردر عجوزة', 'posted'
    );

    UPDATE public.agouza_stock_reservations
    SET status = 'committed', committed_at = now(), committed_by = auth.uid() WHERE id = r.id;

    v_committed := v_committed || jsonb_build_object('inventory_item_id', r.inventory_item_id, 'quantity', r.quantity);
  END LOOP;

  INSERT INTO public.agouza_reservation_audit_log(order_id, action, reason, details)
  VALUES (p_order_id, 'commit', 'order_delivered', jsonb_build_object('committed', v_committed, 'skipped', v_skipped));

  RETURN jsonb_build_object('ok', true, 'committed', v_committed, 'skipped', v_skipped);
END;
$function$;
