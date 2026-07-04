-- Backfill opening cost for brooding batches sourced from chick_trading_batches
-- (their opening cost was never propagated, so total_cost/cost_per_bird showed 0).
UPDATE public.brooding_batches b
SET total_cost = COALESCE(
      (ct.purchase_total + ct.transport_cost + ct.disinfection_cost + ct.other_costs)
      * (b.original_count::numeric / NULLIF(ct.original_count,0))
    , 0) + COALESCE((SELECT SUM(total_cost) FROM public.brooding_feed_issuance WHERE batch_id = b.id),0)
      + COALESCE((SELECT SUM(total_cost) FROM public.brooding_medicine_issuance WHERE batch_id = b.id),0)
      + COALESCE((SELECT SUM(total_amount) FROM public.brooding_expenses WHERE batch_id = b.id),0),
    cost_per_bird = CASE WHEN b.original_count > 0 THEN (
      (COALESCE(
        (ct.purchase_total + ct.transport_cost + ct.disinfection_cost + ct.other_costs)
        * (b.original_count::numeric / NULLIF(ct.original_count,0))
      , 0)
      + COALESCE((SELECT SUM(total_cost) FROM public.brooding_feed_issuance WHERE batch_id = b.id),0)
      + COALESCE((SELECT SUM(total_cost) FROM public.brooding_medicine_issuance WHERE batch_id = b.id),0)
      + COALESCE((SELECT SUM(total_amount) FROM public.brooding_expenses WHERE batch_id = b.id),0)
      ) / b.original_count
    ) ELSE 0 END,
    updated_at = now()
FROM public.chick_trading_batches ct
WHERE b.source_chick_trading_batch_id = ct.id
  AND b.total_cost = 0;