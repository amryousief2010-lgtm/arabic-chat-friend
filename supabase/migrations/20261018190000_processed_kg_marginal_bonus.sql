-- حافز المصنّعات التراكمي من 1 أكتوبر 2026.
-- لا يمس أسعار الطلبات ولا صفوف القبض المعتمدة. شهور ما قبل أكتوبر تبقى على تارجت القيمة في target_bonus_settings.

CREATE TABLE IF NOT EXISTS public.processed_kg_bonus_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_from date NOT NULL UNIQUE,
  minimum_kg numeric NOT NULL,
  bands jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT processed_kg_bonus_schedules_from_oct CHECK (effective_from >= DATE '2026-10-01'),
  CONSTRAINT processed_kg_bonus_schedules_minimum_nonneg CHECK (minimum_kg >= 0)
);

COMMENT ON TABLE public.processed_kg_bonus_schedules IS
  'نسخ حافز المصنّعات بالشرائح الحدّية. كل صف يسري من أول شهر effective_from حتى النسخة الأحدث التالية. أكتوبر 2026 هو أول سريان.';

COMMENT ON COLUMN public.processed_kg_bonus_schedules.bands IS
  'مصفوفة {from_kg, to_kg, rate}. to_kg للشريحة الأخيرة null. الكيلو يُسعَّر بشريحته من أول كيلو بعد بلوغ minimum_kg.';

CREATE OR REPLACE FUNCTION public.validate_processed_kg_bonus_schedule()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  elem jsonb;
  i int;
  n int;
  prev_to numeric;
  from_kg numeric;
  to_kg numeric;
  rate numeric;
  to_is_null boolean;
BEGIN
  IF EXTRACT(DAY FROM NEW.effective_from) <> 1 THEN
    RAISE EXCEPTION 'تاريخ السريان يجب أن يكون أول يوم في الشهر';
  END IF;
  IF jsonb_typeof(NEW.bands) <> 'array' THEN
    RAISE EXCEPTION 'الشرائح يجب أن تكون مصفوفة';
  END IF;
  n := jsonb_array_length(NEW.bands);
  IF n < 1 THEN
    RAISE EXCEPTION 'يجب إضافة شريحة واحدة على الأقل';
  END IF;
  prev_to := 0;
  to_is_null := false;
  FOR i IN 0..n - 1 LOOP
    elem := NEW.bands -> i;
    from_kg := (elem ->> 'from_kg')::numeric;
    rate := (elem ->> 'rate')::numeric;
    to_is_null := elem -> 'to_kg' IS NULL OR jsonb_typeof(elem -> 'to_kg') = 'null';
    IF from_kg IS NULL OR rate IS NULL THEN
      RAISE EXCEPTION 'كل شريحة تحتاج from_kg و rate';
    END IF;
    IF from_kg <> prev_to THEN
      RAISE EXCEPTION 'الشرائح يجب أن تتصل بدون فجوات أو تداخل';
    END IF;
    IF rate < 0 THEN
      RAISE EXCEPTION 'سعر الكيلو لا يمكن أن يكون سالبًا';
    END IF;
    IF to_is_null THEN
      IF i <> n - 1 THEN
        RAISE EXCEPTION 'الشريحة المفتوحة يجب أن تكون الأخيرة';
      END IF;
    ELSE
      to_kg := (elem ->> 'to_kg')::numeric;
      IF to_kg IS NULL OR to_kg <= from_kg THEN
        RAISE EXCEPTION 'نهاية الشريحة يجب أن تكون أكبر من بدايتها';
      END IF;
      prev_to := to_kg;
    END IF;
  END LOOP;
  IF NOT to_is_null THEN
    RAISE EXCEPTION 'الشريحة الأخيرة يجب أن تكون مفتوحة';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_processed_kg_bonus_schedule ON public.processed_kg_bonus_schedules;
CREATE TRIGGER trg_validate_processed_kg_bonus_schedule
BEFORE INSERT OR UPDATE ON public.processed_kg_bonus_schedules
FOR EACH ROW EXECUTE FUNCTION public.validate_processed_kg_bonus_schedule();

DROP TRIGGER IF EXISTS tg_processed_kg_bonus_schedules_updated_at ON public.processed_kg_bonus_schedules;
CREATE TRIGGER tg_processed_kg_bonus_schedules_updated_at
BEFORE UPDATE ON public.processed_kg_bonus_schedules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.processed_kg_bonus_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view processed kg bonus schedules" ON public.processed_kg_bonus_schedules;
CREATE POLICY "Authenticated can view processed kg bonus schedules"
ON public.processed_kg_bonus_schedules FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Managers can insert processed kg bonus schedules" ON public.processed_kg_bonus_schedules;
CREATE POLICY "Managers can insert processed kg bonus schedules"
ON public.processed_kg_bonus_schedules FOR INSERT
TO authenticated
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role]));

DROP POLICY IF EXISTS "Managers can update processed kg bonus schedules" ON public.processed_kg_bonus_schedules;
CREATE POLICY "Managers can update processed kg bonus schedules"
ON public.processed_kg_bonus_schedules FOR UPDATE
TO authenticated
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role]));

DROP POLICY IF EXISTS "Managers can delete processed kg bonus schedules" ON public.processed_kg_bonus_schedules;
CREATE POLICY "Managers can delete processed kg bonus schedules"
ON public.processed_kg_bonus_schedules FOR DELETE
TO authenticated
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'marketing_sales_manager'::app_role]));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.processed_kg_bonus_schedules TO authenticated;
GRANT ALL ON public.processed_kg_bonus_schedules TO service_role;

INSERT INTO public.processed_kg_bonus_schedules (effective_from, minimum_kg, bands)
VALUES (
  DATE '2026-10-01',
  400,
  '[
    {"from_kg":0,"to_kg":400,"rate":4},
    {"from_kg":400,"to_kg":750,"rate":6},
    {"from_kg":750,"to_kg":1000,"rate":8},
    {"from_kg":1000,"to_kg":1500,"rate":10},
    {"from_kg":1500,"to_kg":2000,"rate":12},
    {"from_kg":2000,"to_kg":null,"rate":14}
  ]'::jsonb
)
ON CONFLICT (effective_from) DO NOTHING;

-- تفصيل الشرائح يُحفظ عند اعتماد الشهر فقط. الصفوف القديمة تبقى NULL ولا تُعاد كتابتها.
ALTER TABLE public.payroll_month_snapshots
  ADD COLUMN IF NOT EXISTS processed_band_breakdown jsonb;

COMMENT ON COLUMN public.payroll_month_snapshots.processed_band_breakdown IS
  'تفصيل شرائح حافز المصنّعات عند الاعتماد. NULL للشهور المحسوبة بالنظام القديم. لا يُحدَّث بأثر رجعي.';

-- المسوقة تحتاج وقت اعتماد الشهور فقط لتحسب الأوردرات المرحّلة في عدادها.
-- لقطات الرواتب تبقى للإدارة كما هي.
DROP POLICY IF EXISTS "Moderators can view payroll closure times" ON public.payroll_month_closures;
CREATE POLICY "Moderators can view payroll closure times"
ON public.payroll_month_closures FOR SELECT
TO authenticated
USING (has_any_role(auth.uid(), ARRAY['sales_moderator'::app_role]));
