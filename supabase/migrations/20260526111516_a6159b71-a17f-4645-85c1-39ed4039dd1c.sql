
-- Add pickup tracking and brooding fee for external customers
ALTER TABLE public.hatch_batches
  ADD COLUMN IF NOT EXISTS pickup_date date,
  ADD COLUMN IF NOT EXISTS brooding_days integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS brooding_fee numeric DEFAULT 0;

-- Allow hatchery_manager (lab manager) to manage hatch batches
DROP POLICY IF EXISTS "manage_hatch_batches" ON public.hatch_batches;
CREATE POLICY "manage_hatch_batches" ON public.hatch_batches
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'farm_manager'::app_role, 'production_manager'::app_role, 'quality_manager'::app_role, 'hatchery_manager'::app_role, 'brooding_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'farm_manager'::app_role, 'production_manager'::app_role, 'quality_manager'::app_role, 'hatchery_manager'::app_role, 'brooding_manager'::app_role]));

-- Also allow hatchery_manager on hatch_customers if exists
DROP POLICY IF EXISTS "manage_hatch_customers" ON public.hatch_customers;
CREATE POLICY "manage_hatch_customers" ON public.hatch_customers
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'farm_manager'::app_role, 'production_manager'::app_role, 'quality_manager'::app_role, 'hatchery_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'farm_manager'::app_role, 'production_manager'::app_role, 'quality_manager'::app_role, 'hatchery_manager'::app_role]));
