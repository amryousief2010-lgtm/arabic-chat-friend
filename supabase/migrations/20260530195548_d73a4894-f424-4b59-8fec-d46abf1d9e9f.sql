
-- Allow sale items to reference raw materials too
ALTER TABLE public.feed_sale_items
  ALTER COLUMN feed_product_id DROP NOT NULL;

ALTER TABLE public.feed_sale_items
  ADD COLUMN IF NOT EXISTS raw_material_id uuid REFERENCES public.feed_raw_materials(id);

ALTER TABLE public.feed_sale_items
  DROP CONSTRAINT IF EXISTS feed_sale_items_one_ref;
ALTER TABLE public.feed_sale_items
  ADD CONSTRAINT feed_sale_items_one_ref CHECK (
    (feed_product_id IS NOT NULL AND raw_material_id IS NULL) OR
    (feed_product_id IS NULL AND raw_material_id IS NOT NULL)
  );

-- Replace apply trigger to handle both kinds
CREATE OR REPLACE FUNCTION public.apply_feed_sale_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cur_stock numeric;
  cur_cost  numeric;
BEGIN
  IF NEW.feed_product_id IS NOT NULL THEN
    SELECT COALESCE(current_stock,0), COALESCE(latest_unit_cost,0)
      INTO cur_stock, cur_cost
      FROM feed_products WHERE id = NEW.feed_product_id;
    IF cur_stock < NEW.quantity THEN
      RAISE EXCEPTION 'الكمية المتاحة من المنتج غير كافية (المتاح %, المطلوب %)', cur_stock, NEW.quantity;
    END IF;
    IF NEW.unit_cost IS NULL THEN NEW.unit_cost := cur_cost; END IF;

    UPDATE feed_products
       SET current_stock = current_stock - NEW.quantity,
           updated_at = now()
     WHERE id = NEW.feed_product_id;
  ELSIF NEW.raw_material_id IS NOT NULL THEN
    SELECT COALESCE(stock,0), COALESCE(unit_cost,0)
      INTO cur_stock, cur_cost
      FROM feed_raw_materials WHERE id = NEW.raw_material_id;
    IF cur_stock < NEW.quantity THEN
      RAISE EXCEPTION 'الكمية المتاحة من الخامة غير كافية (المتاح %, المطلوب %)', cur_stock, NEW.quantity;
    END IF;
    IF NEW.unit_cost IS NULL THEN NEW.unit_cost := cur_cost; END IF;

    UPDATE feed_raw_materials
       SET stock = stock - NEW.quantity,
           updated_at = now()
     WHERE id = NEW.raw_material_id;
  END IF;

  -- recompute header
  UPDATE feed_sales
     SET total_amount = COALESCE((SELECT SUM(quantity*unit_price) FROM feed_sale_items WHERE sale_id = NEW.sale_id),0) + (NEW.quantity*NEW.unit_price),
         total_cost   = COALESCE((SELECT SUM(quantity*COALESCE(unit_cost,0)) FROM feed_sale_items WHERE sale_id = NEW.sale_id),0) + (NEW.quantity*COALESCE(NEW.unit_cost,0)),
         updated_at = now()
   WHERE id = NEW.sale_id;
  UPDATE feed_sales
     SET profit = COALESCE(total_amount,0) - COALESCE(total_cost,0)
   WHERE id = NEW.sale_id;
  RETURN NEW;
END $$;

-- Revert on delete (already handled for products; extend for raws)
CREATE OR REPLACE FUNCTION public.revert_feed_sale_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.feed_product_id IS NOT NULL THEN
    UPDATE public.feed_products
       SET current_stock = COALESCE(current_stock,0) + OLD.quantity,
           updated_at = now()
     WHERE id = OLD.feed_product_id;
  ELSIF OLD.raw_material_id IS NOT NULL THEN
    UPDATE public.feed_raw_materials
       SET stock = COALESCE(stock,0) + OLD.quantity,
           updated_at = now()
     WHERE id = OLD.raw_material_id;
  END IF;

  UPDATE public.feed_sales
     SET total_amount = COALESCE((SELECT SUM(quantity*unit_price) FROM public.feed_sale_items WHERE sale_id = OLD.sale_id),0),
         total_cost   = COALESCE((SELECT SUM(quantity*COALESCE(unit_cost,0)) FROM public.feed_sale_items WHERE sale_id = OLD.sale_id),0),
         profit       = COALESCE((SELECT SUM(quantity*(unit_price-COALESCE(unit_cost,0))) FROM public.feed_sale_items WHERE sale_id = OLD.sale_id),0),
         updated_at = now()
   WHERE id = OLD.sale_id;
  RETURN OLD;
END $$;
