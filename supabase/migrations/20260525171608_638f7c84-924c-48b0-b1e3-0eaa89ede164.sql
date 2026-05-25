-- =========================================================
-- Phase 2: Order → Source Warehouse mapping (NON-DESTRUCTIVE)
-- Idempotent: safe to re-run.
-- =========================================================

-- 1) Columns on orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS source_warehouse_id uuid REFERENCES public.warehouses(id),
  ADD COLUMN IF NOT EXISTS stock_status text NOT NULL DEFAULT 'not_dispatched';

-- 2) CHECK constraint on stock_status (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_stock_status_chk'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_stock_status_chk
      CHECK (stock_status IN ('not_dispatched','reserved','dispatched','returned'));
  END IF;
END $$;

-- 3) Centralized resolver helper (single source of truth)
CREATE OR REPLACE FUNCTION public.resolve_order_source_warehouse(p_shipping_company text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_shipping_company IS NULL OR length(trim(p_shipping_company)) = 0
      THEN NULL
    WHEN trim(p_shipping_company) = 'العاصمة'
      THEN 'a970d469-37df-40e1-b99f-a49195a3778e'::uuid  -- مخزن فرع العجوزة
    ELSE
      '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid       -- المخزن الرئيسي
  END
$$;

-- 4) BEFORE trigger to auto-fill source_warehouse_id from shipping_company
CREATE OR REPLACE FUNCTION public.set_order_source_warehouse()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.source_warehouse_id := public.resolve_order_source_warehouse(NEW.shipping_company);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS orders_set_source_warehouse ON public.orders;
CREATE TRIGGER orders_set_source_warehouse
BEFORE INSERT OR UPDATE OF shipping_company
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.set_order_source_warehouse();

-- 5) Backfill existing orders (no inventory effect)
UPDATE public.orders
SET source_warehouse_id = public.resolve_order_source_warehouse(shipping_company)
WHERE source_warehouse_id IS DISTINCT FROM public.resolve_order_source_warehouse(shipping_company);

-- 6) Helpful index for warehouse-scoped reporting later
CREATE INDEX IF NOT EXISTS idx_orders_source_warehouse_id
  ON public.orders(source_warehouse_id);
