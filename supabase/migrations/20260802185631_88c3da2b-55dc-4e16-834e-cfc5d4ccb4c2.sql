CREATE OR REPLACE FUNCTION public.is_manual_stock_warehouse(p_wh uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p_wh = '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid;
$$;

GRANT EXECUTE ON FUNCTION public.is_manual_stock_warehouse(uuid) TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.dispatch_order_stock(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_order        record;
  v_item         record;
  v_inv          record;
  v_movements    int := 0;
  v_total_qty    numeric := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT (
    public.has_any_role(v_uid, ARRAY['general_manager','executive_manager','warehouse_supervisor','sales_manager','marketing_sales_manager','shipping_company','private_delivery_rep']::app_role[])
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED — هذا الإجراء لمسؤول المخزن أو الإدارة أو شركة الشحن فقط';
  END IF;

  SELECT id, order_number, shipping_company, source_warehouse_id, stock_status
    INTO v_order
  FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  -- المخزن الرئيسي: الجرد يدوي بالكامل — لا خصم تلقائي من الطلبات
  IF public.is_manual_stock_warehouse(v_order.source_warehouse_id) THEN
    RETURN jsonb_build_object('status','manual_warehouse_skipped','order_id',p_order_id,
      'message','المخزن الرئيسي يعمل بالجرد اليدوي — لا يتم الخصم تلقائياً');
  END IF;

  IF v_order.stock_status = 'dispatched' THEN
    RETURN jsonb_build_object('status','already_dispatched','order_id', p_order_id,'order_number', v_order.order_number);
  END IF;

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
      'صرف مبيعات', COALESCE(v_order.shipping_company,'—'),
      concat('صرف تلقائي للأوردر ', v_order.order_number),
      v_uid, 'posted', 'sales'
    );

    UPDATE public.inventory_items
      SET stock = COALESCE(stock,0) - v_item.qty, last_movement_date = now(), updated_at = now()
      WHERE id = v_inv.id;

    v_movements := v_movements + 1;
    v_total_qty := v_total_qty + v_item.qty;
  END LOOP;

  UPDATE public.orders SET stock_status='dispatched' WHERE id = p_order_id;

  RETURN jsonb_build_object('status','dispatched','order_id',p_order_id,
    'movements', v_movements, 'total_qty', v_total_qty);
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_order_status_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item record; v_oi record; v_result jsonb; v_was_dispatched boolean;
  v_new_stock_status text := NEW.stock_status;
  v_wh uuid := COALESCE(NEW.source_warehouse_id, OLD.source_warehouse_id);
BEGIN
  -- المخزن الرئيسي: كل الحركات يدوية — لا خصم/إضافة تلقائية من الطلبات
  IF public.is_manual_stock_warehouse(v_wh) THEN
    RETURN NULL;
  END IF;

  v_was_dispatched := COALESCE(OLD.stock_status,'') = 'dispatched';

  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.products p SET stock = stock + oi2.quantity::int
      FROM public.order_items oi2
      WHERE oi2.order_id = NEW.id AND oi2.product_id = p.id;

    IF v_was_dispatched AND v_wh IS NOT NULL THEN
      FOR v_oi IN SELECT product_id, quantity FROM public.order_items
                  WHERE order_id = NEW.id AND product_id IS NOT NULL
      LOOP
        SELECT * INTO v_item FROM public.inventory_items
          WHERE warehouse_id = v_wh AND product_id = v_oi.product_id
          ORDER BY stock ASC NULLS LAST LIMIT 1;
        IF v_item.id IS NOT NULL THEN
          UPDATE public.inventory_items
            SET stock = stock + v_oi.quantity, last_movement_date = now()
            WHERE id = v_item.id;
          INSERT INTO public.inventory_movements(
            item_id, warehouse_id, movement_type, quantity, unit_cost,
            reference_type, reference_id, module, reason, product_id
          ) VALUES (
            v_item.id, v_item.warehouse_id, 'sales_return', v_oi.quantity,
            COALESCE(v_item.unit_cost,0), 'order', NEW.id::text, v_item.module,
            'إرجاع تلقائي عند إلغاء طلب مصروف', v_oi.product_id
          );
        END IF;
      END LOOP;
      v_new_stock_status := 'returned';
    ELSE
      v_new_stock_status := 'not_dispatched';
    END IF;
  END IF;

  IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.products p SET stock = GREATEST(stock - oi2.quantity::int, 0)
      FROM public.order_items oi2
      WHERE oi2.order_id = NEW.id AND oi2.product_id = p.id;

    IF COALESCE(OLD.stock_status,'') = 'returned' AND NEW.source_warehouse_id IS NOT NULL THEN
      FOR v_oi IN SELECT product_id, quantity FROM public.order_items
                  WHERE order_id = NEW.id AND product_id IS NOT NULL
      LOOP
        SELECT * INTO v_item FROM public.inventory_items
          WHERE warehouse_id = NEW.source_warehouse_id AND product_id = v_oi.product_id
          ORDER BY stock DESC NULLS LAST LIMIT 1;
        IF v_item.id IS NOT NULL THEN
          UPDATE public.inventory_items
            SET stock = stock - v_oi.quantity, last_movement_date = now()
            WHERE id = v_item.id;
          INSERT INTO public.inventory_movements(
            item_id, warehouse_id, movement_type, quantity, unit_cost,
            reference_type, reference_id, module, reason, product_id
          ) VALUES (
            v_item.id, v_item.warehouse_id, 'sales_dispatch', -v_oi.quantity,
            COALESCE(v_item.unit_cost,0), 'order', NEW.id::text, v_item.module,
            'إعادة سحب بعد التراجع عن الإلغاء', v_oi.product_id
          );
        END IF;
      END LOOP;
      v_new_stock_status := 'dispatched';
    END IF;
  END IF;

  IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
    IF COALESCE(NEW.stock_status,'not_dispatched') <> 'dispatched'
       AND NEW.source_warehouse_id IS NOT NULL THEN
      BEGIN
        v_result := public.dispatch_order_stock(NEW.id);
        v_new_stock_status := 'dispatched';
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  END IF;

  IF v_new_stock_status IS DISTINCT FROM NEW.stock_status THEN
    UPDATE public.orders SET stock_status = v_new_stock_status WHERE id = NEW.id;
  END IF;

  RETURN NULL;
END;
$function$;