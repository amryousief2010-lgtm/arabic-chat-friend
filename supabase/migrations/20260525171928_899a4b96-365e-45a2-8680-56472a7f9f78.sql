-- =========================================================
-- Phase 3: Link products ↔ inventory_items, prep Agouza rows
-- NON-DESTRUCTIVE & IDEMPOTENT
-- =========================================================

-- 1) Add product_id link column on inventory_items
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id);

CREATE INDEX IF NOT EXISTS idx_inventory_items_product_id
  ON public.inventory_items(product_id);

CREATE INDEX IF NOT EXISTS idx_inventory_items_warehouse_product
  ON public.inventory_items(warehouse_id, product_id);

-- 2) Backfill product_id for existing inventory_items by exact name match
UPDATE public.inventory_items i
SET product_id = p.id
FROM public.products p
WHERE i.product_id IS NULL
  AND p.is_active = true
  AND p.name = i.name;

-- 3) Create MAIN warehouse rows for active products with barcode that don't have one yet
INSERT INTO public.inventory_items
  (warehouse_id, product_id, name, sku, item_code, unit, stock,
   reserved_qty, blocked_qty, low_stock_threshold, unit_cost, is_active, module)
SELECT
  '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid,
  p.id,
  p.name,
  p.barcode,
  p.barcode,
  COALESCE(p.unit, 'قطعة'),
  0,
  0,
  0,
  10,
  COALESCE(p.cost_price, 0),
  true,
  'sales'
FROM public.products p
WHERE p.is_active = true
  AND p.barcode IS NOT NULL
  AND length(trim(p.barcode)) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.inventory_items i
    WHERE i.warehouse_id = '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid
      AND i.product_id = p.id
  );

-- 4) Create AGOUZA warehouse rows for active products with barcode (all currently missing)
INSERT INTO public.inventory_items
  (warehouse_id, product_id, name, sku, item_code, unit, stock,
   reserved_qty, blocked_qty, low_stock_threshold, unit_cost, is_active, module)
SELECT
  'a970d469-37df-40e1-b99f-a49195a3778e'::uuid,
  p.id,
  p.name,
  p.barcode,
  p.barcode,
  COALESCE(p.unit, 'قطعة'),
  0,
  0,
  0,
  10,
  COALESCE(p.cost_price, 0),
  true,
  'sales'
FROM public.products p
WHERE p.is_active = true
  AND p.barcode IS NOT NULL
  AND length(trim(p.barcode)) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.inventory_items i
    WHERE i.warehouse_id = 'a970d469-37df-40e1-b99f-a49195a3778e'::uuid
      AND i.product_id = p.id
  );

-- 5) Read-only availability view
CREATE OR REPLACE VIEW public.v_product_stock_availability AS
SELECT
  p.id                AS product_id,
  p.name              AS product_name,
  p.barcode           AS barcode,
  p.is_active         AS product_active,
  w.id                AS warehouse_id,
  w.name              AS warehouse_name,
  i.id                AS inventory_item_id,
  COALESCE(i.stock, 0)         AS current_stock,
  COALESCE(i.reserved_qty, 0)  AS reserved_qty,
  COALESCE(i.blocked_qty, 0)   AS blocked_qty,
  (COALESCE(i.stock, 0)
     - COALESCE(i.reserved_qty, 0)
     - COALESCE(i.blocked_qty, 0)) AS available_stock,
  COALESCE(i.unit_cost, p.cost_price, 0) AS unit_cost,
  CASE
    WHEN p.is_active = false THEN false
    WHEN p.barcode IS NULL OR length(trim(p.barcode)) = 0 THEN false
    WHEN i.id IS NULL THEN false
    WHEN (COALESCE(i.stock,0) - COALESCE(i.reserved_qty,0) - COALESCE(i.blocked_qty,0)) > 0 THEN true
    ELSE false
  END AS can_fulfill
FROM public.products p
CROSS JOIN public.warehouses w
LEFT JOIN public.inventory_items i
  ON i.product_id = p.id AND i.warehouse_id = w.id
WHERE w.id IN (
  '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid,
  'a970d469-37df-40e1-b99f-a49195a3778e'::uuid
);

COMMENT ON VIEW public.v_product_stock_availability IS
  'Phase 3: read-only per-product per-warehouse availability. Used by UI/RPC in later phases. No mutations.';
