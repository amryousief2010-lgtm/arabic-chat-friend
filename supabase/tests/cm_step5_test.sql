-- الخطوة 5: بوابة الوصول. يبدأ بعد اختبارات 1–4 (التي جرت في وضع 'roles').
SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE public.cm_feature_gate SET access_mode = 'general_manager_only';

-- دالة مساعدة للاختبار: تستدعي كل دالة إجراء بوسائط NULL وتتوقع CM_SECTION_LOCKED
CREATE OR REPLACE FUNCTION pg_temp.t_actions_locked() RETURNS text LANGUAGE plpgsql AS $$
DECLARE f record; v_args text; bad text := '';
BEGIN
  FOR f IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.prosecdef AND p.prosrc LIKE '%PERFORM public.cm_gate_assert()%' LOOP
    SELECT coalesce(string_agg('NULL::' || format_type(t, NULL), ','), '') INTO v_args FROM unnest((SELECT proargtypes::oid[] FROM pg_proc WHERE oid=f.oid)) t;
    BEGIN
      EXECUTE format('SELECT public.%I(%s)', f.proname, v_args);
      bad := bad || f.proname || ':no-error ';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'CM_SECTION_LOCKED' THEN bad := bad || f.proname || ':' || SQLERRM || ' '; END IF;
    END;
  END LOOP;
  RETURN bad;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.t_visible_rows() RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE t record; n bigint := 0; c bigint;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace
           WHERE s.nspname='public' AND c.relkind IN ('r','v') AND c.relname LIKE 'cm\_%' AND c.relname <> 'cm_feature_gate'
             AND has_table_privilege('authenticated', c.oid, 'SELECT') LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t.relname) INTO c; n := n + c;
  END LOOP;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.t_actions_locked(), pg_temp.t_visible_rows() TO authenticated;

-- 1) كل الأدوار غير GM مرفوضة في كل مكان
DO $$
DECLARE u text; bad text;
BEGIN
  FOREACH u IN ARRAY ARRAY['a1','b1','c1','d1','e1','f1','a2'] LOOP
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || u, false);
    SET LOCAL ROLE authenticated;
    ASSERT NOT cm_gate_allows(), u || ' gate closed';
    ASSERT pg_temp.t_visible_rows() = 0, u || ' sees zero cm rows (tables + KPI views)';
    ASSERT NOT (cm_is_supervisor() OR cm_is_viewer() OR cm_can_manage() OR cm_can_read_all() OR cm_can_manage_campaigns()
                OR cm_can_listen_recordings() OR cm_can_upload_recordings() OR cm_can_write_spend() OR cm_is_system_or_manager()), u || ' helpers false';
    ASSERT cm_current_moderator_id() IS NULL, u || ' no moderator identity';
    ASSERT cm_customer_for_phone('01000000001') IS NULL, u || ' no phone lookup';
    ASSERT (SELECT count(*) FROM cm_on_shift_moderators(now())) = 0, u || ' no roster';
    bad := pg_temp.t_actions_locked();
    ASSERT bad = '', u || ' actions locked: ' || bad;
    BEGIN INSERT INTO cm_ad_spend_daily (spend_date, amount) VALUES (current_date, 1); ASSERT false, u || ' insert must fail';
    EXCEPTION WHEN insufficient_privilege OR not_null_violation OR undefined_column THEN NULL; END;
    BEGIN PERFORM cm_set_feature_gate('roles'); ASSERT false, u || ' cannot change gate';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN UPDATE cm_feature_gate SET access_mode='roles'; ASSERT false, u || ' no direct update';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    ASSERT (SELECT access_mode FROM cm_feature_gate) = 'general_manager_only', u || ' reads gate mode';
    RESET ROLE;
  END LOOP;
END $$;

-- 2) المدير العام مسموح
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', false);
DO $$ BEGIN
  ASSERT cm_gate_allows(), 'gm allowed';
  ASSERT (SELECT count(*) FROM cm_conversations) > 0, 'gm reads conversations';
  ASSERT cm_is_supervisor() AND cm_can_manage() AND cm_can_write_spend() AND cm_can_listen_recordings(), 'gm helpers';
END $$;
RESET ROLE;

-- 3) الخدمة/الويبهوك تعمل في وضع الإغلاق
SELECT set_config('request.jwt.claim.sub', '', false);
DO $$ BEGIN
  ASSERT cm_gate_allows() AND cm_is_service(), 'service passes gate';
  ASSERT cm_customer_for_phone('01000000009') IS NULL OR true, 'service lookup runs';
  PERFORM cm_gate_assert();
END $$;

-- 4) تغيير البوابة: GM فقط ومُدقَّق؛ وضع roles يعيد المصفوفة القديمة
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', false);
SELECT cm_set_feature_gate('roles');
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT access_mode FROM cm_feature_gate) = 'roles' AND (SELECT updated_by FROM cm_feature_gate) = '00000000-0000-0000-0000-0000000000a3', 'gate changed by gm';
  ASSERT EXISTS (SELECT 1 FROM cm_audit_log WHERE action='feature_gate_changed' AND after->>'access_mode'='roles'
                 AND actor_id='00000000-0000-0000-0000-0000000000a3'), 'gate change audited';
END $$;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
DO $$ BEGIN ASSERT cm_is_supervisor() AND (SELECT count(*) FROM cm_conversations) > 0, 'roles mode: SM back to old matrix'; END $$;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
DO $$ BEGIN ASSERT cm_is_supervisor() AND NOT cm_can_write_spend(), 'roles mode: EM supervisor, spend read-only'; END $$;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', false);
SELECT cm_set_feature_gate('general_manager_only');
RESET ROLE;

-- 5) حارس: كل دالة SECURITY DEFINER ممنوحة لـ authenticated إما مُغلَّفة بالبوابة أو مستثناة صراحةً
DO $$ DECLARE bad text; BEGIN
  SELECT string_agg(p.proname, ', ') INTO bad FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE 'cm\_%' AND p.prosecdef AND p.prorettype <> 'trigger'::regtype
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND p.prosrc NOT LIKE '%cm_gate_%'
    AND p.proname NOT IN ('cm_gate_allows','cm_gate_assert','cm_set_feature_gate','cm_is_service','cm_is_system_or_manager','cm_moderator_id_for_name');
  ASSERT bad IS NULL, 'ungated secdef functions: ' || bad;
END $$;

SELECT 'ALL CM STEP5 SQL TESTS PASSED';
