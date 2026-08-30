DROP FUNCTION IF EXISTS public.inv_get_sales_availability(uuid[], uuid[], boolean, integer, integer);

CREATE FUNCTION public.inv_get_sales_availability(
  p_product_ids uuid[] DEFAULT NULL::uuid[],
  p_warehouse_ids uuid[] DEFAULT NULL::uuid[],
  p_inventory_item_ids uuid[] DEFAULT NULL::uuid[],
  p_active_only boolean DEFAULT true,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
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
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    AND (p_inventory_item_ids IS NULL OR ii.id = ANY(p_inventory_item_ids))
    AND (NOT COALESCE(p_active_only, true) OR ii.is_active = true)
    AND ii.product_id IS NOT NULL
  ORDER BY ii.name
  LIMIT v_limit OFFSET v_offset;
END;
$function$;

REVOKE ALL ON FUNCTION public.inv_get_sales_availability(uuid[], uuid[], uuid[], boolean, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inv_get_sales_availability(uuid[], uuid[], uuid[], boolean, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.inv_get_sales_availability(uuid[], uuid[], uuid[], boolean, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_get_sales_availability(uuid[], uuid[], uuid[], boolean, integer, integer) TO service_role;