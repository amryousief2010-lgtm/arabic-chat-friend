DO $mig$
DECLARE
  wh_ids uuid[] := ARRAY[
    '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid,
    'a970d469-37df-40e1-b99f-a49195a3778e'::uuid,
    '07ce03a3-2250-4894-b7f6-c7b79445edab'::uuid,
    '7178babf-83ab-4868-a298-e6507ff3d987'::uuid
  ];
BEGIN
  INSERT INTO public.inventory_items (warehouse_id, product_id, name, category, unit, stock, unit_cost, is_active, module)
  SELECT w.wh, p.id, p.name, p.category, COALESCE(p.unit,'قطعة'), 0, COALESCE(p.cost_price,0), true, 'sales'
  FROM public.products p
  CROSS JOIN unnest(wh_ids) AS w(wh)
  WHERE p.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM public.inventory_items ii
      WHERE ii.product_id = p.id AND ii.warehouse_id = w.wh
    );
END
$mig$;

CREATE OR REPLACE FUNCTION public.auto_link_product_to_customer_warehouses()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  wh_ids uuid[] := ARRAY[
    '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid,
    'a970d469-37df-40e1-b99f-a49195a3778e'::uuid,
    '07ce03a3-2250-4894-b7f6-c7b79445edab'::uuid,
    '7178babf-83ab-4868-a298-e6507ff3d987'::uuid
  ];
BEGIN
  IF COALESCE(NEW.is_active, true) = false THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.inventory_items (warehouse_id, product_id, name, category, unit, stock, unit_cost, is_active, module)
  SELECT w, NEW.id, NEW.name, NEW.category, COALESCE(NEW.unit,'قطعة'), 0, COALESCE(NEW.cost_price,0), true, 'sales'
  FROM unnest(wh_ids) AS w
  WHERE NOT EXISTS (
    SELECT 1 FROM public.inventory_items ii
    WHERE ii.product_id = NEW.id AND ii.warehouse_id = w
  );

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_auto_link_product_to_customer_warehouses ON public.products;
CREATE TRIGGER trg_auto_link_product_to_customer_warehouses
AFTER INSERT OR UPDATE OF is_active ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.auto_link_product_to_customer_warehouses();