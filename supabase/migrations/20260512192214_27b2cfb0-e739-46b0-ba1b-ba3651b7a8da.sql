-- Orders: allow delete for GM/Exec/Marketing Sales Manager
CREATE POLICY "Authorized roles can delete orders"
ON public.orders
FOR DELETE
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'marketing_sales_manager'::app_role]));

-- Order items: extend delete permission to include marketing sales manager
DROP POLICY IF EXISTS "Authorized roles can delete order items" ON public.order_items;
CREATE POLICY "Authorized roles can delete order items"
ON public.order_items
FOR DELETE
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role, 'shipping_company'::app_role, 'sales_moderator'::app_role]));

-- Customers: allow marketing sales manager to delete too
DROP POLICY IF EXISTS "Managers can delete customers" ON public.customers;
CREATE POLICY "Managers can delete customers"
ON public.customers
FOR DELETE
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'marketing_sales_manager'::app_role]));