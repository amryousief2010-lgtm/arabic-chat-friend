
-- Preview function: returns what would happen if this batch is cancelled
CREATE OR REPLACE FUNCTION public.feed_batch_cancel_preview(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_b public.feed_production_batches%ROWTYPE;
  v_product_name text;
  v_current_stock numeric;
  v_short numeric := 0;
  v_consumption jsonb;
BEGIN
  SELECT * INTO v_b FROM public.feed_production_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  SELECT name, current_stock INTO v_product_name, v_current_stock
    FROM public.feed_products WHERE id = v_b.feed_product_id;

  IF v_b.posted_to_inventory AND COALESCE(v_b.actual_quantity,0) > COALESCE(v_current_stock,0) THEN
    v_short := COALESCE(v_b.actual_quantity,0) - COALESCE(v_current_stock,0);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'raw_material_id', c.raw_material_id,
    'name', COALESCE(rm.name, c.material_name),
    'quantity', c.actual_qty,
    'unit', COALESCE(rm.unit, c.unit, 'kg'),
    'current_stock', rm.stock
  )), '[]'::jsonb)
  INTO v_consumption
  FROM public.feed_batch_consumption c
  LEFT JOIN public.feed_raw_materials rm ON rm.id = c.raw_material_id
  WHERE c.batch_id = p_batch_id AND COALESCE(c.actual_qty,0) > 0;

  RETURN jsonb_build_object(
    'batch_id', v_b.id,
    'batch_number', v_b.batch_number,
    'status', v_b.status,
    'posted_to_inventory', COALESCE(v_b.posted_to_inventory, false),
    'product_name', v_product_name,
    'produced_quantity', COALESCE(v_b.actual_quantity, 0),
    'product_current_stock', COALESCE(v_current_stock, 0),
    'shortage', v_short,
    'raw_materials_to_return', v_consumption
  );
END $$;

GRANT EXECUTE ON FUNCTION public.feed_batch_cancel_preview(uuid) TO authenticated;

-- Enhanced cancel: reverses inventory automatically
CREATE OR REPLACE FUNCTION public.feed_batch_cancel(
  p_batch_id uuid,
  p_reason text,
  p_force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_b public.feed_production_batches%ROWTYPE;
  v_c RECORD;
  v_current_stock numeric;
  v_short numeric := 0;
  v_is_top_mgr boolean;
  v_raw_count int := 0;
  v_finished_deducted numeric := 0;
BEGIN
  IF NOT public.can_manage_feed_batch(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  SELECT * INTO v_b FROM public.feed_production_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_b.status = 'cancelled' THEN RAISE EXCEPTION 'ALREADY_CANCELLED'; END IF;

  v_is_top_mgr := public.has_any_role(v_uid, ARRAY['general_manager','executive_manager']::app_role[]);

  -- Reverse inventory only if it was actually posted
  IF COALESCE(v_b.posted_to_inventory, false) THEN
    -- Check finished product stock
    SELECT current_stock INTO v_current_stock FROM public.feed_products WHERE id = v_b.feed_product_id FOR UPDATE;
    IF COALESCE(v_b.actual_quantity, 0) > COALESCE(v_current_stock, 0) THEN
      v_short := COALESCE(v_b.actual_quantity, 0) - COALESCE(v_current_stock, 0);
      IF NOT p_force THEN
        RAISE EXCEPTION 'FINISHED_STOCK_INSUFFICIENT: %', v_short;
      END IF;
      IF NOT v_is_top_mgr THEN
        RAISE EXCEPTION 'FORCE_REQUIRES_MANAGER';
      END IF;
    END IF;

    -- Deduct finished product (capped at current stock if forced partial)
    v_finished_deducted := LEAST(COALESCE(v_b.actual_quantity,0), COALESCE(v_current_stock,0) + CASE WHEN p_force THEN 0 ELSE COALESCE(v_b.actual_quantity,0) END);
    IF v_finished_deducted > 0 THEN
      UPDATE public.feed_products
        SET current_stock = current_stock - v_finished_deducted, updated_at = now()
        WHERE id = v_b.feed_product_id;

      INSERT INTO public.feed_finished_goods_moves(
        batch_id, feed_product_id, movement_type, qty_kg, destination, notes, performed_by
      ) VALUES (
        v_b.id, v_b.feed_product_id, 'cancel_reversal',
        -v_finished_deducted, 'cancellation',
        'إلغاء فاتورة تصنيع ' || COALESCE(v_b.batch_number,'') || ' — ' || p_reason,
        v_uid
      );
    END IF;

    -- Return raw materials
    FOR v_c IN
      SELECT c.id, c.raw_material_id, c.actual_qty, c.unit_cost, c.unit, c.material_name,
             rm.name AS rm_name, rm.unit AS rm_unit
      FROM public.feed_batch_consumption c
      LEFT JOIN public.feed_raw_materials rm ON rm.id = c.raw_material_id
      WHERE c.batch_id = p_batch_id AND COALESCE(c.actual_qty, 0) > 0
    LOOP
      IF v_c.raw_material_id IS NOT NULL THEN
        UPDATE public.feed_raw_materials
          SET stock = COALESCE(stock,0) + v_c.actual_qty, updated_at = now()
          WHERE id = v_c.raw_material_id;
      END IF;

      INSERT INTO public.feed_factory_movements(
        movement_no, movement_type, direction, item_name, quantity, unit,
        unit_cost, total_cost, from_party, to_party, status, created_by,
        reference_no, source_table, source_id, notes
      ) VALUES (
        'REV-' || COALESCE(v_b.batch_number, v_b.id::text) || '-' || substr(md5(v_c.id::text),1,6),
        'cancel_reversal', 'in',
        COALESCE(v_c.rm_name, v_c.material_name, 'raw'),
        v_c.actual_qty,
        COALESCE(v_c.rm_unit, v_c.unit, 'kg'),
        v_c.unit_cost,
        v_c.actual_qty * COALESCE(v_c.unit_cost, 0),
        'cancellation', 'feed_raw_warehouse', 'posted', v_uid,
        v_b.batch_number, 'feed_production_batches', v_b.id,
        'عكس استهلاك بسبب إلغاء فاتورة تصنيع — ' || p_reason
      );
      v_raw_count := v_raw_count + 1;
    END LOOP;
  END IF;

  UPDATE public.feed_production_batches
    SET status = 'cancelled',
        posted_to_inventory = false,
        cancelled_by = v_uid,
        cancelled_at = now(),
        cancel_reason = p_reason,
        override_negative = COALESCE(override_negative,false) OR p_force,
        override_reason = CASE WHEN p_force THEN COALESCE(override_reason,'') || ' | partial cancel: ' || p_reason ELSE override_reason END,
        updated_at = now()
    WHERE id = p_batch_id;

  INSERT INTO public.production_batch_audit(
    module, batch_id, action, old_status, new_status, payload, performed_by
  ) VALUES (
    'feed', p_batch_id, 'cancel_with_reversal', v_b.status, 'cancelled',
    jsonb_build_object(
      'reason', p_reason,
      'force_partial', p_force,
      'raw_lines_reversed', v_raw_count,
      'finished_deducted', v_finished_deducted,
      'shortage', v_short
    ),
    v_uid
  );

  INSERT INTO public.feed_audit_log(table_name, row_id, action, old_value, new_value, performed_by, notes)
  VALUES (
    'feed_production_batches', p_batch_id, 'cancel_with_reversal',
    jsonb_build_object('status', v_b.status, 'posted_to_inventory', v_b.posted_to_inventory),
    jsonb_build_object('status','cancelled','raw_lines_reversed', v_raw_count, 'finished_deducted', v_finished_deducted),
    v_uid, p_reason
  );

  RETURN jsonb_build_object(
    'success', true,
    'raw_lines_reversed', v_raw_count,
    'finished_deducted', v_finished_deducted,
    'shortage', v_short,
    'partial', p_force AND v_short > 0
  );
END $$;

GRANT EXECUTE ON FUNCTION public.feed_batch_cancel(uuid, text, boolean) TO authenticated;
