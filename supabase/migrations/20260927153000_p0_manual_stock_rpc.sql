-- P0 — Manual stock in/out goes through one locked movement insert.
-- The movement trigger applies stock = stock + effect and stores before/after.
-- The client must not write inventory_items.stock itself.

CREATE OR REPLACE FUNCTION public.post_manual_inventory_movement(
  p_item_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_reason text,
  p_notes text DEFAULT NULL,
  p_party text DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_performed_at timestamptz DEFAULT NULL,
  p_override_reason text DEFAULT NULL,
  p_package_count numeric DEFAULT NULL,
  p_package_weight_kg numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_before numeric;
  v_wh uuid;
  v_cost numeric;
  v_mov uuid;
  v_after numeric;
  v_type text := lower(btrim(COALESCE(p_movement_type, '')));
  v_qty numeric := p_quantity;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT (
    public.has_role(v_uid, 'general_manager'::public.app_role)
    OR public.has_role(v_uid, 'executive_manager'::public.app_role)
    OR public.has_role(v_uid, 'warehouse_supervisor'::public.app_role)
    OR public.has_role(v_uid, 'agouza_warehouse_keeper'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: التوريد والصرف اليدوي للمدير أو مسؤول المخزن';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: السبب مطلوب (٣ حروف على الأقل)';
  END IF;
  IF v_type NOT IN ('in', 'out', 'adjustment') THEN
    RAISE EXCEPTION 'INVALID_TYPE: نوع الحركة يجب أن يكون in أو out أو adjustment';
  END IF;
  IF v_type = 'adjustment' THEN
    IF v_qty IS NULL OR v_qty = 0 THEN
      RAISE EXCEPTION 'INVALID_QTY: فرق التسوية لا يمكن أن يكون صفراً';
    END IF;
  ELSIF v_qty IS NULL OR v_qty <= 0 THEN
    RAISE EXCEPTION 'INVALID_QTY: الكمية يجب أن تكون أكبر من صفر';
  END IF;

  SELECT stock, warehouse_id, unit_cost
    INTO v_before, v_wh, v_cost
    FROM public.inventory_items
   WHERE id = p_item_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الصنف غير موجود';
  END IF;

  INSERT INTO public.inventory_movements(
    item_id, warehouse_id, movement_type, quantity, unit_cost,
    performed_by, performed_at, module, reference, reference_type, party,
    approval_status, reason, notes, effect_mode, period_lock_override_reason,
    package_count, package_weight_kg
  ) VALUES (
    p_item_id, v_wh, v_type, v_qty, COALESCE(v_cost, 0),
    v_uid, COALESCE(p_performed_at, now()), 'warehouse_manual',
    p_reference, COALESCE(p_reference_type, 'manual_' || v_type), p_party,
    'posted', btrim(p_reason), p_notes,
    CASE WHEN v_type = 'adjustment' THEN 'delta' ELSE 'delta' END,
    NULLIF(btrim(COALESCE(p_override_reason, '')), ''),
    p_package_count, p_package_weight_kg
  ) RETURNING id INTO v_mov;

  UPDATE public.inventory_movements
     SET quantity_kg = abs(v_qty)
   WHERE id = v_mov AND quantity_kg IS NULL;

  SELECT stock_before, stock_after INTO v_before, v_after
    FROM public.inventory_movements WHERE id = v_mov;

  RETURN jsonb_build_object(
    'id', v_mov,
    'stock_before', v_before,
    'stock_after', v_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.post_manual_inventory_movement(uuid, text, numeric, text, text, text, text, text, timestamptz, text, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_manual_inventory_movement(uuid, text, numeric, text, text, text, text, text, timestamptz, text, numeric, numeric) TO authenticated, service_role;

-- Absolute "set stock to N" screens become one locked adjustment.
-- The client never writes inventory_items.stock.
CREATE OR REPLACE FUNCTION public.set_inventory_item_stock(
  p_item_id uuid,
  p_new_qty numeric,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_stock numeric;
  v_delta numeric;
BEGIN
  IF p_new_qty IS NULL OR p_new_qty < 0 THEN
    RAISE EXCEPTION 'INVALID_QTY: الرصيد الجديد لا يمكن أن يكون سالباً';
  END IF;
  SELECT stock INTO v_stock
    FROM public.inventory_items
   WHERE id = p_item_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الصنف غير موجود';
  END IF;
  v_delta := p_new_qty - COALESCE(v_stock, 0);
  IF v_delta = 0 THEN
    RETURN jsonb_build_object('status', 'unchanged', 'stock_before', v_stock, 'stock_after', v_stock);
  END IF;
  RETURN public.post_manual_inventory_movement(
    p_item_id, 'adjustment', v_delta, p_reason,
    NULL, NULL, NULL, 'stock_adjustment', NULL, NULL, NULL, NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_inventory_item_stock(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_inventory_item_stock(uuid, numeric, text) TO authenticated, service_role;
