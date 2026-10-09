-- التسليم السريع / تحديث حالة الأوردر: مقصور على م/آلاء والمدير التنفيذي والمدير العام
-- (وأدوار التشغيل الأخرى اللي بتحدّث الحالة من شاشاتها). الموديريتور (sales_moderator)
-- ممنوعة من تغيير orders.status من أي مسار، حتى لو عندها سياسة UPDATE على أوردراتها.
-- إضافة فقط: دالة + trigger جديدين. لا تعديل على سياسات RLS أو بيانات.
-- الرجوع: DROP TRIGGER trg_block_moderator_status_change ON public.orders;
--         DROP FUNCTION public.block_moderator_order_status_change();

CREATE OR REPLACE FUNCTION public.block_moderator_order_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- service_role / cron / system jobs have no auth.uid(): untouched.
  IF v_uid IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF public.has_role(v_uid, 'sales_moderator'::app_role)
     AND NOT public.has_any_role(v_uid, ARRAY[
       'general_manager'::app_role,
       'executive_manager'::app_role,
       'marketing_sales_manager'::app_role,
       'sales_manager'::app_role,
       'accountant'::app_role,
       'warehouse_supervisor'::app_role,
       'shipping_company'::app_role,
       'private_delivery_rep'::app_role
     ])
  THEN
    RAISE EXCEPTION 'تحديث حالة الأوردر (التسليم السريع) غير مسموح للموديريتور. تواصلي مع م/آلاء أو الإدارة.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.block_moderator_order_status_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_block_moderator_status_change ON public.orders;
CREATE TRIGGER trg_block_moderator_status_change
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.block_moderator_order_status_change();
