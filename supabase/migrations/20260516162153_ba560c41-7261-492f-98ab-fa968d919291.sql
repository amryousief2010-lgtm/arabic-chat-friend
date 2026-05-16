DROP POLICY IF EXISTS "Warehouse and managers can manage products" ON public.products;
CREATE POLICY "Warehouse and managers can manage products"
ON public.products
FOR ALL
TO authenticated
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'warehouse_supervisor'::app_role, 'marketing_sales_manager'::app_role]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'warehouse_supervisor'::app_role, 'marketing_sales_manager'::app_role]));