-- Fix product visibility in warehouse supply/dispatch dropdowns without changing balances.
-- 1) Safely deactivate zero-balance orphan inventory rows that duplicate a real product row.
-- 2) Make the auto-link trigger create one active inventory_items row for every active product in active sales warehouses.

UPDATE public.inventory_items orphan
SET
  is_active = false,
  notes = CONCAT_WS(E'\n', orphan.notes, 'Auto-deactivated duplicate orphan row: product exists in the same warehouse; balance preserved at zero.'),
  updated_at = now()
WHERE orphan.product_id IS NULL
  AND COALESCE(orphan.stock, 0) = 0
  AND COALESCE(orphan.reserved_qty, 0) = 0
  AND COALESCE(orphan.blocked_qty, 0) = 0
  AND NOT EXISTS (
    SELECT 1 FROM public.inventory_movements im WHERE im.item_id = orphan.id
  )
  AND EXISTS (
    SELECT 1
    FROM public.products p
    JOIN public.inventory_items linked
      ON linked.product_id = p.id
     AND linked.warehouse_id = orphan.warehouse_id
    WHERE p.is_active = true
      AND linked.is_active = true
      AND btrim(lower(regexp_replace(p.name, '[[:space:]]+', ' ', 'g'))) = btrim(lower(regexp_replace(orphan.name, '[[:space:]]+', ' ', 'g')))
  );

CREATE OR REPLACE FUNCTION public.auto_link_product_to_customer_warehouses()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF COALESCE(NEW.is_active, true) = false THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.inventory_items (warehouse_id, product_id, name, category, unit, stock, unit_cost, is_active, module)
  SELECT w.id, NEW.id, NEW.name, NEW.category, COALESCE(NEW.unit,'قطعة'), 0, COALESCE(NEW.cost_price,0), true, 'warehouse'
  FROM public.warehouses w
  WHERE COALESCE(w.is_active, true) = true
    AND (
      w.name ILIKE '%الرئيسي%'
      OR w.name ILIKE '%المقر%'
      OR w.name ILIKE '%العجوزة%'
      OR w.name ILIKE '%كارفور%'
      OR w.name ILIKE '%carrefour%'
      OR w.name ILIKE '%هيلثي%'
      OR w.name ILIKE '%healthy%'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.inventory_items ii
      WHERE ii.product_id = NEW.id AND ii.warehouse_id = w.id
    );

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_auto_link_product_to_customer_warehouses ON public.products;
CREATE TRIGGER trg_auto_link_product_to_customer_warehouses
AFTER INSERT OR UPDATE OF is_active ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.auto_link_product_to_customer_warehouses();

-- Backfill any missing active product/warehouse links after redefining the dynamic target list.
INSERT INTO public.inventory_items (warehouse_id, product_id, name, category, unit, stock, unit_cost, is_active, module)
SELECT w.id, p.id, p.name, p.category, COALESCE(p.unit,'قطعة'), 0, COALESCE(p.cost_price,0), true, 'warehouse'
FROM public.products p
JOIN public.warehouses w ON COALESCE(w.is_active, true) = true
WHERE p.is_active = true
  AND (
    w.name ILIKE '%الرئيسي%'
    OR w.name ILIKE '%المقر%'
    OR w.name ILIKE '%العجوزة%'
    OR w.name ILIKE '%كارفور%'
    OR w.name ILIKE '%carrefour%'
    OR w.name ILIKE '%هيلثي%'
    OR w.name ILIKE '%healthy%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.inventory_items ii
    WHERE ii.product_id = p.id AND ii.warehouse_id = w.id
  );
