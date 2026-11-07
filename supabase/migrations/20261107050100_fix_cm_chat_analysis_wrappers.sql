-- Fix: wrapper call args must be input args only.
DO $do$
DECLARE fn text; o oid; args text; idargs text; res text; callargs text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['cm_chat_analysis_list','cm_kpi_chat_by_moderator','cm_kpi_chat_by_ad','cm_kpi_chat_categories'] LOOP
    SELECT p.oid INTO o FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=fn||'_core';
    args := pg_get_function_arguments(o); idargs := pg_get_function_identity_arguments(o); res := pg_get_function_result(o);
    SELECT string_agg(quote_ident(a), ', ' ORDER BY i) INTO callargs
      FROM unnest((SELECT proargnames FROM pg_proc WHERE oid=o)) WITH ORDINALITY u(a,i) WHERE i <= (SELECT pronargs FROM pg_proc WHERE oid=o);
    EXECUTE format($f$CREATE OR REPLACE FUNCTION public.%1$I(%2$s) RETURNS %3$s LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $b$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.cm_can_read_all() THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT * FROM public.%4$I(%5$s);
END $b$$f$, fn||'_fast', args, res, fn||'_core', callargs);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon', fn||'_fast', idargs);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role', fn||'_fast', idargs);
    EXECUTE format($f$CREATE OR REPLACE FUNCTION public.%1$I(%2$s) RETURNS %3$s LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $b$
BEGIN
  IF auth.uid() IS NULL OR public.cm_can_read_all() THEN RETURN QUERY SELECT * FROM public.%4$I(%6$s);
  ELSE RETURN QUERY SELECT * FROM public.%5$I(%6$s); END IF;
END $b$$f$, fn, args, res, fn||'_fast', fn||'_core', callargs);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role', fn, idargs);
  END LOOP;
END $do$;
