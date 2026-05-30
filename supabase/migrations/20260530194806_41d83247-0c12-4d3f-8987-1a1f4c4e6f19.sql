
-- Reverse stock on DELETE of a purchase item (and recompute header total)
CREATE OR REPLACE FUNCTION public.revert_feed_raw_purchase_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.feed_raw_materials
     SET stock = GREATEST(0, COALESCE(stock,0) - OLD.quantity),
         updated_at = now()
   WHERE id = OLD.raw_material_id;

  UPDATE public.feed_raw_purchases
     SET total_amount = COALESCE((
            SELECT SUM(quantity * unit_price)
              FROM public.feed_raw_purchase_items
             WHERE purchase_id = OLD.purchase_id
         ),0),
         updated_at = now()
   WHERE id = OLD.purchase_id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_revert_feed_raw_purchase_item ON public.feed_raw_purchase_items;
CREATE TRIGGER trg_revert_feed_raw_purchase_item
AFTER DELETE ON public.feed_raw_purchase_items
FOR EACH ROW EXECUTE FUNCTION public.revert_feed_raw_purchase_item();

-- Reverse stock on DELETE of a sale item (add finished stock back, recompute header)
CREATE OR REPLACE FUNCTION public.revert_feed_sale_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.feed_products
     SET current_stock = COALESCE(current_stock,0) + OLD.quantity,
         updated_at = now()
   WHERE id = OLD.feed_product_id;

  UPDATE public.feed_sales
     SET total_amount = COALESCE((SELECT SUM(quantity*unit_price) FROM public.feed_sale_items WHERE sale_id = OLD.sale_id),0),
         total_cost   = COALESCE((SELECT SUM(quantity*COALESCE(unit_cost,0)) FROM public.feed_sale_items WHERE sale_id = OLD.sale_id),0),
         profit       = COALESCE((SELECT SUM(quantity*(unit_price-COALESCE(unit_cost,0))) FROM public.feed_sale_items WHERE sale_id = OLD.sale_id),0),
         updated_at = now()
   WHERE id = OLD.sale_id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_revert_feed_sale_item ON public.feed_sale_items;
CREATE TRIGGER trg_revert_feed_sale_item
AFTER DELETE ON public.feed_sale_items
FOR EACH ROW EXECUTE FUNCTION public.revert_feed_sale_item();

-- Apply a stock count to actual stock (only general/executive managers)
CREATE OR REPLACE FUNCTION public.apply_feed_stock_count(_count_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_allowed boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = auth.uid()
       AND role IN ('general_manager','executive_manager')
  ) INTO is_allowed;
  IF NOT is_allowed THEN
    RAISE EXCEPTION 'غير مصرح بتطبيق الجرد';
  END IF;

  UPDATE public.feed_raw_materials m
     SET stock = i.counted_qty,
         updated_at = now()
    FROM public.feed_stock_count_items i
   WHERE i.count_id = _count_id
     AND i.item_kind = 'raw_material'
     AND i.raw_material_id = m.id;

  UPDATE public.feed_products p
     SET current_stock = i.counted_qty,
         updated_at = now()
    FROM public.feed_stock_count_items i
   WHERE i.count_id = _count_id
     AND i.item_kind = 'finished_feed'
     AND i.feed_product_id = p.id;

  UPDATE public.feed_stock_counts
     SET status = 'closed',
         closed_at = COALESCE(closed_at, now()),
         notes = COALESCE(notes,'') || E'\n[تم تطبيق الجرد على المخزون '|| to_char(now(),'YYYY-MM-DD HH24:MI') ||']'
   WHERE id = _count_id;
END $$;

GRANT EXECUTE ON FUNCTION public.apply_feed_stock_count(uuid) TO authenticated;
