
DROP POLICY IF EXISTS ltdc_update_gm ON public.lab_treasury_day_closures;
CREATE POLICY ltdc_update_gm ON public.lab_treasury_day_closures
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'general_manager'::app_role) OR has_role(auth.uid(),'executive_manager'::app_role))
  WITH CHECK (has_role(auth.uid(),'general_manager'::app_role) OR has_role(auth.uid(),'executive_manager'::app_role));
