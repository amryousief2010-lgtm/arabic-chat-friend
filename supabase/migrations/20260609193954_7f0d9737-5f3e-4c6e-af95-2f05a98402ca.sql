
-- Allow lab_treasury_approver (السيد الجمل) to create/manage hatchery batches
DROP POLICY IF EXISTS hb_manage ON public.hatchery_batches;
CREATE POLICY hb_manage ON public.hatchery_batches FOR ALL
USING (has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','hatchery_manager','lab_treasury_approver']::app_role[]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','hatchery_manager','lab_treasury_approver']::app_role[]));

DROP POLICY IF EXISTS hbl_manage ON public.hatchery_batch_lots;
CREATE POLICY hbl_manage ON public.hatchery_batch_lots FOR ALL
USING (has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','hatchery_manager','lab_treasury_approver']::app_role[]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','hatchery_manager','lab_treasury_approver']::app_role[]));

DROP POLICY IF EXISTS manage_hatch_batches ON public.hatch_batches;
CREATE POLICY manage_hatch_batches ON public.hatch_batches FOR ALL
USING (has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','farm_manager','production_manager','quality_manager','hatchery_manager','brooding_manager','lab_treasury_approver']::app_role[]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','farm_manager','production_manager','quality_manager','hatchery_manager','brooding_manager','lab_treasury_approver']::app_role[]));
