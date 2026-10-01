-- P0 Issue 4: live operational KPIs from hatch_batches (not legacy hatchery_batches/lots).
-- Keeps old v_hatchery_dashboard_kpis untouched for any legacy readers; UI uses client compute + this view for verify.

CREATE OR REPLACE VIEW public.v_hatchery_lab_ops_kpis AS
WITH ops AS (
  SELECT
    b.*,
    COALESCE(c.customer_type, '') AS customer_type,
    COALESCE(c.name, '') AS customer_name
  FROM public.hatch_batches b
  LEFT JOIN public.hatch_customers c ON c.id = b.customer_id
  WHERE COALESCE(b.is_test, false) = false
    AND (b.customer_id IS NOT NULL OR b.entry_date IS NOT NULL OR b.machine IS NOT NULL)
),
open_ops AS (
  SELECT *
  FROM ops
  WHERE COALESCE(exit_date::text, '') = ''
    AND LOWER(COALESCE(status, '')) NOT IN (
      'completed','closed','delivered','received_by_customer','finished','settled','cancelled','exited','done'
    )
    AND COALESCE(hatched_chicks, 0) = 0
    AND COALESCE(candle1_fertile, 0) = 0
    AND COALESCE(candle1_infertile, 0) = 0
    AND COALESCE(candle2_fertile, 0) = 0
    AND COALESCE(candle2_dead, 0) = 0
    AND COALESCE(hatcher_dead, 0) = 0
)
SELECT
  (SELECT COALESCE(sum(received_eggs), 0) FROM open_ops) AS eggs_in_lab,
  (SELECT COALESCE(sum(received_eggs), 0) FROM open_ops
    WHERE customer_type IN ('ostrich','internal','capital_ostrich')
       OR customer_name ~ 'نعام|عاصمة') AS internal_eggs,
  (SELECT COALESCE(sum(received_eggs), 0) FROM open_ops
    WHERE NOT (
      customer_type IN ('ostrich','internal','capital_ostrich')
      OR customer_name ~ 'نعام|عاصمة'
    )) AS external_eggs,
  (SELECT count(*) FROM open_ops) AS open_batches,
  (SELECT COALESCE(sum(hatched_chicks), 0) FROM ops
    WHERE exit_date >= date_trunc('month', CURRENT_DATE)::date) AS chicks_this_month,
  (SELECT
      CASE WHEN sum(COALESCE(candle1_fertile, 0)) > 0
        THEN round(sum(COALESCE(hatched_chicks, 0))::numeric / sum(COALESCE(candle1_fertile, 0))::numeric * 100, 1)
        ELSE 0::numeric
      END
    FROM ops
    WHERE LOWER(COALESCE(status, '')) IN ('completed','closed','finished','settled','done')
       OR exit_date IS NOT NULL
  ) AS hatch_rate_pct;

GRANT SELECT ON public.v_hatchery_lab_ops_kpis TO authenticated, anon;

COMMENT ON VIEW public.v_hatchery_lab_ops_kpis IS
  'P0 2026-10-02: operational hatchery KPIs from live hatch_batches (HatcheryLab). Replaces reliance on v_hatchery_dashboard_kpis for ops cards.';
