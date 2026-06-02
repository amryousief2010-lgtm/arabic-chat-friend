
-- Orders: allow marketing_sales_manager to view
DROP POLICY IF EXISTS "Managers and authorized roles can view all orders" ON public.orders;
CREATE POLICY "Managers and authorized roles can view all orders"
ON public.orders FOR SELECT
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role, 'accountant'::app_role, 'warehouse_supervisor'::app_role]));

-- Order items
DROP POLICY IF EXISTS "Managers and authorized roles can view all order items" ON public.order_items;
CREATE POLICY "Managers and authorized roles can view all order items"
ON public.order_items FOR SELECT
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role, 'accountant'::app_role, 'warehouse_supervisor'::app_role]));

-- Customers
DROP POLICY IF EXISTS "Managers and authorized roles can view all customers" ON public.customers;
CREATE POLICY "Managers and authorized roles can view all customers"
ON public.customers FOR SELECT
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role, 'accountant'::app_role, 'warehouse_supervisor'::app_role]));

-- Notifications: managers view all (include marketing_sales_manager)
DROP POLICY IF EXISTS "Managers can view all notifications" ON public.notifications;
CREATE POLICY "Managers can view all notifications"
ON public.notifications FOR SELECT
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role, 'accountant'::app_role, 'warehouse_supervisor'::app_role]));
