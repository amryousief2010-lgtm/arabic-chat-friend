-- إدارة المحادثات — الخطوة 5: بوابة وصول رئيسية للقسم كله.
-- الوضع الافتراضي 'general_manager_only': لا أحد غير المدير العام (عمرو) يقرأ أو يكتب أي شيء في cm_*.
-- 'roles' = مصفوفة الصلاحيات السابقة كما هي. التغيير للمدير العام فقط عبر cm_set_feature_gate (مُدقَّق).
-- service_role / الويبهوك / SQL المباشر غير متأثرين (بلا مستخدم). قابل لإعادة التشغيل.
-- ⚠️ أي migration لاحقة تعيد تعريف دالة cm_* يجب أن تأتي قبل هذه أو تعيد تشغيل كتلة التغليف بالأسفل
--    (اختبار cm_step5_test يفشل إذا وُجدت دالة SECURITY DEFINER غير مُغلَّفة).
-- Rollback: UPDATE cm_feature_gate SET access_mode='roles' (يعيد المصفوفة القديمة فوراً)،
--   أو لإزالة كاملة: DROP POLICY cm_gate على جداول cm_* و storage.objects، ثم أعد تطبيق migrations 120000..160000، ثم DROP TABLE cm_feature_gate، DROP FUNCTION cm_gate_allows, cm_gate_assert, cm_set_feature_gate.

CREATE TABLE IF NOT EXISTS public.cm_feature_gate (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  access_mode text NOT NULL DEFAULT 'general_manager_only' CHECK (access_mode IN ('general_manager_only','roles')),
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.cm_feature_gate (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.cm_feature_gate ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cm_gate_read ON public.cm_feature_gate;
CREATE POLICY cm_gate_read ON public.cm_feature_gate FOR SELECT TO authenticated USING (true);  -- الوضع فقط، لتقرر الواجهة الإخفاء
REVOKE ALL ON public.cm_feature_gate FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cm_feature_gate TO authenticated;

-- هل يُسمح للمستدعي بالقسم أصلاً؟ (قبل أي فحص دور)
CREATE OR REPLACE FUNCTION public.cm_gate_allows()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (auth.uid() IS NULL
          AND coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                       nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role')
              NOT IN ('anon','authenticated'))
      OR coalesce((SELECT access_mode FROM public.cm_feature_gate WHERE id), 'general_manager_only') = 'roles'
      OR public.has_any_role(auth.uid(), ARRAY['general_manager']::public.app_role[])
$$;
CREATE OR REPLACE FUNCTION public.cm_gate_assert()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.cm_gate_allows() THEN
    RAISE EXCEPTION 'CM_SECTION_LOCKED' USING ERRCODE = '42501', HINT = 'قسم إدارة المحادثات متاح للمدير العام فقط حالياً';
  END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.cm_set_feature_gate(_mode text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(auth.uid(), ARRAY['general_manager']::public.app_role[]) THEN
    RAISE EXCEPTION 'CM_GM_ONLY' USING ERRCODE = '42501';
  END IF;
  IF _mode NOT IN ('general_manager_only','roles') THEN RAISE EXCEPTION 'CM_BAD_MODE' USING ERRCODE = '22023'; END IF;
  SELECT access_mode INTO v_old FROM public.cm_feature_gate WHERE id FOR UPDATE;
  IF v_old IS DISTINCT FROM _mode THEN
    UPDATE public.cm_feature_gate SET access_mode = _mode, updated_by = auth.uid(), updated_at = now() WHERE id;
    INSERT INTO public.cm_audit_log (actor_id, action, entity, entity_id, before, after)
    VALUES (auth.uid(), 'feature_gate_changed', 'cm_feature_gate', 'singleton',
            jsonb_build_object('access_mode', v_old), jsonb_build_object('access_mode', _mode));
  END IF;
  RETURN _mode;
END $$;

-- (4) الإنفاق: الكتابة MSM/SM/GM فقط — EM عرض فقط
CREATE OR REPLACE FUNCTION public.cm_can_write_spend()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(auth.uid(), ARRAY['marketing_sales_manager','sales_manager','general_manager']::public.app_role[])
$$;

-- تغليف الدوال: (أ) مساعدات الأدوار ⇒ false/NULL عند الإغلاق (فتصبح كل سياسات RLS والدوال المعتمدة عليها مغلقة)،
-- (ب) دوال الإجراءات ⇒ خطأ CM_SECTION_LOCKED، (ج) أدوات الحساب المكشوفة ⇒ NULL.
-- مستثنى عمداً: cm_is_service / cm_is_system_or_manager (مسار الخدمة؛ والثانية تمر عبر cm_can_manage المُغلَّفة)،
-- cm_moderator_id_for_name (يستدعيه trigger جدول orders للتطبيق الأساسي)، cm_ingest_whatsapp_message و cm_attach_recording (غير ممنوحتين للمستخدمين)، والـ triggers.
DO $gate$
DECLARE f record; v_src text; v_new text; v_def text;
  bool_helpers text[] := ARRAY['cm_is_supervisor','cm_is_viewer','cm_can_manage','cm_can_read_all','cm_can_see_conversation',
    'cm_can_manage_campaigns','cm_can_listen_recordings','cm_can_upload_recordings','cm_can_write_spend','cm_moderator_available','cm_order_matches_phone'];
  scalar_sql text[] := ARRAY['cm_current_moderator_id','cm_customer_for_phone','cm_campaign_moderator_on','cm_line_owner_on'];
  setof_sql text[] := ARRAY['cm_on_shift_moderators'];
  actions text[] := ARRAY['cm_attribute_conversation','cm_begin_recording_upload','cm_complete_recording_upload','cm_import_hotline_cdr',
    'cm_link_conversation_order','cm_mark_missed_call_followed_up','cm_merge_customers','cm_undo_merge','cm_reassign_conversation',
    'cm_set_cover','cm_request_recording_access','cm_sync_customer_phones','cm_upsert_ad_spend','cm_ingest_call_recording',
    'cm_distribute_conversation','cm_evaluate_first_reply'];
  soft_plpgsql text[] := ARRAY['cm_clock_start','cm_service_minutes','cm_first_reply_kpi_status'];
BEGIN
  FOR f IN SELECT p.oid, p.proname, p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = ANY (bool_helpers || scalar_sql || setof_sql || actions || soft_plpgsql) LOOP
    v_src := f.prosrc;
    CONTINUE WHEN v_src LIKE '%cm_gate_%';
    v_src := regexp_replace(v_src, ';\s*$', '');
    IF f.proname = ANY (bool_helpers) THEN
      v_new := E'\n  SELECT public.cm_gate_allows() AND coalesce((' || v_src || E'\n  ), false)\n';
    ELSIF f.proname = ANY (scalar_sql) THEN
      v_new := E'\n  SELECT CASE WHEN public.cm_gate_allows() THEN (' || v_src || E'\n  ) END\n';
    ELSIF f.proname = ANY (setof_sql) THEN
      v_new := E'\n  SELECT q.* FROM (' || v_src || E'\n  ) q WHERE public.cm_gate_allows()\n';
    ELSIF f.proname = ANY (actions) THEN
      v_new := regexp_replace(f.prosrc, '\mBEGIN\M', E'BEGIN\n  PERFORM public.cm_gate_assert();  -- بوابة القسم', 'i');
    ELSE
      v_new := regexp_replace(f.prosrc, '\mBEGIN\M', E'BEGIN\n  IF NOT public.cm_gate_allows() THEN RETURN NULL; END IF;  -- بوابة القسم', 'i');
    END IF;
    v_def := pg_get_functiondef(f.oid);
    v_def := replace(v_def, f.prosrc, v_new);
    EXECUTE v_def;
  END LOOP;
END $gate$;

-- سياسة RESTRICTIVE على كل جداول cm_* (تغطي السياسات التي تفحص الأدوار مباشرة مثل cm_audit_log و cm_recording_access_log)
DO $pol$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.oid::regclass AS rel FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relname LIKE 'cm\_%' AND c.relname <> 'cm_feature_gate' AND c.relrowsecurity LOOP
    EXECUTE format('DROP POLICY IF EXISTS cm_gate ON %s', t.rel);
    EXECUTE format('CREATE POLICY cm_gate ON %s AS RESTRICTIVE FOR ALL TO authenticated USING (public.cm_gate_allows()) WITH CHECK (public.cm_gate_allows())', t.rel);
  END LOOP;
END $pol$;
DROP POLICY IF EXISTS cm_gate_recordings ON storage.objects;
CREATE POLICY cm_gate_recordings ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
  USING (bucket_id IS DISTINCT FROM 'cm-call-recordings' OR public.cm_gate_allows())
  WITH CHECK (bucket_id IS DISTINCT FROM 'cm-call-recordings' OR public.cm_gate_allows());

-- عروض cm_* (security_invoker) تقرأ أيضاً من orders مباشرة ⇒ تُغلَّف كلها بشرط البوابة
DO $views$
DECLARE v record; v_def text;
BEGIN
  FOR v IN SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname LIKE 'cm\_%' LOOP
    v_def := pg_get_viewdef(v.oid);
    CONTINUE WHEN v_def LIKE '%cm_gate_allows%';
    EXECUTE format('CREATE OR REPLACE VIEW public.%I WITH (security_invoker = true) AS SELECT q.* FROM (%s) q WHERE public.cm_gate_allows()',
                   v.relname, regexp_replace(v_def, ';\s*$', ''));
  END LOOP;
END $views$;

REVOKE ALL ON FUNCTION public.cm_gate_allows(), public.cm_gate_assert(), public.cm_set_feature_gate(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_gate_allows(), public.cm_gate_assert(), public.cm_set_feature_gate(text) TO authenticated, service_role;
