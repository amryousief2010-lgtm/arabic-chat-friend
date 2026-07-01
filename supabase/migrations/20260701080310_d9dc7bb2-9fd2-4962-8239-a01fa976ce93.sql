
-- 1) Add per-receipt manual availability adjustment (mirror of global stock adjustments)
ALTER TABLE public.slaughter_live_receipts
  ADD COLUMN IF NOT EXISTS manual_available_adjustment integer NOT NULL DEFAULT 0;

-- 2) Update recalc function to include the adjustment
CREATE OR REPLACE FUNCTION public.recalc_live_batch_cost(p_live_batch_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_original_cost numeric := 0;
  v_opening_cost numeric := 0;
  v_bird_count integer := 0;
  v_doa integer := 0;
  v_feed_cost numeric := 0;
  v_mortality_count integer := 0;
  v_mortality_cost numeric := 0;
  v_other_cost numeric := 0;
  v_slaughtered integer := 0;
  v_alive integer := 0;
  v_total numeric := 0;
  v_cpb numeric := 0;
  v_manual_adj integer := 0;
BEGIN
  SELECT total_cost, COALESCE(opening_cost_total,0), bird_count,
         COALESCE(dead_on_arrival,0), COALESCE(other_costs_loaded,0),
         COALESCE(manual_available_adjustment,0)
    INTO v_original_cost, v_opening_cost, v_bird_count, v_doa, v_other_cost, v_manual_adj
  FROM public.slaughter_live_receipts WHERE id = p_live_batch_id;

  SELECT COALESCE(SUM(l.allocated_cost),0) INTO v_feed_cost
  FROM public.slaughter_cost_allocation_lines l
  JOIN public.slaughter_cost_allocations a ON a.id = l.allocation_id
  WHERE l.receipt_id = p_live_batch_id
    AND a.event_type = 'feed' AND a.status = 'allocated';

  SELECT COALESCE(SUM(dead_count),0) INTO v_mortality_count
    FROM public.slaughter_live_mortality
   WHERE live_batch_id = p_live_batch_id AND reversed_at IS NULL;

  SELECT COALESCE(SUM(l.allocated_cost),0) INTO v_mortality_cost
  FROM public.slaughter_cost_allocation_lines l
  JOIN public.slaughter_cost_allocations a ON a.id = l.allocation_id
  WHERE l.receipt_id = p_live_batch_id
    AND a.event_type = 'mortality' AND a.status = 'allocated';

  SELECT COALESCE(SUM(birds_count),0) INTO v_slaughtered
    FROM public.slaughter_batch_live_sources
   WHERE live_receipt_id = p_live_batch_id;

  v_alive := GREATEST(v_bird_count - v_doa - v_mortality_count - v_slaughtered + v_manual_adj, 0);
  v_total := v_original_cost + v_opening_cost + v_feed_cost + v_mortality_cost + v_other_cost;
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

-- 3) Backfill known adjustments so dropdown sum matches dashboard liveBalance (=15)
-- OPENING-LIVE-OSTRICH-21: reconciliation reduced 21→13 alive (-8), currently shows 11 alive; needs -7 to land on 4
UPDATE public.slaughter_live_receipts SET manual_available_adjustment = -7
 WHERE receipt_number = 'OPENING-LIVE-OSTRICH-21';

-- LR-20260602-7312: fully excluded from slaughter availability (-17)
UPDATE public.slaughter_live_receipts SET manual_available_adjustment = -17
 WHERE receipt_number = 'LR-20260602-7312';

-- 4) Re-run recalc for the two touched receipts
SELECT public.recalc_live_batch_cost(id) FROM public.slaughter_live_receipts
 WHERE receipt_number IN ('OPENING-LIVE-OSTRICH-21','LR-20260602-7312');
