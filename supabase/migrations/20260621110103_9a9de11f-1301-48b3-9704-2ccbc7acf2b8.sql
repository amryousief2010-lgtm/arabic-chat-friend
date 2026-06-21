
-- hatchery_invoice_carryovers: restrict INSERT
DROP POLICY IF EXISTS "carryovers insert authenticated" ON public.hatchery_invoice_carryovers;
CREATE POLICY "carryovers insert managers"
  ON public.hatchery_invoice_carryovers
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','hatchery_manager','financial_manager','accountant']::app_role[]));

-- hr_employee_name_aliases: restrict INSERT/UPDATE/DELETE
DROP POLICY IF EXISTS "aliases_insert_authenticated" ON public.hr_employee_name_aliases;
DROP POLICY IF EXISTS "aliases_update_authenticated" ON public.hr_employee_name_aliases;
DROP POLICY IF EXISTS "aliases_delete_authenticated" ON public.hr_employee_name_aliases;

CREATE POLICY "aliases_insert_hr"
  ON public.hr_employee_name_aliases
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','hr_manager']::app_role[]));

CREATE POLICY "aliases_update_hr"
  ON public.hr_employee_name_aliases
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','hr_manager']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','hr_manager']::app_role[]));

CREATE POLICY "aliases_delete_hr"
  ON public.hr_employee_name_aliases
  FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','hr_manager']::app_role[]));

-- meat_recipe_item_mappings: restrict INSERT/UPDATE/DELETE
DROP POLICY IF EXISTS "auth insert recipe mappings" ON public.meat_recipe_item_mappings;
DROP POLICY IF EXISTS "auth update recipe mappings" ON public.meat_recipe_item_mappings;
DROP POLICY IF EXISTS "auth delete recipe mappings" ON public.meat_recipe_item_mappings;

CREATE POLICY "recipe mappings insert managers"
  ON public.meat_recipe_item_mappings
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','meat_factory_manager','production_manager','quality_manager']::app_role[]));

CREATE POLICY "recipe mappings update managers"
  ON public.meat_recipe_item_mappings
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','meat_factory_manager','production_manager','quality_manager']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','meat_factory_manager','production_manager','quality_manager']::app_role[]));

CREATE POLICY "recipe mappings delete managers"
  ON public.meat_recipe_item_mappings
  FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','meat_factory_manager','production_manager','quality_manager']::app_role[]));
