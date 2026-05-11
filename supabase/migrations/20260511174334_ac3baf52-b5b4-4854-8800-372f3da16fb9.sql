-- Allow shipping_company + managers to modify order_items
CREATE POLICY "Shipping and managers can update order items"
ON public.order_items FOR UPDATE
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'shipping_company'::app_role]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'shipping_company'::app_role]));

CREATE POLICY "Shipping and managers can delete order items"
ON public.order_items FOR DELETE
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'shipping_company'::app_role]));

CREATE POLICY "Shipping company can insert order items"
ON public.order_items FOR INSERT
WITH CHECK (has_role(auth.uid(), 'shipping_company'::app_role));

-- Replace shipping_company orders update policy to allow full updates (not just status)
DROP POLICY IF EXISTS "Shipping company can update order status" ON public.orders;

CREATE POLICY "Shipping company can update orders"
ON public.orders FOR UPDATE
USING (has_role(auth.uid(), 'shipping_company'::app_role))
WITH CHECK (has_role(auth.uid(), 'shipping_company'::app_role));

-- Trigger: when an order_item changes (qty/price), restock difference and recompute totals
CREATE OR REPLACE FUNCTION public.handle_order_item_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_status text; v_diff numeric;
BEGIN
  SELECT status INTO v_status FROM public.orders WHERE id = NEW.order_id;
  IF v_status IS NOT NULL AND v_status <> 'cancelled' AND NEW.product_id IS NOT NULL THEN
    -- Adjust stock by quantity diff (old - new added back; new deducted)
    IF OLD.product_id = NEW.product_id THEN
      v_diff := NEW.quantity::int - OLD.quantity::int;
      IF v_diff <> 0 THEN
        UPDATE public.products SET stock = GREATEST(stock - v_diff::int, 0) WHERE id = NEW.product_id;
      END IF;
    ELSE
      -- product changed: return old stock, deduct new
      IF OLD.product_id IS NOT NULL THEN
        UPDATE public.products SET stock = stock + OLD.quantity::int WHERE id = OLD.product_id;
      END IF;
      UPDATE public.products SET stock = GREATEST(stock - NEW.quantity::int, 0) WHERE id = NEW.product_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_item_update ON public.order_items;
CREATE TRIGGER trg_order_item_update
AFTER UPDATE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.handle_order_item_update();

-- Restock when order_item deleted
CREATE OR REPLACE FUNCTION public.handle_order_item_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM public.orders WHERE id = OLD.order_id;
  IF v_status IS NOT NULL AND v_status <> 'cancelled' AND OLD.product_id IS NOT NULL THEN
    UPDATE public.products SET stock = stock + OLD.quantity::int WHERE id = OLD.product_id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_item_delete ON public.order_items;
CREATE TRIGGER trg_order_item_delete
AFTER DELETE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.handle_order_item_delete();

-- Ensure stock-deduct trigger exists on insert
DROP TRIGGER IF EXISTS trg_order_item_insert ON public.order_items;
CREATE TRIGGER trg_order_item_insert
AFTER INSERT ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.deduct_stock_on_order_item();

-- Recompute totals on order whenever items change
CREATE OR REPLACE FUNCTION public.recompute_order_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_order_id uuid; v_subtotal numeric;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  SELECT COALESCE(SUM(total_price), 0) INTO v_subtotal FROM public.order_items WHERE order_id = v_order_id;
  UPDATE public.orders
    SET subtotal = v_subtotal,
        total = v_subtotal + COALESCE(delivery_fee,0) - COALESCE(discount,0),
        updated_at = now()
    WHERE id = v_order_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_totals_ins ON public.order_items;
DROP TRIGGER IF EXISTS trg_recompute_totals_upd ON public.order_items;
DROP TRIGGER IF EXISTS trg_recompute_totals_del ON public.order_items;
CREATE TRIGGER trg_recompute_totals_ins AFTER INSERT ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.recompute_order_totals();
CREATE TRIGGER trg_recompute_totals_upd AFTER UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.recompute_order_totals();
CREATE TRIGGER trg_recompute_totals_del AFTER DELETE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.recompute_order_totals();