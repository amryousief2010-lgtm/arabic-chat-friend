
CREATE OR REPLACE FUNCTION public.submit_stock_adjustment(
  p_item_id uuid,
  p_actual_qty numeric,
  p_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_item public.inventory_items%ROWTYPE;
  v_ref text;
  v_existing uuid;
  v_mov_id uuid;
  v_diff numeric;
BEGIN
  IF NOT (public.has_role(v_uid, 'general_manager'::app_role) OR public.has_role(v_uid, 'executive_manager'::app_role)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: فقط المدير العام أو التنفيذي يعتمد التسويات';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: السبب مطلوب (٣ حروف على الأقل)';
  END IF;
  IF p_actual_qty IS NULL OR p_actual_qty < 0 THEN
    RAISE EXCEPTION 'INVALID_QTY: الكمية الفعلية غير صحيحة';
  END IF;

  SELECT * INTO v_item FROM public.inventory_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  v_diff := p_actual_qty - v_item.stock;
  v_ref := 'stock_adjustment_' || v_item.warehouse_id::text || '_' || p_item_id::text || '_' ||
           to_char(now(), 'YYYYMMDDHH24MISS');

  SELECT id INTO v_existing FROM public.inventory_movements
    WHERE reference_id = v_ref AND movement_type='adjustment' LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  INSERT INTO public.inventory_movements(
    item_id, warehouse_id, movement_type, quantity, unit_cost,
    performed_by, performed_at, module, reference_type, reference_id,
    approval_status, reason, notes, approved_by, approved_at
  ) VALUES (
    p_item_id, v_item.warehouse_id, 'adjustment', p_actual_qty, v_item.unit_cost,
    v_uid, now(), 'warehouse', 'stock_adjustment', v_ref,
    'posted', p_reason,
    'تسوية جرد: قبل=' || v_item.stock || ' بعد=' || p_actual_qty || ' فرق=' || v_diff,
    v_uid, now()
  ) RETURNING id INTO v_mov_id;

  RETURN v_mov_id;
END $$;

GRANT EXECUTE ON FUNCTION public.submit_stock_adjustment(uuid, numeric, text) TO authenticated;
