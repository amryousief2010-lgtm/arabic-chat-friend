DROP POLICY IF EXISTS agouza_audit_insert_system ON public.agouza_override_audit_log;
CREATE POLICY agouza_audit_insert_system ON public.agouza_override_audit_log
FOR INSERT TO authenticated
WITH CHECK (
  can_approve_agouza(auth.uid())
  OR can_manage_agouza(auth.uid())
  OR is_agouza_keeper(auth.uid())
  OR has_role(auth.uid(), 'general_manager'::app_role)
  OR has_role(auth.uid(), 'executive_manager'::app_role)
);