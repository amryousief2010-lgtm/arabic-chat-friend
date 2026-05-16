DROP POLICY IF EXISTS "upsert_manufacturing_status" ON public.manufacturing_status;
DROP POLICY IF EXISTS "update_manufacturing_status" ON public.manufacturing_status;

CREATE POLICY "upsert_manufacturing_status"
ON public.manufacturing_status
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'production_manager'::app_role,
    'warehouse_supervisor'::app_role
  ])
);

CREATE POLICY "update_manufacturing_status"
ON public.manufacturing_status
FOR UPDATE
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'production_manager'::app_role,
    'warehouse_supervisor'::app_role
  ])
)
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'production_manager'::app_role,
    'warehouse_supervisor'::app_role
  ])
);