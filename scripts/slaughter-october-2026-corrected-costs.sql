-- Read-only review of slaughter-batch cost for October 2026.
-- Computes the corrected cost. Does not UPDATE, INSERT, or DELETE.
--
-- Corrected batch cost = sum over each live receipt used by the batch of
--   receipt allocatable cost × birds taken from that receipt / receipt bird count
-- (live-weight share is used only when a per-receipt weight was stored; October
-- 2026 sources do not store one). That total, plus direct slaughter expenses, is
-- divided by accepted output kilograms (actual − damaged − quarantined, excluding
-- waste). This is the same rule as src/lib/slaughterBatchCost.ts.
--
-- The stored cost_per_kg_meat was produced by finalize_slaughter_batch, which
-- divided the FULL cost of slaughter_batches.live_receipt_id by output kilograms.

WITH receipt_cost AS (
  SELECT
    r.id,
    r.receipt_number,
    r.source_name,
    r.bird_count,
    r.total_weight_kg,
    r.total_cost,
    (
      COALESCE(r.total_cost, 0)
      + COALESCE(r.opening_cost_total, 0)
      + COALESCE(r.feed_cost_loaded, 0)
      + COALESCE(r.mortality_cost_loaded, 0)
      + COALESCE(r.other_costs_loaded, 0)
      + COALESCE((
          SELECT SUM(b.feed_cost)
          FROM public.slaughter_live_birds b
          WHERE b.receipt_id = r.id
        ), 0)
    ) AS allocatable_cost
  FROM public.slaughter_live_receipts r
),
source_share AS (
  SELECT
    s.slaughter_batch_id,
    s.live_receipt_id,
    s.birds_count,
    rc.receipt_number,
    rc.source_name,
    rc.bird_count AS receipt_birds,
    rc.allocatable_cost,
    CASE
      WHEN rc.bird_count > 0 THEN ROUND(rc.allocatable_cost * s.birds_count::numeric / rc.bird_count::numeric, 4)
      ELSE 0
    END AS corrected_source_cost,
    s.total_birds_cost AS stored_snapshot_cost
  FROM public.slaughter_batch_live_sources s
  JOIN receipt_cost rc ON rc.id = s.live_receipt_id
),
batch_share AS (
  SELECT
    slaughter_batch_id,
    SUM(birds_count) AS source_birds,
    SUM(corrected_source_cost) AS corrected_birds_cost,
    SUM(stored_snapshot_cost) AS stored_snapshot_cost,
    COUNT(*) AS source_rows,
    STRING_AGG(
      source_name || ' ' || birds_count::text || '/' || receipt_birds::text
        || ' = ' || corrected_source_cost::text,
      ' + ' ORDER BY source_name
    ) AS share_detail
  FROM source_share
  GROUP BY slaughter_batch_id
),
output_kg AS (
  SELECT
    o.batch_id,
    COALESCE(SUM(o.actual_weight_kg), 0) AS gross_kg,
    COALESCE(SUM(GREATEST(
      o.actual_weight_kg - COALESCE(o.damaged_weight_kg, 0) - COALESCE(o.quarantined_weight_kg, 0),
      0
    )) FILTER (WHERE o.destination IS DISTINCT FROM 'waste'), 0) AS accepted_kg
  FROM public.slaughter_batch_outputs o
  GROUP BY o.batch_id
)
SELECT
  b.batch_number,
  b.slaughter_date,
  b.birds_slaughtered,
  b.total_live_weight_kg,
  COALESCE(ok.accepted_kg, b.total_meat_kg, 0) AS accepted_meat_kg,
  ROUND(b.cost_per_kg_meat, 4) AS current_cost_per_kg,
  bs.share_detail,
  ROUND(bs.corrected_birds_cost, 4) AS corrected_birds_cost,
  ROUND(
    CASE
      WHEN COALESCE(ok.accepted_kg, 0) > 0
        THEN (bs.corrected_birds_cost + COALESCE(b.direct_slaughter_expenses, 0)) / ok.accepted_kg
      WHEN COALESCE(b.total_meat_kg, 0) > 0
        THEN (bs.corrected_birds_cost + COALESCE(b.direct_slaughter_expenses, 0)) / b.total_meat_kg
      ELSE NULL
    END,
    4
  ) AS corrected_cost_per_kg,
  ROUND(b.cost_per_kg_meat - (
    CASE
      WHEN COALESCE(ok.accepted_kg, 0) > 0
        THEN (bs.corrected_birds_cost + COALESCE(b.direct_slaughter_expenses, 0)) / ok.accepted_kg
      WHEN COALESCE(b.total_meat_kg, 0) > 0
        THEN (bs.corrected_birds_cost + COALESCE(b.direct_slaughter_expenses, 0)) / b.total_meat_kg
      ELSE NULL
    END
  ), 4) AS current_minus_corrected
FROM public.slaughter_batches b
JOIN batch_share bs ON bs.slaughter_batch_id = b.id
LEFT JOIN output_kg ok ON ok.batch_id = b.id
WHERE b.slaughter_date >= DATE '2026-10-01'
  AND b.slaughter_date < DATE '2026-11-01'
  AND b.status IS DISTINCT FROM 'cancelled'
ORDER BY b.slaughter_date, b.batch_number;

-- Receipt check: birds and cost allocated to October slaughter must not exceed the receipt.
WITH receipt_cost AS (
  SELECT
    r.id,
    r.receipt_number,
    r.source_name,
    r.bird_count,
    (
      COALESCE(r.total_cost, 0)
      + COALESCE(r.opening_cost_total, 0)
      + COALESCE(r.feed_cost_loaded, 0)
      + COALESCE(r.mortality_cost_loaded, 0)
      + COALESCE(r.other_costs_loaded, 0)
    ) AS allocatable_cost
  FROM public.slaughter_live_receipts r
  WHERE r.receipt_date >= DATE '2026-10-01'
    AND r.receipt_date < DATE '2026-11-01'
),
allocated AS (
  SELECT
    s.live_receipt_id,
    SUM(s.birds_count) AS birds_allocated,
    SUM(
      CASE
        WHEN rc.bird_count > 0 THEN ROUND(rc.allocatable_cost * s.birds_count::numeric / rc.bird_count::numeric, 4)
        ELSE 0
      END
    ) AS cost_allocated
  FROM public.slaughter_batch_live_sources s
  JOIN receipt_cost rc ON rc.id = s.live_receipt_id
  GROUP BY s.live_receipt_id
)
SELECT
  rc.receipt_number,
  rc.source_name,
  rc.bird_count,
  COALESCE(a.birds_allocated, 0) AS birds_allocated,
  rc.bird_count - COALESCE(a.birds_allocated, 0) AS birds_remaining,
  ROUND(rc.allocatable_cost, 4) AS allocatable_cost,
  ROUND(COALESCE(a.cost_allocated, 0), 4) AS corrected_cost_allocated,
  ROUND(rc.allocatable_cost - COALESCE(a.cost_allocated, 0), 4) AS corrected_cost_remaining,
  CASE
    WHEN COALESCE(a.birds_allocated, 0) > rc.bird_count THEN 'OVER_ALLOCATED_BIRDS'
    WHEN COALESCE(a.cost_allocated, 0) > rc.allocatable_cost + 0.05 THEN 'OVER_ALLOCATED_COST'
    ELSE 'ok'
  END AS allocation_status
FROM receipt_cost rc
LEFT JOIN allocated a ON a.live_receipt_id = rc.id
ORDER BY rc.receipt_number;
