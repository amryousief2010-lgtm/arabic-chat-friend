-- Restore auto-sync triggers
CREATE TRIGGER trg_sync_farm_hatchery_shipment
AFTER INSERT OR DELETE OR UPDATE ON public.farm_egg_production
FOR EACH ROW EXECUTE FUNCTION public.sync_farm_to_hatchery_shipment();

CREATE TRIGGER trg_sync_family_status_ins
AFTER INSERT ON public.farm_egg_production
FOR EACH ROW EXECUTE FUNCTION public.sync_family_status_from_production();

CREATE TRIGGER trg_sync_family_status_upd
AFTER UPDATE ON public.farm_egg_production
FOR EACH ROW EXECUTE FUNCTION public.sync_family_status_from_production();

CREATE TRIGGER trg_sync_family_status_del
AFTER DELETE ON public.farm_egg_production
FOR EACH ROW EXECUTE FUNCTION public.sync_family_status_from_production();

-- Refresh families' status based on imported production
UPDATE public.farm_families f
SET status = CASE WHEN EXISTS (
  SELECT 1 FROM public.farm_egg_production p
  WHERE p.family_id = f.id AND p.production_date >= '2026-01-01' AND p.egg_count > 0
) THEN 'active' ELSE 'inactive' END,
updated_at = now();
