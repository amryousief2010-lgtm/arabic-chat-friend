-- =====================================================================
-- طلبات عروض الأسعار — الفنادق والمطاعم (B2B) من نموذج capitalostrich.com
-- قرار م. عمرو (27/11/2026): قسم «للفنادق والمطاعم» على الموقع، التسعير عرض سعر لكل منشأة.
--   * كل طلب يصل كـ «فرصة شركة» لفريق المبيعات، منفصل تماماً عن طلبات الموقع (website_inbox)
--     وعن طلبات التجزئة (orders).
--   * الاستقبال: Edge Function b2b-quote-ingest (HMAC من سيرفر الموقع) → b2b_quote_ingest
--     (service_role فقط). حد معدّل الإرسال + منع التكرار بـ submission_id.
--   * مطابقة العميل بالموبايل = تنبيه «عميل محتمل مطابق» فقط. لا دمج تلقائي أبداً.
--     الربط بعميل موجود أو إنشاء عميل جديد يتم يدوياً من الشاشة بواسطة مدير المبيعات.
--   * الصلاحيات: المدير العام / المدير التنفيذي / مدير المبيعات يرون ويديرون الكل.
--     المودريتور (sales_moderator) يرى ويحدّث الطلبات المُسندة إليه فقط.
--   * إشعار داخلي (public.notifications) لكل مستخدم بدور sales_manager عند وصول طلب جديد،
--     وللمُسنَد إليه عند الإسناد. لا أرقام موبايل في نص الإشعار.
-- لا يلمس: cm_ad_attributions، جداول catering_*، website_inbox، orders.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) الصلاحيات
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.b2b_quote_can_manage()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(public.has_any_role(
    auth.uid(),
    ARRAY['general_manager','executive_manager','sales_manager']::public.app_role[]
  ), false)
$$;

REVOKE ALL ON FUNCTION public.b2b_quote_can_manage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b2b_quote_can_manage() TO authenticated;

-- ---------------------------------------------------------------------
-- 2) الجدول
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.b2b_quote_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_no              bigint GENERATED ALWAYS AS IDENTITY (START WITH 1001) UNIQUE,
  submission_id       text NOT NULL,
  facility_name       text NOT NULL CHECK (char_length(btrim(facility_name)) BETWEEN 2 AND 120),
  facility_type       text NOT NULL CHECK (facility_type IN ('hotel','restaurant','cafe','catering')),
  contact_name        text NOT NULL CHECK (char_length(btrim(contact_name)) BETWEEN 2 AND 80),
  phone_raw           text NOT NULL,
  phone_norm          text NOT NULL,
  phone_masked        text GENERATED ALWAYS AS (
                        CASE WHEN length(phone_norm) >= 7
                             THEN left(phone_norm, 3) || '*****' || right(phone_norm, 3)
                             ELSE '***' END) STORED,
  governorate         text NOT NULL CHECK (char_length(btrim(governorate)) BETWEEN 2 AND 40),
  requested_products  text[] NOT NULL DEFAULT '{}',
  weekly_qty          text CHECK (weekly_qty IS NULL OR char_length(weekly_qty) <= 200),
  notes               text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  source              text NOT NULL DEFAULT 'website_horeca',
  attribution         jsonb,
  ip_hash             text,
  status              text NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new','contacted','quote_sent','contracted','rejected')),
  assigned_to         uuid REFERENCES auth.users(id),
  assigned_by         uuid REFERENCES auth.users(id),
  assigned_at         timestamptz,
  quote_amount        numeric(14,2) CHECK (quote_amount IS NULL OR quote_amount >= 0),
  quote_notes         text CHECK (quote_notes IS NULL OR char_length(quote_notes) <= 2000),
  status_reason       text CHECK (status_reason IS NULL OR char_length(status_reason) <= 500),
  possible_match      boolean NOT NULL DEFAULT false,
  match_customer_ids  uuid[] NOT NULL DEFAULT '{}',
  linked_customer_id  uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  linked_by           uuid REFERENCES auth.users(id),
  linked_at           timestamptz,
  site_submitted_at   timestamptz,
  status_changed_at   timestamptz NOT NULL DEFAULT now(),
  status_changed_by   uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT b2b_quote_requests_submission_uniq UNIQUE (submission_id),
  CONSTRAINT b2b_quote_requests_products_chk CHECK (
    requested_products <@ ARRAY['whole_box','thigh','drumstick','steak','farasha','escalope','minced','burger','kofta']::text[]
  )
);

COMMENT ON TABLE public.b2b_quote_requests IS
  'طلبات عروض الأسعار من قسم «للفنادق والمطاعم» على capitalostrich.com. منفصل عن website_inbox وعن orders. لا دمج تلقائي للعملاء.';

CREATE INDEX IF NOT EXISTS b2b_quote_requests_status_idx   ON public.b2b_quote_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS b2b_quote_requests_assigned_idx ON public.b2b_quote_requests (assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS b2b_quote_requests_phone_idx    ON public.b2b_quote_requests (phone_norm, created_at DESC);
CREATE INDEX IF NOT EXISTS b2b_quote_requests_ip_idx       ON public.b2b_quote_requests (ip_hash, created_at DESC) WHERE ip_hash IS NOT NULL;

DROP TRIGGER IF EXISTS b2b_quote_requests_updated_at ON public.b2b_quote_requests;
CREATE TRIGGER b2b_quote_requests_updated_at
  BEFORE UPDATE ON public.b2b_quote_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.b2b_quote_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS b2b_quote_requests_read ON public.b2b_quote_requests;
CREATE POLICY b2b_quote_requests_read ON public.b2b_quote_requests
  FOR SELECT TO authenticated
  USING (
    (SELECT public.b2b_quote_can_manage())
    OR (
      assigned_to = (SELECT auth.uid())
      AND (SELECT public.has_role((SELECT auth.uid()), 'sales_moderator'::public.app_role))
    )
  );
-- لا INSERT/UPDATE/DELETE مباشر لأي دور: الاستقبال بـ service_role عبر b2b_quote_ingest،
-- والتعديل عبر الدوال أدناه فقط.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.b2b_quote_requests FROM anon, authenticated;
REVOKE ALL ON public.b2b_quote_requests FROM anon;

-- ---------------------------------------------------------------------
-- 3) سجل التدقيق
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.b2b_quote_request_audit (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.b2b_quote_requests(id) ON DELETE CASCADE,
  action     text NOT NULL,
  actor      uuid,
  details    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS b2b_quote_request_audit_req_idx ON public.b2b_quote_request_audit (request_id, created_at DESC);

ALTER TABLE public.b2b_quote_request_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS b2b_quote_request_audit_read ON public.b2b_quote_request_audit;
CREATE POLICY b2b_quote_request_audit_read ON public.b2b_quote_request_audit
  FOR SELECT TO authenticated
  USING (
    (SELECT public.b2b_quote_can_manage())
    OR EXISTS (
      SELECT 1 FROM public.b2b_quote_requests r
      WHERE r.id = b2b_quote_request_audit.request_id
        AND r.assigned_to = (SELECT auth.uid())
        AND (SELECT public.has_role((SELECT auth.uid()), 'sales_moderator'::public.app_role))
    )
  );
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.b2b_quote_request_audit FROM anon, authenticated;
REVOKE ALL ON public.b2b_quote_request_audit FROM anon;

-- ---------------------------------------------------------------------
-- 4) أسماء العرض العربية (للإشعارات)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.b2b_quote_type_label(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE _t WHEN 'hotel' THEN 'فندق' WHEN 'restaurant' THEN 'مطعم'
                 WHEN 'cafe' THEN 'كافيه' WHEN 'catering' THEN 'تموين' ELSE _t END
$$;

-- ---------------------------------------------------------------------
-- 5) الاستقبال (service_role فقط) — حد المعدّل + منع التكرار + تنبيه مطابقة + إشعار
--    يُرجع: {result: created|duplicate|rate_limited|invalid, id, ref_no}
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.b2b_quote_ingest(_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sub      text := btrim(coalesce(_data->>'submission_id',''));
  v_phone    text := btrim(coalesce(_data->>'mobile',''));
  v_norm     text;
  v_ip       text := nullif(btrim(coalesce(_data->>'ip_hash','')), '');
  v_existing public.b2b_quote_requests;
  v_row      public.b2b_quote_requests;
  v_matches  uuid[];
  v_products text[];
BEGIN
  IF v_sub = '' OR v_sub !~ '^[A-Za-z0-9_-]{8,64}$' THEN
    RETURN jsonb_build_object('result','invalid','field','submission_id');
  END IF;

  -- إعادة الإرسال بنفس submission_id = نفس الطلب (idempotent)، بدون إشعار جديد.
  SELECT * INTO v_existing FROM public.b2b_quote_requests WHERE submission_id = v_sub;
  IF FOUND THEN
    RETURN jsonb_build_object('result','duplicate','id',v_existing.id,'ref_no',v_existing.ref_no);
  END IF;

  v_norm := nullif(public.normalize_phone_eg(v_phone), '');
  IF v_norm IS NULL OR v_norm !~ '^01[0125][0-9]{8}$' THEN
    RETURN jsonb_build_object('result','invalid','field','mobile');
  END IF;

  -- حد المعدّل: 3 طلبات لنفس الموبايل / 24 ساعة، 5 من نفس الـ IP / ساعة، 60 إجمالي / ساعة.
  IF (SELECT count(*) FROM public.b2b_quote_requests
       WHERE phone_norm = v_norm AND created_at > now() - interval '24 hours') >= 3
     OR (v_ip IS NOT NULL AND (SELECT count(*) FROM public.b2b_quote_requests
       WHERE ip_hash = v_ip AND created_at > now() - interval '1 hour') >= 5)
     OR (SELECT count(*) FROM public.b2b_quote_requests
       WHERE created_at > now() - interval '1 hour') >= 60 THEN
    RETURN jsonb_build_object('result','rate_limited');
  END IF;

  SELECT coalesce(array_agg(DISTINCT p), '{}') INTO v_products
  FROM jsonb_array_elements_text(coalesce(_data->'products','[]'::jsonb)) AS p
  WHERE p IN ('whole_box','thigh','drumstick','steak','farasha','escalope','minced','burger','kofta');

  -- تنبيه مطابقة فقط (لا دمج): عملاء بنفس الموبايل في phone أو phone2.
  SELECT coalesce(array_agg(c.id ORDER BY c.created_at), '{}') INTO v_matches
  FROM public.customers c
  WHERE public.normalize_phone_eg(c.phone) = v_norm
     OR (c.phone2 IS NOT NULL AND btrim(c.phone2) <> '' AND public.normalize_phone_eg(c.phone2) = v_norm);

  BEGIN
    INSERT INTO public.b2b_quote_requests (
      submission_id, facility_name, facility_type, contact_name, phone_raw, phone_norm,
      governorate, requested_products, weekly_qty, notes, source, attribution, ip_hash,
      possible_match, match_customer_ids, site_submitted_at
    ) VALUES (
      v_sub,
      btrim(_data->>'facility_name'),
      _data->>'facility_type',
      btrim(_data->>'contact_name'),
      v_phone,
      v_norm,
      btrim(_data->>'governorate'),
      v_products,
      nullif(btrim(coalesce(_data->>'weekly_qty','')), ''),
      nullif(btrim(coalesce(_data->>'notes','')), ''),
      coalesce(nullif(btrim(coalesce(_data->>'source','')), ''), 'website_horeca'),
      CASE WHEN jsonb_typeof(_data->'attribution') = 'object' THEN _data->'attribution' END,
      v_ip,
      cardinality(v_matches) > 0,
      v_matches,
      CASE WHEN coalesce(_data->>'submitted_at','') ~ '^\d{4}-\d{2}-\d{2}T'
           THEN (_data->>'submitted_at')::timestamptz END
    )
    RETURNING * INTO v_row;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT * INTO v_existing FROM public.b2b_quote_requests WHERE submission_id = v_sub;
      RETURN jsonb_build_object('result','duplicate','id',v_existing.id,'ref_no',v_existing.ref_no);
    WHEN check_violation OR not_null_violation THEN
      RETURN jsonb_build_object('result','invalid','field','payload');
  END;

  INSERT INTO public.b2b_quote_request_audit (request_id, action, actor, details)
  VALUES (v_row.id, 'received', NULL,
          jsonb_build_object('source', v_row.source, 'possible_match', v_row.possible_match,
                             'products', to_jsonb(v_row.requested_products)));

  -- إشعار داخلي لكل مدير مبيعات (بدون رقم الموبايل).
  INSERT INTO public.notifications (title, description, type, target_user_id)
  SELECT 'طلب عرض سعر جديد — الفنادق والمطاعم',
         public.b2b_quote_type_label(v_row.facility_type) || ': ' || v_row.facility_name
           || ' • ' || v_row.governorate || ' • رقم الطلب HQ-' || v_row.ref_no
           || CASE WHEN v_row.possible_match THEN ' • يوجد عميل محتمل مطابق' ELSE '' END,
         'b2b_quote_request',
         ur.user_id
  FROM (SELECT DISTINCT user_id FROM public.user_roles WHERE role = 'sales_manager'::public.app_role) ur;

  RETURN jsonb_build_object('result','created','id',v_row.id,'ref_no',v_row.ref_no);
END;
$$;

REVOKE ALL ON FUNCTION public.b2b_quote_ingest(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.b2b_quote_ingest(jsonb) TO service_role;

-- ---------------------------------------------------------------------
-- 6) الإسناد (المدير العام / التنفيذي / مدير المبيعات)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.b2b_quote_assign(_id uuid, _user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.b2b_quote_requests;
BEGIN
  IF NOT public.b2b_quote_can_manage() THEN
    RAISE EXCEPTION 'b2b_quote_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.b2b_quote_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'b2b_quote_not_found' USING ERRCODE = 'P0002'; END IF;
  IF _user_id IS NOT NULL AND NOT public.has_any_role(
       _user_id, ARRAY['sales_moderator','sales_manager']::public.app_role[]) THEN
    RAISE EXCEPTION 'b2b_quote_bad_assignee' USING ERRCODE = '22023';
  END IF;

  UPDATE public.b2b_quote_requests
     SET assigned_to = _user_id, assigned_by = auth.uid(), assigned_at = now()
   WHERE id = _id;

  INSERT INTO public.b2b_quote_request_audit (request_id, action, actor, details)
  VALUES (_id, 'assigned', auth.uid(), jsonb_build_object('from', v_row.assigned_to, 'to', _user_id));

  IF _user_id IS NOT NULL AND _user_id IS DISTINCT FROM auth.uid() THEN
    INSERT INTO public.notifications (title, description, type, target_user_id)
    VALUES ('تم إسناد طلب عرض سعر إليك — الفنادق والمطاعم',
            public.b2b_quote_type_label(v_row.facility_type) || ': ' || v_row.facility_name
              || ' • ' || v_row.governorate || ' • رقم الطلب HQ-' || v_row.ref_no,
            'b2b_quote_assigned', _user_id);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.b2b_quote_assign(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b2b_quote_assign(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 7) تغيير الحالة + بيانات العرض
--    المديرون: أي طلب. المودريتور: الطلبات المُسندة إليه فقط.
--    quote_sent يتطلب قيمة عرض > 0. rejected يتطلب سبباً.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.b2b_quote_update(
  _id uuid,
  _status text,
  _quote_amount numeric DEFAULT NULL,
  _quote_notes text DEFAULT NULL,
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row    public.b2b_quote_requests;
  v_amount numeric;
  v_notes  text;
  v_reason text := nullif(btrim(coalesce(_reason,'')), '');
BEGIN
  SELECT * INTO v_row FROM public.b2b_quote_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'b2b_quote_not_found' USING ERRCODE = 'P0002'; END IF;

  IF NOT (public.b2b_quote_can_manage()
          OR (v_row.assigned_to = auth.uid()
              AND public.has_role(auth.uid(), 'sales_moderator'::public.app_role))) THEN
    RAISE EXCEPTION 'b2b_quote_forbidden' USING ERRCODE = '42501';
  END IF;

  IF _status NOT IN ('new','contacted','quote_sent','contracted','rejected') THEN
    RAISE EXCEPTION 'b2b_quote_bad_status' USING ERRCODE = '22023';
  END IF;

  v_amount := coalesce(_quote_amount, v_row.quote_amount);
  v_notes  := coalesce(nullif(btrim(coalesce(_quote_notes,'')), ''), v_row.quote_notes);

  IF _status IN ('quote_sent','contracted') AND (v_amount IS NULL OR v_amount <= 0) THEN
    RAISE EXCEPTION 'b2b_quote_amount_required' USING ERRCODE = '22023';
  END IF;
  IF _status = 'rejected' AND v_reason IS NULL THEN
    RAISE EXCEPTION 'b2b_quote_reason_required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.b2b_quote_requests
     SET status            = _status,
         quote_amount      = v_amount,
         quote_notes       = v_notes,
         status_reason     = CASE WHEN v_reason IS NOT NULL THEN v_reason
                                  WHEN _status <> v_row.status THEN NULL
                                  ELSE status_reason END,
         status_changed_at = CASE WHEN _status <> v_row.status THEN now() ELSE status_changed_at END,
         status_changed_by = CASE WHEN _status <> v_row.status THEN auth.uid() ELSE status_changed_by END
   WHERE id = _id;

  INSERT INTO public.b2b_quote_request_audit (request_id, action, actor, details)
  VALUES (_id, 'updated', auth.uid(), jsonb_build_object(
    'from_status', v_row.status, 'to_status', _status,
    'quote_amount', v_amount, 'reason', v_reason));
END;
$$;
REVOKE ALL ON FUNCTION public.b2b_quote_update(uuid, text, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b2b_quote_update(uuid, text, numeric, text, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 8) عملاء محتملون مطابقون (موبايل مُقنَّع) — للعرض فقط
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.b2b_quote_customer_candidates(_id uuid)
RETURNS TABLE (customer_id uuid, name text, phone_masked text, governorate text,
               total_orders integer, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.b2b_quote_can_manage() THEN
    RAISE EXCEPTION 'b2b_quote_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.id, c.name,
         CASE WHEN length(public.normalize_phone_eg(c.phone)) >= 7
              THEN left(public.normalize_phone_eg(c.phone), 3) || '*****' || right(public.normalize_phone_eg(c.phone), 3)
              ELSE '***' END,
         c.governorate, coalesce(c.total_orders, 0), c.created_at
  FROM public.b2b_quote_requests r
  JOIN public.customers c ON c.id = ANY (r.match_customer_ids)
  WHERE r.id = _id
  ORDER BY c.created_at;
END;
$$;
REVOKE ALL ON FUNCTION public.b2b_quote_customer_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b2b_quote_customer_candidates(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 9) الربط اليدوي بعميل (موجود من قائمة المطابقة، أو إنشاء عميل شركة جديد)
--    لا يعدّل بيانات العميل الموجود ولا يدمج أي سجلات.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.b2b_quote_link_customer(_id uuid, _customer_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row  public.b2b_quote_requests;
  v_cust uuid;
BEGIN
  IF NOT public.b2b_quote_can_manage() THEN
    RAISE EXCEPTION 'b2b_quote_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.b2b_quote_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'b2b_quote_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_row.linked_customer_id IS NOT NULL THEN
    RAISE EXCEPTION 'b2b_quote_already_linked' USING ERRCODE = '22023';
  END IF;

  IF _customer_id IS NOT NULL THEN
    IF NOT (_customer_id = ANY (v_row.match_customer_ids)) THEN
      RAISE EXCEPTION 'b2b_quote_customer_not_candidate' USING ERRCODE = '22023';
    END IF;
    v_cust := _customer_id;
  ELSE
    INSERT INTO public.customers (name, phone, governorate, source, notes)
    VALUES (
      v_row.facility_name,
      v_row.phone_norm,
      v_row.governorate,
      'ويب سايت - فنادق ومطاعم',
      'عميل شركة (' || public.b2b_quote_type_label(v_row.facility_type) || ') — المسؤول: '
        || v_row.contact_name || ' — من طلب عرض السعر HQ-' || v_row.ref_no
    )
    RETURNING id INTO v_cust;
  END IF;

  UPDATE public.b2b_quote_requests
     SET linked_customer_id = v_cust, linked_by = auth.uid(), linked_at = now()
   WHERE id = _id;

  INSERT INTO public.b2b_quote_request_audit (request_id, action, actor, details)
  VALUES (_id, CASE WHEN _customer_id IS NULL THEN 'customer_created' ELSE 'customer_linked' END,
          auth.uid(), jsonb_build_object('customer_id', v_cust));
  RETURN v_cust;
END;
$$;
REVOKE ALL ON FUNCTION public.b2b_quote_link_customer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b2b_quote_link_customer(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 10) كشف الموبايل كاملاً (للاتصال) — مُسجَّل في التدقيق
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.b2b_quote_reveal_phone(_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.b2b_quote_requests;
BEGIN
  SELECT * INTO v_row FROM public.b2b_quote_requests WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'b2b_quote_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT (public.b2b_quote_can_manage()
          OR (v_row.assigned_to = auth.uid()
              AND public.has_role(auth.uid(), 'sales_moderator'::public.app_role))) THEN
    RAISE EXCEPTION 'b2b_quote_forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.b2b_quote_request_audit (request_id, action, actor, details)
  VALUES (_id, 'phone_revealed', auth.uid(), NULL);
  RETURN v_row.phone_norm;
END;
$$;
REVOKE ALL ON FUNCTION public.b2b_quote_reveal_phone(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b2b_quote_reveal_phone(uuid) TO authenticated;

-- الأعمدة الحساسة لا تُقرأ مباشرة من العميل: الموبايل الكامل عبر b2b_quote_reveal_phone فقط.
REVOKE SELECT ON public.b2b_quote_requests FROM authenticated;
GRANT SELECT (
  id, ref_no, facility_name, facility_type, contact_name, phone_masked, governorate, requested_products,
  weekly_qty, notes, source, attribution, status, assigned_to, assigned_by, assigned_at,
  quote_amount, quote_notes, status_reason, possible_match, match_customer_ids,
  linked_customer_id, linked_by, linked_at, site_submitted_at, status_changed_at,
  status_changed_by, created_at, updated_at
) ON public.b2b_quote_requests TO authenticated;
