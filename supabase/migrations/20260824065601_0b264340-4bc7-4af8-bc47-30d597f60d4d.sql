CREATE TABLE IF NOT EXISTS public.farm_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  idle_days_threshold integer NOT NULL DEFAULT 45 CHECK (idle_days_threshold BETWEEN 7 AND 180),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.farm_settings TO authenticated;
GRANT ALL ON public.farm_settings TO service_role;

ALTER TABLE public.farm_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "farm_settings_select" ON public.farm_settings;
CREATE POLICY "farm_settings_select" ON public.farm_settings
FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "farm_settings_write" ON public.farm_settings;
CREATE POLICY "farm_settings_write" ON public.farm_settings
FOR INSERT TO authenticated WITH CHECK (
  public.has_role(auth.uid(), 'general_manager') OR
  public.has_role(auth.uid(), 'executive_manager') OR
  public.has_role(auth.uid(), 'farm_manager')
);

DROP POLICY IF EXISTS "farm_settings_update" ON public.farm_settings;
CREATE POLICY "farm_settings_update" ON public.farm_settings
FOR UPDATE TO authenticated USING (
  public.has_role(auth.uid(), 'general_manager') OR
  public.has_role(auth.uid(), 'executive_manager') OR
  public.has_role(auth.uid(), 'farm_manager')
) WITH CHECK (
  public.has_role(auth.uid(), 'general_manager') OR
  public.has_role(auth.uid(), 'executive_manager') OR
  public.has_role(auth.uid(), 'farm_manager')
);

CREATE TRIGGER trg_farm_settings_updated_at
BEFORE UPDATE ON public.farm_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.farm_settings (id, idle_days_threshold)
VALUES (true, 45) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_farm_idle_threshold()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT COALESCE((SELECT idle_days_threshold FROM public.farm_settings LIMIT 1), 45) $$;

CREATE OR REPLACE FUNCTION public.refresh_farm_family_statuses(_idle_days integer DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE n integer; d integer;
BEGIN
  d := COALESCE(_idle_days, public.get_farm_idle_threshold());
  WITH last_prod AS (
    SELECT f.id, (SELECT max(p.production_date) FROM public.farm_egg_production p
                  WHERE p.family_id = f.id AND p.egg_count > 0) AS last_date
    FROM public.farm_families f
  )
  UPDATE public.farm_families f
  SET status = CASE WHEN lp.last_date IS NOT NULL
                      AND lp.last_date >= (CURRENT_DATE - (d || ' days')::interval)
                    THEN 'active' ELSE 'inactive' END,
      updated_at = now()
  FROM last_prod lp
  WHERE lp.id = f.id
    AND f.status IS DISTINCT FROM (CASE WHEN lp.last_date IS NOT NULL
                      AND lp.last_date >= (CURRENT_DATE - (d || ' days')::interval)
                    THEN 'active' ELSE 'inactive' END);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $function$;

CREATE OR REPLACE FUNCTION public.sync_family_status_from_production()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE fid uuid; d integer;
BEGIN
  IF TG_OP = 'DELETE' THEN fid := OLD.family_id; ELSE fid := NEW.family_id; END IF;
  IF fid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  d := public.get_farm_idle_threshold();
  UPDATE public.farm_families f
  SET status = CASE WHEN EXISTS (
    SELECT 1 FROM public.farm_egg_production p
    WHERE p.family_id = fid
      AND p.egg_count > 0
      AND p.production_date >= (CURRENT_DATE - (d || ' days')::interval)
  ) THEN 'active' ELSE 'inactive' END, updated_at = now()
  WHERE f.id = fid;
  RETURN COALESCE(NEW, OLD);
END; $function$;