-- ============================================================
-- Fix Lovable / Supabase lint 0010_security_definer_view on
-- public.product_cost_prices without re-exposing products.cost_price.
--
-- Root cause (PR #9):
--   product_cost_prices was created with security_invoker = false so the
--   view owner could read products.cost_price after authenticated lost
--   column SELECT. Lint 0010 flags that as a Security Definer View.
--
-- Why we cannot only flip security_invoker=on:
--   The querying role (authenticated) still has no SELECT on
--   products.cost_price. An invoker view that selects p.cost_price
--   would 42501 for everyone, including GM/finance.
--
-- Fix:
--   1. Store cost in public.product_cost_data (own RLS).
--   2. Recreate product_cost_prices WITH (security_invoker = on).
--   3. LEFT JOIN so marketers still get catalog rows with cost_price NULL
--      (RLS hides cost rows; invoker privileges apply — clears 0010).
--   4. Do NOT GRANT SELECT (cost_price) on public.products.
--
-- Who sees cost:
--   GM / executive / accountant / financial_manager / cost_accountant
--   via public.inv_can_view_cost() on product_cost_data.
--   Other authenticated roles: product rows, cost_price = NULL.
--
-- Parent / Lovable: apply this migration as-is. Do not run from the
-- agent against production.
-- ============================================================

-- Keep the PR #9 column lock: authenticated must not SELECT products.cost_price.
REVOKE SELECT (cost_price) ON public.products FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.product_cost_data (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  cost_price numeric NULL
);

COMMENT ON TABLE public.product_cost_data IS
  'Sensitive product unit cost. RLS: SELECT/write only when inv_can_view_cost(). '
  'Split from products so product_cost_prices can use security_invoker=on (lint 0010) '
  'without granting authenticated SELECT on products.cost_price.';

COMMENT ON COLUMN public.product_cost_data.cost_price IS
  'Unit cost. Visible to financial roles only; marketers querying the '
  'product_cost_prices view receive NULL via LEFT JOIN + RLS.';

INSERT INTO public.product_cost_data (product_id, cost_price)
SELECT p.id, p.cost_price
FROM public.products p
ON CONFLICT (product_id) DO UPDATE
  SET cost_price = EXCLUDED.cost_price;

ALTER TABLE public.product_cost_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_cost_data_select ON public.product_cost_data;
CREATE POLICY product_cost_data_select
  ON public.product_cost_data
  FOR SELECT
  TO authenticated
  USING (public.inv_can_view_cost());

-- Writes stay financial-only (or service_role, which bypasses RLS).
DROP POLICY IF EXISTS product_cost_data_insert ON public.product_cost_data;
CREATE POLICY product_cost_data_insert
  ON public.product_cost_data
  FOR INSERT
  TO authenticated
  WITH CHECK (public.inv_can_view_cost());

DROP POLICY IF EXISTS product_cost_data_update ON public.product_cost_data;
CREATE POLICY product_cost_data_update
  ON public.product_cost_data
  FOR UPDATE
  TO authenticated
  USING (public.inv_can_view_cost())
  WITH CHECK (public.inv_can_view_cost());

DROP POLICY IF EXISTS product_cost_data_delete ON public.product_cost_data;
CREATE POLICY product_cost_data_delete
  ON public.product_cost_data
  FOR DELETE
  TO authenticated
  USING (public.inv_can_view_cost());

REVOKE ALL ON TABLE public.product_cost_data FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.product_cost_data TO authenticated;
GRANT ALL ON TABLE public.product_cost_data TO service_role;

-- App + manufacturing still write products.cost_price (ProductCosts,
-- mf_recalc_finished_cost). Keep the split table in sync.
CREATE OR REPLACE FUNCTION public.sync_product_cost_data()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.product_cost_data (product_id, cost_price)
  VALUES (NEW.id, NEW.cost_price)
  ON CONFLICT (product_id) DO UPDATE
    SET cost_price = EXCLUDED.cost_price
    WHERE public.product_cost_data.cost_price IS DISTINCT FROM EXCLUDED.cost_price;
  RETURN NEW;
END;
$$;

-- Trigger-only: clients must not call this SECURITY DEFINER function.
REVOKE ALL ON FUNCTION public.sync_product_cost_data() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_product_cost_data ON public.products;
CREATE TRIGGER trg_sync_product_cost_data
AFTER INSERT OR UPDATE OF cost_price ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.sync_product_cost_data();

-- Recreate as an invoker view: caller RLS/privileges apply (lint 0010).
-- Catalog columns come from products (no cost_price). Cost comes from
-- product_cost_data so a LEFT JOIN yields NULL when RLS hides the cost row.
DROP VIEW IF EXISTS public.product_cost_prices;

CREATE VIEW public.product_cost_prices
WITH (security_invoker = on) AS
SELECT
  p.id,
  p.name,
  p.category,
  p.unit,
  p.price,
  p.stock,
  p.low_stock_threshold,
  p.is_active,
  cd.cost_price
FROM public.products p
LEFT JOIN public.product_cost_data cd ON cd.product_id = p.id;

COMMENT ON VIEW public.product_cost_prices IS
  'Lint 0010: security_invoker=on so the querying user''s RLS applies. '
  'Cost is NOT read from products.cost_price (still revoked for authenticated). '
  'GM/finance (inv_can_view_cost) see product_cost_data.cost_price; '
  'marketers still get product rows with cost_price NULL via LEFT JOIN.';

REVOKE ALL ON public.product_cost_prices FROM PUBLIC, anon;
GRANT SELECT ON public.product_cost_prices TO authenticated, service_role;
