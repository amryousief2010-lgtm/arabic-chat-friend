
-- Auto-deduct inventory_items at source warehouse on order_item insert,
-- and auto-return on order cancellation / re-deduct on uncancel.

CREATE OR REPLACE FUNCTION public.deduct_stock_on_order_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_wh uuid;
  v_item record;
  v_qty numeric;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  SELECT status, source_warehouse_id INTO v_status, v_wh
    FROM public.orders WHERE id = NEW.order_id;
  IF v_status IS NULL OR v_status = 'cancelled' THEN RETURN NEW; END IF;

  -- Legacy global product stock (unchanged)
  UPDATE public.products SET stock = GREATEST(stock - NEW.quantity::int, 0)
    WHERE id = NEW.product_id;

  -- Per-warehouse inventory deduction at order creation
  IF v_wh IS NOT NULL THEN
    v_qty := NEW.quantity;
    SELECT * INTO v_item FROM public.inventory_items
      WHERE warehouse_id = v_wh AND product_id = NEW.product_id
      ORDER BY stock DESC NULLS LAST LIMIT 1;
    IF v_item.id IS NOT NULL THEN
      UPDATE public.inventory_items
        SET stock = stock - v_qty, last_movement_date = now()
        WHERE id = v_item.id;
      INSERT INTO public.inventory_movements(
        item_id, warehouse_id, movement_type, quantity, unit_cost,
        reference_type, reference_id, module, reason, product_id, order_item_id
      ) VALUES (
        v_item.id, v_wh, 'sales_dispatch', -v_qty, COALESCE(v_item.unit_cost,0),
        'order', NEW.order_id::text, v_item.module,
        'سحب تلقائي عند تسجيل الطلب', NEW.product_id, NEW.id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Mark order as dispatched after first item insert (helper trigger)
CREATE OR REPLACE FUNCTION public.mark_order_dispatched_on_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.orders
    SET stock_status = 'dispatched'
    WHERE id = NEW.order_id
      AND source_warehouse_id IS NOT NULL
      AND COALESCE(stock_status,'not_dispatched') <> 'dispatched'
      AND status <> 'cancelled';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_order_dispatched_on_item ON public.order_items;
CREATE TRIGGER trg_mark_order_dispatched_on_item
AFTER INSERT ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.mark_order_dispatched_on_item();

-- Updated order-status handler: return/re-deduct from inventory_items on
-- cancel / uncancel. Delivery no longer needs to dispatch (already dispatched
-- at creation), but kept idempotent for legacy orders.
CREATE OR REPLACE FUNCTION public.handle_order_status_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item record;
  oi record;
  v_result jsonb;
BEGIN
  -- CANCEL: return product.stock and per-warehouse inventory
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.products p SET stock = stock + oi.quantity::int
      FROM public.order_items oi
      WHERE oi.order_id = NEW.id AND oi.product_id = p.id;

    IF COALESCE(NEW.source_warehouse_id, OLD.source_warehouse_id) IS NOT NULL THEN
      FOR oi IN
        SELECT product_id, quantity FROM public.order_items
        WHERE order_id = NEW.id AND product_id IS NOT NULL
      LOOP
        SELECT * INTO v_item FROM public.inventory_items
          WHERE warehouse_id = COALESCE(NEW.source_warehouse_id, OLD.source_warehouse_id)
            AND product_id = oi.product_id
          ORDER BY stock ASC NULLS LAST LIMIT 1;
        IF v_item.id IS NOT NULL THEN
          UPDATE public.inventory_items
            SET stock = stock + oi.quantity, last_movement_date = now()
            WHERE id = v_item.id;
          INSERT INTO public.inventory_movements(
            item_id, warehouse_id, movement_type, quantity, unit_cost,
            reference_type, reference_id, module, reason, product_id
          ) VALUES (
            v_item.id, v_item.warehouse_id, 'sales_return', oi.quantity,
            COALESCE(v_item.unit_cost,0), 'order', NEW.id::text, v_item.module,
            'إرجاع تلقائي عند إلغاء الطلب', oi.product_id
          );
        END IF;
      END LOOP;
      NEW.stock_status := 'returned';
    END IF;
  END IF;

  -- UNCANCEL: deduct again
  IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.products p SET stock = GREATEST(stock - oi.quantity::int, 0)
      FROM public.order_items oi
      WHERE oi.order_id = NEW.id AND oi.product_id = p.id;

    IF NEW.source_warehouse_id IS NOT NULL THEN
      FOR oi IN
        SELECT product_id, quantity FROM public.order_items
        WHERE order_id = NEW.id AND product_id IS NOT NULL
      LOOP
        SELECT * INTO v_item FROM public.inventory_items
          WHERE warehouse_id = NEW.source_warehouse_id
            AND product_id = oi.product_id
          ORDER BY stock DESC NULLS LAST LIMIT 1;
        IF v_item.id IS NOT NULL THEN
          UPDATE public.inventory_items
            SET stock = stock - oi.quantity, last_movement_date = now()
            WHERE id = v_item.id;
          INSERT INTO public.inventory_movements(
            item_id, warehouse_id, movement_type, quantity, unit_cost,
            reference_type, reference_id, module, reason, product_id
          ) VALUES (
            v_item.id, v_item.warehouse_id, 'sales_dispatch', -oi.quantity,
            COALESCE(v_item.unit_cost,0), 'order', NEW.id::text, v_item.module,
            'إعادة سحب بعد إلغاء التراجع', oi.product_id
          );
        END IF;
      END LOOP;
      NEW.stock_status := 'dispatched';
    END IF;
  END IF;

  -- Legacy: ensure dispatch on delivery for orders that weren't auto-dispatched yet
  IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
    IF COALESCE(NEW.stock_status,'not_dispatched') <> 'dispatched'
       AND NEW.source_warehouse_id IS NOT NULL THEN
      BEGIN
        v_result := public.dispatch_order_stock(NEW.id);
        NEW.stock_status := 'dispatched';
      EXCEPTION WHEN OTHERS THEN
        -- swallow auth errors silently; per-item trigger already handled it on creation
        NULL;
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
