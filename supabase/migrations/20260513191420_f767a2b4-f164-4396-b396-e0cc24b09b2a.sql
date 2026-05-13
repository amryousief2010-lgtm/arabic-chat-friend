-- Restrict sales_moderator visibility to their own data only

-- 1) CUSTOMERS: drop the broad "view all" policy for moderators and replace with one that
--    only exposes customers that appear in their own orders.
DROP POLICY IF EXISTS "Sales moderators can view all customers" ON public.customers;

CREATE POLICY "Sales moderators view their own customers"
ON public.customers
FOR SELECT
USING (
  has_role(auth.uid(), 'sales_moderator'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.customer_id = customers.id
      AND o.created_by = auth.uid()
  )
);

-- 2) SALES TARGETS: allow each moderator to view only her own target row.
CREATE POLICY "Sales moderators view their own targets"
ON public.sales_targets
FOR SELECT
USING (
  has_role(auth.uid(), 'sales_moderator'::app_role)
  AND user_id = auth.uid()
);
