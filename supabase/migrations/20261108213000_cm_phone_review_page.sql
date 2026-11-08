-- صفحة مراجعة الأرقام: قائمة بالشهر مع العدد، وتصحيح حقل العميل نفسه.
-- لا يكتب cm_contact_phones ولا cm_contacts ولا orders ولا cm_ad_attributions.
-- فحص cm_scan_phone_review يُستبدل هنا حتى تُغلق الحالة المفتوحة التي لم تعد صحيحة
-- دون إعادة فتح مجموعة مُتجاهَلة مطابقة، ودون إغلاق تكرار ما زال قائماً.
-- التراجع: supabase/rollbacks/20261108213000_cm_phone_review_page.sql

CREATE OR REPLACE FUNCTION public.cm_phone_id_set_eq(_a uuid[], _b uuid[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce((SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(coalesce(_a, '{}'::uuid[])) AS u(x)), '{}'::uuid[])
      IS NOT DISTINCT FROM
         coalesce((SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(coalesce(_b, '{}'::uuid[])) AS u(x)), '{}'::uuid[])
$$;

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
  n_closed int := 0;
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
    SELECT cu.id AS customer_id, public.cm_normalize_phone(p.part) AS phone_norm
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
    SELECT DISTINCT phone_norm FROM exploded
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
    ON CONFLICT (issue, customer_id, phone_raw, phone_norm) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n_multi FROM ins_multi;

  -- مجموعة تغيرت: صف واحد يُحدَّث. المجموعة المطابقة المغلقة تبقى مغلقة.
  -- مجموعة لم يعد فيها أكثر من عميل: الصف المفتوح يُغلق، والمغلق يبقى مغلقاً.
  WITH exploded AS (
    SELECT cu.id AS customer_id, public.cm_normalize_phone(p.part) AS phone_norm
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
  touched AS (
    SELECT q.id, q.phone_norm, q.status, q.related_customer_ids
    FROM public.cm_phone_review_queue q
    WHERE q.issue = 'multi_customer'
      AND (
        _customer_ids IS NULL
        OR q.related_customer_ids && _customer_ids
        OR EXISTS (
          SELECT 1 FROM exploded e
          WHERE e.phone_norm = q.phone_norm
            AND (_customer_ids IS NULL OR e.customer_id = ANY (_customer_ids))
        )
      )
  ),
  fresh AS (
    SELECT t.id, t.status, t.related_customer_ids AS old_ids,
           coalesce(array_agg(DISTINCT e.customer_id ORDER BY e.customer_id)
                    FILTER (WHERE e.customer_id IS NOT NULL), '{}'::uuid[]) AS new_ids
    FROM touched t
    LEFT JOIN exploded e ON e.phone_norm = t.phone_norm
    GROUP BY t.id, t.status, t.related_customer_ids
  ),
  upd AS (
    UPDATE public.cm_phone_review_queue q
    SET related_customer_ids = CASE WHEN coalesce(cardinality(f.new_ids), 0) > 1 THEN f.new_ids ELSE q.related_customer_ids END,
        status = CASE
          WHEN coalesce(cardinality(f.new_ids), 0) > 1
               AND NOT public.cm_phone_id_set_eq(q.related_customer_ids, f.new_ids)
               AND q.status <> 'open' THEN 'open'
          WHEN coalesce(cardinality(f.new_ids), 0) <= 1 AND q.status = 'open' THEN 'resolved'
          ELSE q.status
        END,
        resolution = CASE
          WHEN coalesce(cardinality(f.new_ids), 0) > 1
               AND NOT public.cm_phone_id_set_eq(q.related_customer_ids, f.new_ids)
               AND q.status <> 'open' THEN NULL
          WHEN coalesce(cardinality(f.new_ids), 0) <= 1 AND q.status = 'open' THEN 'corrected'
          ELSE q.resolution
        END,
        resolved_by = CASE
          WHEN coalesce(cardinality(f.new_ids), 0) <= 1 AND q.status = 'open' THEN auth.uid()
          WHEN coalesce(cardinality(f.new_ids), 0) > 1
               AND NOT public.cm_phone_id_set_eq(q.related_customer_ids, f.new_ids)
               AND q.status <> 'open' THEN NULL
          ELSE q.resolved_by
        END,
        resolved_at = CASE
          WHEN coalesce(cardinality(f.new_ids), 0) <= 1 AND q.status = 'open' THEN now()
          WHEN coalesce(cardinality(f.new_ids), 0) > 1
               AND NOT public.cm_phone_id_set_eq(q.related_customer_ids, f.new_ids)
               AND q.status <> 'open' THEN NULL
          ELSE q.resolved_at
        END,
        updated_at = now()
    FROM fresh f
    WHERE q.id = f.id
      AND (
        NOT public.cm_phone_id_set_eq(q.related_customer_ids, f.new_ids)
        OR (q.status = 'open' AND coalesce(cardinality(f.new_ids), 0) <= 1)
      )
    RETURNING 1
  )
  SELECT count(*) INTO n_closed FROM upd;

  UPDATE public.cm_phone_review_queue q
  SET status = 'resolved', resolution = 'corrected', resolved_by = auth.uid(), resolved_at = now(), updated_at = now()
  WHERE q.issue = 'malformed' AND q.status = 'open'
    AND (_customer_ids IS NULL OR q.customer_id = ANY (_customer_ids))
    AND NOT EXISTS (
      SELECT 1
      FROM public.customers cu
      CROSS JOIN LATERAL (VALUES (cu.phone), (cu.phone2)) AS f(raw)
      CROSS JOIN LATERAL public.cm_split_phone_field(f.raw) AS p(part)
      WHERE cu.id = q.customer_id
        AND p.part IS NOT DISTINCT FROM q.phone_raw
        AND NOT public.cm_phone_is_valid(public.cm_normalize_phone(p.part))
    );

  UPDATE public.cm_phone_review_queue q
  SET status = 'resolved', resolution = 'corrected', resolved_by = auth.uid(), resolved_at = now(), updated_at = now()
  WHERE q.issue = 'two_numbers' AND q.status = 'open'
    AND (_customer_ids IS NULL OR q.customer_id = ANY (_customer_ids))
    AND NOT EXISTS (
      SELECT 1
      FROM public.customers cu
      CROSS JOIN LATERAL (VALUES (1, cu.phone), (2, cu.phone2)) AS f(field_no, raw)
      WHERE cu.id = q.customer_id
        AND f.raw IS NOT DISTINCT FROM q.phone_raw
        AND (SELECT count(*) FROM public.cm_split_phone_field(f.raw)) > 1
    );

  RETURN jsonb_build_object(
    'malformed', n_mal,
    'two_numbers', n_two,
    'multi_customer', n_multi,
    'reconciled', n_closed
  );
END;
$$;

COMMENT ON FUNCTION public.cm_scan_phone_review(uuid[]) IS
  'Scan-only queue fill. two_numbers is inside one field. A changed multi_customer set reopens the same row; an identical closed set stays closed; an open group that no longer has two customers is resolved.';

REVOKE ALL ON FUNCTION public.cm_scan_phone_review(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cm_scan_phone_review(uuid[]) TO service_role;

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
    RAISE WARNING 'cm_scan_phone_review skipped for customer % (SQLSTATE %)', NEW.id, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.cm_customers_phone_review_trg() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_customers_phone_review_trg() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_customers_cm_phone_review ON public.customers;
CREATE TRIGGER trg_customers_cm_phone_review
  AFTER INSERT OR UPDATE OF phone, phone2 ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.cm_customers_phone_review_trg();

-- قائمة الصفحة. الشهر هو تاريخ الطلب بتوقيت القاهرة، مثل التقارير.
-- عميل بلا طلب في الشهر لا يظهر، إلا أعضاء مجموعة تكرار طابقت الشهر.
CREATE OR REPLACE FUNCTION public.cm_phone_review_list(
  _month date DEFAULT NULL,
  _issue text DEFAULT NULL,
  _search text DEFAULT NULL,
  _page int DEFAULT 1,
  _page_size int DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_size int := least(greatest(coalesce(_page_size, 25), 1), 50);
  v_page int := greatest(coalesce(_page, 1), 1);
  v_off int;
  v_total int := 0;
  v_end date;
  v_q text := NULLIF(btrim(_search), '');
  v_digits text;
  v_mask boolean;
  v_items jsonb := '[]'::jsonb;
  rec record;
  v_customers jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.cm_is_supervisor() THEN
    RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  IF _issue IS NOT NULL AND btrim(_issue) <> '' AND _issue NOT IN ('malformed', 'two_numbers', 'multi_customer') THEN
    RAISE EXCEPTION 'CM_PHONE_ISSUE' USING ERRCODE = '22023';
  END IF;
  v_off := (v_page - 1) * v_size;
  v_end := CASE WHEN _month IS NULL THEN NULL ELSE (_month + interval '1 month')::date END;
  v_digits := NULLIF(regexp_replace(coalesce(_search, ''), '\D', '', 'g'), '');
  v_mask := public.is_marketing_only_user(auth.uid());

  CREATE TEMP TABLE IF NOT EXISTS cm_phone_review_match (
    id uuid, issue text, customer_id uuid, phone_raw text, phone_norm text,
    related_customer_ids uuid[], created_at timestamptz
  ) ON COMMIT DROP;
  TRUNCATE cm_phone_review_match;

  INSERT INTO cm_phone_review_match
  SELECT q.id, q.issue, q.customer_id, q.phone_raw, q.phone_norm, q.related_customer_ids, q.created_at
  FROM public.cm_phone_review_queue q
  WHERE q.status = 'open'
    AND (_issue IS NULL OR btrim(_issue) = '' OR q.issue = _issue)
    AND (
      _month IS NULL
      OR EXISTS (
        SELECT 1 FROM public.orders o
        WHERE (o.customer_id = q.customer_id OR o.customer_id = ANY (q.related_customer_ids))
          AND (o.created_at AT TIME ZONE 'Africa/Cairo')::date >= _month
          AND (o.created_at AT TIME ZONE 'Africa/Cairo')::date < v_end
      )
    )
    AND (
      v_q IS NULL
      OR coalesce(q.phone_norm, '') ILIKE '%' || coalesce(v_digits, v_q) || '%'
      OR coalesce(q.phone_raw, '') ILIKE '%' || v_q || '%'
      OR EXISTS (
        SELECT 1 FROM public.customers c
        WHERE (c.id = q.customer_id OR c.id = ANY (q.related_customer_ids))
          AND c.name ILIKE '%' || v_q || '%'
      )
      OR EXISTS (
        SELECT 1 FROM public.orders o
        WHERE (o.customer_id = q.customer_id OR o.customer_id = ANY (q.related_customer_ids))
          AND o.order_number ILIKE '%' || v_q || '%'
      )
    );

  SELECT count(*) INTO v_total FROM cm_phone_review_match;

  FOR rec IN
    SELECT * FROM cm_phone_review_match
    ORDER BY created_at, id
    OFFSET v_off LIMIT v_size
  LOOP
    SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.name), '[]'::jsonb)
    INTO v_customers
    FROM (
      SELECT c.id,
             c.name,
             CASE WHEN v_mask THEN NULL ELSE c.phone END AS phone,
             CASE WHEN v_mask THEN NULL ELSE c.phone2 END AS phone2,
             CASE WHEN v_mask THEN '[]'::jsonb ELSE (
               SELECT coalesce(jsonb_agg(f.field), '[]'::jsonb)
               FROM (VALUES ('phone', c.phone), ('phone2', c.phone2)) AS f(field, raw)
               WHERE nullif(btrim(f.raw), '') IS NOT NULL
                 AND (
                   (rec.issue = 'two_numbers' AND f.raw = rec.phone_raw)
                   OR (rec.issue = 'malformed' AND EXISTS (
                     SELECT 1 FROM public.cm_split_phone_field(f.raw) AS p(part)
                     WHERE p.part IS NOT DISTINCT FROM rec.phone_raw
                       AND NOT public.cm_phone_is_valid(public.cm_normalize_phone(p.part))
                   ))
                   OR (rec.issue = 'multi_customer' AND EXISTS (
                     SELECT 1 FROM public.cm_split_phone_field(f.raw) AS p(part)
                     WHERE public.cm_phone_is_valid(public.cm_normalize_phone(p.part))
                       AND public.cm_normalize_phone(p.part) = rec.phone_norm
                   ))
                 )
             ) END AS edit_fields,
             (
               SELECT count(*) FROM public.orders o
               WHERE o.customer_id = c.id
                 AND (_month IS NULL OR (
                   (o.created_at AT TIME ZONE 'Africa/Cairo')::date >= _month
                   AND (o.created_at AT TIME ZONE 'Africa/Cairo')::date < v_end
                 ))
             ) AS order_count,
             (
               SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'id', o.id, 'order_number', o.order_number, 'created_at', o.created_at,
                 'status', o.status, 'total', o.total, 'moderator', o.moderator
               ) ORDER BY o.created_at DESC), '[]'::jsonb)
               FROM (
                 SELECT o.id, o.order_number, o.created_at, o.status, o.total, o.moderator
                 FROM public.orders o
                 WHERE o.customer_id = c.id
                   AND (_month IS NULL OR (
                     (o.created_at AT TIME ZONE 'Africa/Cairo')::date >= _month
                     AND (o.created_at AT TIME ZONE 'Africa/Cairo')::date < v_end
                   ))
                 ORDER BY o.created_at DESC
                 LIMIT CASE WHEN _month IS NULL THEN 15 ELSE 50 END
               ) o
             ) AS orders
      FROM public.customers c
      WHERE c.id = rec.customer_id OR c.id = ANY (rec.related_customer_ids)
    ) x;

    v_items := v_items || jsonb_build_object(
      'id', rec.id,
      'issue', rec.issue,
      'phone_raw', rec.phone_raw,
      'phone_norm', rec.phone_norm,
      'created_at', rec.created_at,
      'customers', v_customers
    );
  END LOOP;

  RETURN jsonb_build_object(
    'total', v_total,
    'page', v_page,
    'page_size', v_size,
    'items', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cm_phone_review_list(date, text, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_phone_review_list(date, text, text, int, int) TO authenticated, service_role;

-- تصحيح حقل واحد. لا يمسّ العمود الآخر ولا الطلبات.
-- أدوار تعديل العملاء من المديرين: المدير العام، التنفيذي، مديرة المبيعات.
CREATE OR REPLACE FUNCTION public.cm_correct_customer_phone(
  _customer_id uuid,
  _field text,
  _value text,
  _confirm_drop boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old text;
  v_phone text;
  v_phone2 text;
  v_old_n int;
  v_new_n int;
  v_new text;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_any_role(auth.uid(), ARRAY['general_manager', 'executive_manager', 'sales_manager']::app_role[]) THEN
    RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  IF _field NOT IN ('phone', 'phone2') THEN
    RAISE EXCEPTION 'CM_PHONE_FIELD' USING ERRCODE = '22023';
  END IF;

  SELECT phone, phone2 INTO v_phone, v_phone2
  FROM public.customers
  WHERE id = _customer_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CM_PHONE_CUSTOMER' USING ERRCODE = 'P0002';
  END IF;
  v_old := CASE WHEN _field = 'phone' THEN v_phone ELSE v_phone2 END;
  v_old_n := (SELECT count(*) FROM public.cm_split_phone_field(v_old));
  v_new_n := (SELECT count(*) FROM public.cm_split_phone_field(_value));
  IF v_new_n = 0 THEN
    RAISE EXCEPTION 'CM_PHONE_EMPTY' USING ERRCODE = '22023';
  END IF;
  IF v_old_n > 1 AND v_new_n < v_old_n AND NOT coalesce(_confirm_drop, false) THEN
    RAISE EXCEPTION 'CM_PHONE_DROP_CONFIRM' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cm_split_phone_field(_value) AS p(part)
    WHERE NOT public.cm_phone_is_valid(public.cm_normalize_phone(p.part))
  ) THEN
    RAISE EXCEPTION 'CM_PHONE_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT string_agg(public.cm_normalize_phone(u.part), ' / ' ORDER BY u.ord)
  INTO v_new
  FROM public.cm_split_phone_field(_value) WITH ORDINALITY AS u(part, ord);

  IF _field = 'phone' THEN
    UPDATE public.customers SET phone = v_new WHERE id = _customer_id;
  ELSE
    UPDATE public.customers SET phone2 = v_new WHERE id = _customer_id;
  END IF;

  PERFORM public.cm_scan_phone_review(ARRAY[_customer_id]);
  RETURN jsonb_build_object('customer_id', _customer_id, 'field', _field);
END;
$$;

COMMENT ON FUNCTION public.cm_correct_customer_phone(uuid, text, text, boolean) IS
  'Correct customers.phone or customers.phone2 only. Two-number fields keep every part unless _confirm_drop is true. Does not write orders.';

REVOKE ALL ON FUNCTION public.cm_correct_customer_phone(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_correct_customer_phone(uuid, text, text, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cm_phone_id_set_eq(uuid[], uuid[]) FROM PUBLIC, anon, authenticated;

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
