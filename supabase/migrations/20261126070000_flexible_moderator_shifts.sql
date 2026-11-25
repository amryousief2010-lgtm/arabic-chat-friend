-- جدول الشيفتات المرن: عدد مفتوح من الشيفتات والأوقات والمودريتورز لكل شيفت،
-- مع صلاحيات التعديل (المدير العام + المدير التنفيذي + مديرة المبيعات) والقراءة للمودريتورز.
-- إضافة وتعديل متوافق مع كل المستهلكين الحاليين (cm_shift_assignments, cm_on_shift_moderators, KPIs).
-- Rollback notes:
--   1. DROP FUNCTION IF EXISTS public.cm_get_week_schedule(date, date);
--   2. DROP TRIGGER IF EXISTS trg_cm_day_shifts_sync_assignments ON public.cm_day_shifts;
--   3. DROP TRIGGER IF EXISTS trg_cm_shift_assignments_ensure_day_shift ON public.cm_shift_assignments;
--   4. DROP FUNCTION IF EXISTS public.cm_sync_day_shift_assignments();
--   5. DROP FUNCTION IF EXISTS public.cm_shift_assignments_ensure_day_shift();
--   6. ALTER TABLE public.cm_shift_assignments DROP COLUMN IF EXISTS day_shift_id;
--   7. DROP TABLE IF EXISTS public.cm_day_shifts CASCADE;
--   8. ALTER TABLE public.cm_shift_templates DROP COLUMN IF EXISTS staff_count;
--   9. DROP TABLE IF EXISTS public.cm_shift_patterns CASCADE;
--  10. DROP FUNCTION IF EXISTS public.cm_can_manage_shifts();

BEGIN;

-- ───────────── 1) دالة صلاحية تعديل الشيفتات (GM + Exec + Sales Manager) ─────────────
CREATE OR REPLACE FUNCTION public.cm_can_manage_shifts()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.cm_gate_allows() AND coalesce(
    public.has_any_role(auth.uid(), ARRAY['sales_manager','executive_manager','general_manager']::public.app_role[]),
    false
  )
$$;

REVOKE ALL ON FUNCTION public.cm_can_manage_shifts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_can_manage_shifts() TO authenticated, service_role;

-- ───────────── 2) أنماط قوالب الشيفتات (مرنة وقابلة للإضافة والتعديل) ─────────────
CREATE TABLE IF NOT EXISTS public.cm_shift_patterns (
  key text PRIMARY KEY,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.cm_shift_patterns (key, name, sort_order) VALUES
  ('four_shift', 'نمط الأيام المزدحمة', 1),
  ('three_shift', 'نمط الأيام العادية', 2)
ON CONFLICT (key) DO NOTHING;

-- تحديث دالة التدقيق لتدعم cm_shift_patterns (المفتاح الأساسي key) و cm_day_shifts (id)
CREATE OR REPLACE FUNCTION public.cm_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id text;
BEGIN
  v_id := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END
          ->> CASE WHEN TG_TABLE_NAME IN ('cm_roster_days') THEN 'work_date'
                   WHEN TG_TABLE_NAME IN ('cm_weekday_patterns') THEN 'dow'
                   WHEN TG_TABLE_NAME IN ('cm_shift_patterns') THEN 'key'
                   ELSE 'id' END;
  INSERT INTO public.cm_audit_log (actor_id, action, entity, entity_id, before, after)
  VALUES (auth.uid(), lower(TG_OP), TG_TABLE_NAME, v_id,
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_cm_shift_patterns_touch ON public.cm_shift_patterns;
CREATE TRIGGER trg_cm_shift_patterns_touch
  BEFORE UPDATE ON public.cm_shift_patterns
  FOR EACH ROW EXECUTE FUNCTION public.cm_touch_updated_at();

DROP TRIGGER IF EXISTS trg_cm_shift_patterns_audit ON public.cm_shift_patterns;
CREATE TRIGGER trg_cm_shift_patterns_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.cm_shift_patterns
  FOR EACH ROW EXECUTE FUNCTION public.cm_audit();

ALTER TABLE public.cm_shift_patterns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cm_read ON public.cm_shift_patterns;
CREATE POLICY cm_read ON public.cm_shift_patterns FOR SELECT TO authenticated
  USING ((SELECT public.cm_can_read_all()) OR (SELECT public.cm_current_moderator_id()) IS NOT NULL);

DROP POLICY IF EXISTS cm_write ON public.cm_shift_patterns;
CREATE POLICY cm_write ON public.cm_shift_patterns FOR ALL TO authenticated
  USING ((SELECT public.cm_can_manage_shifts()))
  WITH CHECK ((SELECT public.cm_can_manage_shifts()));

DROP POLICY IF EXISTS cm_gate ON public.cm_shift_patterns;
CREATE POLICY cm_gate ON public.cm_shift_patterns AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.cm_gate_allows())
  WITH CHECK (public.cm_gate_allows());

REVOKE ALL ON public.cm_shift_patterns FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cm_shift_patterns TO authenticated;

-- ───────────── 3) فتح قيود القوالب وأيام الأسبوع والأيام المسجلة ─────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conrelid::regclass::text AS tbl, conname
    FROM pg_constraint
    WHERE conrelid IN (
      'public.cm_shift_templates'::regclass,
      'public.cm_weekday_patterns'::regclass,
      'public.cm_roster_days'::regclass,
      'public.cm_shift_assignments'::regclass
    )
      AND contype = 'c'
      AND (
        pg_get_constraintdef(oid) LIKE '%four_shift%'
        OR pg_get_constraintdef(oid) LIKE '%slot_no%'
      )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
  END LOOP;
END $$;

ALTER TABLE public.cm_shift_templates
  ADD COLUMN IF NOT EXISTS staff_count smallint NOT NULL DEFAULT 1;

ALTER TABLE public.cm_shift_templates
  DROP CONSTRAINT IF EXISTS cm_shift_templates_slot_no_check,
  ADD CONSTRAINT cm_shift_templates_slot_no_check CHECK (slot_no >= 1),
  DROP CONSTRAINT IF EXISTS cm_shift_templates_staff_count_check,
  ADD CONSTRAINT cm_shift_templates_staff_count_check CHECK (staff_count >= 1 AND staff_count <= 20),
  DROP CONSTRAINT IF EXISTS cm_shift_templates_time_diff_check,
  ADD CONSTRAINT cm_shift_templates_time_diff_check CHECK (starts_at <> ends_at);

-- ضمان وجود كل الأنماط المستخدمة في cm_shift_patterns قبل ربط المفتاح الأجنبي
INSERT INTO public.cm_shift_patterns (key, name, sort_order)
SELECT DISTINCT day_pattern, day_pattern, 50
FROM (
  SELECT day_pattern FROM public.cm_shift_templates
  UNION
  SELECT day_pattern FROM public.cm_weekday_patterns
) x
WHERE day_pattern IS NOT NULL
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.cm_shift_templates
  DROP CONSTRAINT IF EXISTS cm_shift_templates_day_pattern_fkey,
  ADD CONSTRAINT cm_shift_templates_day_pattern_fkey
    FOREIGN KEY (day_pattern) REFERENCES public.cm_shift_patterns(key) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.cm_weekday_patterns
  DROP CONSTRAINT IF EXISTS cm_weekday_patterns_day_pattern_fkey,
  ADD CONSTRAINT cm_weekday_patterns_day_pattern_fkey
    FOREIGN KEY (day_pattern) REFERENCES public.cm_shift_patterns(key) ON UPDATE CASCADE;

ALTER TABLE public.cm_roster_days
  ALTER COLUMN day_pattern SET DEFAULT 'custom';

-- ───────────── 4) جدول شيفتات اليوم (يدعم عدداً مفتوحاً من الشيفتات وموظفات متعددات) ─────────────
CREATE TABLE IF NOT EXISTS public.cm_day_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date date NOT NULL REFERENCES public.cm_roster_days(work_date) ON DELETE CASCADE,
  sort_order smallint NOT NULL DEFAULT 1 CHECK (sort_order >= 1),
  label text NOT NULL,
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  staff_count smallint NOT NULL DEFAULT 1 CHECK (staff_count >= 1 AND staff_count <= 20),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('generated','manual','seed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at <> ends_at)
);

CREATE INDEX IF NOT EXISTS cm_day_shifts_date_idx ON public.cm_day_shifts (work_date, sort_order);

DROP TRIGGER IF EXISTS trg_cm_day_shifts_touch ON public.cm_day_shifts;
CREATE TRIGGER trg_cm_day_shifts_touch
  BEFORE UPDATE ON public.cm_day_shifts
  FOR EACH ROW EXECUTE FUNCTION public.cm_touch_updated_at();

DROP TRIGGER IF EXISTS trg_cm_day_shifts_audit ON public.cm_day_shifts;
CREATE TRIGGER trg_cm_day_shifts_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.cm_day_shifts
  FOR EACH ROW EXECUTE FUNCTION public.cm_audit();

ALTER TABLE public.cm_day_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cm_read ON public.cm_day_shifts;
CREATE POLICY cm_read ON public.cm_day_shifts FOR SELECT TO authenticated
  USING ((SELECT public.cm_can_read_all()) OR (SELECT public.cm_current_moderator_id()) IS NOT NULL);

DROP POLICY IF EXISTS cm_write ON public.cm_day_shifts;
CREATE POLICY cm_write ON public.cm_day_shifts FOR ALL TO authenticated
  USING ((SELECT public.cm_can_manage_shifts()))
  WITH CHECK ((SELECT public.cm_can_manage_shifts()));

DROP POLICY IF EXISTS cm_gate ON public.cm_day_shifts;
CREATE POLICY cm_gate ON public.cm_day_shifts AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.cm_gate_allows())
  WITH CHECK (public.cm_gate_allows());

REVOKE ALL ON public.cm_day_shifts FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cm_day_shifts TO authenticated;

-- ───────────── 5) تحديث cm_shift_assignments والربط مع cm_day_shifts دون كسر أي مستهلك ─────────────
ALTER TABLE public.cm_shift_assignments
  DROP CONSTRAINT IF EXISTS cm_shift_assignments_work_date_slot_no_key,
  DROP CONSTRAINT IF EXISTS cm_shift_assignments_slot_no_check,
  ADD CONSTRAINT cm_shift_assignments_slot_no_check CHECK (slot_no >= 1),
  ADD COLUMN IF NOT EXISTS day_shift_id uuid REFERENCES public.cm_day_shifts(id) ON DELETE CASCADE;

-- ملء cm_day_shifts من البيانات القائمة في cm_shift_assignments (آمن للتكرار)
INSERT INTO public.cm_day_shifts (work_date, sort_order, label, starts_at, ends_at, staff_count, source)
SELECT DISTINCT ON (a.work_date, a.slot_no)
  a.work_date, a.slot_no, a.label, a.starts_at, a.ends_at, 1, a.source
FROM public.cm_shift_assignments a
WHERE a.day_shift_id IS NULL
  AND a.starts_at <> a.ends_at
  AND NOT EXISTS (
    SELECT 1 FROM public.cm_day_shifts ds
    WHERE ds.work_date = a.work_date AND ds.sort_order = a.slot_no
  )
ORDER BY a.work_date, a.slot_no, a.created_at;

UPDATE public.cm_shift_assignments a
SET day_shift_id = ds.id
FROM public.cm_day_shifts ds
WHERE a.day_shift_id IS NULL
  AND ds.work_date = a.work_date
  AND ds.sort_order = a.slot_no;

CREATE UNIQUE INDEX IF NOT EXISTS cm_shift_assignments_shift_mod_uniq
  ON public.cm_shift_assignments (day_shift_id, moderator_id)
  WHERE day_shift_id IS NOT NULL AND moderator_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cm_shift_assignments_date_idx
  ON public.cm_shift_assignments (work_date);

CREATE INDEX IF NOT EXISTS cm_shift_assignments_day_shift_idx
  ON public.cm_shift_assignments (day_shift_id);

-- مزامنة أي تعديل على cm_day_shifts مع صفوف cm_shift_assignments التابعة له
CREATE OR REPLACE FUNCTION public.cm_sync_day_shift_assignments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.cm_shift_assignments
  SET work_date = NEW.work_date,
      slot_no = NEW.sort_order,
      label = NEW.label,
      starts_at = NEW.starts_at,
      ends_at = NEW.ends_at
  WHERE day_shift_id = NEW.id
    AND (work_date IS DISTINCT FROM NEW.work_date
      OR slot_no IS DISTINCT FROM NEW.sort_order
      OR label IS DISTINCT FROM NEW.label
      OR starts_at IS DISTINCT FROM NEW.starts_at
      OR ends_at IS DISTINCT FROM NEW.ends_at);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cm_day_shifts_sync_assignments ON public.cm_day_shifts;
CREATE TRIGGER trg_cm_day_shifts_sync_assignments
  AFTER UPDATE OF work_date, sort_order, label, starts_at, ends_at ON public.cm_day_shifts
  FOR EACH ROW EXECUTE FUNCTION public.cm_sync_day_shift_assignments();

-- توافق عكسي: أي إدراج قديم في cm_shift_assignments بدون day_shift_id ينشئ أو يربط cm_day_shifts تلقائياً
CREATE OR REPLACE FUNCTION public.cm_shift_assignments_ensure_day_shift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NEW.day_shift_id IS NULL AND NEW.starts_at <> NEW.ends_at THEN
    SELECT id INTO v_id
    FROM public.cm_day_shifts
    WHERE work_date = NEW.work_date AND sort_order = NEW.slot_no
    ORDER BY created_at LIMIT 1;
    IF v_id IS NULL THEN
      INSERT INTO public.cm_day_shifts (work_date, sort_order, label, starts_at, ends_at, staff_count, source)
      VALUES (NEW.work_date, greatest(1, coalesce(NEW.slot_no, 1)), NEW.label, NEW.starts_at, NEW.ends_at, 1, coalesce(NEW.source, 'manual'))
      RETURNING id INTO v_id;
    END IF;
    NEW.day_shift_id := v_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cm_shift_assignments_ensure_day_shift ON public.cm_shift_assignments;
CREATE TRIGGER trg_cm_shift_assignments_ensure_day_shift
  BEFORE INSERT ON public.cm_shift_assignments
  FOR EACH ROW EXECUTE FUNCTION public.cm_shift_assignments_ensure_day_shift();

-- ───────────── 6) تحديث سياسات الكتابة على جداول الشيفتات لتشمل المدير التنفيذي ─────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cm_weekday_patterns',
    'cm_shift_templates',
    'cm_weekly_days_off',
    'cm_roster_days',
    'cm_shift_assignments'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS cm_write ON public.%I', t);
    EXECUTE format(
      $p$CREATE POLICY cm_write ON public.%I FOR ALL TO authenticated
         USING ((SELECT public.cm_can_manage_shifts()))
         WITH CHECK ((SELECT public.cm_can_manage_shifts()))$p$,
      t
    );
  END LOOP;
END $$;

-- ───────────── 7) دالة قراءة جدول الأسبوع (تتيح للمودريتورز عرض الجدول بدون كشف بيانات حساسة) ─────────────
CREATE OR REPLACE FUNCTION public.cm_get_week_schedule(_from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.cm_gate_assert();
  IF NOT (public.cm_is_service() OR public.cm_can_read_all() OR public.cm_current_moderator_id() IS NOT NULL) THEN
    RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'moderators', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id,
        'display_name', m.display_name,
        'sort_order', m.sort_order,
        'is_active', m.is_active,
        'chat_active', m.chat_active,
        'start_date', m.start_date,
        'end_date', m.end_date
      ) ORDER BY m.sort_order, m.display_name)
      FROM public.cm_moderators m
    ), '[]'::jsonb),
    'days_off', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'moderator_id', o.moderator_id,
        'dow', o.dow
      ))
      FROM public.cm_weekly_days_off o
      WHERE o.valid_to IS NULL
    ), '[]'::jsonb),
    'shifts', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'work_date', s.work_date,
        'sort_order', s.sort_order,
        'label', s.label,
        'starts_at', to_char(s.starts_at, 'HH24:MI'),
        'ends_at', to_char(s.ends_at, 'HH24:MI'),
        'staff_count', s.staff_count,
        'source', s.source,
        'moderator_ids', coalesce((
          SELECT jsonb_agg(a.moderator_id ORDER BY m.sort_order, m.display_name)
          FROM public.cm_shift_assignments a
          JOIN public.cm_moderators m ON m.id = a.moderator_id
          WHERE a.day_shift_id = s.id AND a.moderator_id IS NOT NULL
        ), '[]'::jsonb)
      ) ORDER BY s.work_date, s.starts_at, s.sort_order)
      FROM public.cm_day_shifts s
      WHERE s.work_date BETWEEN _from AND _to
    ), '[]'::jsonb)
  );
END $$;

REVOKE ALL ON FUNCTION public.cm_get_week_schedule(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_get_week_schedule(date, date) TO authenticated, service_role;

COMMIT;
