-- Tighten mf_log INSERT policy
DROP POLICY IF EXISTS mfl_w ON public.mf_log;
CREATE POLICY mfl_w ON public.mf_log FOR INSERT TO authenticated
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'meat_factory_manager'::app_role,
    'warehouse_supervisor'::app_role
  ])
);

-- Add explicit INSERT policy for duplicate_order_approvals (moderators create requests)
DROP POLICY IF EXISTS "Moderator inserts own request" ON public.duplicate_order_approvals;
CREATE POLICY "Moderator inserts own request" ON public.duplicate_order_approvals FOR INSERT TO authenticated
WITH CHECK (
  requested_by = auth.uid()
  AND public.has_any_role(auth.uid(), ARRAY[
    'sales_moderator'::app_role,
    'sales_manager'::app_role,
    'marketing_sales_manager'::app_role,
    'general_manager'::app_role,
    'executive_manager'::app_role
  ])
);