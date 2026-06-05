
-- Allow meat factory manager to also manage raw materials
DROP POLICY IF EXISTS "manage raw materials" ON public.meat_factory_raw_materials;
CREATE POLICY "manage raw materials" ON public.meat_factory_raw_materials
FOR ALL
USING (public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','production_manager','warehouse_supervisor','meat_factory_manager']::app_role[]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','production_manager','warehouse_supervisor','meat_factory_manager']::app_role[]));

-- Allow authorized roles to write inventory movement logs for raw material adjustments
DROP POLICY IF EXISTS "meat_moves_write" ON public.meat_factory_inventory_moves;
CREATE POLICY "meat_moves_write" ON public.meat_factory_inventory_moves
FOR INSERT
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','production_manager','warehouse_supervisor','meat_factory_manager']::app_role[]));
