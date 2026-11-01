-- Org-chart / avatar directory for every signed-in user.
-- Exposes ONLY: id, full_name, user_id, photo_url, job_title, department, status.
-- NOT exposed: salary, phone, pay_day, national id, address, or any other HR field.
-- Storage: bucket "avatars" already has SELECT for authenticated users, so signed URLs work; no storage change.
DROP FUNCTION IF EXISTS public.hr_avatar_directory();
CREATE FUNCTION public.hr_avatar_directory()
RETURNS TABLE (id uuid, full_name text, user_id uuid, photo_url text, job_title text, department text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.full_name::text, e.user_id, e.photo_url::text, e.job_title::text, e.department::text, e.status::text
  FROM public.hr_employees e
  WHERE auth.uid() IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.hr_avatar_directory() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_avatar_directory() FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_avatar_directory() TO authenticated;

-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.hr_avatar_directory();
