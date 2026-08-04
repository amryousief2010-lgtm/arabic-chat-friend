DROP POLICY IF EXISTS "Authenticated can insert unregistered shipments" ON public.unregistered_bostta_shipments;
CREATE POLICY "ubs_insert_roles" ON public.unregistered_bostta_shipments
FOR INSERT TO authenticated
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','sales_manager','marketing_sales_manager','sales_moderator','warehouse_supervisor','agouza_warehouse_keeper','accountant']::app_role[]));