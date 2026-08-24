CREATE OR REPLACE FUNCTION public.sync_family_status_from_production()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE fid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN fid := OLD.family_id; ELSE fid := NEW.family_id; END IF;
  IF fid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  UPDATE public.farm_families f
  SET status = CASE WHEN EXISTS (
    SELECT 1 FROM public.farm_egg_production p
    WHERE p.family_id = fid
      AND p.egg_count > 0
      AND p.production_date >= (CURRENT_DATE - INTERVAL '45 days')
  ) THEN 'active' ELSE 'inactive' END, updated_at = now()
  WHERE f.id = fid;
  RETURN COALESCE(NEW, OLD);
END; $function$;

CREATE OR REPLACE FUNCTION public.refresh_farm_family_statuses(_idle_days integer DEFAULT 45)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  WITH last_prod AS (
    SELECT f.id, (SELECT max(p.production_date) FROM public.farm_egg_production p
                  WHERE p.family_id = f.id AND p.egg_count > 0) AS last_date
    FROM public.farm_families f
  )
  UPDATE public.farm_families f
  SET status = CASE WHEN lp.last_date IS NOT NULL
                      AND lp.last_date >= (CURRENT_DATE - (_idle_days || ' days')::interval)
                    THEN 'active' ELSE 'inactive' END,
      updated_at = now()
  FROM last_prod lp
  WHERE lp.id = f.id
    AND f.status IS DISTINCT FROM (CASE WHEN lp.last_date IS NOT NULL
                      AND lp.last_date >= (CURRENT_DATE - (_idle_days || ' days')::interval)
                    THEN 'active' ELSE 'inactive' END);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $function$;

GRANT EXECUTE ON FUNCTION public.refresh_farm_family_statuses(integer) TO authenticated, service_role;