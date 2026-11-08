-- execute_sql harness for rehearsal phone-review verification.
-- Plain SQL only: no psql metacommands, no include directives, no psql variables.
-- No live user rows. No COMMIT statement. The gate change does not survive ROLLBACK.
--
-- Do not apply 20261103140000_chat_gate_allowlist.sql or
-- 20261103180000_marketing_manager_least_privilege.sql.
--
-- Order:
--   1. Temp snapshot (autocommit, before the test transaction).
--   2. BEGIN through ROLLBACK: schema-only production gate, page migration,
--      page assertions, PR105 scanner rollback, trigger check, reapply, scan check.
--   3. After ROLLBACK: fingerprint checks, then drop the temp snapshot.
--      If execute_sql stops at ROLLBACK, run section 3 as the next call in the
--      same session (the temp table is session-local).

CREATE TEMP TABLE IF NOT EXISTS cm_phone_review_exec_fp (
  k text PRIMARY KEY,
  v text
);
DELETE FROM cm_phone_review_exec_fp;
INSERT INTO cm_phone_review_exec_fp (k, v)
VALUES ('gate', md5(pg_get_functiondef('public.cm_gate_allows()'::regprocedure)));
INSERT INTO cm_phone_review_exec_fp (k, v)
VALUES (
  'allow',
  CASE WHEN to_regclass('public.cm_feature_gate_allowlist') IS NULL THEN '0' ELSE '1' END
);
INSERT INTO cm_phone_review_exec_fp (k, v)
VALUES (
  'kpi',
  CASE WHEN to_regclass('public.cm_kpi_viewer_allowlist') IS NULL THEN '0' ELSE '1' END
);
DO $fp$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    INSERT INTO cm_phone_review_exec_fp (k, v)
    VALUES (
      'cron',
      md5(coalesce((SELECT command || '|' || schedule FROM cron.job WHERE jobname = 'cm-scan-phone-review'), 'absent'))
    );
  ELSE
    INSERT INTO cm_phone_review_exec_fp (k, v) VALUES ('cron', 'no-extension');
  END IF;
END
$fp$;

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.cm_phone_review_queue') IS NULL
     OR to_regprocedure('public.cm_split_phone_field(text)') IS NULL
     OR to_regprocedure('public.cm_normalize_phone(text)') IS NULL
     OR to_regprocedure('public.cm_phone_is_valid(text)') IS NULL
     OR to_regclass('public.cm_feature_gate') IS NULL THEN
    RAISE EXCEPTION 'rehearsal is missing the phone-review queue, helpers, or cm_feature_gate';
  END IF;
END
$pre$;

CREATE TABLE IF NOT EXISTS public.cm_feature_gate_allowlist (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cm_feature_gate_allowlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cm_feature_gate_allowlist FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cm_feature_gate_allowlist TO authenticated;
DROP POLICY IF EXISTS cm_gate_allowlist_gm ON public.cm_feature_gate_allowlist;
CREATE POLICY cm_gate_allowlist_gm ON public.cm_feature_gate_allowlist
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['general_manager']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['general_manager']::public.app_role[]));

CREATE TABLE IF NOT EXISTS public.cm_kpi_viewer_allowlist (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.cm_kpi_viewer_allows()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.cm_kpi_viewer_allowlist WHERE user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.cm_gate_allows()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (auth.uid() IS NULL
          AND coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                       nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role')
              NOT IN ('anon','authenticated'))
      OR coalesce((SELECT access_mode FROM public.cm_feature_gate WHERE id), 'general_manager_only') = 'roles'
      OR public.has_any_role(auth.uid(), ARRAY['general_manager']::public.app_role[])
      OR (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.cm_feature_gate_allowlist a WHERE a.user_id = auth.uid()))
      OR (current_setting('cm.kpiv_ctx', true) = '1' AND public.cm_kpi_viewer_allows())
$$;
REVOKE ALL ON FUNCTION public.cm_gate_allows() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_gate_allows() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.cm_kpi_viewer_allows() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_kpi_viewer_allows() TO authenticated, service_role;

-- page migration
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
-- الاستدعاء للمدير العام والمدير التنفيذي ومديرة المبيعات فقط، ومع بوابة المحادثات.
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
  v_items jsonb := '[]'::jsonb;
  rec record;
  v_customers jsonb;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.cm_gate_allows()
     OR NOT public.has_any_role(auth.uid(), ARRAY['general_manager', 'executive_manager', 'sales_manager']::app_role[]) THEN
    RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  IF _issue IS NOT NULL AND btrim(_issue) <> '' AND _issue NOT IN ('malformed', 'two_numbers', 'multi_customer') THEN
    RAISE EXCEPTION 'CM_PHONE_ISSUE' USING ERRCODE = '22023';
  END IF;
  v_off := (v_page - 1) * v_size;
  v_end := CASE WHEN _month IS NULL THEN NULL ELSE (_month + interval '1 month')::date END;
  v_digits := NULLIF(regexp_replace(coalesce(_search, ''), '\D', '', 'g'), '');

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
             c.phone,
             c.phone2,
             (
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
             ) AS edit_fields,
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
-- المدير العام أو التنفيذي أو مديرة المبيعات، وبوابة المحادثات معاً.
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
     OR NOT public.cm_gate_allows()
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

-- page assertions
DO $$
DECLARE
  v_gm uuid := '00000000-0000-4000-8000-00000000f101';
  v_mod uuid := '00000000-0000-4000-8000-00000000f102';
  v_msm uuid := '00000000-0000-4000-8000-00000000f103';
  v_sm uuid := '00000000-0000-4000-8000-00000000f105';
  v_gate uuid := '00000000-0000-4000-8000-00000000f205';
  v_same uuid := '00000000-0000-4000-8000-00000000f201';
  v_split uuid := '00000000-0000-4000-8000-00000000f202';
  v_a uuid := '00000000-0000-4000-8000-00000000f301';
  v_b uuid := '00000000-0000-4000-8000-00000000f302';
  v_c uuid := '00000000-0000-4000-8000-00000000f303';
  v_old uuid := '00000000-0000-4000-8000-00000000f304';
  v_list jsonb;
  v_phone text;
  v_phone2 text;
  v_total numeric;
  v_status text;
  v_ids uuid[];
  v_n int;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_gm, 'phone-review-gm@example.com'),
    (v_mod, 'phone-review-mod@example.com'),
    (v_msm, 'phone-review-msm@example.com'),
    (v_sm, 'phone-review-sm@example.com');
  -- New users receive sales_moderator. Replace that default for the other roles.
  DELETE FROM public.user_roles WHERE user_id IN (v_gm, v_msm, v_sm);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_gm, 'general_manager'),
    (v_msm, 'marketing_sales_manager'),
    (v_sm, 'sales_manager');
  INSERT INTO public.cm_feature_gate_allowlist (user_id, note)
  VALUES (v_msm, 'اختبار مراجعة الأرقام')
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.customers (id, name, phone, phone2) VALUES
    (v_same, 'عميل اختبار متطابق', '01077771001', '01077771001'),
    (v_split, 'عميل اختبار حقلين', '01077771002 / 01077771003', NULL),
    (v_a, 'عميل اختبار أ', '01077771041', NULL),
    (v_b, 'عميل اختبار ب', '01077771041', NULL),
    (v_c, 'عميل اختبار ج', '01077771055', '01077771041'),
    (v_old, 'عميل اختبار قديم', '0223456789', NULL),
    (v_gate, 'عميل اختبار البوابة', '01077771088', NULL);

  IF EXISTS (
    SELECT 1 FROM public.cm_phone_review_queue
    WHERE customer_id = v_same AND issue = 'two_numbers'
  ) THEN
    RAISE EXCEPTION 'identical phone and phone2 emitted two_numbers';
  END IF;

  INSERT INTO public.orders (order_number, customer_id, status, total, created_at, moderator) VALUES
    ('ORD-TEST-NOV', v_a, 'pending', 150, timestamptz '2026-11-08 10:00:00+02', 'اختبار'),
    ('ORD-TEST-OLD', v_old, 'delivered', 80, timestamptz '2026-01-15 10:00:00+02', 'اختبار'),
    ('ORD-TEST-B', v_b, 'shipped', 40, timestamptz '2026-01-20 10:00:00+02', 'اختبار');

  PERFORM set_config('request.jwt.claim.sub', v_gm::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_list := public.cm_phone_review_list('2026-11-01', NULL, NULL, 1, 25);
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_list->'items') item
    WHERE item->>'issue' = 'multi_customer'
      AND item->>'phone_norm' = '01077771041'
      AND (
        SELECT count(*) FROM jsonb_array_elements(item->'customers')
      ) = 3
  ) THEN
    RAISE EXCEPTION 'November page did not keep every duplicate-group member';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_list->'items') item
    WHERE item->'customers' @> jsonb_build_array(jsonb_build_object('id', v_old::text))
       OR (item->>'phone_raw') = '0223456789'
  ) THEN
    RAISE EXCEPTION 'customer with only a January order appeared in November';
  END IF;

  v_list := public.cm_phone_review_list(NULL, NULL, 'ORD-TEST-NOV', 1, 25);
  IF (v_list->>'total')::int < 1 THEN
    RAISE EXCEPTION 'search by order number missed the group';
  END IF;

  v_list := public.cm_phone_review_list(NULL, 'malformed', NULL, 1, 1);
  IF (v_list->>'page_size')::int <> 1 OR jsonb_array_length(v_list->'items') > 1 THEN
    RAISE EXCEPTION 'page size was not honored';
  END IF;
  IF (v_list->>'total')::int < jsonb_array_length(v_list->'items') THEN
    RAISE EXCEPTION 'total is smaller than the page';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_mod::text, true);
  BEGIN
    PERFORM public.cm_correct_customer_phone(v_split, 'phone', '01077771009', false);
    RAISE EXCEPTION 'moderator correction was allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_sm::text, true);
  BEGIN
    PERFORM public.cm_phone_review_list('2026-11-01', NULL, NULL, 1, 25);
    RAISE EXCEPTION 'gate-denied sales manager listed the queue';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    PERFORM public.cm_correct_customer_phone(v_gate, 'phone', '01077771089', false);
    RAISE EXCEPTION 'gate-denied sales manager corrected a phone';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  IF (SELECT phone FROM public.customers WHERE id = v_gate) IS DISTINCT FROM '01077771088' THEN
    RAISE EXCEPTION 'gate-denied correction changed the phone';
  END IF;
  INSERT INTO public.cm_feature_gate_allowlist (user_id, note)
  VALUES (v_sm, 'مديرة مبيعات مسموح لها بالبوابة')
  ON CONFLICT (user_id) DO NOTHING;
  PERFORM public.cm_correct_customer_phone(v_gate, 'phone', '01077771089', false);
  IF (SELECT phone FROM public.customers WHERE id = v_gate) IS DISTINCT FROM '01077771089' THEN
    RAISE EXCEPTION 'allowlisted sales manager correction did not save';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_msm::text, true);
  BEGIN
    PERFORM public.cm_correct_customer_phone(v_split, 'phone', '01077771009', false);
    RAISE EXCEPTION 'marketing-only correction was allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    PERFORM public.cm_phone_review_list('2026-11-01', 'multi_customer', NULL, 1, 25);
    RAISE EXCEPTION 'marketing-only list was allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_gm::text, true);
  BEGIN
    PERFORM public.cm_correct_customer_phone(v_split, 'phone', '01077771002', false);
    RAISE EXCEPTION 'dropping a second number was saved without confirmation';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'CM_PHONE_DROP_CONFIRM' THEN
      RAISE;
    END IF;
  END;
  SELECT phone INTO v_phone FROM public.customers WHERE id = v_split;
  IF v_phone IS DISTINCT FROM '01077771002 / 01077771003' THEN
    RAISE EXCEPTION 'unconfirmed correction changed the field';
  END IF;

  BEGIN
    PERFORM public.cm_correct_customer_phone(v_split, 'phone', '0223456789', true);
    RAISE EXCEPTION 'invalid number was saved';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  PERFORM public.cm_correct_customer_phone(v_split, 'phone', '01077771002', true);
  SELECT phone, phone2 INTO v_phone, v_phone2 FROM public.customers WHERE id = v_split;
  IF v_phone IS DISTINCT FROM '01077771002' OR v_phone2 IS NOT NULL THEN
    RAISE EXCEPTION 'correction did not keep only the chosen field';
  END IF;
  SELECT total INTO v_total FROM public.orders WHERE order_number = 'ORD-TEST-NOV';
  IF v_total IS DISTINCT FROM 150 THEN
    RAISE EXCEPTION 'order row changed during phone correction';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cm_phone_review_queue
    WHERE customer_id = v_split AND issue = 'two_numbers' AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'corrected two_numbers row stayed open';
  END IF;

  SELECT status, related_customer_ids INTO v_status, v_ids
  FROM public.cm_phone_review_queue
  WHERE issue = 'multi_customer' AND phone_norm = '01077771041';
  IF v_status IS DISTINCT FROM 'open' OR NOT (v_ids @> ARRAY[v_a, v_b, v_c] AND v_ids <@ ARRAY[v_a, v_b, v_c]) THEN
    RAISE EXCEPTION 'shared number was closed while three customers still have it';
  END IF;

  UPDATE public.cm_phone_review_queue
  SET status = 'dismissed', resolution = 'dismissed', related_customer_ids = ARRAY[v_c, v_b, v_a]
  WHERE issue = 'multi_customer' AND phone_norm = '01077771041';
  PERFORM public.cm_scan_phone_review(ARRAY[v_a]);
  SELECT status, count(*) INTO v_status, v_n
  FROM public.cm_phone_review_queue
  WHERE issue = 'multi_customer' AND phone_norm = '01077771041'
  GROUP BY status;
  IF v_n IS DISTINCT FROM 1 OR v_status IS DISTINCT FROM 'dismissed' THEN
    RAISE EXCEPTION 'identical dismissed group was reopened';
  END IF;

  PERFORM public.cm_correct_customer_phone(v_c, 'phone2', '01077771077', false);
  SELECT status, related_customer_ids INTO v_status, v_ids
  FROM public.cm_phone_review_queue
  WHERE issue = 'multi_customer' AND phone_norm = '01077771041';
  IF v_status IS DISTINCT FROM 'open' OR NOT (v_ids @> ARRAY[v_a, v_b] AND v_ids <@ ARRAY[v_a, v_b]) THEN
    RAISE EXCEPTION 'remaining duplicate pair was not kept open, status % ids %', v_status, v_ids;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cm_phone_review_queue
    WHERE issue = 'multi_customer' AND phone_norm = '01077771041' AND status = 'open'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate open rows were created';
  END IF;
END;
$$;

-- restore PR105 scanner, then drop the page helper it must not depend on
-- تراجع قائمة مراجعة الأرقام وتصحيح الحقل.
-- يعيد دالة الفحص والمشغّل إلى نسخة PR105 المنشورة (2443f8c) قبل إسقاط
-- cm_phone_id_set_eq، لأن الماسح الحالي يعتمد عليها.
-- لا يحذف صفوف الطابور ولا يمسّ العملاء أو الطلبات.

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

DROP FUNCTION IF EXISTS public.cm_phone_review_list(date, text, text, int, int);
DROP FUNCTION IF EXISTS public.cm_correct_customer_phone(uuid, text, text, boolean);
DROP FUNCTION IF EXISTS public.cm_phone_id_set_eq(uuid[], uuid[]);

-- rollback assertions
DO $$
DECLARE
  v_src text;
BEGIN
  IF to_regprocedure('public.cm_phone_id_set_eq(uuid[],uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback left cm_phone_id_set_eq';
  END IF;
  IF to_regprocedure('public.cm_phone_review_list(date,text,text,int,int)') IS NOT NULL
     OR to_regprocedure('public.cm_correct_customer_phone(uuid,text,text,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback left a page RPC';
  END IF;
  IF to_regprocedure('public.cm_scan_phone_review(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'rollback dropped the scanner';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE proname = 'cm_scan_phone_review';
  IF position('cm_phone_id_set_eq' IN v_src) > 0 THEN
    RAISE EXCEPTION 'restored scanner still calls cm_phone_id_set_eq';
  END IF;
  IF position('field_no' IN v_src) = 0 THEN
    RAISE EXCEPTION 'restored scanner is not the field-scoped PR105 body';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_customers_cm_phone_review' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'rollback dropped the customer phone trigger';
  END IF;
END;
$$;

SAVEPOINT cm_phone_review_exec_scan;
INSERT INTO public.customers (name, phone, phone2)
VALUES ('تراجع فحص', '01077773001', '01077773001');
DO $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.customers WHERE name = 'تراجع فحص';
  IF EXISTS (
    SELECT 1 FROM public.cm_phone_review_queue
    WHERE customer_id = v_id AND issue = 'two_numbers'
  ) THEN
    RAISE EXCEPTION 'restored scanner marked identical fields as two_numbers';
  END IF;
  UPDATE public.customers SET phone = '0223456789' WHERE id = v_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.cm_phone_review_queue
    WHERE customer_id = v_id AND issue = 'malformed' AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'restored trigger did not queue a malformed number';
  END IF;
END;
$$;
ROLLBACK TO SAVEPOINT cm_phone_review_exec_scan;

-- reapply page migration
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
-- الاستدعاء للمدير العام والمدير التنفيذي ومديرة المبيعات فقط، ومع بوابة المحادثات.
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
  v_items jsonb := '[]'::jsonb;
  rec record;
  v_customers jsonb;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.cm_gate_allows()
     OR NOT public.has_any_role(auth.uid(), ARRAY['general_manager', 'executive_manager', 'sales_manager']::app_role[]) THEN
    RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  IF _issue IS NOT NULL AND btrim(_issue) <> '' AND _issue NOT IN ('malformed', 'two_numbers', 'multi_customer') THEN
    RAISE EXCEPTION 'CM_PHONE_ISSUE' USING ERRCODE = '22023';
  END IF;
  v_off := (v_page - 1) * v_size;
  v_end := CASE WHEN _month IS NULL THEN NULL ELSE (_month + interval '1 month')::date END;
  v_digits := NULLIF(regexp_replace(coalesce(_search, ''), '\D', '', 'g'), '');

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
             c.phone,
             c.phone2,
             (
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
             ) AS edit_fields,
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
-- المدير العام أو التنفيذي أو مديرة المبيعات، وبوابة المحادثات معاً.
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
     OR NOT public.cm_gate_allows()
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

-- reapply assertions
DO $$
DECLARE
  v_src text;
BEGIN
  IF to_regprocedure('public.cm_phone_id_set_eq(uuid[],uuid[])') IS NULL THEN
    RAISE EXCEPTION 'reapply did not restore cm_phone_id_set_eq';
  END IF;
  IF to_regprocedure('public.cm_phone_review_list(date,text,text,int,int)') IS NULL
     OR to_regprocedure('public.cm_correct_customer_phone(uuid,text,text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'reapply did not restore the page RPCs';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE proname = 'cm_scan_phone_review';
  IF position('cm_phone_id_set_eq' IN v_src) = 0 THEN
    RAISE EXCEPTION 'reapplied scanner does not reconcile groups';
  END IF;
END;
$$;

SAVEPOINT cm_phone_review_exec_reapply;
DO $$
DECLARE
  v_id uuid := '00000000-0000-4000-8000-00000000f401';
BEGIN
  INSERT INTO public.customers (id, name, phone, phone2)
  VALUES (v_id, 'إعادة تطبيق', '01077773002', '01077773002');
  PERFORM public.cm_scan_phone_review(ARRAY[v_id]);
  IF EXISTS (
    SELECT 1 FROM public.cm_phone_review_queue
    WHERE customer_id = v_id AND issue = 'two_numbers'
  ) THEN
    RAISE EXCEPTION 'reapplied scanner marked identical fields as two_numbers';
  END IF;
END;
$$;
ROLLBACK TO SAVEPOINT cm_phone_review_exec_reapply;

ROLLBACK;

DO $check$
DECLARE
  v_cron text;
BEGIN
  IF to_regclass('pg_temp.cm_phone_review_exec_fp') IS NULL THEN
    RAISE EXCEPTION 'snapshot missing; run this file as one script so the temp table exists before BEGIN';
  END IF;
  IF md5(pg_get_functiondef('public.cm_gate_allows()'::regprocedure))
     IS DISTINCT FROM (SELECT v FROM cm_phone_review_exec_fp WHERE k = 'gate') THEN
    RAISE EXCEPTION 'cm_gate_allows changed after rollback';
  END IF;
  IF (CASE WHEN to_regclass('public.cm_feature_gate_allowlist') IS NULL THEN '0' ELSE '1' END)
     IS DISTINCT FROM (SELECT v FROM cm_phone_review_exec_fp WHERE k = 'allow') THEN
    RAISE EXCEPTION 'cm_feature_gate_allowlist presence changed after rollback';
  END IF;
  IF (CASE WHEN to_regclass('public.cm_kpi_viewer_allowlist') IS NULL THEN '0' ELSE '1' END)
     IS DISTINCT FROM (SELECT v FROM cm_phone_review_exec_fp WHERE k = 'kpi') THEN
    RAISE EXCEPTION 'cm_kpi_viewer_allowlist presence changed after rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    v_cron := md5(coalesce((SELECT command || '|' || schedule FROM cron.job WHERE jobname = 'cm-scan-phone-review'), 'absent'));
  ELSE
    v_cron := 'no-extension';
  END IF;
  IF v_cron IS DISTINCT FROM (SELECT v FROM cm_phone_review_exec_fp WHERE k = 'cron') THEN
    RAISE EXCEPTION 'pg_cron job cm-scan-phone-review changed after rollback';
  END IF;
END
$check$;

DROP TABLE IF EXISTS cm_phone_review_exec_fp;
