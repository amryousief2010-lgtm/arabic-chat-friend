-- ============================================================
-- Restrict products.cost_price to financial roles (inv_can_view_cost).
-- Column-level privileges: authenticated may SELECT every products
-- column except cost_price. GM/finance read cost via product_cost_prices.
--
-- Parent / Lovable: apply this migration as-is. Do not run from the agent
-- against production.
-- ============================================================

-- 1) Table-level SELECT includes every column, so column REVOKE is a no-op
--    until table SELECT is revoked and non-sensitive columns are re-granted.
REVOKE SELECT ON TABLE public.products FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  cols text;
BEGIN
  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
    INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'products'
    AND column_name <> 'cost_price';

  IF cols IS NULL OR cols = '' THEN
    RAISE EXCEPTION 'products has no grantable columns besides cost_price';
  END IF;

  EXECUTE format('GRANT SELECT (%s) ON public.products TO authenticated', cols);
END $$;

-- service_role (edge functions / admin) still needs full table SELECT
GRANT SELECT ON TABLE public.products TO service_role;

-- 2) Financial-role-gated view. Owner-run so it can read cost_price after
--    the authenticated column revoke; inv_can_view_cost() masks the value
--    for everyone else (returns NULL, not an error — catalog UIs keep working).
CREATE OR REPLACE VIEW public.product_cost_prices AS
SELECT
  p.id,
  p.name,
  p.category,
  p.unit,
  p.price,
  p.stock,
  p.low_stock_threshold,
  p.is_active,
  CASE
    WHEN public.inv_can_view_cost() THEN p.cost_price
    ELSE NULL
  END AS cost_price
FROM public.products p;

ALTER VIEW public.product_cost_prices SET (security_invoker = false, security_barrier = true);

COMMENT ON VIEW public.product_cost_prices IS
  'products catalog with cost_price visible only when inv_can_view_cost() is true (GM/executive/accountant/financial_manager/cost_accountant).';

REVOKE ALL ON public.product_cost_prices FROM PUBLIC, anon;
GRANT SELECT ON public.product_cost_prices TO authenticated, service_role;
