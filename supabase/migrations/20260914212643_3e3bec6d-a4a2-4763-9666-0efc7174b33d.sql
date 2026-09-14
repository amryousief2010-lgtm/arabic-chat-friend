REVOKE ALL ON FUNCTION public.is_hagar_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_hagar_account(uuid) TO authenticated, service_role;