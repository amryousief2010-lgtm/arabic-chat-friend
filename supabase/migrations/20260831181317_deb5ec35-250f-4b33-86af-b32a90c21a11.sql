DROP POLICY IF EXISTS "Authenticated can view customers" ON public.customers;

CREATE POLICY "Business roles can view customers"
ON public.customers FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,'executive_manager'::app_role,
    'sales_manager'::app_role,'marketing_sales_manager'::app_role,
    'marketing_sales_viewer'::app_role,'sales_moderator'::app_role,
    'accountant'::app_role,'financial_manager'::app_role,
    'warehouse_supervisor'::app_role,'agouza_warehouse_keeper'::app_role
  ])
);

DROP POLICY IF EXISTS "Authenticated can view unregistered shipments" ON public.unregistered_bostta_shipments;

CREATE POLICY "Business roles can view unregistered shipments"
ON public.unregistered_bostta_shipments FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,'executive_manager'::app_role,
    'sales_manager'::app_role,'marketing_sales_manager'::app_role,
    'marketing_sales_viewer'::app_role,'sales_moderator'::app_role,
    'accountant'::app_role,'financial_manager'::app_role,
    'warehouse_supervisor'::app_role,'agouza_warehouse_keeper'::app_role
  ])
);