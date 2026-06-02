-- Step 1: create farm_egg_waste table, drop auto-shipment trigger temporarily, delete old data

CREATE TABLE IF NOT EXISTS public.farm_egg_waste (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  waste_date date NOT NULL,
  family_id uuid REFERENCES public.farm_families(id) ON DELETE SET NULL,
  egg_count integer NOT NULL CHECK (egg_count > 0),
  reason text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_farm_egg_waste_date   ON public.farm_egg_waste(waste_date DESC);
CREATE INDEX IF NOT EXISTS idx_farm_egg_waste_family ON public.farm_egg_waste(family_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.farm_egg_waste TO authenticated;
GRANT ALL ON public.farm_egg_waste TO service_role;

ALTER TABLE public.farm_egg_waste ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_view_farm_egg_waste" ON public.farm_egg_waste;
CREATE POLICY "auth_view_farm_egg_waste" ON public.farm_egg_waste
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "manage_farm_egg_waste" ON public.farm_egg_waste;
CREATE POLICY "manage_farm_egg_waste" ON public.farm_egg_waste
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'farm_manager'::app_role, 'production_manager'::app_role, 'quality_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'farm_manager'::app_role, 'production_manager'::app_role, 'quality_manager'::app_role]));

-- Temporarily drop auto-sync triggers so bulk import doesn't create phantom shipments
DROP TRIGGER IF EXISTS trg_sync_farm_hatchery_shipment ON public.farm_egg_production;
DROP TRIGGER IF EXISTS trg_sync_family_status_ins ON public.farm_egg_production;
DROP TRIGGER IF EXISTS trg_sync_family_status_upd ON public.farm_egg_production;
DROP TRIGGER IF EXISTS trg_sync_family_status_del ON public.farm_egg_production;

-- Delete old breeder farm + hatchery data only (users, roles, other modules untouched)
DELETE FROM public.farm_to_hatchery_shipments;
DELETE FROM public.hatch_batches;
DELETE FROM public.farm_egg_production;
DELETE FROM public.farm_egg_waste;
