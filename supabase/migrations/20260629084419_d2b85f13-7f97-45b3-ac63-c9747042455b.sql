DROP POLICY IF EXISTS "auth insert carryover usage" ON public.meat_factory_carryover_dough_usage;
CREATE POLICY "managers insert carryover usage" ON public.meat_factory_carryover_dough_usage
FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'meat_factory_manager'::app_role)
  OR public.has_role(auth.uid(), 'general_manager'::app_role)
  OR public.has_role(auth.uid(), 'executive_manager'::app_role)
);