-- مكالمات الخط الساخن — فصل المبيعات (المودريتورز) عن باقي المجموعات (المعمل/الحسابات/التوصيل). قرار م. عمرو 28-10-2026.
-- مكالمة مبيعات = فيها محاولة تحويل واحدة على الأقل لاسم مربوط في cm_hotline_usernames، أو بلا أي محاولة تحويل
--   (انقطع في القائمة الصوتية — يظل ظاهراً بعلامته). مكالمة كل محاولاتها لأسماء غير مربوطة = «غير المبيعات».
-- 1) cm_calls.is_sales (عمود مخزّن يُحسب بتريجر عند الإدخال/التعديل، ويُعاد حسابه عند تعديل الربط).
-- 2) cm_kpi_missed_calls_v: تستبعد غير المبيعات (تؤثر على cm_kpi_by_moderator وقائمة الفائتة). cm_kpi_by_campaign لا يستخدم المكالمات.
-- التراجع: أعد cm_kpi_missed_calls_v من 20261028110000؛ DROP TRIGGER trg_cm_calls_is_sales, trg_cm_hotline_usernames_sales;
--          DROP FUNCTION cm_call_is_sales, cm_calls_set_is_sales, cm_hotline_username_resales; ALTER TABLE cm_calls DROP COLUMN is_sales.

CREATE OR REPLACE FUNCTION public.cm_call_is_sales(_attempts jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN jsonb_typeof(_attempts) IS DISTINCT FROM 'array' OR jsonb_array_length(_attempts) = 0 THEN true
              ELSE EXISTS (SELECT 1 FROM jsonb_array_elements(_attempts) a
                           JOIN public.cm_hotline_usernames h ON h.username = lower(btrim(a->>'username'))) END
$$;
REVOKE ALL ON FUNCTION public.cm_call_is_sales(jsonb) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.cm_calls ADD COLUMN IF NOT EXISTS is_sales boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.cm_calls_set_is_sales()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.is_sales := public.cm_call_is_sales(NEW.switch_attempts); RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.cm_calls_set_is_sales() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_cm_calls_is_sales ON public.cm_calls;
CREATE TRIGGER trg_cm_calls_is_sales BEFORE INSERT OR UPDATE OF switch_attempts, is_sales ON public.cm_calls
  FOR EACH ROW EXECUTE FUNCTION public.cm_calls_set_is_sales();

-- تعديل الربط (إضافة/حذف اسم) يعيد تصنيف المكالمات التي حوِّلت لهذا الاسم.
CREATE OR REPLACE FUNCTION public.cm_hotline_username_resales()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.cm_calls c SET is_sales = public.cm_call_is_sales(c.switch_attempts)
   WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(c.switch_attempts, '[]')) a
                  WHERE lower(btrim(a->>'username')) IN (coalesce(OLD.username, ''), coalesce(NEW.username, '')))
     AND c.is_sales IS DISTINCT FROM public.cm_call_is_sales(c.switch_attempts);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.cm_hotline_username_resales() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_cm_hotline_usernames_sales ON public.cm_hotline_usernames;
CREATE TRIGGER trg_cm_hotline_usernames_sales AFTER INSERT OR UPDATE OF username OR DELETE ON public.cm_hotline_usernames
  FOR EACH ROW EXECUTE FUNCTION public.cm_hotline_username_resales();

UPDATE public.cm_calls SET is_sales = public.cm_call_is_sales(switch_attempts)
 WHERE is_sales IS DISTINCT FROM public.cm_call_is_sales(switch_attempts);

CREATE OR REPLACE VIEW public.cm_kpi_missed_calls_v WITH (security_invoker = true) AS
WITH k AS (SELECT coalesce((SELECT missed_call_followup_min FROM public.cm_kpi_settings WHERE id = 1), 60) AS m),
f AS (
  SELECT x.id, x.started_at, x.moderator_id, x.phone_norm, x.followed_up_at,
         (upper(coalesce(x.call_result, '')) = 'ANSWERED' AND coalesce(jsonb_array_length(x.switch_attempts), 0) = 0) AS ivr_abandoned,
         (SELECT min(o.started_at) FROM public.cm_calls o
           WHERE o.phone_norm = x.phone_norm AND o.direction = 'outbound' AND o.started_at > x.started_at) AS callback_at,
         (SELECT min(m.sent_at) FROM public.cm_messages m JOIN public.cm_conversations cv ON cv.id = m.conversation_id
           WHERE cv.phone_norm = x.phone_norm AND m.direction = 'out' AND m.sent_at > x.started_at) AS message_at
  FROM public.cm_calls x WHERE x.status = 'missed' AND x.direction = 'inbound' AND x.is_sales)
SELECT f.id AS call_id, f.started_at, public.cm_local_date(f.started_at) AS kpi_date, f.moderator_id, f.phone_norm,
       least(f.followed_up_at, f.callback_at, f.message_at) AS followup_at,
       coalesce(least(f.followed_up_at, f.callback_at, f.message_at) <= f.started_at + make_interval(mins => k.m), false) AS followed_within_target,
       f.ivr_abandoned
FROM f CROSS JOIN k;
