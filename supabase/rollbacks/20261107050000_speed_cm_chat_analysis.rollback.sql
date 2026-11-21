DO $do$ DECLARE fn text; idargs text; BEGIN
  FOREACH fn IN ARRAY ARRAY['cm_kpi_chat_categories','cm_kpi_chat_by_ad','cm_kpi_chat_by_moderator','cm_chat_analysis_list'] LOOP
    SELECT pg_get_function_identity_arguments(p.oid) INTO idargs FROM pg_proc p WHERE p.proname=fn||'_core';
    EXECUTE format('DROP FUNCTION public.%I(%s)', fn, idargs);
    EXECUTE format('DROP FUNCTION public.%I(%s)', fn||'_fast', idargs);
    EXECUTE format('ALTER FUNCTION public.%I(%s) RENAME TO %I', fn||'_core', idargs, fn);
  END LOOP; END $do$;
