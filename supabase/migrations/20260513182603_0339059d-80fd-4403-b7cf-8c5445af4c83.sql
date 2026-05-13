-- Update delete policy to include sales_manager
DROP POLICY IF EXISTS "Managers can delete orders" ON public.orders;

CREATE POLICY "Managers can delete orders"
ON public.orders
FOR DELETE
TO public
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role]));