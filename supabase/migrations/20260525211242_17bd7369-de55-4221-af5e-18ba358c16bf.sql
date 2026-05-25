
CREATE OR REPLACE FUNCTION public.handle_order_status_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  -- Legacy products.stock adjustment on cancel/uncancel (unchanged for backward compat)
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.products p SET stock = stock + oi.quantity::int
    FROM public.order_items oi WHERE oi.order_id = NEW.id AND oi.product_id = p.id;
  END IF;
  IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.products p SET stock = GREATEST(stock - oi.quantity::int, 0)
    FROM public.order_items oi WHERE oi.order_id = NEW.id AND oi.product_id = p.id;
  END IF;

  -- Phase 8: Auto-dispatch on delivery
  IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
    IF COALESCE(NEW.stock_status, 'not_dispatched') <> 'dispatched'
       AND NEW.source_warehouse_id IS NOT NULL THEN
      v_result := public.dispatch_order_stock(NEW.id);
      -- dispatch_order_stock already updates stock_status='dispatched' on the row,
      -- but we are inside a BEFORE/AFTER trigger on the same row update; sync NEW
      NEW.stock_status := 'dispatched';
    END IF;
  END IF;

  -- Phase 8: Auto-return on rollback from delivered
  IF OLD.status = 'delivered' AND NEW.status IS DISTINCT FROM 'delivered' THEN
    IF OLD.stock_status = 'dispatched' THEN
      v_result := public.return_order_stock(NEW.id, 'تراجع عن التوصيل: ' || NEW.status);
      NEW.stock_status := 'returned';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Trigger needs to be BEFORE UPDATE so NEW.stock_status mutation persists
DROP TRIGGER IF EXISTS trg_handle_order_status_stock ON public.orders;
CREATE TRIGGER trg_handle_order_status_stock
BEFORE UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.handle_order_status_stock();
