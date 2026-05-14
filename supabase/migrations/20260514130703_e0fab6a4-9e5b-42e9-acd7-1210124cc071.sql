CREATE POLICY "Sales moderators can update customers"
ON public.customers
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'sales_moderator'::app_role))
WITH CHECK (has_role(auth.uid(), 'sales_moderator'::app_role));