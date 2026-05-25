
DROP POLICY IF EXISTS "Authenticated users can insert order_status_audit" ON public.order_status_audit;
DROP POLICY IF EXISTS "Users can insert order_status_audit" ON public.order_status_audit;
DROP POLICY IF EXISTS "insert_order_status_audit" ON public.order_status_audit;

CREATE POLICY "Sales roles can insert order_status_audit"
ON public.order_status_audit
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'sales_manager'::app_role,
    'sales_moderator'::app_role,
    'accountant'::app_role,
    'financial_manager'::app_role,
    'marketing_sales_manager'::app_role,
    'warehouse_supervisor'::app_role,
    'shipping_company'::app_role
  ])
);

DROP POLICY IF EXISTS "Authenticated users can insert slaughter_audit_log" ON public.slaughter_audit_log;
DROP POLICY IF EXISTS "Users can insert slaughter_audit_log" ON public.slaughter_audit_log;
DROP POLICY IF EXISTS "insert_slaughter_audit_log" ON public.slaughter_audit_log;

CREATE POLICY "Operational roles can insert slaughter_audit_log"
ON public.slaughter_audit_log
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'slaughterhouse_manager'::app_role,
    'production_manager'::app_role,
    'quality_manager'::app_role,
    'warehouse_supervisor'::app_role
  ])
);
