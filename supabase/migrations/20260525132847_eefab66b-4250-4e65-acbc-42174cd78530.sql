-- Dispatch H §D: Security Hardening — Revoke EXECUTE from anon/public for high-risk RPCs
-- Affects functions whose name starts with: fd_, inv_, activate_, approve_
-- Functions remain SECURITY DEFINER with search_path=public and internal role guards.
-- Authenticated users keep EXECUTE so existing UI continues to work.

DO $$
DECLARE
  r record;
  sig text;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND (
        p.proname LIKE 'fd\_%'  ESCAPE '\'
        OR p.proname LIKE 'inv\_%' ESCAPE '\'
        OR p.proname LIKE 'activate\_%' ESCAPE '\'
        OR p.proname LIKE 'approve\_%' ESCAPE '\'
      )
  LOOP
    sig := format('%I.%I(%s)', r.nspname, r.proname, r.args);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', sig);
  END LOOP;
END $$;