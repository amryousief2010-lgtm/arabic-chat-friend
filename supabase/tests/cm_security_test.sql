\set ON_ERROR_STOP on
-- فحوص أمان عامة لكل cm_* (تفشل إن أُضيف جدول/دالة لاحقاً بدون حماية).
DO $$ DECLARE r record; bad text := ''; BEGIN
  -- 1) كل جدول cm_* عليه RLS وسياسة واحدة على الأقل
  FOR r IN SELECT c.relname, c.relrowsecurity,
             (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS npol
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relname LIKE 'cm\_%' LOOP
    IF NOT r.relrowsecurity THEN bad := bad || ' no-RLS:' || r.relname; END IF;
    IF r.npol = 0 THEN bad := bad || ' no-policy:' || r.relname; END IF;
  END LOOP;
  -- 2) لا سياسة cm_* تنطبق على anon أو PUBLIC
  FOR r IN SELECT c.relname, p.polname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
           WHERE c.relname LIKE 'cm\_%' AND (0 = ANY (p.polroles) OR 'anon'::regrole = ANY (p.polroles)) LOOP
    bad := bad || ' anon-policy:' || r.relname || '.' || r.polname;
  END LOOP;
  -- 3) كل view cm_v_* security_invoker
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname LIKE 'cm\_%'
             AND NOT coalesce(c.reloptions @> ARRAY['security_invoker=true'], false) LOOP
    bad := bad || ' view-not-invoker:' || r.relname;
  END LOOP;
  -- 4) كل دالة SECURITY DEFINER باسم cm_*: search_path مضبوط وغير قابلة للتنفيذ من anon
  FOR r IN SELECT p.oid::regprocedure AS sig, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname LIKE 'cm\_%' AND p.prosecdef LOOP
    IF NOT coalesce(EXISTS (SELECT 1 FROM unnest(r.proconfig) x WHERE x LIKE 'search_path=%'), false) THEN
      bad := bad || ' no-search_path:' || r.sig; END IF;
    IF has_function_privilege('anon', r.sig, 'EXECUTE') THEN bad := bad || ' anon-exec:' || r.sig; END IF;
  END LOOP;
  -- 5) anon لا يقرأ أي صف من cm_* حتى مع صلاحيات Supabase الافتراضية
  IF bad <> '' THEN RAISE EXCEPTION 'CM SECURITY CHECK FAILED:%', bad; END IF;
END $$;
SET ROLE anon;
DO $$ DECLARE r record; n bigint; BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
           WHERE ns.nspname='public' AND c.relkind IN ('r','v') AND c.relname LIKE 'cm\_%' LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I', r.relname) INTO n;
      IF n > 0 THEN RAISE EXCEPTION 'anon reads % rows from %', n, r.relname; END IF;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
END $$;
RESET ROLE;
SELECT 'ALL CM SECURITY TESTS PASSED' AS result;
