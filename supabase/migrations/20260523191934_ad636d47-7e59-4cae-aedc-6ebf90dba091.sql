
-- 1) slaughter_workers: restrict SELECT to operational roles
DROP POLICY IF EXISTS "view slaughter workers" ON public.slaughter_workers;
CREATE POLICY "view slaughter workers" ON public.slaughter_workers
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'slaughterhouse_manager'::app_role,
    'hr_manager'::app_role
  ]));

-- 2) catering_customers: restrict SELECT to sales/manager roles
DROP POLICY IF EXISTS "view catering customers (auth)" ON public.catering_customers;
CREATE POLICY "view catering customers (auth)" ON public.catering_customers
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'sales_manager'::app_role,
    'marketing_sales_manager'::app_role,
    'sales_moderator'::app_role,
    'accountant'::app_role,
    'financial_manager'::app_role
  ]));

-- 3) catering_suppliers: restrict SELECT to manager/warehouse roles
DROP POLICY IF EXISTS "view suppliers (auth)" ON public.catering_suppliers;
CREATE POLICY "view suppliers (auth)" ON public.catering_suppliers
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'warehouse_supervisor'::app_role,
    'accountant'::app_role,
    'financial_manager'::app_role
  ]));

-- 4) payroll_bonus_overrides: change role from public to authenticated
DROP POLICY IF EXISTS "Managers view all payroll overrides" ON public.payroll_bonus_overrides;
CREATE POLICY "Managers view all payroll overrides" ON public.payroll_bonus_overrides
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'sales_manager'::app_role,
    'marketing_sales_manager'::app_role,
    'accountant'::app_role,
    'financial_manager'::app_role
  ]));

DROP POLICY IF EXISTS "Moderators view their own payroll override" ON public.payroll_bonus_overrides;
CREATE POLICY "Moderators view their own payroll override" ON public.payroll_bonus_overrides
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'sales_moderator'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.full_name = payroll_bonus_overrides.moderator_name
    )
  );

-- 5) Tighten audit log INSERT policies (no more WITH CHECK true)
DROP POLICY IF EXISTS "slaughter_audit_insert" ON public.slaughter_audit_log;
CREATE POLICY "slaughter_audit_insert" ON public.slaughter_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "System can insert audit" ON public.order_status_audit;
CREATE POLICY "System can insert audit" ON public.order_status_audit
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- 6) Pin search_path on helper functions
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pgmq;
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.normalize_ar(text) SET search_path = public;
