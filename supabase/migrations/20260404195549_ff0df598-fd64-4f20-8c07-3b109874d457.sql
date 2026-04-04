
-- Fix customers INSERT: Restrict to roles that interact with customers
DROP POLICY IF EXISTS "Authenticated users can create customers" ON public.customers;
CREATE POLICY "Authenticated users can create customers"
ON public.customers
FOR INSERT
TO authenticated
WITH CHECK (
  has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'sales_manager'::app_role,
    'sales_moderator'::app_role
  ])
);
