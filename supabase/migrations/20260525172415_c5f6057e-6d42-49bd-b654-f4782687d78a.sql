-- =========================================================
-- Phase 4: Stock RPCs (manual only — no triggers attached)
-- =========================================================

-- 1) Extend inventory_movements CHECK to include sales_dispatch / sales_return
DO $$
DECLARE v_def text;
BEGIN
  ALTER TABLE public.inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;
  ALTER TABLE public.inventory_movements
    ADD CONSTRAINT inventory_movements_movement_type_check
    CHECK (movement_type = ANY (ARRAY[
      'in','out','transfer','adjustment','purchase_receipt',
      'stock_in','stock_out','production_consumption','packaging_consumption',
      'finished_goods_receipt','reconciliation','return','waste_loss',
      'sales_dispatch','sales_return'
    ]));
END $$;

-- Helpful index for idempotency lookups
CREATE INDEX IF NOT EXISTS idx_inv_movements_ref_order
  ON public.inventory_movements(reference_type, reference_id, movement_type);

-- =========================================================
-- 2) check_order_stock_availability(order_id) — READ-ONLY
-- =========================================================
CREATE OR REPLACE FUNCTION public.check_order_stock_availability(p_order_id uuid)
RETURNS TABLE (
  order_id uuid,
  order_number text,
  shipping_company text,
  source_warehouse_id uuid,
  source_warehouse_name text,
  order_item_id uuid,
  product_id uuid,
  product_name text,
  barcode text,
  required_qty numeric,
  inventory_item_id uuid,
  current_stock numeric,
  reserved_qty numeric,
  blocked_qty numeric,
  available_qty numeric,
  can_dispatch boolean,
  blocker_reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.order_number,
    o.shipping_company,
    o.source_warehouse_id,
    w.name,
    oi.id,
    oi.product_id,
    oi.product_name,
    p.barcode,
    oi.quantity::numeric,
    i.id,
    COALESCE(i.stock, 0),
    COALESCE(i.reserved_qty, 0),
    COALESCE(i.blocked_qty, 0),
    (COALESCE(i.stock,0) - COALESCE(i.reserved_qty,0) - COALESCE(i.blocked_qty,0)),
    CASE
      WHEN o.source_warehouse_id IS NULL THEN false
      WHEN p.id IS NULL THEN false
      WHEN p.is_active = false THEN false
      WHEN p.barcode IS NULL OR length(trim(p.barcode))=0 THEN false
      WHEN i.id IS NULL THEN false
      WHEN (COALESCE(i.stock,0) - COALESCE(i.reserved_qty,0) - COALESCE(i.blocked_qty,0)) >= oi.quantity::numeric THEN true
      ELSE false
    END,
    CASE
      WHEN o.source_warehouse_id IS NULL THEN 'SOURCE_WAREHOUSE_UNRESOLVED — طريقة التوصيل غير محددة'
      WHEN p.id IS NULL THEN 'PRODUCT_MISSING — البند غير مرتبط بمنتج'
      WHEN p.is_active = false THEN 'PRODUCT_INACTIVE — المنتج غير نشط'
      WHEN p.barcode IS NULL OR length(trim(p.barcode))=0 THEN 'PRODUCT_NO_BARCODE — المنتج بدون باركود'
      WHEN i.id IS NULL THEN 'INVENTORY_ROW_MISSING — لا يوجد صفّ مخزون في المخزن المصدر'
      WHEN (COALESCE(i.stock,0) - COALESCE(i.reserved_qty,0) - COALESCE(i.blocked_qty,0)) < oi.quantity::numeric
        THEN 'INSUFFICIENT_STOCK — الرصيد المتاح أقل من المطلوب'
      ELSE NULL
    END
  FROM public.orders o
  LEFT JOIN public.warehouses w ON w.id = o.source_warehouse_id
  LEFT JOIN public.order_items oi ON oi.order_id = o.id
  LEFT JOIN public.products p ON p.id = oi.product_id
  LEFT JOIN public.inventory_items i
    ON i.product_id = p.id AND i.warehouse_id = o.source_warehouse_id
  WHERE o.id = p_order_id;
END
$$;

REVOKE EXECUTE ON FUNCTION public.check_order_stock_availability(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_order_stock_availability(uuid) TO authenticated;

-- =========================================================
-- 3) dispatch_order_stock(order_id) — MANUAL, IDEMPOTENT
-- =========================================================
CREATE OR REPLACE FUNCTION public.dispatch_order_stock(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_order        record;
  v_item         record;
  v_inv          record;
  v_movements    int := 0;
  v_total_qty    numeric := 0;
  v_movement_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT (
    public.has_any_role(v_uid, ARRAY['general_manager','executive_manager','warehouse_supervisor']::app_role[])
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED — هذا الإجراء لمسؤول المخزن أو الإدارة فقط';
  END IF;

  SELECT id, order_number, shipping_company, source_warehouse_id, stock_status
    INTO v_order
  FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  -- Idempotency check 1: stock_status
  IF v_order.stock_status = 'dispatched' THEN
    RETURN jsonb_build_object(
      'status','already_dispatched',
      'order_id', p_order_id,
      'order_number', v_order.order_number
    );
  END IF;

  -- Idempotency check 2: existing sales_dispatch movements for this order
  IF EXISTS (
    SELECT 1 FROM public.inventory_movements
    WHERE reference_type='order' AND reference_id = p_order_id::text
      AND movement_type='sales_dispatch'
  ) THEN
    UPDATE public.orders SET stock_status='dispatched' WHERE id=p_order_id AND stock_status<>'dispatched';
    RETURN jsonb_build_object('status','already_dispatched','order_id',p_order_id);
  END IF;

  IF v_order.source_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'SOURCE_WAREHOUSE_UNRESOLVED — يجب اختيار طريقة التوصيل أولاً';
  END IF;

  -- Pre-flight validation: ALL items must be dispatchable
  FOR v_item IN
    SELECT oi.id AS order_item_id, oi.product_id, oi.product_name, oi.quantity::numeric AS qty,
           p.is_active, p.barcode
    FROM public.order_items oi
    LEFT JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = p_order_id
  LOOP
    IF v_item.product_id IS NULL THEN
      RAISE EXCEPTION 'PRODUCT_MISSING — البند % لا يحتوي على منتج', v_item.product_name;
    END IF;
    IF v_item.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'PRODUCT_INACTIVE — المنتج % غير نشط', v_item.product_name;
    END IF;
    IF v_item.barcode IS NULL OR length(trim(v_item.barcode))=0 THEN
      RAISE EXCEPTION 'PRODUCT_NO_BARCODE — المنتج % بدون باركود', v_item.product_name;
    END IF;
    IF v_item.qty IS NULL OR v_item.qty <= 0 THEN
      RAISE EXCEPTION 'INVALID_QUANTITY — كمية غير صالحة للبند %', v_item.product_name;
    END IF;

    SELECT id, stock, reserved_qty, blocked_qty, unit_cost
      INTO v_inv
    FROM public.inventory_items
    WHERE product_id = v_item.product_id
      AND warehouse_id = v_order.source_warehouse_id
    FOR UPDATE;

    IF v_inv.id IS NULL THEN
      RAISE EXCEPTION 'INVENTORY_ROW_MISSING — لا يوجد صفّ مخزون للمنتج % في المخزن المصدر', v_item.product_name;
    END IF;

    IF (COALESCE(v_inv.stock,0) - COALESCE(v_inv.reserved_qty,0) - COALESCE(v_inv.blocked_qty,0)) < v_item.qty THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK — رصيد المنتج % غير كافٍ (المطلوب %, المتاح %)',
        v_item.product_name, v_item.qty,
        (COALESCE(v_inv.stock,0) - COALESCE(v_inv.reserved_qty,0) - COALESCE(v_inv.blocked_qty,0));
    END IF;
  END LOOP;

  -- All items validated. Now create movements and deduct.
  FOR v_item IN
    SELECT oi.id AS order_item_id, oi.product_id, oi.product_name, oi.quantity::numeric AS qty
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
  LOOP
    SELECT id, stock, unit_cost INTO v_inv
    FROM public.inventory_items
    WHERE product_id = v_item.product_id AND warehouse_id = v_order.source_warehouse_id
    FOR UPDATE;

    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, source_warehouse_id,
      movement_type, quantity, unit_cost, total_cost,
      reference_type, reference_id,
      reason, party, notes,
      performed_by, approval_status, module
    ) VALUES (
      v_inv.id, v_order.source_warehouse_id, v_order.source_warehouse_id,
      'sales_dispatch', v_item.qty, COALESCE(v_inv.unit_cost,0),
      v_item.qty * COALESCE(v_inv.unit_cost,0),
      'order', p_order_id::text,
      'شحن طلب ' || v_order.order_number, v_order.shipping_company,
      jsonb_build_object('order_item_id', v_item.order_item_id, 'product_id', v_item.product_id)::text,
      v_uid, 'posted', 'sales'
    ) RETURNING id INTO v_movement_id;

    UPDATE public.inventory_items
       SET stock = stock - v_item.qty,
           last_movement_date = now(),
           updated_at = now()
     WHERE id = v_inv.id;

    v_movements := v_movements + 1;
    v_total_qty := v_total_qty + v_item.qty;
  END LOOP;

  UPDATE public.orders
     SET stock_status = 'dispatched'
   WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'status','dispatched',
    'order_id', p_order_id,
    'order_number', v_order.order_number,
    'source_warehouse_id', v_order.source_warehouse_id,
    'movements_created', v_movements,
    'total_quantity', v_total_qty
  );
END
$$;

REVOKE EXECUTE ON FUNCTION public.dispatch_order_stock(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_order_stock(uuid) TO authenticated;

-- =========================================================
-- 4) return_order_stock(order_id, reason) — MANUAL, IDEMPOTENT
-- =========================================================
CREATE OR REPLACE FUNCTION public.return_order_stock(p_order_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_order     record;
  v_disp      record;
  v_movements int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  IF NOT public.has_any_role(v_uid, ARRAY['general_manager','executive_manager','warehouse_supervisor']::app_role[]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT id, order_number, source_warehouse_id, stock_status, shipping_company
    INTO v_order
  FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF v_order.id IS NULL THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;

  IF v_order.stock_status = 'returned' THEN
    RETURN jsonb_build_object('status','already_returned','order_id',p_order_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.inventory_movements
    WHERE reference_type='order' AND reference_id=p_order_id::text
      AND movement_type='sales_return'
  ) THEN
    UPDATE public.orders SET stock_status='returned' WHERE id=p_order_id;
    RETURN jsonb_build_object('status','already_returned','order_id',p_order_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_movements
    WHERE reference_type='order' AND reference_id=p_order_id::text
      AND movement_type='sales_dispatch'
  ) THEN
    RAISE EXCEPTION 'NOT_DISPATCHED — لا يمكن إرجاع طلب لم يتم شحنه من المخزن';
  END IF;

  -- Mirror each dispatch movement with a return
  FOR v_disp IN
    SELECT item_id, warehouse_id, quantity, unit_cost
    FROM public.inventory_movements
    WHERE reference_type='order' AND reference_id=p_order_id::text
      AND movement_type='sales_dispatch'
  LOOP
    INSERT INTO public.inventory_movements(
      item_id, warehouse_id, destination_warehouse_id,
      movement_type, quantity, unit_cost, total_cost,
      reference_type, reference_id, reason, party,
      performed_by, approval_status, module
    ) VALUES (
      v_disp.item_id, v_disp.warehouse_id, v_disp.warehouse_id,
      'sales_return', v_disp.quantity, COALESCE(v_disp.unit_cost,0),
      v_disp.quantity * COALESCE(v_disp.unit_cost,0),
      'order', p_order_id::text,
      COALESCE(p_reason, 'إرجاع طلب ' || v_order.order_number),
      v_order.shipping_company,
      v_uid, 'posted', 'sales'
    );

    UPDATE public.inventory_items
       SET stock = stock + v_disp.quantity,
           last_movement_date = now(),
           updated_at = now()
     WHERE id = v_disp.item_id;

    v_movements := v_movements + 1;
  END LOOP;

  UPDATE public.orders SET stock_status='returned' WHERE id=p_order_id;

  RETURN jsonb_build_object('status','returned','order_id',p_order_id,'movements_created',v_movements);
END
$$;

REVOKE EXECUTE ON FUNCTION public.return_order_stock(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_order_stock(uuid, text) TO authenticated;

-- =========================================================
-- 5) release_order_reservation(order_id) — stub (no reservation table yet)
-- =========================================================
CREATE OR REPLACE FUNCTION public.release_order_reservation(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  -- No reservation table exists yet for sales orders.
  RETURN jsonb_build_object(
    'status','reservation_not_implemented',
    'order_id', p_order_id,
    'message','نظام الحجز غير مُفعّل حاليًا — لا حركة مخزون'
  );
END
$$;

REVOKE EXECUTE ON FUNCTION public.release_order_reservation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_order_reservation(uuid) TO authenticated;

-- 6) Allow 'blocked' and 'reservation_released' values in stock_status check
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_stock_status_chk;
ALTER TABLE public.orders ADD CONSTRAINT orders_stock_status_chk
  CHECK (stock_status IN ('not_dispatched','checked','reserved','dispatched','returned','blocked','reservation_released'));
