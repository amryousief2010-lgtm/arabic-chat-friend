-- P0 / 2 — Standard pack weight (kg) and a read-only merge-candidates query.
-- Weights: 6 kg for دبوس بالعظم, 1 kg for دهن, 0.5 kg for everything else.
-- Existing non-null weights are left untouched so the migration can be re-run.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS pack_weight_kg numeric;

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS pack_weight_kg numeric;

CREATE OR REPLACE FUNCTION public.default_pack_weight_kg(p_name text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN COALESCE(p_name, '') ILIKE '%دبوس%' AND COALESCE(p_name, '') ILIKE '%عظم%' THEN 6
    WHEN COALESCE(p_name, '') ILIKE '%دهن%' THEN 1
    ELSE 0.5
  END;
$$;

REVOKE ALL ON FUNCTION public.default_pack_weight_kg(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.default_pack_weight_kg(text) TO authenticated, service_role;

UPDATE public.products
   SET pack_weight_kg = public.default_pack_weight_kg(name)
 WHERE pack_weight_kg IS NULL;

UPDATE public.inventory_items i
   SET pack_weight_kg = COALESCE(
         (SELECT p.pack_weight_kg FROM public.products p WHERE p.id = i.product_id),
         public.default_pack_weight_kg(i.name)
       )
 WHERE i.pack_weight_kg IS NULL;

-- Read-only report. No rows are merged.
CREATE OR REPLACE FUNCTION public.list_inventory_merge_candidates()
RETURNS TABLE (
  warehouse_id uuid,
  warehouse_name text,
  match_key text,
  reason text,
  item_id uuid,
  item_name text,
  product_id uuid,
  stock numeric,
  pack_weight_kg numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (
    public.has_role(auth.uid(), 'general_manager'::app_role)
    OR public.has_role(auth.uid(), 'executive_manager'::app_role)
    OR public.has_role(auth.uid(), 'warehouse_supervisor'::app_role)
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT i.id, i.warehouse_id, w.name AS warehouse_name, i.name, i.product_id, i.stock, i.pack_weight_kg,
           lower(regexp_replace(btrim(i.name), '\s+', ' ', 'g')) AS norm
      FROM public.inventory_items i
      JOIN public.warehouses w ON w.id = i.warehouse_id
     WHERE COALESCE(i.is_active, true)
  )
  SELECT b.warehouse_id, b.warehouse_name, b.norm,
         'نفس الاسم داخل المخزن'::text,
         b.id, b.name, b.product_id, b.stock, b.pack_weight_kg
    FROM base b
   WHERE EXISTS (
     SELECT 1 FROM base o
      WHERE o.warehouse_id = b.warehouse_id AND o.norm = b.norm AND o.id <> b.id
   )
  UNION ALL
  SELECT b.warehouse_id, b.warehouse_name, b.product_id::text,
         'أكثر من بطاقة لنفس المنتج'::text,
         b.id, b.name, b.product_id, b.stock, b.pack_weight_kg
    FROM base b
   WHERE b.product_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM base o
        WHERE o.warehouse_id = b.warehouse_id AND o.product_id = b.product_id AND o.id <> b.id
     );
END;
$$;

REVOKE ALL ON FUNCTION public.list_inventory_merge_candidates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_inventory_merge_candidates() TO authenticated, service_role;
