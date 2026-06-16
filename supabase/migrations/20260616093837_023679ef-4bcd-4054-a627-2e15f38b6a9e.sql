CREATE OR REPLACE FUNCTION public.recalc_live_batch_cost(p_live_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_original_cost numeric := 0;
  v_bird_count integer := 0;
  v_doa integer := 0;
  v_feed_cost numeric := 0;
  v_mortality_count integer := 0;
  v_mortality_cost numeric := 0;
  v_other_cost numeric := 0;
  v_alive integer := 0;
  v_total numeric := 0;
  v_cpb numeric := 0;
BEGIN
  SELECT total_cost, bird_count, COALESCE(dead_on_arrival,0), COALESCE(other_costs_loaded,0)
    INTO v_original_cost, v_bird_count, v_doa, v_other_cost
  FROM public.slaughter_live_receipts WHERE id = p_live_batch_id;

  SELECT COALESCE(SUM(total_cost),0) INTO v_feed_cost
    FROM public.slaughter_ostrich_feed_consumption
   WHERE live_batch_id = p_live_batch_id AND reversed_at IS NULL;

  SELECT COALESCE(SUM(dead_count),0), COALESCE(SUM(total_loss_cost) FILTER (WHERE load_on_remaining),0)
    INTO v_mortality_count, v_mortality_cost
    FROM public.slaughter_live_mortality
   WHERE live_batch_id = p_live_batch_id AND reversed_at IS NULL;

  v_alive := GREATEST(v_bird_count - v_doa - v_mortality_count, 0);
  -- FIX: mortality cost is already inside (original + feed). Do NOT add it again.
  -- Mortality redistribution happens naturally because divisor = alive only.
  v_total := v_original_cost + v_feed_cost + v_other_cost;
  v_cpb := CASE WHEN v_alive > 0 THEN v_total / v_alive ELSE 0 END;

  UPDATE public.slaughter_live_receipts
     SET mortality_count = v_mortality_count,
         feed_cost_loaded = v_feed_cost,
         mortality_cost_loaded = v_mortality_cost,
         current_alive_count = v_alive,
         total_batch_cost = v_total,
         cost_per_bird_current = v_cpb,
         updated_at = now()
   WHERE id = p_live_batch_id;
END;
$function$;