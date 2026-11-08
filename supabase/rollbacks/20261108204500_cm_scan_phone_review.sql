-- تراجع فحص طابور مراجعة الأرقام.
-- يزيل الدالة والمُشغّل ووظيفة pg_cron. لا يحذف صفوف cm_phone_review_queue
-- ولا يمسّ cm_contact_phones أو cm_contacts أو customers أو orders.
-- لا أعمدة جديدة: مجموعة multi_customer المتغيرة تُعاد فتحها على الصف نفسه.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('cm-scan-phone-review');
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DROP TRIGGER IF EXISTS trg_customers_cm_phone_review ON public.customers;
DROP FUNCTION IF EXISTS public.cm_customers_phone_review_trg();
DROP FUNCTION IF EXISTS public.cm_scan_phone_review(uuid[]);
