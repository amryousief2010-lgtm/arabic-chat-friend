DROP POLICY IF EXISTS agouza_resv_audit_insert ON public.agouza_reservation_audit_log;
CREATE POLICY agouza_resv_audit_insert ON public.agouza_reservation_audit_log
FOR INSERT TO authenticated
WITH CHECK (
  can_approve_agouza(auth.uid())
  OR can_manage_agouza(auth.uid())
  OR is_agouza_keeper(auth.uid())
  OR has_role(auth.uid(), 'general_manager'::app_role)
  OR has_role(auth.uid(), 'executive_manager'::app_role)
);