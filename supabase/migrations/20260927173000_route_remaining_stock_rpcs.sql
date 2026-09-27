-- The main-warehouse absolute adjustment and the order-return RPC were still
-- writing stock themselves and inserting a movement, so the apply trigger
-- counted the quantity a second time. Both now call the posting function only.

CREATE OR REPLACE FUNCTION public.adjust_main_warehouse_stock(
  p_item_id uuid, p_new_qty numeric, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_posted jsonb;
  v_wh uuid;
BEGIN
  IF NOT (
    public.has_role(v_uid, 'general_manager'::public.app_role)
    OR public.has_role(v_uid, 'executive_manager'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'permission denied: manager role required';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'سبب التعديل مطلوب';
  END IF;
  IF p_new_qty IS NULL OR p_new_qty < 0 THEN
    RAISE EXCEPTION 'INVALID_QTY';
  END IF;
  SELECT warehouse_id INTO v_wh FROM public.inventory_items WHERE id = p_item_id;
  IF v_wh IS NULL THEN
    RAISE EXCEPTION 'item not found';
  END IF;

  PERFORM set_config('app.inventory_internal_post', 'on', true);
  v_posted := public.post_inventory_movement(
    p_item_id, 'adjustment', p_new_qty, 'manual_adjustment', gen_random_uuid(), '1',
    btrim(p_reason), 'تسوية رصيد فعلي', now(), NULL, NULL, NULL, 'set', false,
    v_wh, NULL, 'warehouse', NULL, NULL, 'stock_adjustment', NULL, NULL, NULL, NULL, NULL
  );
  PERFORM set_config('app.inventory_internal_post', 'off', true);
  RETURN v_posted;
END;
$$;

CREATE OR REPLACE FUNCTION public.return_order_stock(p_order_id uuid, p_reason text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_order record;
  v_n integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  IF NOT public.has_any_role(v_uid, ARRAY[
    'general_manager','executive_manager','warehouse_supervisor','sales_manager',
    'marketing_sales_manager','shipping_company','private_delivery_rep'
  ]::public.app_role[]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT id, order_number, stock_status INTO v_order
    FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;
  IF v_order.stock_status = 'returned' THEN
    RETURN jsonb_build_object('status','already_returned','order_id',p_order_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_movements
     WHERE reference_type = 'order' AND reference_id = p_order_id::text
       AND movement_type = 'sales_dispatch'
       AND COALESCE(approval_status, 'posted') = 'posted'
  ) THEN
    RAISE EXCEPTION 'NOT_DISPATCHED — لا يمكن إرجاع طلب لم يتم شحنه من المخزن';
  END IF;

  v_n := public._return_order_dispatched_stock(
    p_order_id, COALESCE(p_reason, 'إرجاع طلب ' || v_order.order_number)
  );
  UPDATE public.orders SET stock_status = 'returned' WHERE id = p_order_id;
  RETURN jsonb_build_object('status','returned','order_id',p_order_id,'movements_created',v_n);
END;
$$;

-- Live revoked these between migration 1 and this file. The new bodies post
-- through the ledger, so authenticated may call them again.
GRANT EXECUTE ON FUNCTION public.adjust_main_warehouse_stock(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_order_stock(uuid, text) TO authenticated;
