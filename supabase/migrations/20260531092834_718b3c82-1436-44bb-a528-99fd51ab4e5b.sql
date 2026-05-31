CREATE OR REPLACE FUNCTION public.return_stock_on_order_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_item record;
BEGIN
  IF OLD.status = 'cancelled' OR COALESCE(OLD.stock_status,'') IN ('returned','not_dispatched') THEN
    RETURN OLD;
  END IF;

  -- Restore global product stock
  UPDATE public.products p
     SET stock = stock + x.quantity::int
    FROM public.order_items x
   WHERE x.order_id = OLD.id AND x.product_id = p.id;

  -- Restore per-warehouse inventory for the order's source warehouse
  IF OLD.source_warehouse_id IS NOT NULL THEN
    FOR r IN
      SELECT product_id, quantity FROM public.order_items
       WHERE order_id = OLD.id AND product_id IS NOT NULL
    LOOP
      SELECT * INTO v_item FROM public.inventory_items
       WHERE warehouse_id = OLD.source_warehouse_id
         AND product_id = r.product_id
       LIMIT 1;
      IF v_item.id IS NOT NULL THEN
        UPDATE public.inventory_items
           SET stock = COALESCE(stock,0) + r.quantity,
               last_movement_date = now()
         WHERE id = v_item.id;
        INSERT INTO public.inventory_movements(
          item_id, warehouse_id, movement_type, quantity, unit_cost,
          reference_type, reference_id, module, reason, product_id
        ) VALUES (
          v_item.id, v_item.warehouse_id, 'sales_return', r.quantity,
          COALESCE(v_item.unit_cost,0), 'order', OLD.id::text, v_item.module,
          'إرجاع تلقائي عند حذف الطلب', r.product_id
        );
      END IF;
    END LOOP;
  END IF;

  RETURN OLD;
END;
$$;