
CREATE OR REPLACE FUNCTION public.list_slaughterhouse_custody_keepers()
RETURNS TABLE(id uuid, full_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.role = 'slaughterhouse_custody_keeper'
  ORDER BY p.full_name;
$$;

GRANT EXECUTE ON FUNCTION public.list_slaughterhouse_custody_keepers() TO authenticated;
