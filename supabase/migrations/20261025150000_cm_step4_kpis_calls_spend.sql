-- إدارة المحادثات — الخطوة 4: الإنفاق الإعلاني اليومي، مكالمات الخط الساخن (CDR) والتسجيلات، متابعة المكالمات الفائتة،
-- ربط المحادثة بالطلب، ومؤشرات الأداء (views بـ security_invoker تُحسب لحظياً من orders و cm_*).
-- إضافة فقط وقابلة لإعادة التشغيل. لا تعتمد على أي توكن من ميتا: الإنفاق يُدخل يدوياً/CSV الآن، و source='marketing_api' محجوز لاحقاً.
-- لا روابط ولا أسرار مخزنة: التسجيل = مسار داخل bucket خاص فقط؛ الرابط الموقّع يُطلب لحظياً بعد تسجيل الاستماع.
-- التراجع: DROP VIEW cm_kpi_*_v; DROP FUNCTION cm_kpi_*, cm_import_hotline_cdr, cm_upsert_ad_spend, cm_request_recording_access,
--          cm_link_conversation_order, cm_mark_missed_call_followed_up, cm_first_reply_kpi_status, cm_order_is_*; DROP TABLE cm_ad_spend_daily,
--          cm_recording_access_log, cm_calls, cm_conversation_orders;

-- ───────────── الصلاحيات المساعدة ─────────────
-- كتابة الإنفاق: MSM / SM / GM / EM (+ النظام عبر cm_is_system_or_manager للـ service role)
CREATE OR REPLACE FUNCTION public.cm_can_write_spend()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(auth.uid(),
    ARRAY['marketing_sales_manager','sales_manager','general_manager','executive_manager']::public.app_role[])
$$;
-- الاستماع للتسجيلات: GM / EM / SM فقط
CREATE OR REPLACE FUNCTION public.cm_can_listen_recordings()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','sales_manager']::public.app_role[])
$$;
CREATE OR REPLACE FUNCTION public.cm_is_service()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NULL AND public.cm_is_system_or_manager()
$$;

-- ───────────── حالات الطلب (من المستودع: orderSalesFilters.ts + migrations 20260707122330) ─────────────
-- مُسلَّم: delivered / collected / completed.  ملغي (والمرتجعات تُخزَّن cancelled): cancelled.
-- partially_returned / fully_returned تظهر في دوال أخرى بالمستودع ⇒ تُحسب «محسومة غير مُسلَّمة» (غير مُتحقَّق منها على الحي).
CREATE OR REPLACE FUNCTION public.cm_order_is_delivered(_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT lower(btrim(coalesce(_status,''))) IN ('delivered','collected','completed') $$;
CREATE OR REPLACE FUNCTION public.cm_order_is_cancelled(_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT lower(btrim(coalesce(_status,''))) = 'cancelled' $$;
CREATE OR REPLACE FUNCTION public.cm_order_is_resolved(_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT public.cm_order_is_delivered(_status) OR lower(btrim(coalesce(_status,''))) IN ('cancelled','partially_returned','fully_returned') $$;

-- ───────────── الإنفاق الإعلاني اليومي ─────────────
CREATE TABLE IF NOT EXISTS public.cm_ad_spend_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.cm_campaigns(id) ON DELETE CASCADE,
  ad_account_id text,
  spend_date date NOT NULL,
  spend numeric(14,2) NOT NULL CHECK (spend >= 0),
  currency text NOT NULL DEFAULT 'EGP' CHECK (currency ~ '^[A-Z]{3}$'),
  impressions bigint CHECK (impressions >= 0),
  clicks bigint CHECK (clicks >= 0),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('marketing_api','manual')),
  entered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cm_ad_spend_daily_uniq UNIQUE (campaign_id, spend_date)
);
CREATE INDEX IF NOT EXISTS cm_ad_spend_daily_date_idx ON public.cm_ad_spend_daily (spend_date);

-- ───────────── مكالمات الخط الساخن ─────────────
CREATE TABLE IF NOT EXISTS public.cm_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_call_id text NOT NULL UNIQUE,              -- معرّف السطر في CDR المزوّد (إعادة الاستيراد آمنة)
  line_id uuid REFERENCES public.cm_lines(id) ON DELETE SET NULL,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  started_at timestamptz NOT NULL,
  duration_sec int NOT NULL DEFAULT 0 CHECK (duration_sec >= 0),
  status text NOT NULL CHECK (status IN ('answered','missed','busy','failed','voicemail')),
  phone_raw text,
  phone_norm text,
  contact_id uuid REFERENCES public.cm_contacts(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  moderator_id uuid REFERENCES public.cm_moderators(id) ON DELETE SET NULL,
  -- مسار فقط داخل bucket خاص — ممنوع أي رابط أو توكن
  recording_path text CHECK (recording_path IS NULL OR (recording_path !~* '^[a-z]+://' AND recording_path !~ '[?#]' AND recording_path !~ '\.\.')),
  followed_up_at timestamptz,                          -- متابعة يدوية (مثلاً من تطبيق واتساب)
  followed_up_by uuid,
  source text NOT NULL DEFAULT 'cdr_csv' CHECK (source IN ('cdr_csv','manual')),
  imported_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cm_calls_phone_idx ON public.cm_calls (phone_norm, started_at);
CREATE INDEX IF NOT EXISTS cm_calls_started_idx ON public.cm_calls (started_at);

CREATE TABLE IF NOT EXISTS public.cm_recording_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.cm_calls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  storage_path text NOT NULL,
  accessed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cm_recording_access_log_idx ON public.cm_recording_access_log (user_id, storage_path, accessed_at DESC);

-- ───────────── ربط المحادثة بالطلب (صريح؛ لا دمج عملاء أبداً) ─────────────
CREATE TABLE IF NOT EXISTS public.cm_conversation_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.cm_conversations(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('phone_match','manual')),
  phone_norm text,
  linked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cm_conversation_orders_uniq UNIQUE (conversation_id, order_id)
);
CREATE INDEX IF NOT EXISTS cm_conversation_orders_order_idx ON public.cm_conversation_orders (order_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['cm_ad_spend_daily','cm_calls'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_touch BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.cm_touch_updated_at()', t);
  END LOOP;
END $$;

-- هل الطلب يخص هذا الرقم؟ (رقم العميل أو رقمه الثاني أو أرقامه في cm_contact_phones، بعد التطبيع)
CREATE OR REPLACE FUNCTION public.cm_order_matches_phone(_order_id uuid, _phone_norm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _phone_norm IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.orders o JOIN public.customers cu ON cu.id = o.customer_id
    WHERE o.id = _order_id AND (
      public.cm_normalize_phone(cu.phone) = _phone_norm OR public.cm_normalize_phone(cu.phone2) = _phone_norm
      OR EXISTS (SELECT 1 FROM public.cm_contact_phones cp WHERE cp.customer_id = cu.id AND cp.phone_norm = _phone_norm AND cp.is_valid)))
$$;

-- ربط صريح: يتطلب تطابق الرقم المطبَّع. _manual = ربط يدوي بدون تطابق (SM/GM فقط). من يرى المحادثة يستطيع الربط بالتطابق.
CREATE OR REPLACE FUNCTION public.cm_link_conversation_order(_conversation_id uuid, _order_id uuid, _manual boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_phone text; v_id uuid; v_match boolean;
BEGIN
  IF NOT (public.cm_is_service() OR public.cm_can_manage() OR public.cm_can_see_conversation(_conversation_id)) THEN
    RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  SELECT phone_norm INTO v_phone FROM public.cm_conversations WHERE id = _conversation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CM_CONVERSATION_NOT_FOUND'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = _order_id) THEN RAISE EXCEPTION 'CM_ORDER_NOT_FOUND'; END IF;
  v_match := public.cm_order_matches_phone(_order_id, v_phone);
  IF NOT v_match AND NOT (_manual AND (public.cm_can_manage() OR public.cm_is_service())) THEN
    RAISE EXCEPTION 'CM_PHONE_MISMATCH' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cm_conversation_orders (conversation_id, order_id, method, phone_norm, linked_by)
  VALUES (_conversation_id, _order_id, CASE WHEN v_match THEN 'phone_match' ELSE 'manual' END, v_phone, auth.uid())
  ON CONFLICT (conversation_id, order_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN SELECT id INTO v_id FROM public.cm_conversation_orders WHERE conversation_id = _conversation_id AND order_id = _order_id; END IF;
  RETURN v_id;
END $$;

-- اقتراح الطلبات المطابقة لرقم المحادثة (خلال نافذة التحويل) — اقتراح فقط، الربط بقرار صريح.
CREATE OR REPLACE FUNCTION public.cm_suggest_conversation_orders(_conversation_id uuid)
RETURNS TABLE (order_id uuid, order_number text, created_at timestamptz, status text, total numeric, already_linked boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT o.id, o.order_number, o.created_at, o.status, o.total,
         EXISTS (SELECT 1 FROM public.cm_conversation_orders l WHERE l.conversation_id = c.id AND l.order_id = o.id)
  FROM public.cm_conversations c
  JOIN public.orders o ON o.created_at >= c.first_inbound_at - interval '1 day'
   AND o.created_at < c.first_inbound_at + make_interval(days => coalesce((SELECT conversion_window_days FROM public.cm_kpi_settings WHERE id = 1), 7))
  WHERE c.id = _conversation_id AND public.cm_order_matches_phone(o.id, c.phone_norm)
  ORDER BY o.created_at
$$;

-- ───────────── استيراد CDR (service role أو SM/GM) ─────────────
-- _rows: [{external_call_id, direction, started_at, duration_sec, status, phone, moderator, line, recording_path}]
CREATE OR REPLACE FUNCTION public.cm_import_hotline_cdr(_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; i int := 0; n_ins int := 0; n_dup int := 0; rej jsonb := '[]'; v_phone text; v_id uuid;
        v_dir text; v_status text; v_started timestamptz; v_dur int; v_path text; v_err text;
BEGIN
  IF NOT public.cm_is_system_or_manager() THEN RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(_rows) <> 'array' THEN RAISE EXCEPTION 'CM_ROWS_NOT_ARRAY'; END IF;
  IF jsonb_array_length(_rows) > 5000 THEN RAISE EXCEPTION 'CM_TOO_MANY_ROWS'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    i := i + 1; v_err := NULL;
    v_dir := lower(btrim(r->>'direction')); v_status := lower(btrim(r->>'status'));
    v_path := nullif(btrim(r->>'recording_path'), '');
    BEGIN v_started := (r->>'started_at')::timestamptz; EXCEPTION WHEN others THEN v_started := NULL; END;
    BEGIN v_dur := coalesce(nullif(r->>'duration_sec','')::int, 0); EXCEPTION WHEN others THEN v_dur := -1; END;
    v_phone := public.cm_normalize_phone(r->>'phone');
    IF coalesce(btrim(r->>'external_call_id'), '') = '' THEN v_err := 'missing_id';
    ELSIF v_dir NOT IN ('inbound','outbound') OR v_dir IS NULL THEN v_err := 'bad_direction';
    ELSIF v_status NOT IN ('answered','missed','busy','failed','voicemail') OR v_status IS NULL THEN v_err := 'bad_status';
    ELSIF v_started IS NULL THEN v_err := 'bad_started_at';
    ELSIF v_dur < 0 THEN v_err := 'bad_duration';
    ELSIF NOT public.cm_phone_is_valid(v_phone) THEN v_err := 'bad_phone';
    ELSIF v_path IS NOT NULL AND (v_path ~* '^[a-z]+://' OR v_path ~ '[?#]' OR v_path ~ '\.\.') THEN v_err := 'recording_must_be_path';
    END IF;
    IF v_err IS NOT NULL THEN rej := rej || jsonb_build_object('row', i, 'reason', v_err); CONTINUE; END IF;
    INSERT INTO public.cm_calls (external_call_id, line_id, direction, started_at, duration_sec, status, phone_raw, phone_norm,
                                 contact_id, customer_id, moderator_id, recording_path, imported_by)
    VALUES (btrim(r->>'external_call_id'),
            (SELECT id FROM public.cm_lines WHERE label = btrim(r->>'line') OR external_id = btrim(r->>'line') LIMIT 1),
            v_dir, v_started, v_dur, v_status, r->>'phone', v_phone,
            (SELECT id FROM public.cm_contacts WHERE phone_norm = v_phone),
            public.cm_customer_for_phone(v_phone),
            public.cm_moderator_id_for_name(r->>'moderator'),
            v_path, auth.uid())
    ON CONFLICT (external_call_id) DO NOTHING RETURNING id INTO v_id;
    IF v_id IS NULL THEN n_dup := n_dup + 1; ELSE n_ins := n_ins + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('inserted', n_ins, 'duplicates', n_dup, 'rejected', rej);
END $$;

CREATE OR REPLACE FUNCTION public.cm_mark_missed_call_followed_up(_call_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.cm_can_manage() OR EXISTS (SELECT 1 FROM public.cm_calls WHERE id = _call_id
          AND moderator_id IS NOT NULL AND moderator_id = public.cm_current_moderator_id())) THEN
    RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  UPDATE public.cm_calls SET followed_up_at = coalesce(followed_up_at, now()), followed_up_by = coalesce(followed_up_by, auth.uid())
  WHERE id = _call_id AND status = 'missed';
END $$;

-- ───────────── التسجيلات: سجل استماع + طلب رابط موقّع قصير ─────────────
-- لا تُرجع رابطاً: تُرجع bucket/path/expires_in؛ الواجهة تطلب الرابط الموقّع من Storage، وسياسة Storage
-- تسمح بالقراءة فقط لمن له سجل استماع لنفس المسار خلال آخر 5 دقائق.
CREATE OR REPLACE FUNCTION public.cm_request_recording_access(_call_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_path text; v_log uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.cm_can_listen_recordings() THEN RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  SELECT recording_path INTO v_path FROM public.cm_calls WHERE id = _call_id;
  IF v_path IS NULL THEN RAISE EXCEPTION 'CM_NO_RECORDING'; END IF;
  INSERT INTO public.cm_recording_access_log (call_id, user_id, storage_path) VALUES (_call_id, auth.uid(), v_path) RETURNING id INTO v_log;
  RETURN jsonb_build_object('bucket', 'cm-call-recordings', 'path', v_path, 'expires_in', 120, 'log_id', v_log);
END $$;

DO $$ BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public) VALUES ('cm-call-recordings', 'cm-call-recordings', false)
    ON CONFLICT (id) DO UPDATE SET public = false;
  END IF;
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS cm_recordings_read ON storage.objects;
    CREATE POLICY cm_recordings_read ON storage.objects FOR SELECT TO authenticated USING (
      bucket_id = 'cm-call-recordings' AND public.cm_can_listen_recordings()
      AND EXISTS (SELECT 1 FROM public.cm_recording_access_log l
                  WHERE l.user_id = auth.uid() AND l.storage_path = storage.objects.name AND l.accessed_at > now() - interval '5 minutes'));
    -- لا سياسة INSERT/UPDATE/DELETE للمستخدمين: الرفع عبر service role فقط.
  END IF;
END $$;

-- ───────────── الإنفاق: upsert (MSM/SM/GM/EM أو النظام) ─────────────
-- _rows: [{campaign_id | meta_campaign_id | campaign_name, spend_date, spend, currency, impressions, clicks, ad_account_id}]
CREATE OR REPLACE FUNCTION public.cm_upsert_ad_spend(_rows jsonb, _source text DEFAULT 'manual')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; i int := 0; n_ins int := 0; n_upd int := 0; rej jsonb := '[]'; v_c uuid; v_d date; v_s numeric; v_ins boolean; v_err text;
BEGIN
  IF NOT (public.cm_is_service() OR public.cm_can_write_spend()) THEN RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF _source NOT IN ('manual','marketing_api') THEN RAISE EXCEPTION 'CM_BAD_SOURCE'; END IF;
  IF _source = 'marketing_api' AND NOT public.cm_is_service() THEN RAISE EXCEPTION 'CM_API_SOURCE_SERVICE_ONLY' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(_rows) <> 'array' THEN RAISE EXCEPTION 'CM_ROWS_NOT_ARRAY'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    i := i + 1; v_err := NULL; v_c := NULL;
    BEGIN v_c := nullif(r->>'campaign_id','')::uuid; EXCEPTION WHEN others THEN v_c := NULL; END;
    v_c := coalesce((SELECT id FROM public.cm_campaigns WHERE id = v_c),
                    (SELECT id FROM public.cm_campaigns WHERE meta_campaign_id = nullif(btrim(r->>'meta_campaign_id'),'')),
                    (SELECT id FROM public.cm_campaigns WHERE name = nullif(btrim(r->>'campaign_name'),'') LIMIT 1));
    BEGIN v_d := (r->>'spend_date')::date; EXCEPTION WHEN others THEN v_d := NULL; END;
    BEGIN v_s := (r->>'spend')::numeric; EXCEPTION WHEN others THEN v_s := NULL; END;
    IF v_c IS NULL THEN v_err := 'unknown_campaign';
    ELSIF v_d IS NULL THEN v_err := 'bad_date';
    ELSIF v_s IS NULL OR v_s < 0 THEN v_err := 'bad_spend';
    ELSIF coalesce(r->>'currency','EGP') !~ '^[A-Z]{3}$' THEN v_err := 'bad_currency';
    END IF;
    IF v_err IS NOT NULL THEN rej := rej || jsonb_build_object('row', i, 'reason', v_err); CONTINUE; END IF;
    INSERT INTO public.cm_ad_spend_daily (campaign_id, ad_account_id, spend_date, spend, currency, impressions, clicks, source, entered_by)
    VALUES (v_c, nullif(r->>'ad_account_id',''), v_d, round(v_s, 2), coalesce(r->>'currency','EGP'),
            nullif(r->>'impressions','')::bigint, nullif(r->>'clicks','')::bigint, _source, auth.uid())
    ON CONFLICT (campaign_id, spend_date) DO UPDATE SET
      spend = EXCLUDED.spend, currency = EXCLUDED.currency, ad_account_id = coalesce(EXCLUDED.ad_account_id, cm_ad_spend_daily.ad_account_id),
      impressions = coalesce(EXCLUDED.impressions, cm_ad_spend_daily.impressions), clicks = coalesce(EXCLUDED.clicks, cm_ad_spend_daily.clicks),
      source = EXCLUDED.source, entered_by = EXCLUDED.entered_by
    RETURNING (xmax = 0) INTO v_ins;
    IF v_ins THEN n_ins := n_ins + 1; ELSE n_upd := n_upd + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('inserted', n_ins, 'updated', n_upd, 'rejected', rej);
END $$;

-- ───────────── أول رد (نسخة بلا آثار جانبية لـ cm_evaluate_first_reply، للـ views) ─────────────
-- تغطية: ردّت غير المسندة. في الوقت: ≤ الهدف. متأخر: رد بعد الهدف، أو لا رد وتجاوز الهدف. بانتظار: لا رد ولم يتجاوز.
CREATE OR REPLACE FUNCTION public.cm_first_reply_kpi_status(_clock timestamptz, _first_reply timestamptz, _was_cover boolean,
                                                            _owner uuid, _now timestamptz DEFAULT now())
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE k public.cm_kpi_settings; v_target int; v_el numeric;
BEGIN
  IF _clock IS NULL THEN RETURN NULL; END IF;
  IF _first_reply IS NOT NULL AND _was_cover THEN RETURN 'cover'; END IF;
  SELECT * INTO k FROM public.cm_kpi_settings WHERE id = 1;
  v_target := CASE WHEN _owner IS NOT NULL AND _owner IN (SELECT s.moderator_id FROM public.cm_on_shift_moderators(_clock) s)
                   THEN coalesce(k.first_reply_target_on_shift_min, 15) ELSE coalesce(k.first_reply_target_off_shift_min, 60) END;
  v_el := public.cm_service_minutes(_clock, coalesce(_first_reply, _now));
  IF v_el <= v_target THEN RETURN CASE WHEN _first_reply IS NULL THEN 'pending' ELSE 'on_time' END; END IF;
  RETURN 'late';
END $$;

CREATE OR REPLACE FUNCTION public.cm_local_date(_ts timestamptz)
RETURNS date LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT (_ts AT TIME ZONE coalesce((SELECT timezone FROM public.cm_kpi_settings WHERE id = 1), 'Africa/Cairo'))::date
$$;

-- ───────────── Views المؤشرات (security_invoker ⇒ RLS المستخدم الحالي تنطبق) ─────────────
DROP VIEW IF EXISTS public.cm_kpi_conversations_v;
CREATE VIEW public.cm_kpi_conversations_v WITH (security_invoker = true) AS
WITH k AS (SELECT coalesce((SELECT abandoned_minutes FROM public.cm_kpi_settings WHERE id = 1), 30) AS ab,
                  coalesce((SELECT conversion_window_days FROM public.cm_kpi_settings WHERE id = 1), 7) AS win)
SELECT c.id AS conversation_id, c.line_id, coalesce(c.assigned_moderator_id, c.owner_moderator_id) AS moderator_id,
       a.campaign_id, c.first_inbound_at, public.cm_local_date(c.first_inbound_at) AS kpi_date,
       public.cm_first_reply_kpi_status(c.clock_started_at, c.first_reply_at, c.first_reply_was_cover,
                                        coalesce(c.assigned_moderator_id, c.owner_moderator_id)) AS first_reply_status,
       (c.status IN ('open','pending') AND c.last_inbound_at IS NOT NULL
        AND (c.last_outbound_at IS NULL OR c.last_outbound_at < c.last_inbound_at)
        AND public.cm_service_minutes(c.last_inbound_at, now()) >= k.ab) AS is_abandoned,
       EXISTS (SELECT 1 FROM public.cm_conversation_orders l JOIN public.orders o ON o.id = l.order_id
               WHERE l.conversation_id = c.id AND NOT public.cm_order_is_cancelled(o.status)
                 AND o.created_at >= c.first_inbound_at AND o.created_at < c.first_inbound_at + make_interval(days => k.win)) AS converted_in_window
FROM public.cm_conversations c CROSS JOIN k
LEFT JOIN public.cm_ad_attributions a ON a.conversation_id = c.id
WHERE c.first_inbound_at IS NOT NULL;

DROP VIEW IF EXISTS public.cm_kpi_missed_calls_v;
CREATE VIEW public.cm_kpi_missed_calls_v WITH (security_invoker = true) AS
WITH k AS (SELECT coalesce((SELECT missed_call_followup_min FROM public.cm_kpi_settings WHERE id = 1), 60) AS m),
f AS (
  SELECT x.id, x.started_at, x.moderator_id, x.phone_norm, x.followed_up_at,
         (SELECT min(o.started_at) FROM public.cm_calls o
           WHERE o.phone_norm = x.phone_norm AND o.direction = 'outbound' AND o.started_at > x.started_at) AS callback_at,
         (SELECT min(m.sent_at) FROM public.cm_messages m JOIN public.cm_conversations cv ON cv.id = m.conversation_id
           WHERE cv.phone_norm = x.phone_norm AND m.direction = 'out' AND m.sent_at > x.started_at) AS message_at
  FROM public.cm_calls x WHERE x.status = 'missed' AND x.direction = 'inbound')
SELECT f.id AS call_id, f.started_at, public.cm_local_date(f.started_at) AS kpi_date, f.moderator_id, f.phone_norm,
       least(f.followed_up_at, f.callback_at, f.message_at) AS followup_at,
       coalesce(least(f.followed_up_at, f.callback_at, f.message_at) <= f.started_at + make_interval(mins => k.m), false) AS followed_within_target
FROM f CROSS JOIN k;

-- الطلبات: مودريتور الطلب من orders.moderator_id؛ الحملة من أول محادثة مربوطة بالطلب.
DROP VIEW IF EXISTS public.cm_kpi_orders_v;
CREATE VIEW public.cm_kpi_orders_v WITH (security_invoker = true) AS
SELECT o.id AS order_id, o.created_at, public.cm_local_date(o.created_at) AS kpi_date, o.status,
       coalesce(o.moderator_id, lc.moderator_id) AS moderator_id, lc.campaign_id, lc.conversation_id,
       public.cm_order_is_delivered(o.status) AS is_delivered, public.cm_order_is_cancelled(o.status) AS is_cancelled,
       public.cm_order_is_resolved(o.status) AS is_resolved,
       CASE WHEN public.cm_order_is_delivered(o.status) THEN coalesce(o.total_at_delivery, o.total) ELSE 0 END AS delivered_value
FROM public.orders o
LEFT JOIN LATERAL (
  SELECT l.conversation_id, coalesce(c.assigned_moderator_id, c.owner_moderator_id) AS moderator_id, a.campaign_id
  FROM public.cm_conversation_orders l JOIN public.cm_conversations c ON c.id = l.conversation_id
  LEFT JOIN public.cm_ad_attributions a ON a.conversation_id = c.id
  WHERE l.order_id = o.id ORDER BY c.first_inbound_at NULLS LAST, l.created_at LIMIT 1) lc ON true;

-- ───────────── ملخصات بفترة (security invoker) ─────────────
-- تكلفة الطلب المُسلَّم للحملة = إنفاق الحملة ÷ صافي المُسلَّم من طلباتها.
-- للمودريتور: يُوزَّع إنفاق كل حملة على المودريتورز بنسبة محادثاتهن من الحملة في الفترة، ثم ÷ صافي المُسلَّم المنسوب للحملة لها.
CREATE OR REPLACE FUNCTION public.cm_kpi_by_campaign(_from date, _to date)
RETURNS TABLE (campaign_id uuid, campaign_name text, spend numeric, conversations bigint, converted bigint,
               orders bigint, delivered bigint, resolved bigint, delivered_value numeric, cost_per_delivered numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH s AS (SELECT campaign_id, sum(spend) sp FROM public.cm_ad_spend_daily WHERE spend_date BETWEEN _from AND _to GROUP BY 1),
  cv AS (SELECT campaign_id, count(*) n, count(*) FILTER (WHERE converted_in_window) conv
         FROM public.cm_kpi_conversations_v WHERE kpi_date BETWEEN _from AND _to AND campaign_id IS NOT NULL GROUP BY 1),
  od AS (SELECT campaign_id, count(*) n, count(*) FILTER (WHERE is_delivered) d, count(*) FILTER (WHERE is_resolved) r, sum(delivered_value) v
         FROM public.cm_kpi_orders_v WHERE kpi_date BETWEEN _from AND _to AND campaign_id IS NOT NULL GROUP BY 1),
  ids AS (SELECT campaign_id FROM s UNION SELECT campaign_id FROM cv UNION SELECT campaign_id FROM od)
  SELECT ids.campaign_id, cp.name, coalesce(s.sp, 0), coalesce(cv.n, 0), coalesce(cv.conv, 0), coalesce(od.n, 0), coalesce(od.d, 0),
         coalesce(od.r, 0), coalesce(od.v, 0), CASE WHEN coalesce(od.d, 0) > 0 THEN round(coalesce(s.sp, 0) / od.d, 2) END
  FROM ids LEFT JOIN public.cm_campaigns cp ON cp.id = ids.campaign_id
  LEFT JOIN s ON s.campaign_id = ids.campaign_id LEFT JOIN cv ON cv.campaign_id = ids.campaign_id LEFT JOIN od ON od.campaign_id = ids.campaign_id
  ORDER BY 3 DESC, 2
$$;

CREATE OR REPLACE FUNCTION public.cm_kpi_by_moderator(_from date, _to date)
RETURNS TABLE (moderator_id uuid, display_name text, conversations bigint, on_time bigint, cover bigint, late bigint, pending bigint,
               abandoned bigint, converted bigint, missed_calls bigint, missed_followed bigint, orders bigint, delivered bigint,
               resolved bigint, delivered_value numeric, campaign_delivered bigint, allocated_spend numeric, cost_per_delivered numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH cv AS (SELECT * FROM public.cm_kpi_conversations_v WHERE kpi_date BETWEEN _from AND _to),
  s AS (SELECT campaign_id, sum(spend) sp FROM public.cm_ad_spend_daily WHERE spend_date BETWEEN _from AND _to GROUP BY 1),
  share AS (SELECT campaign_id, moderator_id, count(*)::numeric / sum(count(*)) OVER (PARTITION BY campaign_id) AS w
            FROM cv WHERE campaign_id IS NOT NULL AND moderator_id IS NOT NULL GROUP BY 1, 2),
  alloc AS (SELECT sh.moderator_id, sum(s.sp * sh.w) sp FROM share sh JOIN s ON s.campaign_id = sh.campaign_id GROUP BY 1),
  c AS (SELECT moderator_id, count(*) n,
               count(*) FILTER (WHERE first_reply_status = 'on_time') ot, count(*) FILTER (WHERE first_reply_status = 'cover') co,
               count(*) FILTER (WHERE first_reply_status = 'late') la, count(*) FILTER (WHERE first_reply_status = 'pending') pe,
               count(*) FILTER (WHERE is_abandoned) ab, count(*) FILTER (WHERE converted_in_window) cn
        FROM cv WHERE moderator_id IS NOT NULL GROUP BY 1),
  mc AS (SELECT moderator_id, count(*) n, count(*) FILTER (WHERE followed_within_target) f
         FROM public.cm_kpi_missed_calls_v WHERE kpi_date BETWEEN _from AND _to AND moderator_id IS NOT NULL GROUP BY 1),
  od AS (SELECT moderator_id, count(*) n, count(*) FILTER (WHERE is_delivered) d, count(*) FILTER (WHERE is_resolved) r,
                sum(delivered_value) v, count(*) FILTER (WHERE is_delivered AND campaign_id IS NOT NULL) cd
         FROM public.cm_kpi_orders_v WHERE kpi_date BETWEEN _from AND _to AND moderator_id IS NOT NULL GROUP BY 1)
  SELECT m.id, m.display_name, coalesce(c.n,0), coalesce(c.ot,0), coalesce(c.co,0), coalesce(c.la,0), coalesce(c.pe,0), coalesce(c.ab,0),
         coalesce(c.cn,0), coalesce(mc.n,0), coalesce(mc.f,0), coalesce(od.n,0), coalesce(od.d,0), coalesce(od.r,0), coalesce(od.v,0),
         coalesce(od.cd,0), round(coalesce(alloc.sp,0), 2),
         CASE WHEN coalesce(od.cd,0) > 0 THEN round(coalesce(alloc.sp,0) / od.cd, 2) END
  FROM public.cm_moderators m
  LEFT JOIN c ON c.moderator_id = m.id LEFT JOIN mc ON mc.moderator_id = m.id
  LEFT JOIN od ON od.moderator_id = m.id LEFT JOIN alloc ON alloc.moderator_id = m.id
  WHERE c.n IS NOT NULL OR mc.n IS NOT NULL OR od.n IS NOT NULL OR alloc.sp IS NOT NULL
  ORDER BY m.sort_order
$$;

-- ───────────── RLS ─────────────
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['cm_ad_spend_daily','cm_calls','cm_recording_access_log','cm_conversation_orders'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS cm_read ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS cm_write ON public.%I', t);
  END LOOP;
END $$;
-- الإنفاق: قراءة للوحدة كاملة عدا المودريتور (المصفوفة)، كتابة MSM/SM/GM/EM
CREATE POLICY cm_read ON public.cm_ad_spend_daily FOR SELECT TO authenticated USING ((SELECT public.cm_can_read_all()));
CREATE POLICY cm_write ON public.cm_ad_spend_daily FOR ALL TO authenticated
  USING ((SELECT public.cm_can_write_spend())) WITH CHECK ((SELECT public.cm_can_write_spend()));
-- المكالمات: الإدارة والمشاهدون للكل، المودريتور مكالماتها فقط؛ الكتابة عبر الدوال (الاستيراد / المتابعة)
CREATE POLICY cm_read ON public.cm_calls FOR SELECT TO authenticated USING ((SELECT public.cm_can_read_all())
  OR (moderator_id IS NOT NULL AND moderator_id = (SELECT public.cm_current_moderator_id())));
-- سجل الاستماع: GM/EM فقط للقراءة (رقابة)، ولا كتابة مباشرة
CREATE POLICY cm_read ON public.cm_recording_access_log FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager']::public.app_role[]) OR user_id = auth.uid());
-- روابط المحادثة ↔ الطلب: قراءة لمن يرى المحادثة؛ الإضافة عبر cm_link_conversation_order، الحذف SM/GM
CREATE POLICY cm_read ON public.cm_conversation_orders FOR SELECT TO authenticated USING (public.cm_can_see_conversation(conversation_id));
CREATE POLICY cm_write ON public.cm_conversation_orders FOR DELETE TO authenticated USING ((SELECT public.cm_can_manage()));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.cm_ad_spend_daily, public.cm_calls, public.cm_recording_access_log, public.cm_conversation_orders,
      public.cm_kpi_conversations_v, public.cm_kpi_missed_calls_v, public.cm_kpi_orders_v FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.cm_ad_spend_daily, public.cm_calls, public.cm_recording_access_log, public.cm_conversation_orders FROM authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.cm_ad_spend_daily TO authenticated;
    GRANT SELECT ON public.cm_calls, public.cm_recording_access_log TO authenticated;
    GRANT SELECT, DELETE ON public.cm_conversation_orders TO authenticated;
    GRANT SELECT ON public.cm_kpi_conversations_v, public.cm_kpi_missed_calls_v, public.cm_kpi_orders_v TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON public.cm_ad_spend_daily, public.cm_calls, public.cm_recording_access_log, public.cm_conversation_orders TO service_role;
    GRANT SELECT ON public.cm_kpi_conversations_v, public.cm_kpi_missed_calls_v, public.cm_kpi_orders_v TO service_role;
  END IF;
END $$;

-- الدوال: لا شيء لـ PUBLIC/anon؛ authenticated لما تحتاجه الواجهة (والفحص داخل كل دالة)، الاستيراد للنظام وSM/GM.
DO $$
DECLARE f text;
  all_fns text[] := ARRAY['cm_can_write_spend()','cm_can_listen_recordings()','cm_is_service()','cm_order_is_delivered(text)',
    'cm_order_is_cancelled(text)','cm_order_is_resolved(text)','cm_order_matches_phone(uuid,text)','cm_link_conversation_order(uuid,uuid,boolean)',
    'cm_suggest_conversation_orders(uuid)','cm_import_hotline_cdr(jsonb)','cm_mark_missed_call_followed_up(uuid)',
    'cm_request_recording_access(uuid)','cm_upsert_ad_spend(jsonb,text)','cm_first_reply_kpi_status(timestamptz,timestamptz,boolean,uuid,timestamptz)',
    'cm_local_date(timestamptz)','cm_kpi_by_campaign(date,date)','cm_kpi_by_moderator(date,date)'];
BEGIN
  FOREACH f IN ARRAY all_fns LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f); END IF;
  END LOOP;
END $$;
