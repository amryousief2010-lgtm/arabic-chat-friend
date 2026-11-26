-- Box replace/delete and item-line delete must reverse posted inventory
-- movements instead of updating them. Delivered→pending (or any
-- non-cancelled status) must return net dispatched stock.
-- Bodies of apply_order_box_copy_change / save_order_items_edit /
-- handle_order_status_stock start from the coceg-prod live definitions
-- captured 2026-11-15 (frozen per-box shipping rule of 5 Nov is preserved).

CREATE OR REPLACE FUNCTION public._return_order_items_dispatched_stock(
  p_order_id uuid,
  p_item_ids uuid[],
  p_reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r         record;
  v_ii      record;
  v_n       integer := 0;
  v_line_net numeric;
  v_qty     numeric;
  v_rev     uuid;
  v_line    uuid;
BEGIN
  IF p_order_id IS NULL
     OR p_item_ids IS NULL
     OR coalesce(array_length(p_item_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM set_config('app.inventory_internal_post', 'on', true);
  FOR r IN SELECT * FROM public._order_net_dispatched_items(p_order_id) LOOP
    -- Line-level net, capped by remaining order-level net so a prior
    -- whole-order return cannot be double-posted.
    SELECT COALESCE(SUM(
             CASE WHEN m.movement_type = 'sales_dispatch' THEN abs(m.quantity)
                  ELSE -abs(m.quantity) END
           ), 0)
      INTO v_line_net
      FROM public.inventory_movements m
     WHERE m.reference_type = 'order'
       AND m.reference_id = p_order_id::text
       AND m.movement_type IN ('sales_dispatch', 'sales_return')
       AND COALESCE(m.approval_status, 'posted') = 'posted'
       AND m.item_id = r.item_id
       AND m.warehouse_id IS NOT DISTINCT FROM r.warehouse_id
       AND (
         m.order_item_id = ANY(p_item_ids)
         OR m.reverses_movement_id IN (
           SELECT d.id
             FROM public.inventory_movements d
            WHERE d.reference_type = 'order'
              AND d.reference_id = p_order_id::text
              AND d.movement_type = 'sales_dispatch'
              AND d.order_item_id = ANY(p_item_ids)
         )
       );

    v_qty := least(r.net_qty, greatest(v_line_net, 0));
    IF v_qty IS NULL OR v_qty <= 0 THEN
      CONTINUE;
    END IF;

    SELECT id, warehouse_id, product_id, unit_cost, module
      INTO v_ii
      FROM public.inventory_items
     WHERE id = r.item_id
     FOR UPDATE;
    IF v_ii.id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT d.id, d.order_item_id
      INTO v_rev, v_line
      FROM public.inventory_movements d
     WHERE d.reference_type = 'order'
       AND d.reference_id = p_order_id::text
       AND d.movement_type = 'sales_dispatch'
       AND COALESCE(d.approval_status, 'posted') = 'posted'
       AND d.item_id = r.item_id
       AND d.warehouse_id IS NOT DISTINCT FROM r.warehouse_id
       AND d.order_item_id = ANY(p_item_ids)
     ORDER BY d.performed_at DESC NULLS LAST, d.created_at DESC
     LIMIT 1;

    -- source_line_id must not collide with whole-order returns
    -- (_return_order_dispatched_stock uses the inventory item id).
    PERFORM public.post_inventory_movement(
      v_ii.id, 'sales_return', v_qty,
      'order_return', p_order_id,
      'order_item_return:' || r.item_id::text || ':' || md5(
        array_to_string(
          ARRAY(SELECT DISTINCT x::text FROM unnest(p_item_ids) AS x ORDER BY 1),
          ','
        )
      ),
      COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'مرتجع أوردر'),
      'إرجاع صرف الأوردر',
      now(), COALESCE(v_ii.unit_cost, 0), NULL, p_order_id::text,
      'delta', false,
      COALESCE(r.warehouse_id, v_ii.warehouse_id),
      v_ii.product_id, COALESCE(v_ii.module, 'sales'),
      v_rev, NULL, 'order', p_order_id::text, NULL, NULL, NULL, v_line
    );
    v_n := v_n + 1;
  END LOOP;
  PERFORM set_config('app.inventory_internal_post', 'off', true);
  RETURN v_n;
END;
$function$;


REVOKE ALL ON FUNCTION public._return_order_items_dispatched_stock(uuid, uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._return_order_items_dispatched_stock(uuid, uuid[], text) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_order_box_copy_change(p_order_id uuid, p_target_key text, p_operation text, p_payload jsonb, p_snapshot_token text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_order public.orders%ROWTYPE;
  v_audit public.order_box_copy_audit%ROWTYPE;
  v_inst public.order_offer_instances%ROWTYPE;
  v_copy public.order_box_copies%ROWTYPE;
  v_key text := btrim(coalesce(p_target_key, ''));
  v_op text := btrim(coalesce(p_operation, ''));
  v_items jsonb := '[]'::jsonb;
  v_new_name text;
  v_new_box uuid;
  v_elem jsonb;
  v_removed jsonb := '[]'::jsonb;
  v_added jsonb := '[]'::jsonb;
  v_source_name text;
  v_source_box uuid;
  v_source_index integer;
  v_source_kind text;
  v_new_copy uuid;
  v_new_index integer;
  v_qty numeric;
  v_unit numeric;
  v_gift boolean;
  v_pid uuid;
  v_pname text;
  v_line_id uuid;
  v_removed_price numeric := 0;
  v_added_price numeric := 0;
  v_next_included numeric := 0;
  v_prev_included numeric := 0;
  v_new_fee numeric := 0;
  v_subtotal numeric := 0;
  v_new_total numeric := 0;
  v_delta numeric := 0;
  v_cash numeric := 0;
  v_fixed numeric := 0;
  v_result jsonb;
  v_ship numeric;
  v_row record;
  v_deltas jsonb := '{}'::jsonb;
  v_product text;
  v_change numeric;
  v_res_qty numeric;
  v_res_id uuid;
  v_new_res numeric;
  v_item_id uuid;
  v_stock numeric;
  v_other numeric;
  v_available numeric;
  v_agouza constant uuid := 'a970d469-37df-40e1-b99f-a49195a3778e';
BEGIN
  v_uid := public._assert_box_copy_editor();
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'مفتاح العملية مطلوب';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب غير موجود';
  END IF;

  SELECT * INTO v_audit
  FROM public.order_box_copy_audit
  WHERE order_id = p_order_id AND idempotency_key = btrim(p_idempotency_key);
  IF FOUND THEN
    RETURN coalesce(v_audit.result, '{}'::jsonb) || jsonb_build_object('idempotent', true);
  END IF;

  IF v_order.status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'لا يمكن تعديل بوكسات طلب تم تسليمه أو إلغاؤه';
  END IF;

  IF p_snapshot_token IS NULL
     OR btrim(p_snapshot_token) = ''
     OR p_snapshot_token IS DISTINCT FROM public.order_box_snapshot_token(p_order_id) THEN
    RAISE EXCEPTION 'الطلب تغيّر. حدّث الشاشة ثم أعد المحاولة';
  END IF;

  IF v_op NOT IN ('replace_box', 'replace_products', 'delete') THEN
    RAISE EXCEPTION 'نوع العملية غير معروف';
  END IF;

  IF p_payload IS NULL THEN
    v_items := '[]'::jsonb;
  ELSIF jsonb_typeof(p_payload) = 'array' THEN
    v_items := p_payload;
  ELSE
    v_items := coalesce(p_payload->'items', '[]'::jsonb);
  END IF;

  IF v_op = 'replace_box' THEN
    v_new_name := btrim(coalesce(p_payload->>'offer_name', ''));
    IF v_new_name = '' THEN
      RAISE EXCEPTION 'اسم البوكس البديل مطلوب';
    END IF;
    IF nullif(p_payload->>'offer_box_id', '') IS NOT NULL THEN
      BEGIN
        v_new_box := (p_payload->>'offer_box_id')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'البوكس البديل غير موجود';
      END;
      IF NOT EXISTS (SELECT 1 FROM public.offer_boxes WHERE id = v_new_box) THEN
        RAISE EXCEPTION 'البوكس البديل غير موجود';
      END IF;
    END IF;
  END IF;

  IF v_op <> 'delete' THEN
    IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
      RAISE EXCEPTION 'لا توجد منتجات بديلة';
    END IF;
    FOR v_elem IN SELECT value FROM jsonb_array_elements(v_items) LOOP
      IF coalesce((v_elem->>'quantity')::numeric, 0) <= 0 THEN
        RAISE EXCEPTION 'كمية المنتج البديل يجب أن تكون أكبر من صفر';
      END IF;
      IF coalesce((v_elem->>'unit_price')::numeric, 0) < 0 THEN
        RAISE EXCEPTION 'سعر المنتج البديل غير صالح';
      END IF;
      IF btrim(coalesce(v_elem->>'product_name', '')) = '' THEN
        RAISE EXCEPTION 'اسم المنتج البديل مطلوب';
      END IF;
    END LOOP;
  END IF;

  v_copy := NULL;
  v_inst := NULL;

  IF v_key = 'plain' THEN
    v_source_kind := 'plain';
    v_source_name := NULL;
    v_source_box := NULL;
    v_source_index := 1;
    IF NOT EXISTS (
      SELECT 1 FROM public.order_items i
      WHERE i.order_id = p_order_id AND btrim(coalesce(i.offer_name, '')) = ''
    ) THEN
      RAISE EXCEPTION 'النسخة غير موجودة';
    END IF;
  ELSIF v_key LIKE 'orphan:%' THEN
    v_source_kind := 'orphan';
    v_source_name := substr(v_key, 8);
    v_source_box := NULL;
    v_source_index := 1;
    IF NOT EXISTS (
      SELECT 1 FROM public.order_items i
      WHERE i.order_id = p_order_id AND btrim(coalesce(i.offer_name, '')) = v_source_name
    ) THEN
      RAISE EXCEPTION 'النسخة غير موجودة';
    END IF;
  ELSIF v_key LIKE 'copy:%' THEN
    v_source_kind := 'materialized';
    BEGIN
      v_copy := NULL;
      SELECT * INTO v_copy
      FROM public.order_box_copies
      WHERE id = substr(v_key, 6)::uuid
        AND order_id = p_order_id
        AND active;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'النسخة غير موجودة';
      END IF;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'النسخة غير موجودة';
    END;
    v_source_name := v_copy.offer_name;
    v_source_box := v_copy.offer_box_id;
    v_source_index := v_copy.copy_index;
  ELSIF v_key LIKE 'inst:%' THEN
    v_source_kind := 'virtual';
    BEGIN
      v_inst := NULL;
      SELECT * INTO v_inst
      FROM public.order_offer_instances
      WHERE id = substr(v_key, 6, 36)::uuid
        AND order_id = p_order_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'النسخة غير موجودة';
      END IF;
      v_source_index := substr(v_key, 43)::integer;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'النسخة غير موجودة';
      WHEN numeric_value_out_of_range THEN
        RAISE EXCEPTION 'النسخة غير موجودة';
    END;
    PERFORM public._materialize_offer_box_copies(p_order_id, v_inst.offer_name);
    v_copy := NULL;
    SELECT * INTO v_copy
    FROM public.order_box_copies
    WHERE order_id = p_order_id
      AND offer_name = v_inst.offer_name
      AND copy_index = v_source_index
      AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'النسخة غير موجودة';
    END IF;
    v_source_name := v_copy.offer_name;
    v_source_box := coalesce(v_copy.offer_box_id, v_inst.offer_box_id);
    v_source_index := v_copy.copy_index;
  ELSE
    RAISE EXCEPTION 'النسخة غير موجودة';
  END IF;

  PERFORM set_config('app.skip_order_recompute', 'on', true);

  IF v_source_kind = 'plain' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'product_id', i.product_id, 'product_name', i.product_name,
      'quantity', i.quantity, 'unit_price', i.unit_price, 'offer_name', i.offer_name,
      'is_gift', coalesce(i.is_gift, false)
    )), '[]'::jsonb)
    INTO v_removed
    FROM public.order_items i
    WHERE i.order_id = p_order_id
      AND btrim(coalesce(i.offer_name, '')) = ''
      AND NOT (i.product_id IS NULL AND btrim(coalesce(i.product_name, '')) = 'تكلفة الشحن');
  ELSIF v_source_kind = 'orphan' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'product_id', i.product_id, 'product_name', i.product_name,
      'quantity', i.quantity, 'unit_price', i.unit_price, 'offer_name', i.offer_name,
      'is_gift', coalesce(i.is_gift, false)
    )), '[]'::jsonb)
    INTO v_removed
    FROM public.order_items i
    WHERE i.order_id = p_order_id
      AND btrim(coalesce(i.offer_name, '')) = v_source_name
      AND NOT (i.product_id IS NULL AND btrim(coalesce(i.product_name, '')) = 'تكلفة الشحن');
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'product_id', i.product_id, 'product_name', i.product_name,
      'quantity', i.quantity, 'unit_price', i.unit_price, 'offer_name', i.offer_name,
      'is_gift', coalesce(i.is_gift, false)
    )), '[]'::jsonb)
    INTO v_removed
    FROM public.order_items i
    WHERE i.offer_copy_id = v_copy.id;
  END IF;

  PERFORM public._return_order_items_dispatched_stock(
    p_order_id,
    ARRAY(
      SELECT (elem->>'id')::uuid
      FROM jsonb_array_elements(v_removed) elem
      WHERE nullif(elem->>'id', '') IS NOT NULL
    ),
    'مرتجع تلقائي بسبب استبدال/حذف بوكس في الطلب ' || v_order.order_number
  );
  PERFORM set_config('app.inventory_ledger_relink', 'on', true);

  IF v_source_kind = 'plain' THEN
    DELETE FROM public.order_items i
    WHERE i.order_id = p_order_id
      AND btrim(coalesce(i.offer_name, '')) = ''
      AND NOT (i.product_id IS NULL AND btrim(coalesce(i.product_name, '')) = 'تكلفة الشحن');
  ELSIF v_source_kind = 'orphan' THEN
    DELETE FROM public.order_items i
    WHERE i.order_id = p_order_id
      AND btrim(coalesce(i.offer_name, '')) = v_source_name
      AND NOT (i.product_id IS NULL AND btrim(coalesce(i.product_name, '')) = 'تكلفة الشحن');
  ELSE
    DELETE FROM public.order_items WHERE offer_copy_id = v_copy.id;
    UPDATE public.order_box_copies SET active = false WHERE id = v_copy.id;
  END IF;

  PERFORM set_config('app.inventory_ledger_relink', 'off', true);

  SELECT coalesce(sum((elem->>'quantity')::numeric * (elem->>'unit_price')::numeric), 0)
  INTO v_removed_price
  FROM jsonb_array_elements(v_removed) elem
  WHERE coalesce((elem->>'is_gift')::boolean, false) = false;

  IF v_op = 'replace_box' OR v_op = 'replace_products' THEN
    IF v_op = 'replace_box' THEN
      SELECT coalesce(max(copy_index), 0) + 1 INTO v_new_index
      FROM public.order_box_copies
      WHERE order_id = p_order_id AND offer_name = v_new_name;
      INSERT INTO public.order_box_copies (
        order_id, offer_box_id, offer_name, copy_index, recorded_price, active
      ) VALUES (
        p_order_id, v_new_box, v_new_name, v_new_index, 0, true
      ) RETURNING id INTO v_new_copy;
    END IF;

    FOR v_elem IN SELECT value FROM jsonb_array_elements(v_items) LOOP
      v_qty := (v_elem->>'quantity')::numeric;
      v_gift := coalesce((v_elem->>'is_gift')::boolean, false);
      v_unit := CASE WHEN v_gift THEN 0 ELSE (v_elem->>'unit_price')::numeric END;
      v_pname := btrim(v_elem->>'product_name');
      v_pid := nullif(v_elem->>'product_id', '')::uuid;
      INSERT INTO public.order_items (
        order_id, product_id, product_name, quantity, unit_price, total_price,
        offer_name, offer_copy_id, is_gift
      ) VALUES (
        p_order_id,
        v_pid,
        v_pname,
        v_qty,
        v_unit,
        round(v_qty * v_unit, 2),
        CASE WHEN v_op = 'replace_box' THEN v_new_name ELSE NULL END,
        CASE WHEN v_op = 'replace_box' THEN v_new_copy ELSE NULL END,
        v_gift
      ) RETURNING id INTO v_line_id;
      v_added := v_added || jsonb_build_object(
        'id', v_line_id,
        'product_id', v_pid,
        'product_name', v_pname,
        'quantity', v_qty,
        'unit_price', v_unit,
        'is_gift', v_gift,
        'offer_name', CASE WHEN v_op = 'replace_box' THEN v_new_name ELSE NULL END
      );
      IF NOT v_gift THEN
        v_added_price := v_added_price + (v_qty * v_unit);
      END IF;
    END LOOP;

    IF v_op = 'replace_box' THEN
      UPDATE public.order_box_copies
      SET recorded_price = round(v_added_price, 2)
      WHERE id = v_new_copy;
    END IF;
  END IF;

  IF v_source_name IS NOT NULL THEN
    PERFORM public._sync_offer_instance_count(p_order_id, v_source_name, v_source_box, v_uid);
  END IF;
  IF v_op = 'replace_box' THEN
    PERFORM public._sync_offer_instance_count(p_order_id, v_new_name, v_new_box, v_uid);
  END IF;

  FOR v_row IN
    SELECT offer_name, offer_box_id, quantity, shipping_cost_per_box
    FROM public.order_offer_instances
    WHERE order_id = p_order_id
  LOOP
    -- Frozen per-box shipping (set when the box row was created). Catalog only as a fallback.
    v_next_included := v_next_included
      + coalesce(v_row.shipping_cost_per_box, public._box_offer_shipping(v_row.offer_box_id, v_row.offer_name)) * v_row.quantity;
  END LOOP;
  -- GM rule 5/11/2026: shipping is per box and never auto-deducted.
  -- A box change (delete / replace a box copy) sets the fee to the sum of the
  -- frozen per-box shipping of the boxes still on the order. Replacing or
  -- deleting plain (non-box) products is not a box change: the fee is kept.
  IF v_source_kind = 'plain' AND v_op <> 'replace_box' THEN
    v_new_fee := coalesce(v_order.delivery_fee, 0);
  ELSE
    v_new_fee := v_next_included;
  END IF;
  IF v_new_fee < 0 THEN
    v_new_fee := 0;
  END IF;
  v_new_fee := round(v_new_fee, 2);

  SELECT coalesce(round(sum(i.quantity * i.unit_price), 2), 0)
  INTO v_subtotal
  FROM public.order_items i
  WHERE i.order_id = p_order_id
    AND coalesce(i.is_gift, false) = false
    AND NOT (
      i.product_id IS NULL
      AND btrim(coalesce(i.product_name, '')) = 'تكلفة الشحن'
      AND btrim(coalesce(i.offer_name, '')) <> ''
    );

  v_new_total := round(
    v_subtotal - coalesce(v_order.discount, 0) + coalesce(v_order.extra_charge, 0) + v_new_fee,
    2
  );

  IF v_order.source_warehouse_id = v_agouza
     AND v_order.stock_status IS DISTINCT FROM 'dispatched'
     AND to_regclass('public.agouza_stock_reservations') IS NOT NULL
     AND to_regclass('public.inventory_items') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.agouza_stock_reservations r
       WHERE r.order_id = p_order_id AND r.status = 'active'
     )
  THEN
    FOR v_elem IN SELECT value FROM jsonb_array_elements(v_removed) LOOP
      IF nullif(v_elem->>'product_id', '') IS NULL THEN
        CONTINUE;
      END IF;
      v_product := v_elem->>'product_id';
      v_deltas := jsonb_set(
        v_deltas,
        ARRAY[v_product],
        to_jsonb(coalesce((v_deltas->>v_product)::numeric, 0) - (v_elem->>'quantity')::numeric),
        true
      );
    END LOOP;
    FOR v_elem IN SELECT value FROM jsonb_array_elements(v_added) LOOP
      IF nullif(v_elem->>'product_id', '') IS NULL THEN
        CONTINUE;
      END IF;
      v_product := v_elem->>'product_id';
      v_deltas := jsonb_set(
        v_deltas,
        ARRAY[v_product],
        to_jsonb(coalesce((v_deltas->>v_product)::numeric, 0) + (v_elem->>'quantity')::numeric),
        true
      );
    END LOOP;

    FOR v_product, v_change IN
      SELECT key, value::numeric FROM jsonb_each_text(v_deltas)
    LOOP
      IF abs(v_change) <= 0.0000001 THEN
        CONTINUE;
      END IF;
      v_pid := v_product::uuid;

      PERFORM 1
      FROM public.agouza_stock_reservations r
      WHERE r.order_id = p_order_id AND r.product_id = v_pid AND r.status = 'active'
      FOR UPDATE;

      SELECT coalesce(sum(r.quantity), 0) INTO v_res_qty
      FROM public.agouza_stock_reservations r
      WHERE r.order_id = p_order_id AND r.product_id = v_pid AND r.status = 'active';

      v_res_id := NULL;
      SELECT r.id INTO v_res_id
      FROM public.agouza_stock_reservations r
      WHERE r.order_id = p_order_id AND r.product_id = v_pid AND r.status = 'active'
      ORDER BY r.reserved_at
      LIMIT 1
      FOR UPDATE;

      v_new_res := coalesce(v_res_qty, 0) + v_change;

      IF v_change > 0 THEN
        SELECT ii.id, coalesce(ii.stock, 0)
        INTO v_item_id, v_stock
        FROM public.inventory_items ii
        WHERE ii.warehouse_id = v_agouza AND ii.product_id = v_pid
        ORDER BY ii.id
        LIMIT 1
        FOR UPDATE;
        IF NOT FOUND THEN
          v_stock := 0;
          v_item_id := NULL;
        END IF;
        SELECT coalesce(sum(r.quantity), 0) INTO v_other
        FROM public.agouza_stock_reservations r
        WHERE r.product_id = v_pid
          AND r.status = 'active'
          AND r.order_id <> p_order_id;
        v_available := coalesce(v_stock, 0) - coalesce(v_other, 0);
        IF v_new_res > v_available + 0.0000001 OR v_item_id IS NULL THEN
          SELECT coalesce(
            (SELECT elem->>'product_name' FROM jsonb_array_elements(v_added) elem WHERE elem->>'product_id' = v_product LIMIT 1),
            (SELECT elem->>'product_name' FROM jsonb_array_elements(v_removed) elem WHERE elem->>'product_id' = v_product LIMIT 1),
            v_product
          ) INTO v_pname;
          RAISE EXCEPTION 'المخزون غير كافٍ للمنتج %', v_pname;
        END IF;
        IF v_res_id IS NULL THEN
          INSERT INTO public.agouza_stock_reservations (
            order_id, product_id, inventory_item_id, quantity, status, reserved_by
          ) VALUES (
            p_order_id, v_pid, v_item_id, v_new_res, 'active', v_uid
          );
        ELSE
          UPDATE public.agouza_stock_reservations
          SET quantity = v_new_res, updated_at = now()
          WHERE id = v_res_id;
          UPDATE public.agouza_stock_reservations
          SET status = 'released',
              released_at = now(),
              released_by = v_uid,
              release_reason = 'box_copy_change_merged',
              updated_at = now()
          WHERE order_id = p_order_id
            AND product_id = v_pid
            AND status = 'active'
            AND id <> v_res_id;
        END IF;
      ELSE
        IF v_new_res <= 0.0000001 THEN
          UPDATE public.agouza_stock_reservations
          SET status = 'released',
              released_at = now(),
              released_by = v_uid,
              release_reason = 'box_copy_change',
              updated_at = now()
          WHERE order_id = p_order_id AND product_id = v_pid AND status = 'active';
        ELSE
          UPDATE public.agouza_stock_reservations
          SET quantity = v_new_res, updated_at = now()
          WHERE id = v_res_id;
          UPDATE public.agouza_stock_reservations
          SET status = 'released',
              released_at = now(),
              released_by = v_uid,
              release_reason = 'box_copy_change_merged',
              updated_at = now()
          WHERE order_id = p_order_id
            AND product_id = v_pid
            AND status = 'active'
            AND id <> v_res_id;
        END IF;
      END IF;
    END LOOP;
  END IF;

  v_delta := v_new_total - coalesce(v_order.total, 0);
  v_cash := coalesce(v_order.courier_cash_due, 0);
  IF v_order.collection_method = 'mixed_payment' THEN
    v_fixed := coalesce(v_order.vodafone_cash_amount, 0)
      + coalesce(v_order.instapay_amount, 0)
      + coalesce(v_order.bank_transfer_amount, 0)
      + coalesce(v_order.other_amount, 0)
      + coalesce(v_order.free_amount, 0)
      + coalesce(v_order.deposit_amount, 0);
    v_cash := round(coalesce(v_order.courier_cash_due, 0) + v_delta, 2);
    IF v_cash < -0.01 THEN
      RAISE EXCEPTION 'المدفوعات السابقة أكبر من إجمالي الطلب الجديد';
    END IF;
  ELSIF coalesce(v_order.courier_cash_due, 0) <> 0 THEN
    v_cash := greatest(0, round(coalesce(v_order.courier_cash_due, 0) + v_delta, 2));
  END IF;

  UPDATE public.orders
  SET subtotal = v_subtotal,
      delivery_fee = v_new_fee,
      total = v_new_total,
      courier_cash_due = CASE
        WHEN collection_method = 'mixed_payment' THEN v_cash
        WHEN coalesce(courier_cash_due, 0) <> 0 THEN v_cash
        ELSE courier_cash_due
      END,
      updated_at = now()
  WHERE id = p_order_id;

  v_result := jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'operation', v_op,
    'source_key', v_key,
    'previous_total', v_order.total,
    'new_total', v_new_total,
    'delivery_fee', v_new_fee,
    'subtotal', v_subtotal,
    'price_delta', round(v_added_price - v_removed_price, 2)
  );

  INSERT INTO public.order_box_copy_audit (
    order_id, idempotency_key, acted_by, operation, source_key,
    source_offer_name, source_copy_index, source_recorded_price,
    removed_items, added_items, price_delta, previous_total, new_total, result
  ) VALUES (
    p_order_id, btrim(p_idempotency_key), v_uid, v_op, v_key,
    v_source_name, v_source_index, round(v_removed_price, 2),
    v_removed, v_added, round(v_added_price - v_removed_price, 2),
    v_order.total, v_new_total, v_result
  );

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_order_box_copy_change(uuid, text, text, jsonb, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_order_items_edit(p_order_id uuid, p_items jsonb, p_subtotal numeric, p_discount numeric, p_total numeric, p_delivery_fee numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb;
  v_id uuid;
  v_product_id uuid;
  v_qty numeric;
  v_unit numeric;
  v_product_name text;
  v_order_no text;
  v_deleted_ids uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  IF NOT public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::public.app_role,
    'executive_manager'::public.app_role,
    'sales_manager'::public.app_role,
    'shipping_company'::public.app_role,
    'sales_moderator'::public.app_role
  ]) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية تعديل الطلب';
  END IF;

  PERFORM 1 FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب غير موجود';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'بيانات المنتجات غير صالحة';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS x(item)
    WHERE (x.item ? 'id')
      AND NULLIF(x.item->>'id', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.order_items oi
        WHERE oi.id = (x.item->>'id')::uuid
          AND oi.order_id = p_order_id
      )
  ) THEN
    RAISE EXCEPTION 'يوجد صنف لا ينتمي لهذا الطلب';
  END IF;

  PERFORM set_config('app.skip_order_recompute', 'on', true);

  SELECT o.order_number, coalesce(array_agg((x.item->>'id')::uuid) FILTER (
           WHERE (x.item->>'_deleted')::boolean IS TRUE
             AND NULLIF(x.item->>'id', '') IS NOT NULL
         ), ARRAY[]::uuid[])
    INTO v_order_no, v_deleted_ids
  FROM public.orders o
  LEFT JOIN jsonb_array_elements(p_items) AS x(item) ON true
  WHERE o.id = p_order_id
  GROUP BY o.order_number;

  IF coalesce(array_length(v_deleted_ids, 1), 0) > 0 THEN
    PERFORM public._return_order_items_dispatched_stock(
      p_order_id,
      v_deleted_ids,
      'مرتجع تلقائي بسبب حذف صنف من الطلب ' || coalesce(v_order_no, p_order_id::text)
    );
    PERFORM set_config('app.inventory_ledger_relink', 'on', true);
  END IF;

  DELETE FROM public.order_items oi
  USING jsonb_array_elements(p_items) AS x(item)
  WHERE (x.item->>'_deleted')::boolean IS TRUE
    AND NULLIF(x.item->>'id', '') IS NOT NULL
    AND oi.id = (x.item->>'id')::uuid
    AND oi.order_id = p_order_id;

  IF coalesce(array_length(v_deleted_ids, 1), 0) > 0 THEN
    PERFORM set_config('app.inventory_ledger_relink', 'off', true);
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF COALESCE((v_item->>'_deleted')::boolean, false) THEN
      CONTINUE;
    END IF;

    v_id := NULLIF(v_item->>'id', '')::uuid;
    v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
    v_qty := COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0);
    v_unit := COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0);
    v_product_name := COALESCE(NULLIF(v_item->>'product_name', ''), '');

    IF v_product_name = '' THEN
      RAISE EXCEPTION 'اسم المنتج مطلوب';
    END IF;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'الكمية يجب أن تكون أكبر من صفر';
    END IF;
    IF v_unit < 0 THEN
      RAISE EXCEPTION 'السعر غير صالح';
    END IF;

    IF v_id IS NULL THEN
      INSERT INTO public.order_items (
        order_id, product_id, product_name, quantity, unit_price, total_price,
        offer_name, is_half_kg, is_gift
      ) VALUES (
        p_order_id,
        v_product_id,
        v_product_name,
        v_qty,
        v_unit,
        v_qty * v_unit,
        NULLIF(v_item->>'offer_name', ''),
        COALESCE((v_item->>'is_half_kg')::boolean, false),
        COALESCE((v_item->>'is_gift')::boolean, false)
      );
    ELSE
      UPDATE public.order_items
      SET product_id = v_product_id,
          product_name = v_product_name,
          quantity = v_qty,
          unit_price = v_unit,
          total_price = v_qty * v_unit,
          offer_name = NULLIF(v_item->>'offer_name', ''),
          is_half_kg = COALESCE((v_item->>'is_half_kg')::boolean, false),
          is_gift = COALESCE((v_item->>'is_gift')::boolean, false)
      WHERE id = v_id
        AND order_id = p_order_id;
    END IF;
  END LOOP;

  UPDATE public.orders
  SET subtotal = COALESCE(p_subtotal, 0),
      discount = COALESCE(p_discount, 0),
      total = COALESCE(p_total, 0),
      delivery_fee = COALESCE(p_delivery_fee, delivery_fee),
      updated_at = now()
  WHERE id = p_order_id;

  PERFORM public.sync_order_offer_instances(p_order_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.save_order_items_edit(uuid, jsonb, numeric, numeric, numeric, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.handle_order_status_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result           jsonb;
  v_was_dispatched   boolean;
  v_returned         integer := 0;
  v_is_manual        boolean;
  v_commit_resv      boolean := false;
  v_err              text;
  v_detail           text;
  v_new_stock_status text := NEW.stock_status;
  v_wh               uuid := COALESCE(NEW.source_warehouse_id, OLD.source_warehouse_id);
BEGIN
  v_is_manual      := COALESCE(public.is_manual_stock_warehouse(v_wh), false);
  v_was_dispatched := COALESCE(OLD.stock_status,'') = 'dispatched';

  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    v_returned := public._return_order_dispatched_stock(NEW.id, 'إرجاع تلقائي عند إلغاء طلب مصروف');
    IF v_returned > 0 OR (v_was_dispatched AND NOT v_is_manual) THEN
      v_new_stock_status := 'returned';
    ELSIF NOT v_is_manual THEN
      v_new_stock_status := 'not_dispatched';
    END IF;
    PERFORM public._resolve_order_stock_dispatch_failures(NEW.id, 'system:order_cancelled');
  END IF;

  -- Revert from delivered to any non-cancelled status: return net posted
  -- dispatch (idempotent). Cancel is handled above and must not double-return.
  IF OLD.status = 'delivered'
     AND NEW.status IS DISTINCT FROM 'delivered'
     AND NEW.status IS DISTINCT FROM 'cancelled' THEN
    v_returned := public._return_order_dispatched_stock(
      NEW.id,
      'إرجاع تلقائي عند التراجع عن تسليم الطلب ' || coalesce(NEW.order_number, OLD.order_number)
    );
    IF v_returned > 0 OR v_was_dispatched THEN
      v_new_stock_status := 'not_dispatched';
    END IF;
    PERFORM public._resolve_order_stock_dispatch_failures(NEW.id, 'system:delivery_reverted');
  END IF;

  IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled' THEN
    IF COALESCE(OLD.stock_status,'') = 'returned' THEN
      v_new_stock_status := 'not_dispatched';
    END IF;
  END IF;

  IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered'
     AND COALESCE(v_new_stock_status,'not_dispatched') <> 'dispatched'
     AND NEW.source_warehouse_id IS NOT NULL THEN
    BEGIN
      IF NEW.source_warehouse_id = 'a970d469-37df-40e1-b99f-a49195a3778e'::uuid THEN
        v_commit_resv := NOT COALESCE(public.can_operate_agouza_order(NEW.id, 'commit'), false);
      END IF;
      v_result := public._dispatch_order_stock_core(NEW.id, auth.uid(), NULL, v_commit_resv);
      IF v_result->>'status' IN ('dispatched','already_dispatched') THEN
        v_new_stock_status := 'dispatched';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
      BEGIN
        PERFORM public._log_order_stock_dispatch_failure(NEW.id, v_err, v_detail, true);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'order % stock dispatch failed (%); failure logging also failed: %', NEW.id, v_err, SQLERRM;
      END;
    END;
  END IF;

  IF v_new_stock_status IS DISTINCT FROM NEW.stock_status THEN
    UPDATE public.orders SET stock_status = v_new_stock_status
     WHERE id = NEW.id AND stock_status IS DISTINCT FROM v_new_stock_status;
  END IF;

  RETURN NULL;
END;
$function$;
