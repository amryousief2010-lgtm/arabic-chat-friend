
-- Allow accountant to INSERT new raw items (cannot edit/delete existing)
CREATE POLICY "meat_raw_insert_accountant"
ON public.meat_factory_raw_items
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'accountant'::app_role)
  OR has_role(auth.uid(), 'financial_manager'::app_role)
  OR has_role(auth.uid(), 'general_manager'::app_role)
  OR has_role(auth.uid(), 'executive_manager'::app_role)
  OR has_role(auth.uid(), 'meat_factory_manager'::app_role)
  OR has_role(auth.uid(), 'warehouse_supervisor'::app_role)
);

-- Allow inserting into audit log
CREATE POLICY "meat_audit_insert"
ON public.meat_factory_audit_log
FOR INSERT
TO authenticated
WITH CHECK (
  has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'meat_factory_manager'::app_role,
    'quality_manager'::app_role,
    'accountant'::app_role,
    'financial_manager'::app_role,
    'warehouse_supervisor'::app_role
  ])
);
