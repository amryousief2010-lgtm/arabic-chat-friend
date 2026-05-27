
CREATE OR REPLACE FUNCTION public.return_stock_on_order_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  oi record;
  v_item record;
BEGIN
  -- Skip if already cancelled/returned (stock was already restored)
  IF OLD.status = 'cancelled' OR COALESCE(OLD.stock_status,'') IN ('returned','not_dispatched') THEN
    RETURN OLD;
  END IF;

  -- Restore global product stock
  UPDATE public.products p
     SET stock = stock + oi.quantity::int
    FROM public.order_items oi
   WHERE oi.order_id = OLD.id AND oi.product_id = p.id;

  -- Restore per-warehouse inventory for the order's source warehouse
  IF OLD.source_warehouse_id IS NOT NULL THEN
    FOR oi IN
      SELECT product_id, quantity FROM public.order_items
       WHERE order_id = OLD.id AND product_id IS NOT NULL
    LOOP
      SELECT * INTO v_item FROM public.inventory_items
       WHERE warehouse_id = OLD.source_warehouse_id
         AND product_id = oi.product_id
       LIMIT 1;
      IF v_item.id IS NOT NULL THEN
        UPDATE public.inventory_items
           SET stock = COALESCE(stock,0) + oi.quantity,
               last_movement_date = now()
         WHERE id = v_item.id;
        INSERT INTO public.inventory_movements(
          item_id, warehouse_id, movement_type, quantity, unit_cost,
          reference_type, reference_id, module, reason, product_id
        ) VALUES (
          v_item.id, v_item.warehouse_id, 'sales_return', oi.quantity,
          COALESCE(v_item.unit_cost,0), 'order', OLD.id::text, v_item.module,
          'إرجاع تلقائي عند حذف الطلب', oi.product_id
        );
      END IF;
    END LOOP;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_return_stock_on_order_delete ON public.orders;
CREATE TRIGGER trg_return_stock_on_order_delete
  BEFORE DELETE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.return_stock_on_order_delete();
