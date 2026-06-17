
-- Ensure live receipts have total_batch_cost/cost_per_bird_current populated immediately
-- (covers purchases without any feed/mortality yet, and re-computes after opening_cost or DOA changes).
CREATE OR REPLACE FUNCTION public.slaughter_live_receipt_after_recalc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recalc_live_batch_cost(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_slr_after_recalc ON public.slaughter_live_receipts;
CREATE TRIGGER trg_slr_after_recalc
AFTER INSERT OR UPDATE OF total_weight_kg, price_per_kg, opening_cost_total, dead_on_arrival, bird_count, other_costs_loaded
ON public.slaughter_live_receipts
FOR EACH ROW
EXECUTE FUNCTION public.slaughter_live_receipt_after_recalc();

-- Backfill: recompute every existing receipt so dashboards show correct totals immediately.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.slaughter_live_receipts LOOP
    PERFORM public.recalc_live_batch_cost(r.id);
  END LOOP;
END $$;
