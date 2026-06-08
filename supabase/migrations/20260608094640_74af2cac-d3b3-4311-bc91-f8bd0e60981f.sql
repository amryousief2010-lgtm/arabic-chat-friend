DROP VIEW IF EXISTS public.v_lab_treasury_balances CASCADE;

CREATE VIEW public.v_lab_treasury_balances AS
WITH pm AS (
  SELECT unnest(ARRAY['cash','vodafone_cash','instapay','bank_transfer'])::lab_treasury_payment_method AS payment_method
),
opens AS (
  SELECT 'cash'::lab_treasury_payment_method AS payment_method, COALESCE(SUM(cash_amount),0) AS opening_balance FROM public.lab_treasury_opening_balances WHERE status='approved'
  UNION ALL
  SELECT 'vodafone_cash'::lab_treasury_payment_method, COALESCE(SUM(vodafone_cash_amount),0) FROM public.lab_treasury_opening_balances WHERE status='approved'
  UNION ALL
  SELECT 'instapay'::lab_treasury_payment_method, COALESCE(SUM(instapay_amount),0) FROM public.lab_treasury_opening_balances WHERE status='approved'
  UNION ALL
  SELECT 'bank_transfer'::lab_treasury_payment_method, COALESCE(SUM(bank_transfer_amount),0) FROM public.lab_treasury_opening_balances WHERE status='approved'
),
mvs AS (
  SELECT payment_method,
    COALESCE(SUM(CASE WHEN movement_type='income' AND status='approved' THEN amount
                      WHEN movement_type='expense' AND status='approved' THEN -amount ELSE 0 END),0) AS net_movements,
    COALESCE(SUM(CASE WHEN movement_type='income' AND status IN ('approved','pending') THEN amount
                      WHEN movement_type='expense' AND status IN ('approved','pending') THEN -amount ELSE 0 END),0) AS net_movements_estimated
  FROM public.lab_treasury_movements
  GROUP BY payment_method
)
SELECT pm.payment_method,
  COALESCE(MAX(opens.opening_balance),0) AS opening_balance,
  COALESCE(MAX(mvs.net_movements),0) AS net_movements,
  COALESCE(MAX(opens.opening_balance),0) + COALESCE(MAX(mvs.net_movements),0) AS official_balance,
  COALESCE(MAX(opens.opening_balance),0) + COALESCE(MAX(mvs.net_movements),0) AS balance_approved,
  COALESCE(MAX(opens.opening_balance),0) + COALESCE(MAX(mvs.net_movements_estimated),0) AS balance_estimated
FROM pm
LEFT JOIN opens ON opens.payment_method = pm.payment_method
LEFT JOIN mvs ON mvs.payment_method = pm.payment_method
GROUP BY pm.payment_method;

GRANT SELECT ON public.v_lab_treasury_balances TO authenticated, service_role;