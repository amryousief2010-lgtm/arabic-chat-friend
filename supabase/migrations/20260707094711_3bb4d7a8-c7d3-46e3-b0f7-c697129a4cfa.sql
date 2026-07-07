
-- 1) Allow apply_inventory_movement to skip insufficient-stock check when a per-transaction GUC is set
CREATE OR REPLACE FUNCTION public.apply_inventory_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_old_qty numeric; v_old_cost numeric; v_new_cost numeric;
  v_allow_neg boolean := false;
BEGIN
  IF NEW.approval_status <> 'posted' THEN RETURN NEW; END IF;

  BEGIN
    v_allow_neg := COALESCE(current_setting('app.allow_negative_stock', true), 'off') = 'on';
  EXCEPTION WHEN OTHERS THEN v_allow_neg := false;
  END;

  IF NEW.movement_type IN ('in','purchase_receipt','stock_in','finished_goods_receipt','return','opening_balance') THEN
    SELECT stock, unit_cost INTO v_old_qty, v_old_cost
      FROM public.inventory_items WHERE id = NEW.item_id FOR UPDATE;
    IF NEW.unit_cost IS NOT NULL AND NEW.unit_cost > 0 AND NEW.quantity > 0 THEN
      v_new_cost := ((COALESCE(v_old_qty,0) * COALESCE(v_old_cost,0)) + (NEW.quantity * NEW.unit_cost))
                    / NULLIF(COALESCE(v_old_qty,0) + NEW.quantity, 0);
      UPDATE public.inventory_items
        SET stock = stock + NEW.quantity,
            unit_cost = COALESCE(v_new_cost, unit_cost),
            last_movement_date = now()
        WHERE id = NEW.item_id;
      IF v_old_cost IS DISTINCT FROM v_new_cost THEN
        INSERT INTO public.product_cost_history(module, target_table, target_id, old_cost, new_cost, reason, source, approved_by)
        VALUES (COALESCE(NEW.module,'shared'),'inventory_items', NEW.item_id::text,
                v_old_cost, v_new_cost, 'متوسط مرجح عند ' || NEW.movement_type, 'inv_post', NEW.performed_by);
      END IF;
    ELSE
      UPDATE public.inventory_items SET stock = stock + NEW.quantity, last_movement_date = now()
        WHERE id = NEW.item_id;
    END IF;

  ELSIF NEW.movement_type IN ('out','stock_out','production_consumption','packaging_consumption','waste_loss') THEN
    SELECT (stock - reserved_qty - blocked_qty) INTO v_old_qty
      FROM public.inventory_items WHERE id = NEW.item_id FOR UPDATE;
    IF v_old_qty < NEW.quantity AND NOT v_allow_neg THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: المتاح % والمطلوب %', v_old_qty, NEW.quantity;
    END IF;
    UPDATE public.inventory_items SET stock = stock - NEW.quantity, last_movement_date = now()
      WHERE id = NEW.item_id;

  ELSIF NEW.movement_type = 'transfer' THEN
    SELECT (stock - reserved_qty - blocked_qty) INTO v_old_qty
      FROM public.inventory_items WHERE id = NEW.item_id FOR UPDATE;
    IF v_old_qty < NEW.quantity AND NOT v_allow_neg THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: المتاح % والمطلوب %', v_old_qty, NEW.quantity;
    END IF;
    UPDATE public.inventory_items SET stock = stock - NEW.quantity, last_movement_date = now()
      WHERE id = NEW.item_id;

  ELSIF NEW.movement_type IN ('adjustment','reconciliation') THEN
    UPDATE public.inventory_items SET stock = NEW.quantity, last_movement_date = now()
      WHERE id = NEW.item_id;
  END IF;

  RETURN NEW;
END $function$;

-- 2) Overload approve_distribution_dispatch to accept p_override_negative and pre-compute shortages
CREATE OR REPLACE FUNCTION public.approve_distribution_dispatch(
  p_custody_id uuid,
  p_warehouse_id uuid,
  p_order_ids uuid[],
  p_idempotency_key text DEFAULT NULL::text,
  p_override_negative boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
  v_shortages jsonb := '[]'::jsonb;
  v_short RECORD;
BEGIN
  IF p_custody_id IS NULL THEN RAISE EXCEPTION 'custody_id is required'; END IF;
  IF p_warehouse_id IS NULL THEN RAISE EXCEPTION 'warehouse_id is required'; END IF;
  IF p_order_ids IS NULL OR array_length(p_order_ids,1) IS NULL THEN
    RAISE EXCEPTION 'يجب اختيار طلب واحد على الأقل';
  END IF;

  SELECT id, courier_name, status INTO v_custody
  FROM public.courier_goods_custodies WHERE id = p_custody_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'العهدة غير موجودة'; END IF;
  IF v_custody.status <> 'open' THEN RAISE EXCEPTION 'العهدة ليست مفتوحة (الحالة: %)', v_custody.status; END IF;
  v_courier := v_custody.courier_name;

  IF p_idempotency_key IS NOT NULL AND length(p_idempotency_key) > 0 THEN
    v_reference := 'DIST-' || p_idempotency_key;
    SELECT count(*) INTO v_existing_count FROM public.inventory_movements WHERE reference = v_reference;
    IF v_existing_count > 0 THEN
      SELECT array_agg(id) INTO v_movement_ids FROM public.inventory_movements WHERE reference = v_reference;
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

  -- Pre-compute shortages: for each (product, required-qty), see how much is available
  FOR v_short IN
    SELECT
      p.product_name,
      SUM(p.required)::numeric AS required,
      MAX(COALESCE(ii.stock - ii.reserved_qty - ii.blocked_qty, 0))::numeric AS available
    FROM (
      SELECT oi.product_id, oi.product_name, SUM(COALESCE(oi.quantity,0)) AS required
      FROM public.order_items oi
      WHERE oi.order_id = ANY(p_order_ids)
      GROUP BY oi.product_id, oi.product_name
    ) p
    LEFT JOIN public.inventory_items ii
      ON ii.warehouse_id = p_warehouse_id AND ii.is_active = true AND ii.product_id = p.product_id
    GROUP BY p.product_name
    HAVING SUM(p.required) > MAX(COALESCE(ii.stock - ii.reserved_qty - ii.blocked_qty, 0))
  LOOP
    v_shortages := v_shortages || jsonb_build_object(
      'product_name', v_short.product_name,
      'required', v_short.required,
      'available', v_short.available,
      'shortage', v_short.required - v_short.available
    );
  END LOOP;

  IF jsonb_array_length(v_shortages) > 0 AND NOT p_override_negative THEN
    RETURN jsonb_build_object(
      'needs_override', true,
      'shortages', v_shortages,
      'reference', v_reference
    );
  END IF;

  SELECT count(*) INTO v_assigned_existing
  FROM public.courier_order_assignments
  WHERE order_id = ANY(p_order_ids) AND status NOT IN ('fully_returned','cancelled');
  IF v_assigned_existing > 0 THEN
    RAISE EXCEPTION 'يوجد % طلب مرتبط بالفعل بعهدة نشطة', v_assigned_existing;
  END IF;

  -- If user explicitly overrode, allow negative stock inside this transaction
  IF p_override_negative THEN
    PERFORM set_config('app.allow_negative_stock', 'on', true);
  END IF;

  FOR v_item IN
    SELECT oi.id, oi.order_id, oi.product_id, oi.product_name, oi.quantity, oi.unit_price, NULL::text AS unit
    FROM public.order_items oi WHERE oi.order_id = ANY(p_order_ids)
  LOOP
    SELECT o.id, o.order_number, o.status, o.customer_id, c.name AS customer_name
    INTO v_order
    FROM public.orders o LEFT JOIN public.customers c ON c.id = o.customer_id
    WHERE o.id = v_item.order_id;

    SELECT id, unit_cost INTO v_inv
    FROM public.inventory_items
    WHERE warehouse_id = p_warehouse_id AND is_active = true AND product_id = v_item.product_id
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
      CASE WHEN p_override_negative THEN 'صرف خط توزيع (تجاوز رصيد)' ELSE 'صرف خط توزيع' END,
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

  FOR v_order IN SELECT id, order_number FROM public.orders WHERE id = ANY(p_order_ids) LOOP
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
    'shortages', v_shortages,
    'override_applied', p_override_negative,
    'idempotent_hit', false
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.approve_distribution_dispatch(uuid, uuid, uuid[], text, boolean) TO authenticated;
