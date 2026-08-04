DROP POLICY IF EXISTS "auth update missing" ON public.zodex_missing_orders;

CREATE POLICY "zmo_update_roles" ON public.zodex_missing_orders
FOR UPDATE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','sales_manager','warehouse_supervisor','marketing_sales_manager','accountant']::app_role[]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','sales_manager','warehouse_supervisor','marketing_sales_manager','accountant']::app_role[]));