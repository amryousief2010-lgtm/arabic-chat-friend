-- فحص طابور مراجعة الأرقام فقط.
-- يكتب public.cm_phone_review_queue ولا يكتب cm_contact_phones ولا cm_contacts
-- ولا customers ولا orders ولا cm_ad_attributions.
-- لا يستدعي cm_sync_customer_phones().
--
-- يعتمد على دوال وجداول الخطوة 2 (cm_split_phone_field / cm_normalize_phone /
-- cm_phone_is_valid و cm_phone_review_queue). على قاعدة لا تملكها بعد
-- تُنشأ الدالة والمُشغّل، ويُتخطى الفحص الأول حتى لا يفشل تطبيق الهجرات.
-- التراجع: supabase/rollbacks/20261108204500_cm_scan_phone_review.sql
--
-- two_numbers يُحسب داخل الحقل الواحد (phone أو phone2)، لا بجمع الحقلين.
-- رقم واحد مكرر في phone و phone2 ليس «رقمان في حقل واحد».
--
-- multi_customer: الفهرس الفريد هو (issue, customer_id, phone_raw, phone_norm).
-- في هذه الحالة customer_id و phone_raw فارغان، فيبقى صف واحد لكل رقم.
-- نفس مجموعة العملاء على صف dismissed/resolved تبقى مغلقة.
-- مجموعة مختلفة تُحدّث الصف نفسه، تعيده open، وتمسح resolution حتى يُراجَع
-- من جديد. الصف المفتوح يُحدَّث في مكانه ولا يُكرَّر.

CREATE OR REPLACE FUNCTION public.cm_scan_phone_review(_customer_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n_mal int := 0;
  n_two int := 0;
  n_multi int := 0;
BEGIN
  WITH src AS (
    SELECT cu.id AS customer_id, f.field_no, f.raw
    FROM public.customers cu
    CROSS JOIN LATERAL (VALUES (1, cu.phone), (2, cu.phone2)) AS f(field_no, raw)
    WHERE nullif(btrim(f.raw), '') IS NOT NULL
      AND (_customer_ids IS NULL OR cu.id = ANY (_customer_ids))
      AND NOT EXISTS (
        SELECT 1 FROM public.cm_customer_merges mg
        WHERE mg.merged_customer_id = cu.id AND mg.undone_at IS NULL
      )
  ),
  parts AS (
    SELECT s.customer_id, s.field_no, s.raw, p.part,
           count(*) OVER (PARTITION BY s.customer_id, s.field_no) AS nparts
    FROM src s
    CROSS JOIN LATERAL public.cm_split_phone_field(s.raw) AS p(part)
  ),
  ins_two AS (
    INSERT INTO public.cm_phone_review_queue (issue, customer_id, phone_raw)
    SELECT DISTINCT 'two_numbers', customer_id, raw
    FROM parts
    WHERE nparts > 1
    ON CONFLICT (issue, customer_id, phone_raw, phone_norm) DO NOTHING
    RETURNING 1
  ),
  ins_mal AS (
    INSERT INTO public.cm_phone_review_queue (issue, customer_id, phone_raw, phone_norm)
    SELECT DISTINCT 'malformed', customer_id, part, public.cm_normalize_phone(part)
    FROM parts
    WHERE NOT public.cm_phone_is_valid(public.cm_normalize_phone(part))
    ON CONFLICT (issue, customer_id, phone_raw, phone_norm) DO NOTHING
    RETURNING 1
  )
  SELECT
    (SELECT count(*) FROM ins_mal),
    (SELECT count(*) FROM ins_two)
  INTO n_mal, n_two;

  WITH exploded AS (
    SELECT cu.id AS customer_id,
           public.cm_normalize_phone(p.part) AS phone_norm
    FROM public.customers cu
    CROSS JOIN LATERAL (VALUES (cu.phone), (cu.phone2)) AS f(raw)
    CROSS JOIN LATERAL public.cm_split_phone_field(f.raw) AS p(part)
    WHERE nullif(btrim(f.raw), '') IS NOT NULL
      AND public.cm_phone_is_valid(public.cm_normalize_phone(p.part))
      AND NOT EXISTS (
        SELECT 1 FROM public.cm_customer_merges mg
        WHERE mg.merged_customer_id = cu.id AND mg.undone_at IS NULL
      )
  ),
  wanted AS (
    SELECT DISTINCT phone_norm
    FROM exploded
    WHERE _customer_ids IS NULL OR customer_id = ANY (_customer_ids)
  ),
  grouped AS (
    SELECT e.phone_norm,
           array_agg(DISTINCT e.customer_id ORDER BY e.customer_id) AS related_customer_ids
    FROM exploded e
    JOIN wanted w ON w.phone_norm = e.phone_norm
    GROUP BY e.phone_norm
    HAVING count(DISTINCT e.customer_id) > 1
  ),
  ins_multi AS (
    INSERT INTO public.cm_phone_review_queue (issue, phone_norm, related_customer_ids)
    SELECT 'multi_customer', phone_norm, related_customer_ids
    FROM grouped
    ON CONFLICT (issue, customer_id, phone_raw, phone_norm) DO UPDATE
      SET related_customer_ids = EXCLUDED.related_customer_ids,
          status = 'open',
          resolution = NULL,
          resolved_by = NULL,
          resolved_at = NULL,
          updated_at = now()
      WHERE (
        SELECT coalesce(array_agg(DISTINCT x ORDER BY x), '{}'::uuid[])
        FROM unnest(cm_phone_review_queue.related_customer_ids) AS u(x)
      ) IS DISTINCT FROM (
        SELECT coalesce(array_agg(DISTINCT x ORDER BY x), '{}'::uuid[])
        FROM unnest(EXCLUDED.related_customer_ids) AS u(x)
      )
    RETURNING 1
  )
  SELECT count(*) INTO n_multi FROM ins_multi;

  RETURN jsonb_build_object(
    'malformed', n_mal,
    'two_numbers', n_two,
    'multi_customer', n_multi
  );
END;
$$;

COMMENT ON FUNCTION public.cm_scan_phone_review(uuid[]) IS
  'Scan-only fill of cm_phone_review_queue. two_numbers is counted inside one phone field. multi_customer keeps one row per phone: an identical closed set stays closed, a changed set reopens that row. Does not write contacts, customers, orders, or ad attributions.';

REVOKE ALL ON FUNCTION public.cm_scan_phone_review(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cm_scan_phone_review(uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.cm_scan_phone_review(uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cm_scan_phone_review(uuid[]) TO service_role;

-- المُشغّل يفحص العميل المحفوظ فقط، وأي خطأ داخله لا يمنع حفظ العميل.
CREATE OR REPLACE FUNCTION public.cm_customers_phone_review_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.phone IS NOT DISTINCT FROM OLD.phone
     AND NEW.phone2 IS NOT DISTINCT FROM OLD.phone2 THEN
    RETURN NULL;
  END IF;
  BEGIN
    PERFORM public.cm_scan_phone_review(ARRAY[NEW.id]);
  EXCEPTION WHEN OTHERS THEN
    -- State code only. The error text can embed the saved phone number.
    RAISE WARNING 'cm_scan_phone_review skipped for customer % (SQLSTATE %)', NEW.id, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.cm_customers_phone_review_trg() IS
  'AFTER INSERT/UPDATE OF phone, phone2: scan that customer into cm_phone_review_queue. Errors are warned and do not abort the customer save.';

REVOKE ALL ON FUNCTION public.cm_customers_phone_review_trg() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cm_customers_phone_review_trg() FROM anon;
GRANT EXECUTE ON FUNCTION public.cm_customers_phone_review_trg() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cm_customers_phone_review_trg() TO service_role;

DROP TRIGGER IF EXISTS trg_customers_cm_phone_review ON public.customers;
CREATE TRIGGER trg_customers_cm_phone_review
  AFTER INSERT OR UPDATE OF phone, phone2 ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.cm_customers_phone_review_trg();

-- ليلًا 01:00 UTC. لا يُنشئ الامتداد؛ يعمل فقط إن كان pg_cron مثبتًا.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('cm-scan-phone-review');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM cron.schedule(
      'cm-scan-phone-review',
      '0 1 * * *',
      $cron$SELECT public.cm_scan_phone_review(NULL)$cron$
    );
  END IF;
END $$;

-- فحص كامل مرة واحدة عند التطبيق، إن كانت الخطوة 2 موجودة على القاعدة.
DO $$
BEGIN
  IF to_regclass('public.cm_phone_review_queue') IS NOT NULL
     AND to_regclass('public.cm_customer_merges') IS NOT NULL
     AND to_regprocedure('public.cm_normalize_phone(text)') IS NOT NULL
     AND to_regprocedure('public.cm_phone_is_valid(text)') IS NOT NULL
     AND to_regprocedure('public.cm_split_phone_field(text)') IS NOT NULL
  THEN
    PERFORM public.cm_scan_phone_review(NULL);
  ELSE
    RAISE NOTICE 'cm_scan_phone_review initial scan skipped: phone helpers or review queue are not installed';
  END IF;
END $$;
