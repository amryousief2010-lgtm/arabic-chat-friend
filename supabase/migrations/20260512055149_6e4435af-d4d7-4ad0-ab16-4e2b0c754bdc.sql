DROP POLICY IF EXISTS "Authenticated users can create orders" ON public.orders;

CREATE POLICY "Authorized roles can create orders"
ON public.orders
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = created_by
  AND has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'sales_manager'::app_role,
    'sales_moderator'::app_role,
    'marketing_sales_manager'::app_role
  ])
);