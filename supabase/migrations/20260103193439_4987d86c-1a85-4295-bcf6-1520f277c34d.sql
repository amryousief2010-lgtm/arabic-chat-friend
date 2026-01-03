-- Update policies to include sales_manager

DROP POLICY IF EXISTS "Managers can update customers" ON public.customers;
CREATE POLICY "Managers can update customers"
ON public.customers FOR UPDATE
USING (has_any_role(auth.uid(), ARRAY['general_manager', 'executive_manager', 'sales_manager']::app_role[]));

DROP POLICY IF EXISTS "Managers can update notifications" ON public.notifications;
CREATE POLICY "Managers can update notifications"
ON public.notifications FOR UPDATE
USING (has_any_role(auth.uid(), ARRAY['general_manager', 'executive_manager', 'sales_manager']::app_role[]));

DROP POLICY IF EXISTS "Managers can delete notifications" ON public.notifications;
CREATE POLICY "Managers can delete notifications"
ON public.notifications FOR DELETE
USING (has_any_role(auth.uid(), ARRAY['general_manager', 'executive_manager', 'sales_manager']::app_role[]));

DROP POLICY IF EXISTS "Authorized roles can update orders" ON public.orders;
CREATE POLICY "Authorized roles can update orders"
ON public.orders FOR UPDATE
USING (has_any_role(auth.uid(), ARRAY['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'warehouse_supervisor']::app_role[]));

DROP POLICY IF EXISTS "Warehouse and managers can manage products" ON public.products;
CREATE POLICY "Warehouse and managers can manage products"
ON public.products FOR ALL
USING (has_any_role(auth.uid(), ARRAY['general_manager', 'executive_manager', 'sales_manager', 'warehouse_supervisor']::app_role[]));

DROP POLICY IF EXISTS "Managers can view all profiles" ON public.profiles;
CREATE POLICY "Managers can view all profiles"
ON public.profiles FOR SELECT
USING (has_any_role(auth.uid(), ARRAY['general_manager', 'executive_manager', 'sales_manager']::app_role[]));

DROP POLICY IF EXISTS "Managers can view all roles" ON public.user_roles;
CREATE POLICY "Managers can view all roles"
ON public.user_roles FOR SELECT
USING (has_any_role(auth.uid(), ARRAY['general_manager', 'executive_manager', 'sales_manager']::app_role[]));