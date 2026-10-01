-- Target kg prices: proper effective_from rows + manager-only history + Oct 2026 processed 120.
-- Scope: sales target page only. Sep 2026 stays processed 140. Meat 390 / bone 350 unchanged.

-- 0) Backup live versions + singleton
CREATE TABLE IF NOT EXISTS public._migration_backup_sales_kg_price_versions_20261001 AS
SELECT * FROM public.sales_kg_price_versions;

CREATE TABLE IF NOT EXISTS public._migration_backup_sales_kg_price_settings_20261001 AS
SELECT * FROM public.sales_kg_price_settings;

-- 1) Audit columns on versions
ALTER TABLE public.sales_kg_price_versions
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS effective_to date;

COMMENT ON COLUMN public.sales_kg_price_versions.effective_to IS
  'Optional exclusive end; when null, version applies until the next effective_from.';

-- 2) Ensure Sep 2026 processed stays 140 (do not overwrite if already correct)
INSERT INTO public.sales_kg_price_versions (
  effective_from, meat_price, bone_meat_price, processed_price
) VALUES ('2026-09-01', 390, 350, 140)
ON CONFLICT (effective_from) DO UPDATE SET
  meat_price = 390,
  bone_meat_price = 350,
  processed_price = 140,
  updated_at = now();

-- 3) Seed Oct 2026+ processed 120 (new row; does not touch Sep)
INSERT INTO public.sales_kg_price_versions (
  effective_from, meat_price, bone_meat_price, processed_price
) VALUES ('2026-10-01', 390, 350, 120)
ON CONFLICT (effective_from) DO UPDATE SET
  meat_price = 390,
  bone_meat_price = 350,
  processed_price = 120,
  updated_at = now();

-- Maintain optional effective_to chain for clarity
UPDATE public.sales_kg_price_versions SET effective_to = '2026-09-01'
WHERE effective_from = '2020-01-01';
UPDATE public.sales_kg_price_versions SET effective_to = '2026-10-01'
WHERE effective_from = '2026-09-01';
UPDATE public.sales_kg_price_versions SET effective_to = NULL
WHERE effective_from = '2026-10-01';

-- Sync singleton to latest (Oct) policy for any legacy readers
UPDATE public.sales_kg_price_settings
SET
  meat_price = 390,
  bone_meat_price = 350,
  processed_price = 120,
  updated_at = now()
WHERE singleton IS TRUE;

ALTER TABLE public.sales_kg_price_settings
  ALTER COLUMN processed_price SET DEFAULT 120;

-- 4) Month resolve RPC: SECURITY DEFINER so moderators get month prices without table SELECT
CREATE OR REPLACE FUNCTION public.get_sales_kg_prices_for_month(p_year integer, p_month integer)
RETURNS TABLE (
  meat_price numeric,
  bone_meat_price numeric,
  processed_price numeric,
  effective_from date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.meat_price, v.bone_meat_price, v.processed_price, v.effective_from
  FROM public.sales_kg_price_versions v
  WHERE v.effective_from <= make_date(p_year, p_month, 1)
  ORDER BY v.effective_from DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_sales_kg_prices_for_month(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_sales_kg_prices_for_month(integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_sales_kg_prices_for_month(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_kg_prices_for_month(integer, integer) TO service_role;

-- 5) Helper: is price manager (existing roles only)
CREATE OR REPLACE FUNCTION public.is_sales_kg_price_manager(p_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    public.has_role(p_uid, 'general_manager')
    OR public.has_role(p_uid, 'executive_manager')
    OR public.has_role(p_uid, 'sales_manager')
    OR public.has_role(p_uid, 'marketing_sales_manager'),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_sales_kg_price_manager(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_sales_kg_price_manager(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_sales_kg_price_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_sales_kg_price_manager(uuid) TO service_role;

-- 6) Upsert a new effective version for one price kind (or all three when kind = 'all')
CREATE OR REPLACE FUNCTION public.upsert_sales_kg_price_version(
  p_effective_from date,
  p_price_kind text,
  p_new_price numeric,
  p_replace_same_date boolean DEFAULT false
)
RETURNS public.sales_kg_price_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_prev public.sales_kg_price_versions%ROWTYPE;
  v_row public.sales_kg_price_versions%ROWTYPE;
  v_meat numeric;
  v_bone numeric;
  v_proc numeric;
  v_exists boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.is_sales_kg_price_manager(v_uid) THEN
    RAISE EXCEPTION 'not authorized to manage target kg prices';
  END IF;
  IF p_effective_from IS NULL THEN
    RAISE EXCEPTION 'effective_from is required';
  END IF;
  IF p_new_price IS NULL OR p_new_price < 0 THEN
    RAISE EXCEPTION 'price must be >= 0';
  END IF;
  IF p_price_kind NOT IN ('processed', 'meat', 'bone_meat') THEN
    RAISE EXCEPTION 'invalid price kind';
  END IF;

  SELECT * INTO v_prev
  FROM public.sales_kg_price_versions
  WHERE effective_from <= p_effective_from
  ORDER BY effective_from DESC
  LIMIT 1;

  IF NOT FOUND THEN
    v_meat := 390; v_bone := 350; v_proc := 140;
  ELSE
    v_meat := v_prev.meat_price;
    v_bone := v_prev.bone_meat_price;
    v_proc := v_prev.processed_price;
  END IF;

  IF p_price_kind = 'processed' THEN v_proc := p_new_price;
  ELSIF p_price_kind = 'meat' THEN v_meat := p_new_price;
  ELSE v_bone := p_new_price;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.sales_kg_price_versions WHERE effective_from = p_effective_from
  ) INTO v_exists;

  IF v_exists AND NOT p_replace_same_date THEN
    RAISE EXCEPTION 'version already exists for % — set replace_same_date to overwrite', p_effective_from;
  END IF;

  INSERT INTO public.sales_kg_price_versions AS t (
    effective_from, meat_price, bone_meat_price, processed_price, created_by, updated_by
  ) VALUES (
    p_effective_from, v_meat, v_bone, v_proc, v_uid, v_uid
  )
  ON CONFLICT (effective_from) DO UPDATE SET
    meat_price = EXCLUDED.meat_price,
    bone_meat_price = EXCLUDED.bone_meat_price,
    processed_price = EXCLUDED.processed_price,
    updated_by = v_uid,
    updated_at = now()
  RETURNING * INTO v_row;

  -- Recompute effective_to for neighbouring rows
  UPDATE public.sales_kg_price_versions v
  SET effective_to = n.next_from
  FROM (
    SELECT effective_from,
           lead(effective_from) OVER (ORDER BY effective_from) AS next_from
    FROM public.sales_kg_price_versions
  ) n
  WHERE v.effective_from = n.effective_from
    AND v.effective_to IS DISTINCT FROM n.next_from;

  -- Sync singleton to latest version
  WITH latest AS (
    SELECT meat_price, bone_meat_price, processed_price
    FROM public.sales_kg_price_versions
    ORDER BY effective_from DESC
    LIMIT 1
  )
  UPDATE public.sales_kg_price_settings s
  SET
    meat_price = latest.meat_price,
    bone_meat_price = latest.bone_meat_price,
    processed_price = latest.processed_price,
    updated_by = v_uid,
    updated_at = now()
  FROM latest
  WHERE s.singleton IS TRUE;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_sales_kg_price_version(date, text, numeric, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_sales_kg_price_version(date, text, numeric, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_sales_kg_price_version(date, text, numeric, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_sales_kg_price_version(date, text, numeric, boolean) TO service_role;

-- 7) Tighten RLS: history only for managers; moderators use RPC for month prices
DROP POLICY IF EXISTS "Authenticated can view kg price versions" ON public.sales_kg_price_versions;
DROP POLICY IF EXISTS "Managers can view kg price versions" ON public.sales_kg_price_versions;
CREATE POLICY "Managers can view kg price versions"
ON public.sales_kg_price_versions FOR SELECT TO authenticated
USING (public.is_sales_kg_price_manager(auth.uid()));

DROP POLICY IF EXISTS "Authenticated can view kg prices" ON public.sales_kg_price_settings;
DROP POLICY IF EXISTS "Managers can view kg price settings" ON public.sales_kg_price_settings;
CREATE POLICY "Managers can view kg price settings"
ON public.sales_kg_price_settings FOR SELECT TO authenticated
USING (public.is_sales_kg_price_manager(auth.uid()));

-- Keep insert/update manager policies (recreate to use helper)
DROP POLICY IF EXISTS "Managers can insert kg price versions" ON public.sales_kg_price_versions;
CREATE POLICY "Managers can insert kg price versions"
ON public.sales_kg_price_versions FOR INSERT TO authenticated
WITH CHECK (public.is_sales_kg_price_manager(auth.uid()));

DROP POLICY IF EXISTS "Managers can update kg price versions" ON public.sales_kg_price_versions;
CREATE POLICY "Managers can update kg price versions"
ON public.sales_kg_price_versions FOR UPDATE TO authenticated
USING (public.is_sales_kg_price_manager(auth.uid()))
WITH CHECK (public.is_sales_kg_price_manager(auth.uid()));

DROP POLICY IF EXISTS "Managers can insert kg prices" ON public.sales_kg_price_settings;
CREATE POLICY "Managers can insert kg prices"
ON public.sales_kg_price_settings FOR INSERT TO authenticated
WITH CHECK (public.is_sales_kg_price_manager(auth.uid()));

DROP POLICY IF EXISTS "Managers can update kg prices" ON public.sales_kg_price_settings;
CREATE POLICY "Managers can update kg prices"
ON public.sales_kg_price_settings FOR UPDATE TO authenticated
USING (public.is_sales_kg_price_manager(auth.uid()))
WITH CHECK (public.is_sales_kg_price_manager(auth.uid()));

-- 8) Record migration
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20261001230000',
  'sales_kg_price_effective_from_panel',
  ARRAY['sales_kg_price_versions oct120 + RLS + upsert RPC']
)
ON CONFLICT (version) DO NOTHING;
