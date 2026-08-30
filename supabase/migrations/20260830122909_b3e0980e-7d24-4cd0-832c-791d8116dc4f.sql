REVOKE EXECUTE ON FUNCTION public.inv_can_consume(uuid, numeric) FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.inv_can_consume(uuid, numeric) TO service_role;