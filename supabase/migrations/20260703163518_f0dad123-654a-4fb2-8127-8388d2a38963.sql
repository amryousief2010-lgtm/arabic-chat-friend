DROP POLICY IF EXISTS ct_audit_insert ON public.chick_trading_audit_log;
CREATE POLICY ct_audit_insert ON public.chick_trading_audit_log
FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'hatchery_manager'::app_role)
  OR has_role(auth.uid(), 'brooding_manager'::app_role)
  OR has_role(auth.uid(), 'general_manager'::app_role)
  OR has_role(auth.uid(), 'executive_manager'::app_role)
);