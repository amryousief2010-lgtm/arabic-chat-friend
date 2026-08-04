DROP POLICY IF EXISTS "auth read runs" ON public.zodex_sync_runs;
CREATE POLICY "zodex_sync_runs_read_roles" ON public.zodex_sync_runs
FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','sales_manager','warehouse_supervisor','marketing_sales_manager','accountant','financial_manager','shipping_company']::app_role[]));

DROP POLICY IF EXISTS "auth read missing" ON public.zodex_missing_orders;
CREATE POLICY "zodex_missing_orders_read_roles" ON public.zodex_missing_orders
FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','sales_manager','warehouse_supervisor','marketing_sales_manager','accountant','financial_manager','shipping_company']::app_role[]));

DROP POLICY IF EXISTS "zodex_closed_invoices_read" ON public.zodex_closed_invoices;
CREATE POLICY "zodex_closed_invoices_read_roles" ON public.zodex_closed_invoices
FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','sales_manager','warehouse_supervisor','marketing_sales_manager','accountant','financial_manager','shipping_company']::app_role[]));

DROP POLICY IF EXISTS "zodex_closed_invoice_orders_read" ON public.zodex_closed_invoice_orders;
CREATE POLICY "zodex_closed_invoice_orders_read_roles" ON public.zodex_closed_invoice_orders
FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','sales_manager','warehouse_supervisor','marketing_sales_manager','accountant','financial_manager','shipping_company']::app_role[]));