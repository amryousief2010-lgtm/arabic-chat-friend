-- Migration B: Scope shipping_company SELECT on customers to own-carrier orders only.
-- Rollback (kept for reference, do NOT run unless reverting):
--   DROP POLICY "Shipping company can view own-carrier customers" ON public.customers;
--   CREATE POLICY "Shipping company can view customers"
--     ON public.customers FOR SELECT TO public
--     USING (has_role(auth.uid(), 'shipping_company'::app_role));

DROP POLICY IF EXISTS "Shipping company can view customers" ON public.customers;

CREATE POLICY "Shipping company can view own-carrier customers"
ON public.customers
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'shipping_company'::app_role)
  AND EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE o.customer_id = customers.id
      AND p.shipping_company_name IS NOT NULL
      AND o.shipping_company = p.shipping_company_name
  )
);