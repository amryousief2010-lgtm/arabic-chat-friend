-- وحدة «إدارة المحادثات» — الخطوة 1: المودريتورز، الأسماء البديلة، الشيفتات والأجازات،
-- الخطوط، إعدادات التوزيع والمؤشرات والاحتفاظ، المراجعة المتبادلة، سجل التدقيق،
-- وعمود orders.moderator_id.
-- إضافة فقط وقابل لإعادة التشغيل. لا يحذف ولا يعدّل أي سياسة قائمة على orders/order_items.
-- التراجع: DROP TRIGGER trg_cm_orders_moderator_id ON public.orders;
--          ALTER TABLE public.orders DROP COLUMN moderator_id;  ثم DROP TABLE public.cm_* CASCADE;
--          ثم DROP FUNCTION public.cm_*.

-- ───────────── الكيانات ─────────────
CREATE TABLE IF NOT EXISTS public.cm_moderators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  canonical_name text NOT NULL UNIQUE,
  payroll_key text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  chat_active boolean NOT NULL DEFAULT true,
  start_date date,
  end_date date,
  sort_order int NOT NULL DEFAULT 100,
  max_open_conversations int NOT NULL DEFAULT 40 CHECK (max_open_conversations > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cm_moderators_active_idx ON public.cm_moderators (is_active);

CREATE TABLE IF NOT EXISTS public.cm_moderator_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  moderator_id uuid NOT NULL REFERENCES public.cm_moderators(id) ON DELETE CASCADE,
  alias text NOT NULL,
  alias_norm text GENERATED ALWAYS AS (public.normalize_ar_name(alias)) STORED,
  valid_from date,
  valid_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cm_moderator_aliases_norm_uniq ON public.cm_moderator_aliases (alias_norm);

-- ───────────── الشيفتات ─────────────
-- نمط اليوم: four_shift (السبت/الأحد/الاثنين) أو three_shift (الثلاثاء–الجمعة). dow حسب Postgres: 0=الأحد … 6=السبت.
CREATE TABLE IF NOT EXISTS public.cm_weekday_patterns (
  dow smallint PRIMARY KEY CHECK (dow BETWEEN 0 AND 6),
  day_pattern text NOT NULL CHECK (day_pattern IN ('four_shift','three_shift')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cm_shift_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_pattern text NOT NULL CHECK (day_pattern IN ('four_shift','three_shift')),
  slot_no smallint NOT NULL CHECK (slot_no BETWEEN 1 AND 6),
  label text NOT NULL,
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (day_pattern, slot_no)
);

CREATE TABLE IF NOT EXISTS public.cm_weekly_days_off (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  moderator_id uuid NOT NULL REFERENCES public.cm_moderators(id) ON DELETE CASCADE,
  dow smallint NOT NULL CHECK (dow BETWEEN 0 AND 6),
  valid_from date NOT NULL DEFAULT current_date,
  valid_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cm_weekly_days_off_current_uniq
  ON public.cm_weekly_days_off (moderator_id) WHERE valid_to IS NULL;

CREATE TABLE IF NOT EXISTS public.cm_roster_days (
  work_date date PRIMARY KEY,
  day_pattern text NOT NULL CHECK (day_pattern IN ('four_shift','three_shift')),
  notes text,
  generated_at timestamptz,
  generated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- الأوقات منسوخة من القالب لحظة التوليد حتى لا يغيّر تعديل القالب الأيام السابقة.
CREATE TABLE IF NOT EXISTS public.cm_shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date date NOT NULL REFERENCES public.cm_roster_days(work_date) ON DELETE CASCADE,
  slot_no smallint NOT NULL CHECK (slot_no BETWEEN 1 AND 6),
  label text NOT NULL,
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  moderator_id uuid REFERENCES public.cm_moderators(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'generated' CHECK (source IN ('generated','manual','seed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_date, slot_no)
);
CREATE INDEX IF NOT EXISTS cm_shift_assignments_mod_idx ON public.cm_shift_assignments (moderator_id, work_date);

-- ───────────── القنوات والخطوط ─────────────
CREATE TABLE IF NOT EXISTS public.cm_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL UNIQUE CHECK (kind IN ('whatsapp','messenger','instagram','hotline')),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- لا أرقام في البذور. connection_status يبقى not_connected؛ ولا يوجد أي ربط بميتا في هذه الخطوة.
CREATE TABLE IF NOT EXISTS public.cm_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.cm_channels(id),
  label text NOT NULL UNIQUE,
  phone_raw text,
  phone_norm text,
  external_id text,
  mode text NOT NULL DEFAULT 'app_only' CHECK (mode IN ('coexistence','api','app_only','hotline')),
  owner_moderator_id uuid REFERENCES public.cm_moderators(id) ON DELETE SET NULL,
  is_api_line boolean NOT NULL DEFAULT false,
  meta_registered boolean NOT NULL DEFAULT false,
  connection_status text NOT NULL DEFAULT 'not_connected'
    CHECK (connection_status IN ('not_connected','pending','connected','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cm_lines_phone_uniq ON public.cm_lines (channel_id, phone_norm) WHERE phone_norm IS NOT NULL;

-- ───────────── الإعدادات (صف واحد لكل جدول) ─────────────
CREATE TABLE IF NOT EXISTS public.cm_distribution_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  method text NOT NULL DEFAULT 'campaign' CHECK (method IN ('round_robin','load','campaign')),
  fallback_method text NOT NULL DEFAULT 'load' CHECK (fallback_method IN ('round_robin','load','none')),
  rotation_offset int NOT NULL DEFAULT 0,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cm_kpi_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  timezone text NOT NULL DEFAULT 'Africa/Cairo',
  service_window_start time NOT NULL DEFAULT '09:00',
  service_window_end time NOT NULL DEFAULT '01:00',
  abandoned_minutes int NOT NULL DEFAULT 30 CHECK (abandoned_minutes > 0),
  first_reply_target_on_shift_min int NOT NULL DEFAULT 15 CHECK (first_reply_target_on_shift_min > 0),
  first_reply_target_off_shift_min int NOT NULL DEFAULT 60 CHECK (first_reply_target_off_shift_min > 0),
  missed_call_followup_min int NOT NULL DEFAULT 60,
  conversion_window_days int NOT NULL DEFAULT 7,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cm_retention_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  message_text_days int NOT NULL DEFAULT 730,
  media_days int NOT NULL DEFAULT 365,
  recording_days int NOT NULL DEFAULT 180,
  recording_listener_roles text[] NOT NULL DEFAULT ARRAY['general_manager','executive_manager','sales_manager'],
  log_every_listen boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- قرارات معلّقة مخزّنة كإعدادات (لا تُطبَّق آلياً في هذه الخطوة).
CREATE TABLE IF NOT EXISTS public.cm_governance_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  bonus_proposer_role text NOT NULL DEFAULT 'sales_manager',
  bonus_approver_role text NOT NULL DEFAULT 'general_manager',
  automatic_deduction boolean NOT NULL DEFAULT false,
  campaign_stop_proposer_role text NOT NULL DEFAULT 'marketing_sales_manager',
  campaign_stop_approver_role text NOT NULL DEFAULT 'executive_manager',
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cm_peer_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_moderator_id uuid NOT NULL REFERENCES public.cm_moderators(id) ON DELETE CASCADE,
  reviewee_moderator_id uuid NOT NULL REFERENCES public.cm_moderators(id) ON DELETE CASCADE,
  valid_from date NOT NULL DEFAULT current_date,
  valid_to date,
  source_policy text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reviewer_moderator_id <> reviewee_moderator_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS cm_peer_review_current_uniq
  ON public.cm_peer_review (reviewer_moderator_id, reviewee_moderator_id) WHERE valid_to IS NULL;

CREATE TABLE IF NOT EXISTS public.cm_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  before jsonb,
  after jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cm_audit_log_entity_idx ON public.cm_audit_log (entity, at DESC);

-- ───────────── الدوال المساعدة ─────────────
CREATE OR REPLACE FUNCTION public.cm_current_moderator_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.cm_moderators WHERE user_id = auth.uid() AND is_active LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.cm_is_supervisor()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(auth.uid(),
    ARRAY['sales_manager','marketing_sales_manager','executive_manager','general_manager']::app_role[])
$$;

CREATE OR REPLACE FUNCTION public.cm_is_viewer()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(auth.uid(),
    ARRAY['marketing_sales_viewer','social_media_manager']::app_role[])
$$;

-- من يعدّل الشيفتات والإعدادات: مديرة المبيعات، والمدير العام كصاحب النظام.
CREATE OR REPLACE FUNCTION public.cm_can_manage()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(auth.uid(), ARRAY['sales_manager','general_manager']::app_role[])
$$;

CREATE OR REPLACE FUNCTION public.cm_can_read_all()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.cm_is_supervisor() OR public.cm_is_viewer()
$$;

-- ربط اسم نصي بمودريتور (مطابقة تامة بعد التطبيع فقط؛ لا تخمين).
CREATE OR REPLACE FUNCTION public.cm_moderator_id_for_name(_name text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.moderator_id FROM public.cm_moderator_aliases a
  WHERE _name IS NOT NULL AND btrim(_name) <> ''
    AND a.alias_norm = public.normalize_ar_name(btrim(_name))
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.cm_current_moderator_id(), public.cm_is_supervisor(), public.cm_is_viewer(),
  public.cm_can_manage(), public.cm_can_read_all(), public.cm_moderator_id_for_name(text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.cm_current_moderator_id(), public.cm_is_supervisor(), public.cm_is_viewer(),
      public.cm_can_manage(), public.cm_can_read_all(), public.cm_moderator_id_for_name(text) TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.cm_current_moderator_id(), public.cm_is_supervisor(), public.cm_is_viewer(),
      public.cm_can_manage(), public.cm_can_read_all(), public.cm_moderator_id_for_name(text) TO service_role;
  END IF;
END $$;

-- ───────────── updated_at + التدقيق ─────────────
CREATE OR REPLACE FUNCTION public.cm_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION public.cm_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id text;
BEGIN
  v_id := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END
          ->> CASE WHEN TG_TABLE_NAME IN ('cm_roster_days') THEN 'work_date'
                   WHEN TG_TABLE_NAME IN ('cm_weekday_patterns') THEN 'dow' ELSE 'id' END;
  INSERT INTO public.cm_audit_log (actor_id, action, entity, entity_id, before, after)
  VALUES (auth.uid(), lower(TG_OP), TG_TABLE_NAME, v_id,
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
  RETURN COALESCE(NEW, OLD);
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cm_moderators','cm_moderator_aliases','cm_weekday_patterns','cm_shift_templates',
    'cm_weekly_days_off','cm_roster_days','cm_shift_assignments','cm_channels','cm_lines',
    'cm_distribution_settings','cm_kpi_settings','cm_retention_settings','cm_governance_settings','cm_peer_review']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_touch ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_touch BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.cm_touch_updated_at()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.cm_audit()', t);
  END LOOP;
END $$;

-- ───────────── RLS ─────────────
-- بدون FORCE: الدوال SECURITY DEFINER (مالكها postgres) تقرأ cm_moderators وتكتب cm_audit_log
-- دون أن تمر بسياسات تستدعي نفسها (تجنّب التكرار اللانهائي). المستخدمون authenticated يخضعون للـ RLS دائماً.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cm_moderators','cm_moderator_aliases','cm_weekday_patterns','cm_shift_templates',
    'cm_weekly_days_off','cm_roster_days','cm_shift_assignments','cm_channels','cm_lines',
    'cm_distribution_settings','cm_kpi_settings','cm_retention_settings','cm_governance_settings',
    'cm_peer_review','cm_audit_log']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- الجداول العامة (قوالب، أنماط، قنوات، إعدادات): يقرأها كل من له علاقة بالوحدة، ويعدّلها المدير فقط.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cm_weekday_patterns','cm_shift_templates','cm_roster_days','cm_channels',
    'cm_distribution_settings','cm_kpi_settings','cm_retention_settings','cm_governance_settings']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS cm_read ON public.%I', t);
    EXECUTE format($p$CREATE POLICY cm_read ON public.%I FOR SELECT TO authenticated
      USING ((SELECT public.cm_can_read_all()) OR (SELECT public.cm_current_moderator_id()) IS NOT NULL)$p$, t);
    EXECUTE format('DROP POLICY IF EXISTS cm_write ON public.%I', t);
    EXECUTE format($p$CREATE POLICY cm_write ON public.%I FOR ALL TO authenticated
      USING ((SELECT public.cm_can_manage())) WITH CHECK ((SELECT public.cm_can_manage()))$p$, t);
  END LOOP;
END $$;

-- جداول تخص مودريتور بعينها: المودريتور تقرأ ما يخصها فقط.
DROP POLICY IF EXISTS cm_read ON public.cm_moderators;
CREATE POLICY cm_read ON public.cm_moderators FOR SELECT TO authenticated
  USING ((SELECT public.cm_can_read_all()) OR id = (SELECT public.cm_current_moderator_id()));
DROP POLICY IF EXISTS cm_write ON public.cm_moderators;
CREATE POLICY cm_write ON public.cm_moderators FOR ALL TO authenticated
  USING ((SELECT public.cm_can_manage())) WITH CHECK ((SELECT public.cm_can_manage()));

DROP POLICY IF EXISTS cm_read ON public.cm_moderator_aliases;
CREATE POLICY cm_read ON public.cm_moderator_aliases FOR SELECT TO authenticated
  USING ((SELECT public.cm_can_read_all()) OR moderator_id = (SELECT public.cm_current_moderator_id()));
DROP POLICY IF EXISTS cm_write ON public.cm_moderator_aliases;
CREATE POLICY cm_write ON public.cm_moderator_aliases FOR ALL TO authenticated
  USING ((SELECT public.cm_can_manage())) WITH CHECK ((SELECT public.cm_can_manage()));

DROP POLICY IF EXISTS cm_read ON public.cm_weekly_days_off;
CREATE POLICY cm_read ON public.cm_weekly_days_off FOR SELECT TO authenticated
  USING ((SELECT public.cm_can_read_all()) OR moderator_id = (SELECT public.cm_current_moderator_id()));
DROP POLICY IF EXISTS cm_write ON public.cm_weekly_days_off;
CREATE POLICY cm_write ON public.cm_weekly_days_off FOR ALL TO authenticated
  USING ((SELECT public.cm_can_manage())) WITH CHECK ((SELECT public.cm_can_manage()));

DROP POLICY IF EXISTS cm_read ON public.cm_shift_assignments;
CREATE POLICY cm_read ON public.cm_shift_assignments FOR SELECT TO authenticated
  USING ((SELECT public.cm_can_read_all()) OR moderator_id = (SELECT public.cm_current_moderator_id()));
DROP POLICY IF EXISTS cm_write ON public.cm_shift_assignments;
CREATE POLICY cm_write ON public.cm_shift_assignments FOR ALL TO authenticated
  USING ((SELECT public.cm_can_manage())) WITH CHECK ((SELECT public.cm_can_manage()));

DROP POLICY IF EXISTS cm_read ON public.cm_lines;
CREATE POLICY cm_read ON public.cm_lines FOR SELECT TO authenticated
  USING ((SELECT public.cm_can_read_all()) OR owner_moderator_id = (SELECT public.cm_current_moderator_id()));
DROP POLICY IF EXISTS cm_write ON public.cm_lines;
CREATE POLICY cm_write ON public.cm_lines FOR ALL TO authenticated
  USING ((SELECT public.cm_can_manage())) WITH CHECK ((SELECT public.cm_can_manage()));

DROP POLICY IF EXISTS cm_read ON public.cm_peer_review;
CREATE POLICY cm_read ON public.cm_peer_review FOR SELECT TO authenticated
  USING ((SELECT public.cm_can_read_all())
         OR reviewer_moderator_id = (SELECT public.cm_current_moderator_id())
         OR reviewee_moderator_id = (SELECT public.cm_current_moderator_id()));
DROP POLICY IF EXISTS cm_write ON public.cm_peer_review;
CREATE POLICY cm_write ON public.cm_peer_review FOR ALL TO authenticated
  USING ((SELECT public.cm_can_manage())) WITH CHECK ((SELECT public.cm_can_manage()));

-- سجل التدقيق: قراءة فقط لمديرة المبيعات والمدير التنفيذي والمدير العام. الكتابة بالـ trigger فقط.
DROP POLICY IF EXISTS cm_read ON public.cm_audit_log;
CREATE POLICY cm_read ON public.cm_audit_log FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role(auth.uid(), ARRAY['sales_manager','executive_manager','general_manager']::app_role[])));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.cm_moderators, public.cm_moderator_aliases,
      public.cm_weekday_patterns, public.cm_shift_templates, public.cm_weekly_days_off, public.cm_roster_days,
      public.cm_shift_assignments, public.cm_channels, public.cm_lines, public.cm_distribution_settings,
      public.cm_kpi_settings, public.cm_retention_settings, public.cm_governance_settings, public.cm_peer_review
      TO authenticated;
    GRANT SELECT ON public.cm_audit_log TO authenticated;
    REVOKE INSERT, UPDATE, DELETE ON public.cm_audit_log FROM authenticated;
  END IF;
END $$;

-- ───────────── orders.moderator_id ─────────────
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS moderator_id uuid REFERENCES public.cm_moderators(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS orders_moderator_id_idx ON public.orders (moderator_id);

CREATE OR REPLACE FUNCTION public.cm_orders_set_moderator_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.moderator IS DISTINCT FROM OLD.moderator THEN
    NEW.moderator_id := public.cm_moderator_id_for_name(NEW.moderator);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_cm_orders_moderator_id ON public.orders;
CREATE TRIGGER trg_cm_orders_moderator_id BEFORE INSERT OR UPDATE OF moderator ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.cm_orders_set_moderator_id();

-- طلبات بلا ربط بعد الملء: تُراجع يدوياً، لا تخمين.
CREATE OR REPLACE VIEW public.cm_v_unmatched_order_moderators WITH (security_invoker = true) AS
SELECT o.moderator AS moderator_text, count(*) AS orders_count
FROM public.orders o
WHERE o.moderator_id IS NULL AND o.moderator IS NOT NULL AND btrim(o.moderator) <> ''
GROUP BY o.moderator;

-- ───────────── تقوية: لا شيء من cm_* متاح لـ anon ─────────────
-- Supabase يمنح anon صلاحيات افتراضية على كل دالة/جدول جديد في public؛ REVOKE FROM PUBLIC وحده لا يكفي.
DO $cm_harden$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname LIKE 'cm\_%' AND p.prosecdef LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    FOR r IN SELECT c.oid::regclass AS rel FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind IN ('r','v','p') AND c.relname LIKE 'cm\_%' LOOP
      EXECUTE format('REVOKE ALL ON %s FROM anon', r.rel);
    END LOOP;
  END IF;
END $cm_harden$;
