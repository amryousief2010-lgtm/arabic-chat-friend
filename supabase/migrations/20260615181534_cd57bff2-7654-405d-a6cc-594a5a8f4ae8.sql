
-- Trigger: when inserting/updating slaughter_batch_outputs, if product_id is null
-- and the matching yield standard has a product_id, copy it down.
CREATE OR REPLACE FUNCTION public.slaughter_outputs_inherit_product()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product uuid;
BEGIN
  IF NEW.product_id IS NULL THEN
    IF NEW.yield_standard_id IS NOT NULL THEN
      SELECT product_id INTO v_product
      FROM public.slaughter_yield_standards
      WHERE id = NEW.yield_standard_id;
    END IF;
    IF v_product IS NULL AND NEW.cut_name_ar IS NOT NULL THEN
      SELECT product_id INTO v_product
      FROM public.slaughter_yield_standards
      WHERE cut_name_ar = NEW.cut_name_ar
        AND product_id IS NOT NULL
      LIMIT 1;
    END IF;
    IF v_product IS NOT NULL THEN
      NEW.product_id := v_product;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_slaughter_outputs_inherit_product ON public.slaughter_batch_outputs;
CREATE TRIGGER trg_slaughter_outputs_inherit_product
BEFORE INSERT OR UPDATE OF cut_name_ar, yield_standard_id, product_id
ON public.slaughter_batch_outputs
FOR EACH ROW
EXECUTE FUNCTION public.slaughter_outputs_inherit_product();

-- Manual backfill helper: re-apply cut→product mapping to historical outputs
-- whose product_id is still NULL. Returns number of rows updated.
CREATE OR REPLACE FUNCTION public.slaughter_outputs_backfill_product_ids()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH upd AS (
    UPDATE public.slaughter_batch_outputs o
    SET product_id = ys.product_id
    FROM public.slaughter_yield_standards ys
    WHERE o.product_id IS NULL
      AND ys.product_id IS NOT NULL
      AND (
        o.yield_standard_id = ys.id
        OR (o.yield_standard_id IS NULL AND o.cut_name_ar = ys.cut_name_ar)
      )
    RETURNING o.id
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.slaughter_outputs_backfill_product_ids() TO authenticated, service_role;
