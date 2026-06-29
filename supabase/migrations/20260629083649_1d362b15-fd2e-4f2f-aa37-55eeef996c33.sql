DROP POLICY IF EXISTS "auth insert order assignments" ON public.courier_order_assignments;
DROP POLICY IF EXISTS "auth update order assignments" ON public.courier_order_assignments;

CREATE POLICY "staff insert order assignments"
ON public.courier_order_assignments
FOR INSERT
TO authenticated
WITH CHECK (
  has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'warehouse_supervisor'::app_role,
    'agouza_warehouse_keeper'::app_role,
    'sales_manager'::app_role,
    'marketing_sales_manager'::app_role,
    'production_manager'::app_role
  ])
);

CREATE POLICY "staff update order assignments"
ON public.courier_order_assignments
FOR UPDATE
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'warehouse_supervisor'::app_role,
    'agouza_warehouse_keeper'::app_role,
    'sales_manager'::app_role,
    'marketing_sales_manager'::app_role,
    'production_manager'::app_role
  ])
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'warehouse_supervisor'::app_role,
    'agouza_warehouse_keeper'::app_role,
    'sales_manager'::app_role,
    'marketing_sales_manager'::app_role,
    'production_manager'::app_role
  ])
);