DROP POLICY IF EXISTS "Sales moderators can view their customers" ON public.customers;

CREATE POLICY "Sales moderators can view all customers"
ON public.customers
FOR SELECT
USING (has_role(auth.uid(), 'sales_moderator'::app_role));