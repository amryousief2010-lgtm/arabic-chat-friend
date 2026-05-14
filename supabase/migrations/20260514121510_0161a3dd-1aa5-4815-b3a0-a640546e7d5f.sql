CREATE POLICY "Sales moderators can view all customers"
ON public.customers FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'sales_moderator'::app_role));