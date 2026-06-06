-- 1. Apply security_invoker=on to flagged views
ALTER VIEW public.v_hatchery_batches_full SET (security_invoker = on);
ALTER VIEW public.v_hatchery_client_balances SET (security_invoker = on);
ALTER VIEW public.v_hatchery_dashboard_kpis SET (security_invoker = on);
ALTER VIEW public.v_lab_external_summary SET (security_invoker = on);
ALTER VIEW public.v_lab_treasury_balances SET (security_invoker = on);
ALTER VIEW public.v_lab_treasury_dashboard SET (security_invoker = on);
ALTER VIEW public.v_mother_farm_feed_balance SET (security_invoker = on);
ALTER VIEW public.v_slaughter_custody_balance SET (security_invoker = on);
ALTER VIEW public.v_slaughter_custody_week_usage SET (security_invoker = on);
ALTER VIEW public.v_slaughter_transfer_shipments SET (security_invoker = on);

-- 2. Tighten INSERT policies on audit tables (replace WITH CHECK (true) with role-based checks).
-- Note: any SECURITY DEFINER triggers inserting into these tables bypass RLS, so trigger-based audit inserts continue to work.

-- slaughter_custody_audit_log
DROP POLICY IF EXISTS custody_audit_insert ON public.slaughter_custody_audit_log;
CREATE POLICY custody_audit_insert
ON public.slaughter_custody_audit_log
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'slaughterhouse_custody_keeper'::app_role)
  OR public.has_role(auth.uid(), 'slaughterhouse_manager'::app_role)
  OR public.has_role(auth.uid(), 'general_manager'::app_role)
  OR public.has_role(auth.uid(), 'executive_manager'::app_role)
);

-- hatchery_print_audit
DROP POLICY IF EXISTS hpa_insert ON public.hatchery_print_audit;
CREATE POLICY hpa_insert
ON public.hatchery_print_audit
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'hatchery_manager'::app_role)
  OR public.has_role(auth.uid(), 'production_manager'::app_role)
  OR public.has_role(auth.uid(), 'general_manager'::app_role)
  OR public.has_role(auth.uid(), 'executive_manager'::app_role)
);
