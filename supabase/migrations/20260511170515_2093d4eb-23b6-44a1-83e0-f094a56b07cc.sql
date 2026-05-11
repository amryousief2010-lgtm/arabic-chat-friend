
CREATE OR REPLACE FUNCTION public.deduct_stock_on_order_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  SELECT status INTO v_status FROM public.orders WHERE id = NEW.order_id;
  IF v_status IS NULL OR v_status = 'cancelled' THEN RETURN NEW; END IF;
  UPDATE public.products SET stock = GREATEST(stock - NEW.quantity::int, 0) WHERE id = NEW.product_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deduct_stock_on_order_item ON public.order_items;
CREATE TRIGGER trg_deduct_stock_on_order_item
AFTER INSERT ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.deduct_stock_on_order_item();

CREATE OR REPLACE FUNCTION public.handle_order_status_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.products p SET stock = stock + oi.quantity::int
    FROM public.order_items oi WHERE oi.order_id = NEW.id AND oi.product_id = p.id;
  END IF;
  IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.products p SET stock = GREATEST(stock - oi.quantity::int, 0)
    FROM public.order_items oi WHERE oi.order_id = NEW.id AND oi.product_id = p.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_handle_order_status_stock ON public.orders;
CREATE TRIGGER trg_handle_order_status_stock
AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.handle_order_status_stock();

DROP POLICY IF EXISTS "Shipping company can view all orders" ON public.orders;
CREATE POLICY "Shipping company can view all orders" ON public.orders FOR SELECT
USING (has_role(auth.uid(), 'shipping_company'::app_role));

DROP POLICY IF EXISTS "Shipping company can view all order items" ON public.order_items;
CREATE POLICY "Shipping company can view all order items" ON public.order_items FOR SELECT
USING (has_role(auth.uid(), 'shipping_company'::app_role));

DROP POLICY IF EXISTS "Shipping company can view customers" ON public.customers;
CREATE POLICY "Shipping company can view customers" ON public.customers FOR SELECT
USING (has_role(auth.uid(), 'shipping_company'::app_role));

DROP POLICY IF EXISTS "Shipping company can update order status" ON public.orders;
CREATE POLICY "Shipping company can update order status" ON public.orders FOR UPDATE
USING (has_role(auth.uid(), 'shipping_company'::app_role) AND status IN ('pending','processing','shipped','delivered','cancelled'))
WITH CHECK (has_role(auth.uid(), 'shipping_company'::app_role) AND status IN ('delivered','cancelled'));
