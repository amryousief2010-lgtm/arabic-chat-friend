DROP POLICY IF EXISTS "managers update discrepancies" ON public.order_mega_discrepancies;
CREATE POLICY "managers update discrepancies"
ON public.order_mega_discrepancies
FOR UPDATE TO authenticated
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role]));

DROP POLICY IF EXISTS "select own or manager discrepancies" ON public.order_mega_discrepancies;
CREATE POLICY "select own or manager discrepancies"
ON public.order_mega_discrepancies
FOR SELECT TO authenticated
USING (reported_by = auth.uid() OR has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role]));