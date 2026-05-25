
CREATE OR REPLACE VIEW public.v_stock_reconciliation
WITH (security_invoker = true) AS
WITH sales_inv AS (
  SELECT
    product_id,
    COALESCE(SUM(stock) FILTER (WHERE warehouse_id = '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid), 0) AS main_stock,
    COALESCE(SUM(stock) FILTER (WHERE warehouse_id = 'a970d469-37df-40e1-b99f-a49195a3778e'::uuid), 0) AS agouza_stock,
    COALESCE(SUM(stock), 0) AS total_sales_stock,
    COUNT(*) AS inv_row_count
  FROM public.inventory_items
  WHERE product_id IS NOT NULL
    AND warehouse_id IN (
      '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid,
      'a970d469-37df-40e1-b99f-a49195a3778e'::uuid
    )
  GROUP BY product_id
),
base AS (
  SELECT
    p.id AS product_id, p.barcode, p.name, p.is_active,
    COALESCE(p.stock,0) AS legacy_stock,
    COALESCE(si.main_stock,0) AS main_stock,
    COALESCE(si.agouza_stock,0) AS agouza_stock,
    COALESCE(si.total_sales_stock,0) AS total_sales_stock,
    COALESCE(si.inv_row_count,0) AS inv_row_count,
    (COALESCE(p.stock,0) - COALESCE(si.total_sales_stock,0)) AS diff,
    CASE
      WHEN p.barcode IS NULL OR p.barcode = '' OR p.is_active IS NOT TRUE
        THEN 'inactive_or_missing_barcode'
      WHEN COALESCE(si.inv_row_count,0) = 0 THEN 'missing_inventory_row'
      WHEN (COALESCE(p.stock,0) - COALESCE(si.total_sales_stock,0)) = 0 THEN 'matched'
      WHEN (COALESCE(p.stock,0) - COALESCE(si.total_sales_stock,0)) > 0 THEN 'legacy_higher'
      ELSE 'inventory_higher'
    END AS issue_type
  FROM public.products p
  LEFT JOIN sales_inv si ON si.product_id = p.id
)
SELECT
  b.product_id, b.barcode, b.name, b.is_active,
  b.legacy_stock, b.main_stock, b.agouza_stock, b.total_sales_stock,
  b.inv_row_count, b.diff, b.issue_type,
  CASE b.issue_type
    WHEN 'matched'                     THEN 'no_action'
    WHEN 'inactive_or_missing_barcode' THEN 'freeze_no_dispatch'
    WHEN 'missing_inventory_row'       THEN 'seed_inventory_item_then_reconcile'
    WHEN 'legacy_higher'               THEN 'reduce_legacy_to_inventory_truth'
    WHEN 'inventory_higher'            THEN 'manager_review_inventory_higher'
  END AS recommended_action,
  (b.issue_type <> 'matched') AS requires_manager_approval
FROM base b;

REVOKE ALL ON public.v_stock_reconciliation FROM PUBLIC;
GRANT SELECT ON public.v_stock_reconciliation TO authenticated;

CREATE OR REPLACE FUNCTION public.dispatch_dry_run(p_order_id uuid)
RETURNS TABLE (
  order_id uuid,
  order_number text,
  shipping_company text,
  source_warehouse_id uuid,
  warehouse_name text,
  stock_status text,
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
  legacy_behavior text,
  new_behavior text,
  double_deduction_risk boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
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
      'movement_type','sales_dispatch',
      'warehouse_id', i.source_warehouse_id,
      'inventory_item_id', i.inventory_item_id,
      'product_id', i.product_id,
      'quantity', i.required_qty,
      'reference_table','orders',
      'reference_id', i.order_id,
      'reference_note', concat('DRY-RUN dispatch for ', i.order_number)
    ) AS expected_movement,
    'Legacy: deduct_stock_on_order_item decremented products.stock on item INSERT (not warehouse-aware, clamps at 0). handle_order_status_stock toggles products.stock on cancel transitions, also not warehouse-aware.' AS legacy_behavior,
    'New: dispatch_order_stock inserts a sales_dispatch row into inventory_movements against the resolved warehouse inventory_items row; idempotent via unique (reference_id, movement_type).' AS new_behavior,
    true AS double_deduction_risk
  FROM items i
  ORDER BY i.product_name NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.dispatch_dry_run(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dispatch_dry_run(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.dispatch_dry_run(uuid) TO authenticated;

COMMENT ON FUNCTION public.dispatch_dry_run(uuid) IS
'Phase 5B-DRY-RUN read-only simulator. SECURITY INVOKER, STABLE. Allowed roles: general_manager, executive_manager, warehouse_supervisor.';
