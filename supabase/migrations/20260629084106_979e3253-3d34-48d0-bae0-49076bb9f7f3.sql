DROP POLICY IF EXISTS "auth insert carryover dough" ON public.meat_factory_carryover_dough;
DROP POLICY IF EXISTS "auth update carryover dough" ON public.meat_factory_carryover_dough;

CREATE POLICY "managers insert carryover dough"
ON public.meat_factory_carryover_dough
FOR INSERT
TO authenticated
WITH CHECK (
  has_any_role(auth.uid(), ARRAY[
    'meat_factory_manager'::app_role,
    'general_manager'::app_role,
    'executive_manager'::app_role
  ])
);

CREATE POLICY "managers update carryover dough"
ON public.meat_factory_carryover_dough
FOR UPDATE
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY[
    'meat_factory_manager'::app_role,
    'general_manager'::app_role,
    'executive_manager'::app_role
  ])
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY[
    'meat_factory_manager'::app_role,
    'general_manager'::app_role,
    'executive_manager'::app_role
  ])
);