DROP POLICY IF EXISTS "view slaughter batch sources" ON public.slaughter_batch_live_sources;
CREATE POLICY "view slaughter batch sources"
ON public.slaughter_batch_live_sources
FOR SELECT
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'slaughterhouse_manager'::app_role,
    'production_manager'::app_role,
    'agouza_warehouse_keeper'::app_role
  ])
);