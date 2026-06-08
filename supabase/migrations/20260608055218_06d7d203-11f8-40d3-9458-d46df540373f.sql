
-- 1) Restrict duplicate_order_attempt_audit SELECT to managers only (remove owner SELECT to avoid phone exposure)
DROP POLICY IF EXISTS "Duplicate audit visible to owner or marketing manager" ON public.duplicate_order_attempt_audit;
CREATE POLICY "Duplicate audit visible to managers"
  ON public.duplicate_order_attempt_audit
  FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'marketing_sales_manager'::app_role)
    OR has_role(auth.uid(), 'general_manager'::app_role)
    OR has_role(auth.uid(), 'executive_manager'::app_role)
  );

-- 2) Tighten hatch_batch_edit_audit INSERT to roles that actually edit batches
DROP POLICY IF EXISTS audit_insert_authenticated ON public.hatch_batch_edit_audit;
CREATE POLICY audit_insert_authorized
  ON public.hatch_batch_edit_audit
  FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND (
      has_role(auth.uid(), 'general_manager'::app_role)
      OR has_role(auth.uid(), 'executive_manager'::app_role)
      OR has_role(auth.uid(), 'hatchery_manager'::app_role)
      OR has_role(auth.uid(), 'farm_manager'::app_role)
      OR has_role(auth.uid(), 'production_manager'::app_role)
    )
  );

-- 3) Tighten lab_treasury_audit_log INSERT to lab/finance roles only
DROP POLICY IF EXISTS lta_insert ON public.lab_treasury_audit_log;
CREATE POLICY lta_insert_authorized
  ON public.lab_treasury_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND (
      has_role(auth.uid(), 'general_manager'::app_role)
      OR has_role(auth.uid(), 'executive_manager'::app_role)
      OR has_role(auth.uid(), 'lab_treasury_approver'::app_role)
      OR has_role(auth.uid(), 'accountant'::app_role)
      OR has_role(auth.uid(), 'financial_manager'::app_role)
      OR has_role(auth.uid(), 'hatchery_manager'::app_role)
    )
  );
