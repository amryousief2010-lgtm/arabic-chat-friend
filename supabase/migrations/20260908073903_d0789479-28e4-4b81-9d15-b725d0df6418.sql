-- 1) Actual cost per finished product from approved manufacturing invoices
CREATE OR REPLACE VIEW public.v_meat_finished_actual_cost
WITH (security_invoker = true) AS
SELECT
  public.canonical_wh_item_name(i.product_name)                              AS canon_name,
  min(i.product_name)                                                        AS product_name,
  count(*)::int                                                              AS invoices_count,
  sum(COALESCE(i.finished_qty,0))                                            AS total_qty,
  sum(COALESCE(i.raw_cost,0))                                                AS raw_cost,
  sum(COALESCE(i.spice_cost,0))                                              AS spice_cost,
  sum(COALESCE(i.packaging_cost,0))                                          AS packaging_cost,
  sum(COALESCE(i.extra_cost,0))                                              AS extra_cost,
  sum(COALESCE(i.total_manufacturing_cost, i.materials_total_cost, 0))       AS total_cost,
  round(sum(COALESCE(i.total_manufacturing_cost, i.materials_total_cost, 0))
        / NULLIF(sum(COALESCE(i.finished_qty,0)),0), 3)                      AS actual_unit_cost,
  max(COALESCE(i.approved_at, i.updated_at, i.created_at))                   AS last_approved_at
FROM public.meat_manufacturing_invoices i
WHERE lower(COALESCE(i.status,'')) IN ('approved','transferred')
  AND COALESCE(i.finished_qty,0) > 0
GROUP BY 1;

GRANT SELECT ON public.v_meat_finished_actual_cost TO authenticated;
GRANT SELECT ON public.v_meat_finished_actual_cost TO service_role;

-- 2) Recalculate + propagate the weighted average cost
CREATE OR REPLACE FUNCTION public.mf_recalc_finished_cost(p_product_name text)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canon text;
  v_cost  numeric;
BEGIN
  IF p_product_name IS NULL OR btrim(p_product_name) = '' THEN RETURN NULL; END IF;
  v_canon := public.canonical_wh_item_name(p_product_name);

  SELECT round(sum(COALESCE(i.total_manufacturing_cost, i.materials_total_cost, 0))
               / NULLIF(sum(COALESCE(i.finished_qty,0)),0), 3)
    INTO v_cost
    FROM public.meat_manufacturing_invoices i
   WHERE lower(COALESCE(i.status,'')) IN ('approved','transferred')
     AND COALESCE(i.finished_qty,0) > 0
     AND public.canonical_wh_item_name(i.product_name) = v_canon;

  IF v_cost IS NULL OR v_cost <= 0 THEN RETURN NULL; END IF;

  UPDATE public.meat_finished_inventory f
     SET avg_prod_cost = v_cost, updated_at = now()
   WHERE public.canonical_wh_item_name(f.name_ar) = v_canon
     AND COALESCE(f.avg_prod_cost,0) IS DISTINCT FROM v_cost;

  UPDATE public.products p
     SET cost_price = v_cost, updated_at = now()
   WHERE public.canonical_wh_item_name(p.name) = v_canon
     AND COALESCE(p.cost_price,0) IS DISTINCT FROM v_cost;

  RETURN v_cost;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mf_recalc_finished_cost(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mf_recalc_finished_cost(text) TO service_role;

-- 3) Auto-sync on approve / cancel / cost change
CREATE OR REPLACE FUNCTION public.trg_mf_sync_finished_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.mf_recalc_finished_cost(NEW.product_name);
  IF TG_OP = 'UPDATE'
     AND OLD.product_name IS DISTINCT FROM NEW.product_name THEN
    PERFORM public.mf_recalc_finished_cost(OLD.product_name);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS mf_sync_finished_cost ON public.meat_manufacturing_invoices;
CREATE TRIGGER mf_sync_finished_cost
AFTER INSERT OR UPDATE OF status, finished_qty, raw_cost, spice_cost, packaging_cost, extra_cost, total_manufacturing_cost, materials_total_cost, product_name
ON public.meat_manufacturing_invoices
FOR EACH ROW EXECUTE FUNCTION public.trg_mf_sync_finished_cost();

-- 4) Variance view: recorded average vs actual invoice cost
CREATE OR REPLACE VIEW public.v_meat_cost_variance
WITH (security_invoker = true) AS
SELECT
  a.canon_name,
  a.product_name,
  a.invoices_count,
  a.total_qty,
  a.raw_cost,
  a.spice_cost,
  a.packaging_cost,
  a.extra_cost,
  a.total_cost,
  a.actual_unit_cost,
  a.last_approved_at,
  round(a.raw_cost       / NULLIF(a.total_qty,0), 3) AS raw_per_unit,
  round(a.spice_cost     / NULLIF(a.total_qty,0), 3) AS spice_per_unit,
  round(a.packaging_cost / NULLIF(a.total_qty,0), 3) AS packaging_per_unit,
  round(a.extra_cost     / NULLIF(a.total_qty,0), 3) AS extra_per_unit,
  f.avg_prod_cost                                    AS finished_avg_cost,
  p.cost_price                                       AS product_cost_price,
  p.price                                            AS product_sale_price,
  round(COALESCE(f.avg_prod_cost, p.cost_price, 0) - a.actual_unit_cost, 3) AS variance,
  round(((COALESCE(f.avg_prod_cost, p.cost_price, 0) - a.actual_unit_cost)
         / NULLIF(a.actual_unit_cost,0)) * 100, 2)   AS variance_pct
FROM public.v_meat_finished_actual_cost a
LEFT JOIN LATERAL (
  SELECT fi.avg_prod_cost FROM public.meat_finished_inventory fi
   WHERE public.canonical_wh_item_name(fi.name_ar) = a.canon_name LIMIT 1
) f ON true
LEFT JOIN LATERAL (
  SELECT pr.cost_price, pr.price FROM public.products pr
   WHERE public.canonical_wh_item_name(pr.name) = a.canon_name
   ORDER BY pr.is_active DESC LIMIT 1
) p ON true;

GRANT SELECT ON public.v_meat_cost_variance TO authenticated;
GRANT SELECT ON public.v_meat_cost_variance TO service_role;

-- 5) Offer box cost & profit
CREATE OR REPLACE VIEW public.v_offer_box_costs
WITH (security_invoker = true) AS
WITH lines AS (
  SELECT
    b.id                                     AS box_id,
    b.name                                   AS box_name,
    b.is_active,
    b.starts_at,
    b.expires_at,
    COALESCE(b.offer_price,0)                AS offer_price,
    COALESCE(b.shipping_cost,0)              AS shipping_cost,
    oi.product_id,
    p.name                                   AS product_name,
    COALESCE(oi.quantity,1)                  AS quantity,
    COALESCE(oi.custom_price, p.price, 0)    AS line_price,
    COALESCE(p.cost_price,0)                 AS unit_cost,
    ac.actual_unit_cost,
    COALESCE(ac.raw_cost       / NULLIF(ac.total_qty,0), 0) AS raw_pu,
    COALESCE(ac.spice_cost     / NULLIF(ac.total_qty,0), 0) AS spice_pu,
    COALESCE(ac.packaging_cost / NULLIF(ac.total_qty,0), 0) AS pack_pu,
    COALESCE(ac.extra_cost     / NULLIF(ac.total_qty,0), 0) AS extra_pu
  FROM public.offer_boxes b
  JOIN public.offer_box_items oi ON oi.offer_box_id = b.id
  LEFT JOIN public.products p ON p.id = oi.product_id
  LEFT JOIN public.v_meat_finished_actual_cost ac
         ON ac.canon_name = public.canonical_wh_item_name(p.name)
)
SELECT
  box_id,
  box_name,
  is_active,
  starts_at,
  expires_at,
  min(offer_price)                                           AS offer_price,
  min(shipping_cost)                                         AS shipping_cost,
  count(*)::int                                              AS items_count,
  sum(quantity)                                              AS total_qty,
  round(sum(quantity * COALESCE(actual_unit_cost, unit_cost)), 2) AS total_cost,
  round(sum(quantity * raw_pu), 2)                           AS raw_cost,
  round(sum(quantity * spice_pu), 2)                         AS spice_cost,
  round(sum(quantity * pack_pu), 2)                          AS packaging_cost,
  round(sum(quantity * extra_pu), 2)                         AS extra_cost,
  round(sum(quantity * COALESCE(unit_cost,0)), 2)            AS legacy_cost,
  round(sum(quantity * line_price), 2)                       AS items_value,
  round(min(offer_price) - sum(quantity * COALESCE(actual_unit_cost, unit_cost)), 2) AS profit,
  round(((min(offer_price) - sum(quantity * COALESCE(actual_unit_cost, unit_cost)))
        / NULLIF(min(offer_price),0)) * 100, 2)              AS profit_pct,
  (min(offer_price) - sum(quantity * COALESCE(actual_unit_cost, unit_cost))) < 100 AS below_min_profit,
  count(*) FILTER (WHERE COALESCE(actual_unit_cost, unit_cost, 0) = 0)::int AS items_without_cost
FROM lines
GROUP BY box_id, box_name, is_active, starts_at, expires_at;

GRANT SELECT ON public.v_offer_box_costs TO authenticated;
GRANT SELECT ON public.v_offer_box_costs TO service_role;

-- 6) Offer box lines detail
CREATE OR REPLACE VIEW public.v_offer_box_cost_lines
WITH (security_invoker = true) AS
SELECT
  b.id                                   AS box_id,
  b.name                                 AS box_name,
  oi.product_id,
  p.name                                 AS product_name,
  COALESCE(oi.quantity,1)                AS quantity,
  oi.is_gift,
  COALESCE(oi.custom_price, p.price, 0)  AS line_price,
  COALESCE(p.cost_price,0)               AS product_cost_price,
  ac.actual_unit_cost,
  round(COALESCE(ac.raw_cost       / NULLIF(ac.total_qty,0), 0), 3) AS raw_per_unit,
  round(COALESCE(ac.spice_cost     / NULLIF(ac.total_qty,0), 0), 3) AS spice_per_unit,
  round(COALESCE(ac.packaging_cost / NULLIF(ac.total_qty,0), 0), 3) AS packaging_per_unit,
  round(COALESCE(ac.extra_cost     / NULLIF(ac.total_qty,0), 0), 3) AS extra_per_unit,
  round(COALESCE(oi.quantity,1) * COALESCE(ac.actual_unit_cost, p.cost_price, 0), 2) AS line_cost
FROM public.offer_boxes b
JOIN public.offer_box_items oi ON oi.offer_box_id = b.id
LEFT JOIN public.products p ON p.id = oi.product_id
LEFT JOIN public.v_meat_finished_actual_cost ac
       ON ac.canon_name = public.canonical_wh_item_name(p.name);

GRANT SELECT ON public.v_offer_box_cost_lines TO authenticated;
GRANT SELECT ON public.v_offer_box_cost_lines TO service_role;

-- 7) Backfill existing finished products from approved invoices
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT product_name FROM public.v_meat_finished_actual_cost LOOP
    PERFORM public.mf_recalc_finished_cost(r.product_name);
  END LOOP;
END $$;