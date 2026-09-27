-- Posting functions may raise the session flags only while their own write runs.
-- set_config(..., true) is local to the transaction. Leaving the flags on let a
-- later direct stock write in the same transaction pass the guard.
-- Reset them to off immediately after the write returns. Do not clear them
-- inside a trigger: a sibling trigger would turn the flag off before the guard.

CREATE OR REPLACE FUNCTION public.post_inventory_movement(
  p_item_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_source_type text,
  p_source_id uuid,
  p_source_line_id text,
  p_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_performed_at timestamptz DEFAULT NULL,
  p_unit_cost numeric DEFAULT NULL,
  p_party text DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_effect_mode text DEFAULT NULL,
  p_allow_negative boolean DEFAULT false,
  p_warehouse_id uuid DEFAULT NULL,
  p_product_id uuid DEFAULT NULL,
  p_module text DEFAULT NULL,
  p_reverses_movement_id uuid DEFAULT NULL,
  p_override_reason text DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_reference_id text DEFAULT NULL,
  p_destination_warehouse_id uuid DEFAULT NULL,
  p_package_count numeric DEFAULT NULL,
  p_package_weight_kg numeric DEFAULT NULL,
  p_order_item_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_before numeric;
  v_after numeric;
  v_cost numeric;
  v_new_cost numeric;
  v_wh uuid;
  v_reserved numeric;
  v_blocked numeric;
  v_avail numeric;
  v_mode text;
  v_mov uuid;
  v_existing uuid;
  v_existing_before numeric;
  v_existing_after numeric;
  v_when timestamptz := COALESCE(p_performed_at, now());
  v_lock timestamptz;
  v_override text := NULLIF(btrim(COALESCE(p_override_reason, '')), '');
  v_internal boolean := COALESCE(current_setting('app.inventory_internal_post', true), '') = 'on';
  v_qty numeric := p_quantity;
BEGIN
  IF p_item_id IS NULL OR p_movement_type IS NULL OR p_source_type IS NULL
     OR p_source_id IS NULL OR p_source_line_id IS NULL OR length(btrim(p_source_line_id)) = 0 THEN
    RAISE EXCEPTION 'SOURCE_REQUIRED: كل حركة تحتاج صنفاً ونوع مستند ومفتاح سطر';
  END IF;

  IF NOT v_internal THEN
    IF NOT public.inventory_can_post(v_uid, p_source_type, COALESCE(p_warehouse_id, (
      SELECT warehouse_id FROM public.inventory_items WHERE id = p_item_id
    ))) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: غير مصرح بترحيل % على هذا المخزن', p_source_type;
    END IF;
  END IF;

  SELECT m.id, m.stock_before, m.stock_after
    INTO v_existing, v_existing_before, v_existing_after
  FROM public.inventory_movements m
  WHERE m.source_type = p_source_type
    AND m.source_id = p_source_id
    AND m.source_line_id = p_source_line_id
    AND COALESCE(m.approval_status, 'posted') = 'posted'
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'id', v_existing,
      'status', 'already_posted',
      'stock_before', v_existing_before,
      'stock_after', v_existing_after,
      'source_type', p_source_type
    );
  END IF;

  v_mode := COALESCE(NULLIF(btrim(COALESCE(p_effect_mode, '')), ''),
    CASE
      WHEN p_movement_type IN ('adjustment', 'reconciliation', 'adjust') THEN 'delta'
      WHEN p_movement_type = 'opening_balance' THEN 'set'
      ELSE 'delta'
    END);

  BEGIN
    SELECT stock, unit_cost, warehouse_id, COALESCE(reserved_qty, 0), COALESCE(blocked_qty, 0)
      INTO v_before, v_cost, v_wh, v_reserved, v_blocked
    FROM public.inventory_items
    WHERE id = p_item_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'الصنف غير موجود';
    END IF;

    v_wh := COALESCE(p_warehouse_id, v_wh);

    v_lock := public.warehouse_period_locked_until(v_wh);
    IF v_lock IS NOT NULL AND v_when < v_lock THEN
      IF v_override IS NULL OR length(v_override) < 3
         OR v_uid IS NULL
         OR NOT (
           public.has_role(v_uid, 'general_manager'::public.app_role)
           OR public.has_role(v_uid, 'executive_manager'::public.app_role)
         ) THEN
        RAISE EXCEPTION
          'الفترة مقفلة لهذا المخزن حتى %. لا يمكن تسجيل حركة بتاريخ أقدم. التجاوز للمدير العام أو المدير التنفيذي مع سبب مكتوب.',
          to_char(v_lock AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI');
      END IF;
    ELSE
      v_override := NULL;
    END IF;

    IF p_movement_type IN ('adjustment', 'reconciliation', 'adjust') AND v_mode = 'delta' THEN
      v_after := COALESCE(v_before, 0) + COALESCE(v_qty, 0);
    ELSIF p_movement_type IN ('adjustment', 'reconciliation', 'adjust')
          OR (p_movement_type = 'opening_balance' AND v_mode = 'set') THEN
      v_after := COALESCE(v_qty, 0);
    ELSIF p_movement_type IN ('in','purchase_receipt','stock_in','finished_goods_receipt','return','opening_balance','sales_return') THEN
      v_after := COALESCE(v_before, 0) + abs(COALESCE(v_qty, 0));
      v_qty := abs(COALESCE(v_qty, 0));
    ELSIF p_movement_type IN ('out','stock_out','production_consumption','packaging_consumption','waste_loss','transfer','sales_dispatch') THEN
      v_avail := COALESCE(v_before, 0) - v_reserved - v_blocked;
      IF v_avail < abs(COALESCE(v_qty, 0)) AND NOT p_allow_negative THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: المتاح % والمطلوب %', v_avail, abs(v_qty);
      END IF;
      v_after := COALESCE(v_before, 0) - abs(COALESCE(v_qty, 0));
      v_qty := abs(COALESCE(v_qty, 0));
    ELSE
      RAISE EXCEPTION 'UNKNOWN_MOVEMENT_TYPE: %', p_movement_type;
    END IF;

    IF v_after < 0 AND NOT p_allow_negative THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: الرصيد بعد الحركة سيكون %', v_after;
    END IF;

    v_new_cost := v_cost;
    IF p_movement_type IN ('in','purchase_receipt','stock_in','finished_goods_receipt','return','opening_balance','sales_return')
       AND p_unit_cost IS NOT NULL AND p_unit_cost > 0 AND COALESCE(v_qty, 0) > 0
       AND NOT (p_movement_type = 'opening_balance' AND v_mode = 'set') THEN
      v_new_cost := ((COALESCE(v_before, 0) * COALESCE(v_cost, 0)) + (abs(v_qty) * p_unit_cost))
                    / NULLIF(COALESCE(v_before, 0) + abs(v_qty), 0);
    ELSIF p_unit_cost IS NOT NULL AND p_unit_cost > 0
          AND p_movement_type = 'opening_balance' AND v_mode = 'set' THEN
      v_new_cost := p_unit_cost;
    END IF;

    PERFORM set_config('app.inventory_stock_write', 'on', true);
    PERFORM set_config('app.inventory_ledger_posted', 'on', true);
    IF p_allow_negative THEN
      PERFORM set_config('app.allow_negative_stock', 'on', true);
    END IF;

    UPDATE public.inventory_items
       SET stock = v_after,
           last_movement_date = now(),
           unit_cost = COALESCE(v_new_cost, unit_cost)
     WHERE id = p_item_id;

    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, source_warehouse_id, destination_warehouse_id,
      movement_type, quantity, quantity_kg, unit_cost, total_cost,
      reference, reference_type, reference_id, party, notes, reason,
      performed_by, performed_at, approval_status, approved_by, approved_at,
      module, product_id, order_item_id, effect_mode,
      stock_before, stock_after, period_lock_override_reason,
      package_count, package_weight_kg,
      source_type, source_id, source_line_id, reverses_movement_id
    ) VALUES (
      p_item_id, v_wh, v_wh, p_destination_warehouse_id,
      p_movement_type, v_qty, abs(v_qty),
      COALESCE(p_unit_cost, v_cost, 0),
      abs(COALESCE(v_qty, 0)) * COALESCE(p_unit_cost, v_cost, 0),
      p_reference, COALESCE(p_reference_type, p_source_type),
      COALESCE(p_reference_id, p_source_id::text),
      p_party, p_notes, p_reason,
      v_uid, v_when, 'posted', v_uid, now(),
      COALESCE(p_module, 'ledger'), p_product_id, p_order_item_id, v_mode,
      v_before, v_after, v_override,
      p_package_count, p_package_weight_kg,
      p_source_type, p_source_id, p_source_line_id, p_reverses_movement_id
    ) RETURNING id INTO v_mov;

    PERFORM set_config('app.inventory_stock_write', 'off', true);
    PERFORM set_config('app.inventory_ledger_posted', 'off', true);
    IF p_allow_negative THEN
      PERFORM set_config('app.allow_negative_stock', 'off', true);
    END IF;

    RETURN jsonb_build_object(
      'id', v_mov,
      'status', 'posted',
      'stock_before', v_before,
      'stock_after', v_after,
      'movement_type', p_movement_type,
      'source_type', p_source_type
    );
  EXCEPTION WHEN unique_violation THEN
    PERFORM set_config('app.inventory_stock_write', 'off', true);
    PERFORM set_config('app.inventory_ledger_posted', 'off', true);
    PERFORM set_config('app.allow_negative_stock', 'off', true);
    IF SQLERRM NOT ILIKE '%inventory_movements_source_line_uidx%' THEN
      RAISE;
    END IF;
    SELECT m.id, m.stock_before, m.stock_after
      INTO v_existing, v_existing_before, v_existing_after
    FROM public.inventory_movements m
    WHERE m.source_type = p_source_type
      AND m.source_id = p_source_id
      AND m.source_line_id = p_source_line_id
      AND COALESCE(m.approval_status, 'posted') = 'posted'
    LIMIT 1;
    RETURN jsonb_build_object(
      'id', v_existing,
      'status', 'already_posted',
      'stock_before', v_existing_before,
      'stock_after', v_existing_after,
      'source_type', p_source_type
    );
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.post_inventory_movement(
  uuid, text, numeric, text, uuid, text, text, text, timestamptz, numeric,
  text, text, text, boolean, uuid, uuid, text, uuid, text, text, text, uuid, numeric, numeric, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_inventory_movement(
  uuid, text, numeric, text, uuid, text, text, text, timestamptz, numeric,
  text, text, text, boolean, uuid, uuid, text, uuid, text, text, text, uuid, numeric, numeric, uuid
) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.post_meat_raw_movement(
  p_item_id uuid,
  p_direction text,
  p_quantity numeric,
  p_unit_cost numeric,
  p_reason text,
  p_ref_table text,
  p_ref_id uuid,
  p_item_kind text DEFAULT NULL,
  p_effect text DEFAULT 'delta',
  p_target_stock numeric DEFAULT NULL,
  p_avg_cost numeric DEFAULT NULL,
  p_item_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item public.meat_factory_raw_items%ROWTYPE;
  v_before numeric;
  v_after numeric;
  v_dir text;
  v_qty numeric;
  v_existing uuid;
  v_kind text;
  v_name text;
BEGIN
  IF p_item_id IS NULL THEN RAISE EXCEPTION 'ITEM_REQUIRED'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  IF auth.uid() IS NOT NULL AND NOT (
    public.has_role(auth.uid(), 'general_manager'::public.app_role)
    OR public.has_role(auth.uid(), 'executive_manager'::public.app_role)
    OR public.has_role(auth.uid(), 'meat_factory_manager'::public.app_role)
    OR public.has_role(auth.uid(), 'warehouse_supervisor'::public.app_role)
    OR public.has_role(auth.uid(), 'production_manager'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: ترحيل خامات المصنع لأمين المخزن أو مدير المصنع أو المدير';
  END IF;

  SELECT * INTO v_item FROM public.meat_factory_raw_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الصنف غير موجود في خامات مصنع اللحوم'; END IF;
  v_before := COALESCE(v_item.current_stock, 0);
  v_kind := COALESCE(p_item_kind, v_item.kind, 'raw');
  v_name := COALESCE(p_item_name, v_item.name);

  IF COALESCE(p_effect, 'delta') = 'set' THEN
    v_after := COALESCE(p_target_stock, v_before);
    IF v_after < 0 THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK: الرصيد المستهدف سالب'; END IF;
    IF v_after = v_before THEN
      RETURN jsonb_build_object('status', 'no_change', 'stock_before', v_before, 'stock_after', v_after);
    END IF;
    v_dir := CASE WHEN v_after >= v_before THEN 'IN' ELSE 'OUT' END;
    v_qty := abs(v_after - v_before);
  ELSE
    v_dir := upper(btrim(COALESCE(p_direction, '')));
    IF v_dir NOT IN ('IN', 'OUT') THEN RAISE EXCEPTION 'INVALID_DIRECTION'; END IF;
    v_qty := abs(COALESCE(p_quantity, 0));
    IF v_qty = 0 THEN
      RETURN jsonb_build_object('status', 'no_change', 'stock_before', v_before, 'stock_after', v_before);
    END IF;
    IF v_dir = 'IN' THEN
      v_after := v_before + v_qty;
    ELSE
      IF v_before < v_qty THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: المتاح % والمطلوب %', v_before, v_qty;
      END IF;
      v_after := v_before - v_qty;
    END IF;
  END IF;

  IF p_ref_id IS NOT NULL AND p_ref_table IS NOT NULL THEN
    SELECT id INTO v_existing
      FROM public.meat_factory_inventory_moves
     WHERE ref_table = p_ref_table
       AND ref_id = p_ref_id
       AND item_id = p_item_id
       AND direction = v_dir
     LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('id', v_existing, 'status', 'already_posted', 'stock_before', v_before, 'stock_after', v_before);
    END IF;
  END IF;

  PERFORM set_config('app.meat_raw_stock_write', 'on', true);
  UPDATE public.meat_factory_raw_items
     SET current_stock = v_after,
         avg_cost = COALESCE(p_avg_cost, avg_cost),
         updated_at = now()
   WHERE id = p_item_id;

  INSERT INTO public.meat_factory_inventory_moves(
    item_kind, item_id, item_name, direction, quantity, unit_cost, reason,
    ref_table, ref_id, created_by, stock_before, stock_after, ledger_keyed
  ) VALUES (
    v_kind, p_item_id, v_name, v_dir, v_qty, COALESCE(p_unit_cost, 0), btrim(p_reason),
    p_ref_table, p_ref_id, auth.uid(), v_before, v_after, true
  );

  PERFORM set_config('app.meat_raw_stock_write', 'off', true);

  RETURN jsonb_build_object(
    'status', 'posted', 'stock_before', v_before, 'stock_after', v_after, 'direction', v_dir, 'quantity', v_qty
  );
EXCEPTION WHEN unique_violation THEN
  PERFORM set_config('app.meat_raw_stock_write', 'off', true);
  IF SQLERRM NOT ILIKE '%meat_raw_moves_source_uidx%'
     AND SQLERRM NOT ILIKE '%uq_meat_moves_%' THEN
    RAISE;
  END IF;
  RETURN jsonb_build_object('status', 'already_posted', 'stock_before', v_before, 'stock_after', v_before);
END;
$function$;

REVOKE ALL ON FUNCTION public.post_meat_raw_movement(
  uuid, text, numeric, numeric, text, text, uuid, text, text, numeric, numeric, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_meat_raw_movement(
  uuid, text, numeric, numeric, text, text, uuid, text, text, numeric, numeric, text
) TO authenticated, service_role;



CREATE OR REPLACE FUNCTION public.ledger_apply_card_stock(p_item_id uuid, p_stock numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM set_config('app.inventory_stock_write', 'on', true);
  UPDATE public.inventory_items
     SET stock = COALESCE(p_stock, 0),
         last_movement_date = now()
   WHERE id = p_item_id;
  PERFORM set_config('app.inventory_stock_write', 'off', true);
END;
$$;

REVOKE ALL ON FUNCTION public.ledger_apply_card_stock(uuid, numeric) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.post_named_stock(
  p_store text,
  p_item_id uuid,
  p_delta numeric,
  p_source_type text,
  p_source_id uuid,
  p_source_line text,
  p_reason text,
  p_unit_cost numeric DEFAULT NULL,
  p_effect text DEFAULT 'delta',
  p_target numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_before numeric;
  v_after numeric;
  v_existing uuid;
  v_line text := btrim(COALESCE(p_source_line, ''));
BEGIN
  IF auth.uid() IS NOT NULL
     AND COALESCE(current_setting('app.named_stock_internal', true), '') IS DISTINCT FROM 'on'
     AND NOT public.has_any_role(auth.uid(), ARRAY[
       'general_manager'::public.app_role,
       'executive_manager'::public.app_role,
       'feed_factory_manager'::public.app_role,
       'warehouse_supervisor'::public.app_role,
       'meat_factory_manager'::public.app_role,
       'slaughterhouse_manager'::public.app_role,
       'production_manager'::public.app_role,
       'brooding_manager'::public.app_role,
       'accountant'::public.app_role,
       'financial_manager'::public.app_role
     ]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF p_store IS NULL OR p_item_id IS NULL OR p_source_type IS NULL OR p_source_id IS NULL OR v_line = '' THEN
    RAISE EXCEPTION 'NAMED_STOCK_SOURCE_REQUIRED';
  END IF;
  IF p_store NOT IN (
    'feed_raw_materials', 'feed_products', 'slaughterhouse_feed_inventory',
    'brooding_feed_inventory', 'meat_factory_products'
  ) THEN
    RAISE EXCEPTION 'UNKNOWN_NAMED_STORE: %', p_store;
  END IF;

  SELECT id INTO v_existing
    FROM public.separate_stock_movements
   WHERE store_name = p_store
     AND source_type = p_source_type
     AND source_id = p_source_id
     AND source_line_id = v_line;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_posted', 'id', v_existing);
  END IF;

  PERFORM set_config('app.named_stock_write', 'on', true);

  IF p_store = 'feed_raw_materials' THEN
    SELECT stock INTO v_before FROM public.feed_raw_materials WHERE id = p_item_id FOR UPDATE;
  ELSIF p_store = 'feed_products' THEN
    SELECT current_stock INTO v_before FROM public.feed_products WHERE id = p_item_id FOR UPDATE;
  ELSIF p_store = 'slaughterhouse_feed_inventory' THEN
    SELECT current_kg INTO v_before FROM public.slaughterhouse_feed_inventory WHERE id = p_item_id FOR UPDATE;
  ELSIF p_store = 'brooding_feed_inventory' THEN
    SELECT current_kg INTO v_before FROM public.brooding_feed_inventory WHERE id = p_item_id FOR UPDATE;
  ELSE
    SELECT current_stock INTO v_before FROM public.meat_factory_products WHERE id = p_item_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    PERFORM set_config('app.named_stock_write', 'off', true);
    RAISE EXCEPTION 'NAMED_STOCK_ITEM_NOT_FOUND';
  END IF;

  IF COALESCE(p_effect, 'delta') = 'set' THEN
    v_after := COALESCE(p_target, v_before);
  ELSE
    v_after := COALESCE(v_before, 0) + COALESCE(p_delta, 0);
  END IF;
  IF v_after < 0 THEN
    PERFORM set_config('app.named_stock_write', 'off', true);
    RAISE EXCEPTION 'NAMED_STOCK_INSUFFICIENT: الرصيد % والحركة تصله إلى %', v_before, v_after;
  END IF;

  INSERT INTO public.separate_stock_movements(
    store_name, item_id, direction, quantity, stock_before, stock_after,
    source_type, source_id, source_line_id, reason, unit_cost, created_by
  ) VALUES (
    p_store, p_item_id,
    CASE WHEN v_after > v_before THEN 'in' WHEN v_after < v_before THEN 'out' ELSE 'set' END,
    abs(v_after - v_before), v_before, v_after,
    p_source_type, p_source_id, v_line, p_reason, p_unit_cost, auth.uid()
  );

  IF p_store = 'feed_raw_materials' THEN
    UPDATE public.feed_raw_materials
       SET stock = v_after,
           unit_cost = CASE WHEN p_unit_cost IS NOT NULL AND p_unit_cost > 0 THEN p_unit_cost ELSE unit_cost END,
           updated_at = now()
     WHERE id = p_item_id;
  ELSIF p_store = 'feed_products' THEN
    UPDATE public.feed_products
       SET current_stock = v_after,
           latest_unit_cost = CASE WHEN p_unit_cost IS NOT NULL AND p_unit_cost > 0 THEN p_unit_cost ELSE latest_unit_cost END,
           updated_at = now()
     WHERE id = p_item_id;
  ELSIF p_store = 'slaughterhouse_feed_inventory' THEN
    UPDATE public.slaughterhouse_feed_inventory
       SET current_kg = v_after,
           last_unit_cost = CASE WHEN p_unit_cost IS NOT NULL AND p_unit_cost > 0 THEN p_unit_cost ELSE last_unit_cost END,
           updated_at = now()
     WHERE id = p_item_id;
  ELSIF p_store = 'brooding_feed_inventory' THEN
    UPDATE public.brooding_feed_inventory
       SET current_kg = v_after,
           last_unit_cost = CASE WHEN p_unit_cost IS NOT NULL AND p_unit_cost > 0 THEN p_unit_cost ELSE last_unit_cost END,
           updated_at = now()
     WHERE id = p_item_id;
  ELSE
    UPDATE public.meat_factory_products
       SET current_stock = v_after,
           latest_unit_cost = CASE WHEN p_unit_cost IS NOT NULL AND p_unit_cost > 0 THEN p_unit_cost ELSE latest_unit_cost END,
           updated_at = now()
     WHERE id = p_item_id;
  END IF;

  PERFORM set_config('app.named_stock_write', 'off', true);
  RETURN jsonb_build_object('status', 'posted', 'before', v_before, 'after', v_after);
END;
$$;

REVOKE ALL ON FUNCTION public.post_named_stock(text, uuid, numeric, text, uuid, text, text, numeric, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_named_stock(text, uuid, numeric, text, uuid, text, text, numeric, text, numeric) TO authenticated, service_role;
