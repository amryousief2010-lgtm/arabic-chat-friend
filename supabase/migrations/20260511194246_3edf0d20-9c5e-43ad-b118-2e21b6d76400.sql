CREATE OR REPLACE FUNCTION public.sync_family_status_from_production()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE fid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN fid := OLD.family_id; ELSE fid := NEW.family_id; END IF;
  IF fid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  UPDATE public.farm_families f
  SET status = CASE WHEN EXISTS (
    SELECT 1 FROM public.farm_egg_production p
    WHERE p.family_id = fid AND p.production_date >= '2026-01-01' AND p.egg_count > 0
  ) THEN 'active' ELSE 'inactive' END, updated_at = now()
  WHERE f.id = fid;
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_sync_family_status_ins ON public.farm_egg_production;
DROP TRIGGER IF EXISTS trg_sync_family_status_upd ON public.farm_egg_production;
DROP TRIGGER IF EXISTS trg_sync_family_status_del ON public.farm_egg_production;

CREATE TRIGGER trg_sync_family_status_ins AFTER INSERT ON public.farm_egg_production
FOR EACH ROW EXECUTE FUNCTION public.sync_family_status_from_production();

CREATE TRIGGER trg_sync_family_status_upd AFTER UPDATE ON public.farm_egg_production
FOR EACH ROW EXECUTE FUNCTION public.sync_family_status_from_production();

CREATE TRIGGER trg_sync_family_status_del AFTER DELETE ON public.farm_egg_production
FOR EACH ROW EXECUTE FUNCTION public.sync_family_status_from_production();