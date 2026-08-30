-- ============================================================
-- Phase 5(B2): Secure inventory READ layer (RPC only)
-- No RLS/grant changes on existing tables. No data changes.
-- ============================================================

-- 1) Cost visibility helper (no user_id parameter)
CREATE OR REPLACE FUNCTION public.inv_can_view_cost()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN (
        'general_manager','executive_manager','accountant',
        'financial_manager','cost_accountant'
      )
  )
$$;

REVOKE ALL ON FUNCTION public.inv_can_view_cost() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_can_view_cost() TO authenticated;

-- Internal helper: role membership check for the current user
CREATE OR REPLACE FUNCTION public.inv_has_any_role(_roles app_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = ANY(_roles)
  )
$$;

REVOKE ALL ON FUNCTION public.inv_has_any_role(app_role[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_has_any_role(app_role[]) TO authenticated;

-- ============================================================
-- 2) Sales availability (NO cost columns)
-- ============================================================
CREATE OR REPLACE FUNCTION public.inv_get_sales_availability(
  p_product_ids uuid[] DEFAULT NULL,
  p_warehouse_ids uuid[] DEFAULT NULL,
  p_active_only boolean DEFAULT true,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  inventory_item_id uuid,
  product_id uuid,
  warehouse_id uuid,
  warehouse_name text,
  item_code text,
  item_name text,
  unit text,
  current_stock numeric,
  reserved_stock numeric,
  blocked_stock numeric,
  available_stock numeric,
  is_active boolean,
  is_low_stock boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_limit integer; v_offset integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.inv_has_any_role(ARRAY[
      'general_manager','executive_manager','sales_manager','sales_moderator',
      'marketing_sales_manager','marketing_sales_viewer',
      'warehouse_supervisor','agouza_warehouse_keeper'
    ]::app_role[]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED_FOR_INVENTORY_AVAILABILITY';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);

  RETURN QUERY
  SELECT
    ii.id,
    ii.product_id,
    ii.warehouse_id,
    w.name,
    ii.item_code,
    ii.name,
    ii.unit,
    COALESCE(ii.stock, 0),
    COALESCE(ii.reserved_qty, 0),
    COALESCE(ii.blocked_qty, 0),
    GREATEST(COALESCE(ii.stock,0) - COALESCE(ii.reserved_qty,0) - COALESCE(ii.blocked_qty,0), 0),
    ii.is_active,
    (COALESCE(ii.stock,0) <= COALESCE(ii.low_stock_threshold,0))
  FROM public.inventory_items ii
  LEFT JOIN public.warehouses w ON w.id = ii.warehouse_id
  WHERE (p_product_ids IS NULL OR ii.product_id = ANY(p_product_ids))
    AND (p_warehouse_ids IS NULL OR ii.warehouse_id = ANY(p_warehouse_ids))
    AND (NOT COALESCE(p_active_only, true) OR ii.is_active = true)
    AND ii.product_id IS NOT NULL
  ORDER BY ii.name
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.inv_get_sales_availability(uuid[],uuid[],boolean,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_get_sales_availability(uuid[],uuid[],boolean,integer,integer) TO authenticated;

-- ============================================================
-- 3) Operational balances (NO cost columns)
-- ============================================================
CREATE OR REPLACE FUNCTION public.inv_get_operational_balances(
  p_warehouse_ids uuid[] DEFAULT NULL,
  p_modules text[] DEFAULT NULL,
  p_active_only boolean DEFAULT true,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  inventory_item_id uuid,
  product_id uuid,
  item_code text,
  item_name text,
  category text,
  unit text,
  module text,
  warehouse_id uuid,
  warehouse_name text,
  warehouse_type text,
  current_stock numeric,
  reserved_stock numeric,
  blocked_stock numeric,
  available_stock numeric,
  low_stock_threshold numeric,
  is_low_stock boolean,
  is_active boolean,
  last_movement_date timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_limit integer; v_offset integer; v_search text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.inv_has_any_role(ARRAY[
      'general_manager','executive_manager','warehouse_supervisor',
      'meat_factory_manager','feed_factory_manager','production_manager','quality_manager'
    ]::app_role[]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED_FOR_INVENTORY_OPERATIONS';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);
  v_search := NULLIF(btrim(COALESCE(p_search, '')), '');

  RETURN QUERY
  SELECT
    ii.id, ii.product_id, ii.item_code, ii.name, ii.category, ii.unit, ii.module,
    ii.warehouse_id, w.name, w.type,
    COALESCE(ii.stock,0),
    COALESCE(ii.reserved_qty,0),
    COALESCE(ii.blocked_qty,0),
    GREATEST(COALESCE(ii.stock,0) - COALESCE(ii.reserved_qty,0) - COALESCE(ii.blocked_qty,0), 0),
    COALESCE(ii.low_stock_threshold,0),
    (COALESCE(ii.stock,0) <= COALESCE(ii.low_stock_threshold,0)),
    ii.is_active,
    ii.last_movement_date
  FROM public.inventory_items ii
  LEFT JOIN public.warehouses w ON w.id = ii.warehouse_id
  WHERE (p_warehouse_ids IS NULL OR ii.warehouse_id = ANY(p_warehouse_ids))
    AND (p_modules IS NULL OR ii.module = ANY(p_modules))
    AND (NOT COALESCE(p_active_only, true) OR ii.is_active = true)
    AND (v_search IS NULL OR ii.name ILIKE '%' || v_search || '%' OR COALESCE(ii.item_code,'') ILIKE '%' || v_search || '%')
  ORDER BY ii.name
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.inv_get_operational_balances(uuid[],text[],boolean,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_get_operational_balances(uuid[],text[],boolean,text,integer,integer) TO authenticated;

-- ============================================================
-- 4) Operational movements (NO cost columns)
-- ============================================================
CREATE OR REPLACE FUNCTION public.inv_get_operational_movements(
  p_warehouse_ids uuid[] DEFAULT NULL,
  p_modules text[] DEFAULT NULL,
  p_movement_types text[] DEFAULT NULL,
  p_item_id uuid DEFAULT NULL,
  p_movement_no text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  movement_id uuid,
  movement_no text,
  movement_type text,
  module text,
  item_id uuid,
  item_name text,
  item_code text,
  unit text,
  warehouse_id uuid,
  warehouse_name text,
  source_warehouse_id uuid,
  destination_warehouse_id uuid,
  quantity numeric,
  reference text,
  reference_type text,
  reference_id text,
  reason text,
  approval_status text,
  performed_by uuid,
  performed_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_limit integer; v_offset integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.inv_has_any_role(ARRAY[
      'general_manager','executive_manager','warehouse_supervisor',
      'meat_factory_manager','feed_factory_manager','production_manager','quality_manager'
    ]::app_role[]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED_FOR_INVENTORY_OPERATIONS';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);

  RETURN QUERY
  SELECT
    m.id, m.movement_no, m.movement_type, m.module,
    m.item_id, ii.name, ii.item_code, ii.unit,
    m.warehouse_id, w.name,
    m.source_warehouse_id, m.destination_warehouse_id,
    m.quantity, m.reference, m.reference_type, m.reference_id,
    m.reason, m.approval_status, m.performed_by, m.performed_at, m.created_at
  FROM public.inventory_movements m
  LEFT JOIN public.inventory_items ii ON ii.id = m.item_id
  LEFT JOIN public.warehouses w ON w.id = m.warehouse_id
  WHERE (p_warehouse_ids IS NULL OR m.warehouse_id = ANY(p_warehouse_ids))
    AND (p_modules IS NULL OR m.module = ANY(p_modules))
    AND (p_movement_types IS NULL OR m.movement_type = ANY(p_movement_types))
    AND (p_item_id IS NULL OR m.item_id = p_item_id)
    AND (p_movement_no IS NULL OR m.movement_no = p_movement_no)
    AND (p_date_from IS NULL OR m.performed_at >= p_date_from)
    AND (p_date_to IS NULL OR m.performed_at < p_date_to)
  ORDER BY m.performed_at DESC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.inv_get_operational_movements(uuid[],text[],text[],uuid,text,timestamptz,timestamptz,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_get_operational_movements(uuid[],text[],text[],uuid,text,timestamptz,timestamptz,integer,integer) TO authenticated;

-- ============================================================
-- 5) Financial balances (cost visible, financial roles only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.inv_get_financial_balances(
  p_warehouse_ids uuid[] DEFAULT NULL,
  p_modules text[] DEFAULT NULL,
  p_active_only boolean DEFAULT true,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  inventory_item_id uuid,
  product_id uuid,
  item_code text,
  item_name text,
  category text,
  unit text,
  module text,
  warehouse_id uuid,
  warehouse_name text,
  current_stock numeric,
  reserved_stock numeric,
  blocked_stock numeric,
  available_stock numeric,
  unit_cost numeric,
  total_value numeric,
  has_zero_cost boolean,
  is_active boolean,
  last_movement_date timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_limit integer; v_offset integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.inv_can_view_cost() THEN RAISE EXCEPTION 'NOT_AUTHORIZED_TO_VIEW_COST'; END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);

  RETURN QUERY
  SELECT
    ii.id, ii.product_id, ii.item_code, ii.name, ii.category, ii.unit, ii.module,
    ii.warehouse_id, w.name,
    COALESCE(ii.stock,0),
    COALESCE(ii.reserved_qty,0),
    COALESCE(ii.blocked_qty,0),
    GREATEST(COALESCE(ii.stock,0) - COALESCE(ii.reserved_qty,0) - COALESCE(ii.blocked_qty,0), 0),
    COALESCE(ii.unit_cost,0),
    ROUND(COALESCE(ii.stock,0) * COALESCE(ii.unit_cost,0), 2),
    (COALESCE(ii.unit_cost,0) = 0 AND COALESCE(ii.stock,0) <> 0),
    ii.is_active,
    ii.last_movement_date
  FROM public.inventory_items ii
  LEFT JOIN public.warehouses w ON w.id = ii.warehouse_id
  WHERE (p_warehouse_ids IS NULL OR ii.warehouse_id = ANY(p_warehouse_ids))
    AND (p_modules IS NULL OR ii.module = ANY(p_modules))
    AND (NOT COALESCE(p_active_only, true) OR ii.is_active = true)
  ORDER BY ii.name
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.inv_get_financial_balances(uuid[],text[],boolean,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_get_financial_balances(uuid[],text[],boolean,integer,integer) TO authenticated;

-- ============================================================
-- 6) Financial movements (cost visible, financial roles only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.inv_get_financial_movements(
  p_warehouse_ids uuid[] DEFAULT NULL,
  p_modules text[] DEFAULT NULL,
  p_movement_types text[] DEFAULT NULL,
  p_item_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  movement_id uuid,
  movement_no text,
  movement_type text,
  module text,
  item_id uuid,
  item_name text,
  unit text,
  warehouse_id uuid,
  warehouse_name text,
  source_warehouse_id uuid,
  destination_warehouse_id uuid,
  quantity numeric,
  unit_cost numeric,
  total_cost numeric,
  reference text,
  reason text,
  approval_status text,
  performed_by uuid,
  performed_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_limit integer; v_offset integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.inv_can_view_cost() THEN RAISE EXCEPTION 'NOT_AUTHORIZED_TO_VIEW_COST'; END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);

  RETURN QUERY
  SELECT
    m.id, m.movement_no, m.movement_type, m.module,
    m.item_id, ii.name, ii.unit,
    m.warehouse_id, w.name,
    m.source_warehouse_id, m.destination_warehouse_id,
    m.quantity,
    COALESCE(m.unit_cost,0),
    COALESCE(m.total_cost, COALESCE(m.unit_cost,0) * COALESCE(m.quantity,0)),
    m.reference, m.reason, m.approval_status, m.performed_by, m.performed_at
  FROM public.inventory_movements m
  LEFT JOIN public.inventory_items ii ON ii.id = m.item_id
  LEFT JOIN public.warehouses w ON w.id = m.warehouse_id
  WHERE (p_warehouse_ids IS NULL OR m.warehouse_id = ANY(p_warehouse_ids))
    AND (p_modules IS NULL OR m.module = ANY(p_modules))
    AND (p_movement_types IS NULL OR m.movement_type = ANY(p_movement_types))
    AND (p_item_id IS NULL OR m.item_id = p_item_id)
    AND (p_date_from IS NULL OR m.performed_at >= p_date_from)
    AND (p_date_to IS NULL OR m.performed_at < p_date_to)
  ORDER BY m.performed_at DESC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.inv_get_financial_movements(uuid[],text[],text[],uuid,timestamptz,timestamptz,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_get_financial_movements(uuid[],text[],text[],uuid,timestamptz,timestamptz,integer,integer) TO authenticated;