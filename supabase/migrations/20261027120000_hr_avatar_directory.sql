-- Avatar-only employee directory for every signed-in user.
-- Exposes ONLY: id, full_name, user_id, photo_url. No salary, phone, pay_day or other HR fields.
-- Rollback: see bottom of file.
CREATE OR REPLACE FUNCTION public.hr_avatar_directory()
RETURNS TABLE (id uuid, full_name text, user_id uuid, photo_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.full_name::text, e.user_id, e.photo_url::text
  FROM public.hr_employees e
  WHERE auth.uid() IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.hr_avatar_directory() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_avatar_directory() FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_avatar_directory() TO authenticated;

-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.hr_avatar_directory();
