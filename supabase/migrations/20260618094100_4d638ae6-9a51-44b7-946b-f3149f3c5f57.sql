-- Unified stock adjustment RPC for meat factory inventory
-- Restricted to General Manager / Executive Manager only.
-- Creates an inventory movement + audit log entry. No treasury or invoice side-effects.

CREATE OR REPLACE FUNCTION public.meat_factory_adjust_stock(
  p_item_kind text,           -- 'raw' | 'spice' | 'packaging' | 'finished'
  p_item_id uuid,
  p_actual_qty numeric,
  p_reason text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_before numeric;
  v_diff numeric;
  v_dir text;
  v_unit_cost numeric := 0;
  v_name text;
  v_ref text;
BEGIN
  -- Authorization: only GM or Executive Manager
  IF NOT (public.has_role(v_uid, 'general_manager'::app_role)
       OR public.has_role(v_uid, 'executive_manager'::app_role)) THEN
    RAISE EXCEPTION 'غير مصرح: فقط المدير العام أو المدير التنفيذي يمكنه تسوية المخزون';
  END IF;

  IF p_actual_qty IS NULL OR p_actual_qty < 0 THEN
    RAISE EXCEPTION 'الرصيد الفعلي يجب ألا يكون سالبًا';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'سبب التسوية مطلوب';
  END IF;
  IF p_item_kind NOT IN ('raw','spice','packaging','finished') THEN
    RAISE EXCEPTION 'نوع الصنف غير صحيح';
  END IF;

  IF p_item_kind IN ('raw','spice','packaging') THEN
    SELECT current_stock, COALESCE(avg_cost,0), name
      INTO v_before, v_unit_cost, v_name
    FROM public.meat_factory_raw_items
    WHERE id = p_item_id AND kind = p_item_kind;
  ELSE
    SELECT COALESCE(current_stock,0), COALESCE(latest_unit_cost, cost_price, 0), COALESCE(name_ar, name_en)
      INTO v_before, v_unit_cost, v_name
    FROM public.meat_factory_products
    WHERE id = p_item_id;
  END IF;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'الصنف غير موجود';
  END IF;

  v_diff := p_actual_qty - v_before;
  v_dir := CASE WHEN v_diff >= 0 THEN 'IN' ELSE 'OUT' END;
  v_ref := 'meat_factory_stock_adjustment_' || p_item_id::text || '_' || extract(epoch from now())::bigint::text;

  -- Movement log (no treasury impact)
  INSERT INTO public.meat_factory_inventory_moves(
    item_kind, item_id, item_name, direction, quantity, unit_cost,
    reason, ref_table, ref_id, created_by, stock_before, stock_after
  ) VALUES (
    p_item_kind, p_item_id, v_name, v_dir, abs(v_diff), v_unit_cost,
    'stock_adjustment: ' || p_reason || COALESCE(' — ' || p_notes, ''),
    'stock_adjustment', NULL, v_uid, v_before, p_actual_qty
  );

  -- Update item stock
  IF p_item_kind IN ('raw','spice','packaging') THEN
    UPDATE public.meat_factory_raw_items
       SET current_stock = p_actual_qty, updated_at = now()
     WHERE id = p_item_id;
  ELSE
    UPDATE public.meat_factory_products
       SET current_stock = p_actual_qty, updated_at = now()
     WHERE id = p_item_id;
  END IF;

  -- Audit
  INSERT INTO public.meat_factory_audit_log(
    table_name, row_id, action, old_value, new_value, performed_by
  ) VALUES (
    CASE WHEN p_item_kind='finished' THEN 'meat_factory_products' ELSE 'meat_factory_raw_items' END,
    p_item_id, 'stock_adjustment',
    jsonb_build_object('stock', v_before, 'name', v_name, 'kind', p_item_kind),
    jsonb_build_object('stock', p_actual_qty, 'diff', v_diff, 'reason', p_reason, 'notes', p_notes, 'reference_id', v_ref),
    v_uid
  );

  RETURN jsonb_build_object(
    'ok', true, 'item_id', p_item_id, 'item_name', v_name, 'kind', p_item_kind,
    'before', v_before, 'after', p_actual_qty, 'diff', v_diff,
    'value_diff', v_diff * v_unit_cost, 'reference_id', v_ref
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.meat_factory_adjust_stock(text, uuid, numeric, text, text) TO authenticated;