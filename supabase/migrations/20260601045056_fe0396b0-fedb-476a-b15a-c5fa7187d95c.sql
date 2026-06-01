ALTER POLICY "Warehouse managers delete movements"
ON public.inventory_movements
USING (
  has_any_role(
    auth.uid(),
    ARRAY[
      'general_manager'::app_role,
      'executive_manager'::app_role,
      'warehouse_supervisor'::app_role
    ]
  )
);