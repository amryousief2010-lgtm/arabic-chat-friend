-- تقييد قراءة إعدادات بونص المصنّعات. لا يُطبَّق من هنا.
-- منحنى أكتوبر 2026 نفسه محسوب في الواجهة (moderatorKgBonus) ومش متخزّن في جدول.
-- لكن الشرائح القديمة لسه مقروءة لأي مستخدم مسجّل:
--   target_bonus_settings (سياسة "Authenticated can view bonus settings")
--   processed_kg_bonus_schedules (سياسة "Authenticated can view processed kg bonus schedules")
-- القراءة المباشرة تبقى لأدوار الإدارة اللي بتعدّل جدول التارجت:
--   general_manager, executive_manager, sales_manager, marketing_sales_manager.
-- المسوقة تفضل تشوف كارت بونصها عبر moderator_card_bonus_settings
-- (أساسي + لحوم + عظم + كتاكيت فقط، من غير شرائح المصنّعات).

DROP POLICY IF EXISTS "Authenticated can view bonus settings" ON public.target_bonus_settings;
DROP POLICY IF EXISTS "Managers can view bonus settings" ON public.target_bonus_settings;
CREATE POLICY "Managers can view bonus settings"
ON public.target_bonus_settings
FOR SELECT
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'sales_manager'::app_role,
    'marketing_sales_manager'::app_role
  ])
);

DROP POLICY IF EXISTS "Authenticated can view processed kg bonus schedules" ON public.processed_kg_bonus_schedules;
DROP POLICY IF EXISTS "Managers can view processed kg bonus schedules" ON public.processed_kg_bonus_schedules;
CREATE POLICY "Managers can view processed kg bonus schedules"
ON public.processed_kg_bonus_schedules
FOR SELECT
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'sales_manager'::app_role,
    'marketing_sales_manager'::app_role
  ])
);

CREATE OR REPLACE FUNCTION public.moderator_card_bonus_settings()
RETURNS TABLE (
  category text,
  tier integer,
  sales_amount numeric,
  bonus_amount numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.category, s.tier, s.sales_amount, s.bonus_amount
  FROM public.target_bonus_settings s
  WHERE auth.uid() IS NOT NULL
    AND s.category IN ('أساسي', 'لحوم', 'لحوم بالعظم/كجم', 'كتاكيت');
$$;

COMMENT ON FUNCTION public.moderator_card_bonus_settings() IS
  'إعدادات كارت بونص المسوقة فقط: الأساسي وتارجت اللحوم والعظم والكتاكيت. لا يرجّع شرائح المصنّعات.';

REVOKE ALL ON FUNCTION public.moderator_card_bonus_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderator_card_bonus_settings() TO authenticated, service_role;
