CREATE OR REPLACE FUNCTION public.handle_order_status_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item record; v_oi record; v_result jsonb; v_was_dispatched boolean;
  v_new_stock_status text := NEW.stock_status;
BEGIN
  v_was_dispatched := COALESCE(OLD.stock_status,'') = 'dispatched';

  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.products p SET stock = stock + oi2.quantity::int
      FROM public.order_items oi2
      WHERE oi2.order_id = NEW.id AND oi2.product_id = p.id;

    IF v_was_dispatched
       AND COALESCE(NEW.source_warehouse_id, OLD.source_warehouse_id) IS NOT NULL THEN
      FOR v_oi IN SELECT product_id, quantity FROM public.order_items
                  WHERE order_id = NEW.id AND product_id IS NOT NULL
      LOOP
        SELECT * INTO v_item FROM public.inventory_items
          WHERE warehouse_id = COALESCE(NEW.source_warehouse_id, OLD.source_warehouse_id)
            AND product_id = v_oi.product_id
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
          WHERE warehouse_id = NEW.source_warehouse_id
            AND product_id = v_oi.product_id
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

DROP TRIGGER IF EXISTS trg_handle_order_status_stock ON public.orders;
CREATE TRIGGER trg_handle_order_status_stock
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_order_status_stock();