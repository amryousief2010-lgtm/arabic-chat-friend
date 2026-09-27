-- P0 — Inventory cost is visible only to finance roles.
-- The app role admin was renamed to general_manager and is not a separate value.
-- Allowed: general_manager, executive_manager, accountant, financial_manager, cost_accountant.
-- A table-level GRANT SELECT is not narrowed by REVOKE SELECT (column).
-- Replace table SELECT for anon/authenticated with every column except cost.
-- Screens that need a number read inventory_items_visible / inventory_movements_visible,
-- which return NULL for everyone else. service_role keeps table privileges.

CREATE OR REPLACE FUNCTION public.can_view_inventory_cost(p_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p_uid IS NOT NULL AND (
    public.has_role(p_uid, 'general_manager'::public.app_role)
    OR public.has_role(p_uid, 'executive_manager'::public.app_role)
    OR public.has_role(p_uid, 'accountant'::public.app_role)
    OR public.has_role(p_uid, 'financial_manager'::public.app_role)
    OR public.has_role(p_uid, 'cost_accountant'::public.app_role)
  );
$$;

REVOKE ALL ON FUNCTION public.can_view_inventory_cost(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_inventory_cost(uuid) TO authenticated, service_role;

DROP VIEW IF EXISTS public.inventory_items_visible;
CREATE VIEW public.inventory_items_visible
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  id, warehouse_id, name, category, sku, unit, stock, low_stock_threshold,
  CASE WHEN public.can_view_inventory_cost(auth.uid()) THEN unit_cost ELSE NULL END AS unit_cost,
  expiry_date, notes, is_active, created_at, updated_at, reserved_qty, blocked_qty,
  module, item_code, last_movement_date, product_id, pack_weight_kg
FROM public.inventory_items;

DROP VIEW IF EXISTS public.inventory_movements_visible;
CREATE VIEW public.inventory_movements_visible
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  id, item_id, warehouse_id, movement_type, quantity, destination_warehouse_id,
  reference, party,
  CASE WHEN public.can_view_inventory_cost(auth.uid()) THEN unit_cost ELSE NULL END AS unit_cost,
  notes, performed_by, performed_at, created_at, movement_no, module,
  source_warehouse_id, reference_type, reference_id, batch_id, reason,
  approval_status, approved_by, approved_at,
  CASE WHEN public.can_view_inventory_cost(auth.uid()) THEN total_cost ELSE NULL END AS total_cost,
  order_item_id, product_id, package_count, package_weight_kg, quantity_kg,
  stock_before, stock_after, effect_mode, period_lock_override_reason
FROM public.inventory_movements;

GRANT SELECT ON public.inventory_items_visible TO authenticated, anon, service_role;
GRANT SELECT ON public.inventory_movements_visible TO authenticated, anon, service_role;

-- Table-level SELECT overrides a column REVOKE. Replace it with an explicit list.
DO $cols$
DECLARE
  r text;
  item_cols text := 'id, warehouse_id, name, category, sku, unit, stock, low_stock_threshold, expiry_date, notes, is_active, created_at, updated_at, reserved_qty, blocked_qty, module, item_code, last_movement_date, product_id, pack_weight_kg';
  mov_cols text := 'id, item_id, warehouse_id, movement_type, quantity, destination_warehouse_id, reference, party, notes, performed_by, performed_at, created_at, movement_no, module, source_warehouse_id, reference_type, reference_id, batch_id, reason, approval_status, approved_by, approved_at, order_item_id, product_id, package_count, package_weight_kg, quantity_kg, stock_before, stock_after, effect_mode, period_lock_override_reason';
BEGIN
  FOREACH r IN ARRAY ARRAY['PUBLIC', 'anon', 'authenticated']
  LOOP
    IF r = 'PUBLIC' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE SELECT ON TABLE public.inventory_items FROM %s', r);
      EXECUTE format('REVOKE SELECT (unit_cost) ON public.inventory_items FROM %s', r);
      IF r <> 'PUBLIC' THEN
        EXECUTE format('GRANT SELECT (%s) ON public.inventory_items TO %s', item_cols, r);
      END IF;
      EXECUTE format('REVOKE SELECT ON TABLE public.inventory_movements FROM %s', r);
      EXECUTE format('REVOKE SELECT (unit_cost, total_cost) ON public.inventory_movements FROM %s', r);
      IF r <> 'PUBLIC' THEN
        EXECUTE format('GRANT SELECT (%s) ON public.inventory_movements TO %s', mov_cols, r);
      END IF;
    END IF;
  END LOOP;
END
$cols$;
