
-- Phase 5D-pre: schema-only safety preparation. No data changes, no trigger changes,
-- no stock changes, no order status changes.

-- 1) Add line-identity columns to inventory_movements (NULLABLE, no backfill).
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS order_item_id uuid NULL
    REFERENCES public.order_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS product_id uuid NULL
    REFERENCES public.products(id);

COMMENT ON COLUMN public.inventory_movements.order_item_id IS
  'Phase 5D-pre: identifies the originating order line for sales_dispatch / sales_return / reservation_release. NULL for all other movement sources.';
COMMENT ON COLUMN public.inventory_movements.product_id IS
  'Phase 5D-pre: denormalised product id for audit. Preserves trace even if inventory_items or order_items rows are later modified.';

-- 2) Helper index on the new line identity.
CREATE INDEX IF NOT EXISTS idx_inv_mov_order_item
  ON public.inventory_movements (order_item_id, movement_type);

-- 3) Sales-only partial UNIQUE index. Pre-flight confirmed zero existing rows match
--    the WHERE clause, so no conflict is possible at creation time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_mov_order_line_dispatch
  ON public.inventory_movements (order_item_id, movement_type, item_id)
  WHERE reference_type = 'order'
    AND movement_type IN ('sales_dispatch','sales_return','reservation_release');

-- 4) Snapshot table for Phase 5D manager-approved reconciliation. Empty.
CREATE TABLE IF NOT EXISTS public.products_stock_snapshot_5d (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id),
  legacy_stock_before numeric NOT NULL,
  inventory_stock_before numeric NOT NULL,
  snapped_at timestamptz NOT NULL DEFAULT now(),
  snapped_by uuid NULL,
  notes text NULL
);
CREATE INDEX IF NOT EXISTS idx_products_stock_snapshot_5d_product
  ON public.products_stock_snapshot_5d (product_id);

ALTER TABLE public.products_stock_snapshot_5d ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "snapshot_5d_managers_select" ON public.products_stock_snapshot_5d;
CREATE POLICY "snapshot_5d_managers_select"
  ON public.products_stock_snapshot_5d
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'general_manager'::app_role)
    OR public.has_role(auth.uid(),'executive_manager'::app_role)
    OR public.has_role(auth.uid(),'warehouse_supervisor'::app_role)
  );

DROP POLICY IF EXISTS "snapshot_5d_managers_insert" ON public.products_stock_snapshot_5d;
CREATE POLICY "snapshot_5d_managers_insert"
  ON public.products_stock_snapshot_5d
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'general_manager'::app_role)
    OR public.has_role(auth.uid(),'executive_manager'::app_role)
  );
-- No UPDATE/DELETE policies: snapshots are append-only.

-- 5) Status router audit log column on orders (jsonb, append-only via app code later).
--    Schema-only; no trigger reads or writes it yet.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS stock_router_log jsonb NULL;
COMMENT ON COLUMN public.orders.stock_router_log IS
  'Phase 5D-pre: reserved for the future status-router audit trail. Untouched until Phase 5F.';

-- 6) Extend dispatch_dry_run output with idempotency-key preview.
--    Read-only, SECURITY INVOKER, STABLE. Role guard preserved as-is.
DROP FUNCTION IF EXISTS public.dispatch_dry_run(uuid);
CREATE OR REPLACE FUNCTION public.dispatch_dry_run(p_order_id uuid)
RETURNS TABLE(
  order_id uuid,
  order_number text,
  shipping_company text,
  source_warehouse_id uuid,
  warehouse_name text,
  stock_status text,
  order_item_id uuid,
  product_id uuid,
  product_name text,
  barcode text,
  is_active boolean,
  required_qty numeric,
  available_qty numeric,
  inventory_item_id uuid,
  can_dispatch boolean,
  blocker_reason text,
  expected_movement jsonb,
  expected_idempotency_key jsonb,
  would_be_unique boolean,
  would_conflict boolean,
  legacy_behavior text,
  new_behavior text,
  double_deduction_risk boolean
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH guard AS (
    SELECT
      CASE
        WHEN auth.uid() IS NULL THEN (SELECT 1/0)
        WHEN NOT (
          public.has_role(auth.uid(), 'general_manager'::app_role)
          OR public.has_role(auth.uid(), 'executive_manager'::app_role)
          OR public.has_role(auth.uid(), 'warehouse_supervisor'::app_role)
        ) THEN (SELECT 1/0)
        ELSE 1
      END AS ok
  ),
  approved_companies(name) AS (
    VALUES ('العاصمة'),('زودكس'),('مندوب خاص'),
           ('مندوب من المزرعة'),('استلام من المزرعة'),('أخرى')
  ),
  o AS (
    SELECT
      ord.id, ord.order_number, ord.shipping_company,
      ord.source_warehouse_id, ord.stock_status,
      w.name AS warehouse_name,
      (ord.shipping_company IS NOT NULL
         AND ord.shipping_company NOT IN (SELECT name FROM approved_companies)) AS unknown_company
    FROM public.orders ord
    LEFT JOIN public.warehouses w ON w.id = ord.source_warehouse_id
    WHERE ord.id = p_order_id
      AND (SELECT ok FROM guard) = 1
  ),
  items AS (
    SELECT
      o.id AS order_id, o.order_number, o.shipping_company,
      o.source_warehouse_id, o.warehouse_name, o.stock_status, o.unknown_company,
      oi.id AS order_item_id,
      oi.product_id, oi.quantity AS required_qty,
      p.name AS product_name, p.barcode, p.is_active,
      ii.id AS inventory_item_id,
      COALESCE(ii.stock,0) AS available_qty,
      (ii.id IS NULL) AS no_inv_row
    FROM o
    JOIN public.order_items oi ON oi.order_id = o.id
    LEFT JOIN public.products p ON p.id = oi.product_id
    LEFT JOIN public.inventory_items ii
      ON ii.product_id = oi.product_id
     AND ii.warehouse_id = o.source_warehouse_id
  )
  SELECT
    i.order_id, i.order_number, i.shipping_company,
    i.source_warehouse_id, i.warehouse_name, i.stock_status,
    i.order_item_id,
    i.product_id, i.product_name, i.barcode, i.is_active,
    i.required_qty, i.available_qty, i.inventory_item_id,
    CASE
      WHEN i.source_warehouse_id IS NULL THEN false
      WHEN i.unknown_company THEN false
      WHEN i.is_active IS NOT TRUE THEN false
      WHEN i.barcode IS NULL OR i.barcode = '' THEN false
      WHEN i.no_inv_row THEN false
      WHEN i.available_qty < i.required_qty THEN false
      ELSE true
    END AS can_dispatch,
    CASE
      WHEN i.source_warehouse_id IS NULL THEN 'NULL_SOURCE_WAREHOUSE'
      WHEN i.unknown_company THEN 'UNKNOWN_SHIPPING_COMPANY'
      WHEN i.is_active IS NOT TRUE THEN 'INACTIVE_PRODUCT'
      WHEN i.barcode IS NULL OR i.barcode = '' THEN 'PRODUCT_NO_BARCODE'
      WHEN i.no_inv_row THEN 'NO_INVENTORY_ROW'
      WHEN i.available_qty < i.required_qty THEN 'INSUFFICIENT_STOCK'
      ELSE NULL
    END AS blocker_reason,
    jsonb_build_object(
      'reference_type','order',
      'reference_id', i.order_id,
      'order_item_id', i.order_item_id,
      'movement_type','sales_dispatch',
      'item_id', i.inventory_item_id,
      'warehouse_id', i.source_warehouse_id,
      'product_id', i.product_id,
      'quantity', i.required_qty,
      'module','sales',
      'reference_note', concat('DRY-RUN dispatch for ', i.order_number)
    ) AS expected_movement,
    jsonb_build_object(
      'order_item_id', i.order_item_id,
      'movement_type','sales_dispatch',
      'item_id', i.inventory_item_id,
      'partial_predicate','reference_type=order AND movement_type IN (sales_dispatch,sales_return,reservation_release)'
    ) AS expected_idempotency_key,
    -- A future INSERT would land in the partial unique index, and key columns are all non-null
    (i.order_item_id IS NOT NULL AND i.inventory_item_id IS NOT NULL) AS would_be_unique,
    -- Would conflict iff there is already a sales_dispatch row for the same line+inventory_item
    EXISTS (
      SELECT 1 FROM public.inventory_movements m
      WHERE m.reference_type = 'order'
        AND m.movement_type  = 'sales_dispatch'
        AND m.order_item_id  = i.order_item_id
        AND m.item_id        = i.inventory_item_id
    ) AS would_conflict,
    'Legacy: deduct_stock_on_order_item decremented products.stock on item INSERT (not warehouse-aware, clamps at 0). handle_order_status_stock toggles products.stock on cancel transitions, also not warehouse-aware.' AS legacy_behavior,
    'New (Phase 5F): dispatch_order_stock inserts one sales_dispatch row per order line into inventory_movements; idempotency enforced by partial UNIQUE (order_item_id, movement_type, item_id) WHERE reference_type=order.' AS new_behavior,
    true AS double_deduction_risk
  FROM items i
  ORDER BY i.product_name NULLS LAST;
$function$;

GRANT EXECUTE ON FUNCTION public.dispatch_dry_run(uuid) TO authenticated;
