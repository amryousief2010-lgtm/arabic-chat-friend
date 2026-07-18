CREATE OR REPLACE FUNCTION public.apply_feed_sale_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cur_stock numeric;
  cur_cost numeric;
BEGIN
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'الكمية يجب أن تكون أكبر من صفر';
  END IF;

  IF NEW.feed_product_id IS NOT NULL THEN
    SELECT COALESCE(current_stock,0), COALESCE(latest_unit_cost,0)
      INTO cur_stock, cur_cost
      FROM public.feed_products
     WHERE id = NEW.feed_product_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'منتج العلف غير موجود';
    END IF;

    IF cur_stock < NEW.quantity THEN
      RAISE EXCEPTION 'الكمية المتاحة من المنتج غير كافية (المتاح %, المطلوب %)', cur_stock, NEW.quantity;
    END IF;

    NEW.unit_cost := COALESCE(NULLIF(NEW.unit_cost,0), cur_cost, 0);
    NEW.line_total := COALESCE(NEW.quantity,0) * COALESCE(NEW.unit_price,0);
    NEW.line_cost := COALESCE(NEW.quantity,0) * COALESCE(NEW.unit_cost,0);

    UPDATE public.feed_products
       SET current_stock = current_stock - NEW.quantity,
           updated_at = now()
     WHERE id = NEW.feed_product_id;
  ELSIF NEW.raw_material_id IS NOT NULL THEN
    SELECT COALESCE(stock,0), COALESCE(unit_cost,0)
      INTO cur_stock, cur_cost
      FROM public.feed_raw_materials
     WHERE id = NEW.raw_material_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'الخامة غير موجودة';
    END IF;

    IF cur_stock < NEW.quantity THEN
      RAISE EXCEPTION 'الكمية المتاحة من الخامة غير كافية (المتاح %, المطلوب %)', cur_stock, NEW.quantity;
    END IF;

    NEW.unit_cost := COALESCE(NULLIF(NEW.unit_cost,0), cur_cost, 0);
    NEW.line_total := COALESCE(NEW.quantity,0) * COALESCE(NEW.unit_price,0);
    NEW.line_cost := COALESCE(NEW.quantity,0) * COALESCE(NEW.unit_cost,0);

    UPDATE public.feed_raw_materials
       SET stock = stock - NEW.quantity,
           updated_at = now()
     WHERE id = NEW.raw_material_id;
  ELSE
    RAISE EXCEPTION 'يجب اختيار منتج علف أو خامة';
  END IF;

  UPDATE public.feed_sales
     SET total_amount = COALESCE((SELECT SUM(quantity * unit_price) FROM public.feed_sale_items WHERE sale_id = NEW.sale_id),0) + NEW.line_total,
         total_cost = COALESCE((SELECT SUM(quantity * COALESCE(unit_cost,0)) FROM public.feed_sale_items WHERE sale_id = NEW.sale_id),0) + NEW.line_cost,
         updated_at = now()
   WHERE id = NEW.sale_id;

  UPDATE public.feed_sales
     SET profit = COALESCE(total_amount,0) - COALESCE(total_cost,0)
   WHERE id = NEW.sale_id;

  RETURN NEW;
END;
$function$;

WITH fixed_items AS (
  UPDATE public.feed_sale_items i
     SET unit_cost = COALESCE(NULLIF(i.unit_cost,0), NULLIF(i.unit_price,0), fp.latest_unit_cost, 0),
         line_total = i.quantity * i.unit_price,
         line_cost = i.quantity * COALESCE(NULLIF(i.unit_cost,0), NULLIF(i.unit_price,0), fp.latest_unit_cost, 0)
    FROM public.feed_sales s,
         public.feed_products fp
   WHERE s.id = i.sale_id
     AND fp.id = i.feed_product_id
     AND COALESCE(s.destination_type,'external_customer') <> 'external_customer'
     AND i.feed_product_id IS NOT NULL
     AND COALESCE(i.unit_cost,0) = 0
  RETURNING i.id, i.unit_cost
)
UPDATE public.brooding_feed_stock_movements m
   SET unit_cost = fi.unit_cost,
       total_cost = m.quantity_kg * fi.unit_cost
  FROM fixed_items fi
 WHERE m.source_type = 'feed_factory_invoice'
   AND m.source_id = fi.id;

UPDATE public.slaughterhouse_feed_movements m
   SET unit_cost = i.unit_cost,
       total_cost = m.quantity_kg * i.unit_cost
  FROM public.feed_sale_items i,
       public.feed_sales s
 WHERE s.id = i.sale_id
   AND m.source_type = 'feed_factory_invoice'
   AND m.source_id = i.id
   AND COALESCE(s.destination_type,'external_customer') <> 'external_customer'
   AND COALESCE(m.unit_cost,0) = 0
   AND COALESCE(i.unit_cost,0) > 0;

UPDATE public.feed_sales s
   SET total_amount = x.total_amount,
       total_cost = x.total_cost,
       profit = x.total_amount - x.total_cost,
       updated_at = now()
  FROM (
    SELECT sale_id,
           COALESCE(SUM(quantity * unit_price),0) AS total_amount,
           COALESCE(SUM(quantity * COALESCE(unit_cost,0)),0) AS total_cost
      FROM public.feed_sale_items
     GROUP BY sale_id
  ) x
 WHERE x.sale_id = s.id
   AND COALESCE(s.destination_type,'external_customer') <> 'external_customer';

WITH latest_brooding_cost AS (
  SELECT DISTINCT ON (feed_id) feed_id, unit_cost
    FROM public.brooding_feed_stock_movements
   WHERE movement_type = 'factory_supply'
     AND COALESCE(unit_cost,0) > 0
   ORDER BY feed_id, created_at DESC, id DESC
)
UPDATE public.brooding_feed_inventory bi
   SET last_unit_cost = l.unit_cost,
       updated_at = now()
  FROM latest_brooding_cost l
 WHERE bi.id = l.feed_id;

WITH latest_slaughter_cost AS (
  SELECT DISTINCT ON (feed_id) feed_id, unit_cost
    FROM public.slaughterhouse_feed_movements
   WHERE movement_type = 'factory_supply'
     AND COALESCE(unit_cost,0) > 0
   ORDER BY feed_id, created_at DESC, id DESC
)
UPDATE public.slaughterhouse_feed_inventory si
   SET last_unit_cost = l.unit_cost,
       updated_at = now()
  FROM latest_slaughter_cost l
 WHERE si.id = l.feed_id;