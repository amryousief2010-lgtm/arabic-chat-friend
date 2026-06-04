CREATE TABLE IF NOT EXISTS public.profile_directory (
  id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profile_directory TO authenticated;
GRANT ALL ON public.profile_directory TO service_role;
ALTER TABLE public.profile_directory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view profile directory" ON public.profile_directory;
CREATE POLICY "Authenticated users can view profile directory"
ON public.profile_directory
FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION public.sync_profile_directory_from_profiles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.profile_directory
    WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO public.profile_directory (id, full_name, updated_at)
  VALUES (NEW.id, NEW.full_name, now())
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_directory_from_profiles ON public.profiles;
CREATE TRIGGER trg_sync_profile_directory_from_profiles
AFTER INSERT OR UPDATE OF full_name OR DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_directory_from_profiles();

INSERT INTO public.profile_directory (id, full_name, updated_at)
SELECT id, full_name, updated_at
FROM public.profiles
ON CONFLICT (id) DO UPDATE
SET full_name = EXCLUDED.full_name,
    updated_at = EXCLUDED.updated_at;

DROP POLICY IF EXISTS "Managers can view all profiles" ON public.profiles;
CREATE POLICY "Managers can view all profiles"
ON public.profiles
FOR SELECT
USING (
  has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role])
);