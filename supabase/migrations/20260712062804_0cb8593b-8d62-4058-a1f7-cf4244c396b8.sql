CREATE OR REPLACE VIEW public.v_available_live_ostrich AS
SELECT id AS receipt_id,
   receipt_number,
   receipt_date,
   source_name,
   bird_count AS original_count,
   current_alive_count,
   total_weight_kg,
   avg_weight_kg,
   price_per_kg,
   total_batch_cost,
   cost_per_bird_current,
   feed_cost_loaded,
   other_costs_loaded,
   COALESCE((SELECT sum(s.bird_count) FROM slaughter_live_sales s WHERE s.live_receipt_id = r.id), 0::bigint)::integer AS sold_live_count,
   COALESCE((SELECT sum(s.sale_weight_kg) FROM slaughter_live_sales s WHERE s.live_receipt_id = r.id), 0::numeric) AS sold_live_weight_kg
FROM slaughter_live_receipts r
WHERE archived = false OR current_alive_count > 0;