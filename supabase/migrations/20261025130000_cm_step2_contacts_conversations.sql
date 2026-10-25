-- إدارة المحادثات — الخطوة 2: جهات الاتصال والأرقام، المحادثات والرسائل، الإسناد والتوزيع، الحملات والإسناد الإعلاني.
-- إضافة فقط (add-only) وقابلة لإعادة التشغيل. لا تعدّل customers ولا orders.
-- لا ربط بميتا هنا: الـ webhook لاحقاً يكتب بصلاحية service_role.
-- التراجع اليدوي: DROP TABLE public.cm_ad_attributions, cm_campaign_ads, cm_line_moderator_map, cm_campaign_line_map,
--   cm_campaigns, cm_conversation_assignments, cm_messages, cm_conversations, cm_customer_merges, cm_phone_review_queue,
--   cm_contact_phones, cm_contacts CASCADE; ثم DROP FUNCTION للدوال المضافة أدناه؛
--   ALTER TABLE cm_distribution_settings DROP COLUMN last_assigned_moderator_id.

-- ───────────── تطبيع الأرقام ─────────────
-- نفس normalize_phone_eg + نفس معالجة البادئة 02 / 2 الموجودة في lookup_caller_by_phone.
CREATE OR REPLACE FUNCTION public.cm_normalize_phone(_raw text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE v text := public.normalize_phone_eg(_raw);
BEGIN
  IF v ~ '^0201[0-9]{9}$' THEN v := substr(v, 3);
  ELSIF v ~ '^201[0-9]{9}$' THEN v := substr(v, 2);
  END IF;
  RETURN nullif(v, '');
END $$;

CREATE OR REPLACE FUNCTION public.cm_phone_is_valid(_norm text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT coalesce(_norm ~ '^01[0125][0-9]{8}$', false) $$;

-- يقسم حقلاً قد يحمل رقمين (مثل «010… / 011…» أو «010… و 011…» أو 22 رقماً متلاصقة).
CREATE OR REPLACE FUNCTION public.cm_split_phone_field(_raw text)
RETURNS SETOF text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE p text; d text;
BEGIN
  IF _raw IS NULL OR btrim(_raw) = '' THEN RETURN; END IF;
  d := regexp_replace(translate(_raw, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g');
  IF d ~ '^01[0-9]{9}01[0-9]{9}$' THEN
    RETURN NEXT substr(d, 1, 11); RETURN NEXT substr(d, 12, 11); RETURN;
  END IF;
  FOR p IN SELECT btrim(x) FROM regexp_split_to_table(_raw, '\s*[/,;|،\\]\s*|\s+و\s+|\s{2,}|\s*-\s+|\s+-\s*') x LOOP
    IF p <> '' THEN RETURN NEXT p; END IF;
  END LOOP;
END $$;

-- ───────────── الجداول ─────────────
CREATE TABLE IF NOT EXISTS public.cm_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_raw text,
  phone_norm text,
  wa_id text,
  profile_name text,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cm_contacts_phone_uniq ON public.cm_contacts (phone_norm) WHERE phone_norm IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cm_contacts_wa_uniq ON public.cm_contacts (wa_id) WHERE wa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cm_contacts_customer_idx ON public.cm_contacts (customer_id);

CREATE TABLE IF NOT EXISTS public.cm_contact_phones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.cm_contacts(id) ON DELETE CASCADE,
  phone_raw text NOT NULL,
  phone_norm text,
  source text NOT NULL CHECK (source IN ('customers.phone','customers.phone2','whatsapp','hotline','manual')),
  is_valid boolean NOT NULL DEFAULT false,
  invalid_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (customer_id IS NOT NULL OR contact_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS cm_contact_phones_uniq
  ON public.cm_contact_phones (customer_id, contact_id, source, phone_raw) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS cm_contact_phones_norm_idx ON public.cm_contact_phones (phone_norm) WHERE is_valid;

CREATE TABLE IF NOT EXISTS public.cm_phone_review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue text NOT NULL CHECK (issue IN ('malformed','two_numbers','multi_customer')),
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  phone_raw text,
  phone_norm text,
  related_customer_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cm_phone_review_queue_uniq
  ON public.cm_phone_review_queue (issue, customer_id, phone_raw, phone_norm) NULLS NOT DISTINCT;

-- الدمج لا يمسّ customers ولا orders: ينقل روابط طبقة cm_ فقط، ويحفظ لقطة للتراجع.
CREATE TABLE IF NOT EXISTS public.cm_customer_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survivor_customer_id uuid NOT NULL REFERENCES public.customers(id),
  merged_customer_id uuid NOT NULL REFERENCES public.customers(id),
  reason text,
  review_id uuid REFERENCES public.cm_phone_review_queue(id) ON DELETE SET NULL,
  approved_by uuid NOT NULL,
  merged_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL,
  undone_by uuid,
  undone_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (survivor_customer_id <> merged_customer_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS cm_customer_merges_active_uniq
  ON public.cm_customer_merges (merged_customer_id) WHERE undone_at IS NULL;

CREATE TABLE IF NOT EXISTS public.cm_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_campaign_id text UNIQUE,
  name text NOT NULL,
  objective text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  product_tag text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cm_campaigns_one_default ON public.cm_campaigns (is_default) WHERE is_default;

CREATE TABLE IF NOT EXISTS public.cm_campaign_ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.cm_campaigns(id) ON DELETE CASCADE,
  meta_ad_id text NOT NULL UNIQUE,
  name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cm_campaign_line_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.cm_campaigns(id) ON DELETE CASCADE,
  line_id uuid NOT NULL REFERENCES public.cm_lines(id) ON DELETE CASCADE,
  valid_from date NOT NULL DEFAULT current_date,
  valid_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS cm_campaign_line_map_current ON public.cm_campaign_line_map (campaign_id) WHERE valid_to IS NULL;

CREATE TABLE IF NOT EXISTS public.cm_line_moderator_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id uuid NOT NULL REFERENCES public.cm_lines(id) ON DELETE CASCADE,
  moderator_id uuid NOT NULL REFERENCES public.cm_moderators(id) ON DELETE CASCADE,
  valid_from date NOT NULL DEFAULT current_date,
  valid_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS cm_line_moderator_map_current ON public.cm_line_moderator_map (line_id) WHERE valid_to IS NULL;

CREATE TABLE IF NOT EXISTS public.cm_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','messenger','instagram')),
  line_id uuid REFERENCES public.cm_lines(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.cm_contacts(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  phone_norm text,
  -- لماسنجر وإنستجرام لاحقاً (غير مستخدمة الآن)
  external_thread_id text,
  page_id text,
  ig_user_id text,
  owner_moderator_id uuid REFERENCES public.cm_moderators(id) ON DELETE SET NULL,
  assigned_moderator_id uuid REFERENCES public.cm_moderators(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','closed','spam')),
  campaign_id uuid REFERENCES public.cm_campaigns(id) ON DELETE SET NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  first_inbound_at timestamptz,
  -- بداية العدّ بعد التأجيل إلى 09:00 إن وصلت الرسالة بين 01:00 و09:00 (مطابق لـ responseClock.clockStart)
  clock_started_at timestamptz,
  first_reply_at timestamptz,
  first_reply_moderator_id uuid REFERENCES public.cm_moderators(id) ON DELETE SET NULL,
  first_reply_was_cover boolean,
  awaiting_reply_since timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cm_conversations_assigned_idx ON public.cm_conversations (assigned_moderator_id, status);
CREATE INDEX IF NOT EXISTS cm_conversations_owner_idx ON public.cm_conversations (owner_moderator_id, status);
CREATE INDEX IF NOT EXISTS cm_conversations_phone_idx ON public.cm_conversations (phone_norm);
CREATE INDEX IF NOT EXISTS cm_conversations_line_idx ON public.cm_conversations (line_id, last_inbound_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS cm_conversations_thread_uniq
  ON public.cm_conversations (channel, external_thread_id) WHERE external_thread_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.cm_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.cm_conversations(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  type text NOT NULL DEFAULT 'text'
    CHECK (type IN ('text','image','audio','video','document','sticker','location','contacts','reaction','template','interactive','system','unknown')),
  body text,
  media_path text,
  media_mime text,
  provider text NOT NULL DEFAULT 'whatsapp' CHECK (provider IN ('whatsapp','messenger','instagram','manual')),
  provider_message_id text,
  sender_moderator_id uuid REFERENCES public.cm_moderators(id) ON DELETE SET NULL,
  sent_via text CHECK (sent_via IN ('business_app','api','manual')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  delivery_status text NOT NULL DEFAULT 'received'
    CHECK (delivery_status IN ('received','pending','sent','delivered','read','failed')),
  delivered_at timestamptz,
  read_at timestamptz,
  failed_reason text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- يمنع تكرار الحفظ عند إعادة إرسال الـ webhook
CREATE UNIQUE INDEX IF NOT EXISTS cm_messages_provider_uniq ON public.cm_messages (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cm_messages_conv_idx ON public.cm_messages (conversation_id, sent_at);

CREATE TABLE IF NOT EXISTS public.cm_conversation_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.cm_conversations(id) ON DELETE CASCADE,
  moderator_id uuid NOT NULL REFERENCES public.cm_moderators(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'primary' CHECK (kind IN ('primary','cover')),
  method text NOT NULL CHECK (method IN ('line_owner','campaign','round_robin','load','manual','cover')),
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cm_conv_assign_one_primary
  ON public.cm_conversation_assignments (conversation_id) WHERE kind = 'primary' AND ended_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cm_conv_assign_one_cover_each
  ON public.cm_conversation_assignments (conversation_id, moderator_id) WHERE kind = 'cover' AND ended_at IS NULL;
CREATE INDEX IF NOT EXISTS cm_conv_assign_conv_idx ON public.cm_conversation_assignments (conversation_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS cm_conv_assign_mod_idx ON public.cm_conversation_assignments (moderator_id) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS public.cm_ad_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL UNIQUE REFERENCES public.cm_conversations(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('ctwa_clid','referral','manual','unknown')),
  ctwa_clid text,
  referral_source_id text,
  referral_source_type text,
  referral_headline text,
  manual_value text,
  campaign_id uuid REFERENCES public.cm_campaigns(id) ON DELETE SET NULL,
  ad_id text,
  set_by uuid,
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cm_ad_attr_ctwa_idx ON public.cm_ad_attributions (ctwa_clid);
CREATE INDEX IF NOT EXISTS cm_ad_attr_ref_idx ON public.cm_ad_attributions (referral_source_id);

ALTER TABLE public.cm_distribution_settings
  ADD COLUMN IF NOT EXISTS last_assigned_moderator_id uuid REFERENCES public.cm_moderators(id) ON DELETE SET NULL;

-- ───────────── دوال الصلاحية ─────────────
CREATE OR REPLACE FUNCTION public.cm_can_see_conversation(_conversation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.cm_can_read_all() OR EXISTS (
    SELECT 1 FROM public.cm_conversations c
    WHERE c.id = _conversation_id
      AND public.cm_current_moderator_id() IS NOT NULL
      AND (c.assigned_moderator_id = public.cm_current_moderator_id()
           OR c.owner_moderator_id = public.cm_current_moderator_id()
           OR EXISTS (SELECT 1 FROM public.cm_conversation_assignments a
                      WHERE a.conversation_id = c.id AND a.kind = 'cover' AND a.ended_at IS NULL
                        AND a.moderator_id = public.cm_current_moderator_id())))
$$;

CREATE OR REPLACE FUNCTION public.cm_can_manage_campaigns()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','marketing_sales_manager']::public.app_role[])
$$;

-- مسموح لمن يدير الوحدة أو للنظام (service_role / الـ webhook / الـ migration بدون مستخدم)
CREATE OR REPLACE FUNCTION public.cm_is_system_or_manager()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- بدون مستخدم وبدون دور anon/authenticated في الـ JWT = service_role أو SQL مباشر (migration / مهمة).
  SELECT (auth.uid() IS NULL
          AND coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                       nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role')
              NOT IN ('anon','authenticated'))
         OR public.cm_can_manage()
$$;

-- ───────────── الوقت ونافذة الخدمة (مطابق لـ responseClock.ts) ─────────────
CREATE OR REPLACE FUNCTION public.cm_clock_start(_ts timestamptz)
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.cm_kpi_settings; l timestamp; t time; in_win boolean;
BEGIN
  SELECT * INTO s FROM public.cm_kpi_settings WHERE id = 1;
  IF s IS NULL THEN s.timezone := 'Africa/Cairo'; s.service_window_start := '09:00'; s.service_window_end := '01:00'; END IF;
  l := _ts AT TIME ZONE s.timezone; t := l::time;
  IF s.service_window_start < s.service_window_end THEN
    in_win := t >= s.service_window_start AND t < s.service_window_end;
  ELSE
    in_win := t >= s.service_window_start OR t < s.service_window_end;
  END IF;
  IF in_win THEN RETURN _ts; END IF;
  IF t < s.service_window_start THEN
    RETURN (l::date + s.service_window_start) AT TIME ZONE s.timezone;
  END IF;
  RETURN ((l::date + 1) + s.service_window_start) AT TIME ZONE s.timezone;
END $$;

-- دقائق داخل نافذة الخدمة بين لحظتين
CREATE OR REPLACE FUNCTION public.cm_service_minutes(_from timestamptz, _to timestamptz)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.cm_kpi_settings; a timestamp; b timestamp; d date; ws timestamp; we timestamp; total numeric := 0;
BEGIN
  IF _to <= _from THEN RETURN 0; END IF;
  SELECT * INTO s FROM public.cm_kpi_settings WHERE id = 1;
  a := _from AT TIME ZONE s.timezone; b := _to AT TIME ZONE s.timezone;
  FOR d IN SELECT generate_series(a::date - 1, b::date, interval '1 day')::date LOOP
    ws := d + s.service_window_start;
    we := d + s.service_window_end + CASE WHEN s.service_window_end <= s.service_window_start THEN interval '1 day' ELSE interval '0' END;
    IF least(we, b) > greatest(ws, a) THEN
      total := total + extract(epoch FROM least(we, b) - greatest(ws, a)) / 60;
    END IF;
  END LOOP;
  RETURN round(total, 2);
END $$;

-- المودريتورز في شيفت لحظة معيّنة (الشيفت الليلي يُنسب ليوم بدايته)
CREATE OR REPLACE FUNCTION public.cm_on_shift_moderators(_ts timestamptz)
RETURNS TABLE (moderator_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (SELECT coalesce((SELECT timezone FROM public.cm_kpi_settings WHERE id = 1), 'Africa/Cairo') AS tz),
  l AS (SELECT (_ts AT TIME ZONE s.tz) AS lt FROM s)
  SELECT DISTINCT a.moderator_id
  FROM l
  JOIN public.cm_shift_assignments a ON a.work_date BETWEEN l.lt::date - 1 AND l.lt::date
  JOIN public.cm_moderators m ON m.id = a.moderator_id
  WHERE m.is_active AND m.chat_active
    AND (m.end_date IS NULL OR m.end_date >= l.lt::date)
    AND l.lt >= a.work_date + a.starts_at
    AND l.lt < a.work_date + a.ends_at + CASE WHEN a.ends_at <= a.starts_at THEN interval '1 day' ELSE interval '0' END
$$;

-- هل المودريتور متاحة للعمل في يوم (غير منتهية، وليس يوم إجازتها الأسبوعية)
CREATE OR REPLACE FUNCTION public.cm_moderator_available(_moderator_id uuid, _ts timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH l AS (SELECT (_ts AT TIME ZONE coalesce((SELECT timezone FROM public.cm_kpi_settings WHERE id = 1), 'Africa/Cairo'))::date AS d)
  SELECT EXISTS (SELECT 1 FROM public.cm_moderators m, l WHERE m.id = _moderator_id AND m.is_active AND m.chat_active
                   AND (m.end_date IS NULL OR m.end_date >= l.d) AND (m.start_date IS NULL OR m.start_date <= l.d))
     AND NOT EXISTS (SELECT 1 FROM public.cm_weekly_days_off o, l WHERE o.moderator_id = _moderator_id
                   AND o.dow = extract(dow FROM l.d) AND o.valid_from <= l.d AND (o.valid_to IS NULL OR o.valid_to >= l.d))
$$;

-- صاحب الخط في تاريخ: من cm_line_moderator_map إن وُجد، وإلا cm_lines.owner_moderator_id
CREATE OR REPLACE FUNCTION public.cm_line_owner_on(_line_id uuid, _day date)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT moderator_id FROM public.cm_line_moderator_map WHERE line_id = _line_id AND valid_from <= _day
       AND (valid_to IS NULL OR valid_to >= _day) ORDER BY valid_from DESC LIMIT 1),
    (SELECT owner_moderator_id FROM public.cm_lines WHERE id = _line_id))
$$;

-- مودريتور الحملة: حملة ← خط ← مودريتور في التاريخ؛ وإن لم تكن حملة فالحملة الافتراضية
CREATE OR REPLACE FUNCTION public.cm_campaign_moderator_on(_campaign_id uuid, _day date)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.cm_line_owner_on(m.line_id, _day)
  FROM public.cm_campaign_line_map m
  WHERE m.campaign_id = coalesce(_campaign_id, (SELECT id FROM public.cm_campaigns WHERE is_default LIMIT 1))
    AND m.valid_from <= _day AND (m.valid_to IS NULL OR m.valid_to >= _day)
  ORDER BY m.valid_from DESC LIMIT 1
$$;

-- ───────────── الإسناد والتوزيع ─────────────
-- يوزّع محادثة: صاحب الخط أولاً (إن كانت إجازتها اليوم تُسجَّل تغطية لمن في الشيفت)،
-- ثم حسب cm_distribution_settings: campaign → fallback (load / round_robin) على من في الشيفت.
-- الوقت المعتمد هو بداية العدّ (cm_clock_start)، فرسالة 03:00 تُوزَّع على شيفت 09:00.
CREATE OR REPLACE FUNCTION public.cm_distribute_conversation(_conversation_id uuid, _at timestamptz DEFAULT NULL)
RETURNS TABLE (moderator_id uuid, via text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.cm_conversations; ds public.cm_distribution_settings; t timestamptz; d date;
        v_owner uuid; v_pick uuid; v_via text; v_method text; v_cover uuid;
BEGIN
  IF NOT public.cm_is_system_or_manager() THEN
    RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.cm_conversations WHERE id = _conversation_id FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'CM_CONVERSATION_NOT_FOUND'; END IF;
  SELECT * INTO ds FROM public.cm_distribution_settings WHERE id = 1;
  t := public.cm_clock_start(coalesce(_at, c.first_inbound_at, c.opened_at, now()));
  d := (t AT TIME ZONE coalesce((SELECT timezone FROM public.cm_kpi_settings WHERE id = 1), 'Africa/Cairo'))::date;

  v_owner := CASE WHEN c.line_id IS NOT NULL THEN public.cm_line_owner_on(c.line_id, d) END;
  -- مودريتور انتهى عملها أو أُوقفت ليست مالكة
  IF v_owner IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.cm_moderators m WHERE m.id = v_owner AND m.is_active
       AND m.chat_active AND (m.end_date IS NULL OR m.end_date >= d)) THEN
    v_owner := NULL;
  END IF;

  IF v_owner IS NOT NULL THEN
    v_pick := v_owner; v_via := 'line_owner';
  ELSE
    v_method := coalesce(ds.method, 'campaign');
    IF v_method = 'campaign' THEN
      v_pick := public.cm_campaign_moderator_on(c.campaign_id, d);
      IF v_pick IS NOT NULL AND public.cm_moderator_available(v_pick, t) THEN v_via := 'campaign';
      ELSE v_pick := NULL; v_method := coalesce(nullif(ds.fallback_method, 'none'), 'none');
      END IF;
    END IF;
    IF v_pick IS NULL AND v_method = 'load' THEN
      SELECT s.moderator_id INTO v_pick FROM public.cm_on_shift_moderators(t) s
      JOIN public.cm_moderators m ON m.id = s.moderator_id
      LEFT JOIN LATERAL (SELECT count(*) n FROM public.cm_conversations x
                         WHERE x.assigned_moderator_id = s.moderator_id AND x.status IN ('open','pending')) o ON true
      WHERE o.n < m.max_open_conversations
      ORDER BY o.n, m.sort_order, m.slug LIMIT 1;
      v_via := 'load';
    ELSIF v_pick IS NULL AND v_method = 'round_robin' THEN
      WITH r AS (SELECT s.moderator_id, m.sort_order, m.slug,
                        row_number() OVER (ORDER BY m.sort_order, m.slug) rn
                 FROM public.cm_on_shift_moderators(t) s JOIN public.cm_moderators m ON m.id = s.moderator_id
                 WHERE (SELECT count(*) FROM public.cm_conversations x WHERE x.assigned_moderator_id = s.moderator_id
                          AND x.status IN ('open','pending')) < m.max_open_conversations),
           lastrn AS (SELECT rn FROM r WHERE r.moderator_id = ds.last_assigned_moderator_id)
      SELECT r.moderator_id INTO v_pick FROM r
      ORDER BY (r.rn <= coalesce((SELECT rn FROM lastrn), 0)), r.rn LIMIT 1;
      v_via := 'round_robin';
    END IF;
  END IF;

  IF v_pick IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 'none'::text; RETURN;
  END IF;

  IF c.owner_moderator_id IS DISTINCT FROM v_owner AND v_owner IS NOT NULL THEN
    UPDATE public.cm_conversations SET owner_moderator_id = v_owner WHERE id = c.id;
  END IF;
  INSERT INTO public.cm_conversation_assignments (conversation_id, moderator_id, kind, method, assigned_by, assigned_at, reason)
  VALUES (c.id, v_pick, 'primary', v_via, auth.uid(), now(), 'distribution');
  IF v_via IN ('round_robin','load') THEN
    UPDATE public.cm_distribution_settings SET last_assigned_moderator_id = v_pick WHERE id = 1;
  END IF;

  -- صاحبة الخط في إجازة اليوم: تغطية فورية لأول من في الشيفت
  IF v_via = 'line_owner' AND NOT public.cm_moderator_available(v_owner, t) THEN
    SELECT s.moderator_id INTO v_cover FROM public.cm_on_shift_moderators(t) s
    JOIN public.cm_moderators m ON m.id = s.moderator_id
    WHERE s.moderator_id <> v_owner ORDER BY m.sort_order, m.slug LIMIT 1;
    IF v_cover IS NOT NULL THEN
      INSERT INTO public.cm_conversation_assignments (conversation_id, moderator_id, kind, method, assigned_by, reason)
      VALUES (c.id, v_cover, 'cover', 'cover', auth.uid(), 'owner_day_off')
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN QUERY SELECT v_pick, v_via;
END $$;

-- إسناد يدوي (مديرة المبيعات / المدير العام فقط)
CREATE OR REPLACE FUNCTION public.cm_reassign_conversation(_conversation_id uuid, _moderator_id uuid, _reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.cm_can_manage() THEN RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.cm_conversation_assignments (conversation_id, moderator_id, kind, method, assigned_by, reason)
  VALUES (_conversation_id, _moderator_id, 'primary', 'manual', auth.uid(), _reason) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- تقييم الرد الأول (مطابق لـ evaluateFirstReply): pending / on_time / cover / late.
-- عند التأخر دون رد تُضاف تغطية لمن في الشيفت غير المالكة.
CREATE OR REPLACE FUNCTION public.cm_evaluate_first_reply(_conversation_id uuid, _now timestamptz DEFAULT now())
RETURNS TABLE (status text, target_min int, elapsed_min numeric, cover_moderator_ids uuid[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.cm_conversations; k public.cm_kpi_settings; v_target int; v_el numeric; v_covers uuid[] := '{}'; v_owner uuid;
BEGIN
  IF NOT public.cm_is_system_or_manager() THEN RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.cm_conversations WHERE id = _conversation_id;
  SELECT * INTO k FROM public.cm_kpi_settings WHERE id = 1;
  IF c.clock_started_at IS NULL THEN RETURN QUERY SELECT 'pending', NULL::int, 0::numeric, v_covers; RETURN; END IF;
  v_owner := coalesce(c.assigned_moderator_id, c.owner_moderator_id);
  v_target := CASE WHEN v_owner IN (SELECT s.moderator_id FROM public.cm_on_shift_moderators(c.clock_started_at) s)
                   THEN k.first_reply_target_on_shift_min ELSE k.first_reply_target_off_shift_min END;
  IF c.first_reply_at IS NOT NULL THEN
    v_el := public.cm_service_minutes(c.clock_started_at, c.first_reply_at);
    RETURN QUERY SELECT CASE WHEN c.first_reply_was_cover THEN 'cover' WHEN v_el <= v_target THEN 'on_time' ELSE 'late' END,
                        v_target, v_el, v_covers;
    RETURN;
  END IF;
  v_el := public.cm_service_minutes(c.clock_started_at, _now);
  IF v_el <= v_target THEN RETURN QUERY SELECT 'pending', v_target, v_el, v_covers; RETURN; END IF;
  SELECT coalesce(array_agg(s.moderator_id), '{}') INTO v_covers FROM public.cm_on_shift_moderators(_now) s
  WHERE s.moderator_id IS DISTINCT FROM v_owner;
  INSERT INTO public.cm_conversation_assignments (conversation_id, moderator_id, kind, method, reason)
  SELECT c.id, x, 'cover', 'cover', 'first_reply_breach' FROM unnest(v_covers) x
  ON CONFLICT DO NOTHING;
  RETURN QUERY SELECT 'late', v_target, v_el, v_covers;
END $$;

-- ───────────── الإسناد الإعلاني ─────────────
-- الترتيب: ctwa_clid ثم referral.source_id ثم يدوي ثم غير معروف. الحملة من cm_campaign_ads إن عُرف الإعلان.
CREATE OR REPLACE FUNCTION public.cm_attribute_conversation(_conversation_id uuid, _ctwa_clid text DEFAULT NULL,
  _referral_source_id text DEFAULT NULL, _referral_source_type text DEFAULT NULL, _referral_headline text DEFAULT NULL,
  _manual_value text DEFAULT NULL, _manual_campaign_id uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_method text; v_campaign uuid;
BEGIN
  IF NOT (public.cm_is_system_or_manager() OR public.cm_can_manage_campaigns()) THEN
    RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  v_method := CASE WHEN nullif(_ctwa_clid,'') IS NOT NULL THEN 'ctwa_clid'
                   WHEN nullif(_referral_source_id,'') IS NOT NULL THEN 'referral'
                   WHEN nullif(_manual_value,'') IS NOT NULL OR _manual_campaign_id IS NOT NULL THEN 'manual'
                   ELSE 'unknown' END;
  v_campaign := coalesce((SELECT campaign_id FROM public.cm_campaign_ads WHERE meta_ad_id = _referral_source_id),
                         CASE WHEN v_method = 'manual' THEN _manual_campaign_id END);
  INSERT INTO public.cm_ad_attributions (conversation_id, method, ctwa_clid, referral_source_id, referral_source_type,
    referral_headline, manual_value, campaign_id, ad_id, set_by)
  VALUES (_conversation_id, v_method, _ctwa_clid, _referral_source_id, _referral_source_type, _referral_headline,
    _manual_value, v_campaign, _referral_source_id, auth.uid())
  ON CONFLICT (conversation_id) DO UPDATE SET method = EXCLUDED.method, ctwa_clid = EXCLUDED.ctwa_clid,
    referral_source_id = EXCLUDED.referral_source_id, referral_source_type = EXCLUDED.referral_source_type,
    referral_headline = EXCLUDED.referral_headline, manual_value = EXCLUDED.manual_value,
    campaign_id = EXCLUDED.campaign_id, ad_id = EXCLUDED.ad_id, set_by = EXCLUDED.set_by, captured_at = now();
  UPDATE public.cm_conversations SET campaign_id = v_campaign WHERE id = _conversation_id AND v_campaign IS NOT NULL;
  RETURN v_method;
END $$;

-- ───────────── أرقام العملاء والدمج ─────────────
-- العميل المرتبط برقم مطبَّع: صاحب أحدث طلب، ثم أحدث تعديل.
CREATE OR REPLACE FUNCTION public.cm_customer_for_phone(_phone text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cp.customer_id FROM public.cm_contact_phones cp
  JOIN public.customers cu ON cu.id = cp.customer_id
  LEFT JOIN LATERAL (SELECT max(o.created_at) last_order FROM public.orders o WHERE o.customer_id = cp.customer_id) lo ON true
  WHERE cp.is_valid AND cp.phone_norm = public.cm_normalize_phone(_phone)
    AND NOT EXISTS (SELECT 1 FROM public.cm_customer_merges mg WHERE mg.merged_customer_id = cp.customer_id AND mg.undone_at IS NULL)
  ORDER BY lo.last_order DESC NULLS LAST, cu.updated_at DESC NULLS LAST, cu.id LIMIT 1
$$;

-- يبني cm_contact_phones من customers.phone/phone2 (قراءة فقط من customers) ويملأ طابور المراجعة. آمن لإعادة التشغيل.
CREATE OR REPLACE FUNCTION public.cm_sync_customer_phones()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n_ins int; n_mal int; n_two int; n_multi int;
BEGIN
  IF NOT public.cm_is_system_or_manager() THEN RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  WITH src AS (
    SELECT cu.id customer_id, f.src, f.raw FROM public.customers cu
    CROSS JOIN LATERAL (VALUES ('customers.phone', cu.phone), ('customers.phone2', cu.phone2)) f(src, raw)
    WHERE nullif(btrim(f.raw), '') IS NOT NULL),
  parts AS (SELECT s.*, p, count(*) OVER (PARTITION BY s.customer_id, s.src) nparts
            FROM src s CROSS JOIN LATERAL public.cm_split_phone_field(s.raw) p),
  ins AS (
    INSERT INTO public.cm_contact_phones (customer_id, source, phone_raw, phone_norm, is_valid, invalid_reason)
    SELECT customer_id, src, p, public.cm_normalize_phone(p), public.cm_phone_is_valid(public.cm_normalize_phone(p)),
           CASE WHEN NOT public.cm_phone_is_valid(public.cm_normalize_phone(p)) THEN 'not_egyptian_mobile' END
    FROM parts
    ON CONFLICT DO NOTHING RETURNING 1)
  SELECT count(*) INTO n_ins FROM ins;

  INSERT INTO public.cm_phone_review_queue (issue, customer_id, phone_raw, phone_norm)
  SELECT 'malformed', customer_id, phone_raw, phone_norm FROM public.cm_contact_phones
  WHERE customer_id IS NOT NULL AND NOT is_valid ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n_mal = ROW_COUNT;

  INSERT INTO public.cm_phone_review_queue (issue, customer_id, phone_raw)
  SELECT 'two_numbers', cu.id, f.raw FROM public.customers cu
  CROSS JOIN LATERAL (VALUES (cu.phone), (cu.phone2)) f(raw)
  WHERE (SELECT count(*) FROM public.cm_split_phone_field(f.raw)) > 1 ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n_two = ROW_COUNT;

  INSERT INTO public.cm_phone_review_queue (issue, phone_norm, related_customer_ids)
  SELECT 'multi_customer', phone_norm, array_agg(DISTINCT customer_id ORDER BY customer_id)
  FROM public.cm_contact_phones WHERE is_valid AND customer_id IS NOT NULL
  GROUP BY phone_norm HAVING count(DISTINCT customer_id) > 1
  ON CONFLICT (issue, customer_id, phone_raw, phone_norm) DO UPDATE SET related_customer_ids = EXCLUDED.related_customer_ids
    WHERE cm_phone_review_queue.status = 'open';
  GET DIAGNOSTICS n_multi = ROW_COUNT;

  -- ربط جهات الاتصال غير المربوطة برقمها
  UPDATE public.cm_contacts ct SET customer_id = public.cm_customer_for_phone(ct.phone_norm)
  WHERE ct.customer_id IS NULL AND public.cm_phone_is_valid(ct.phone_norm) AND public.cm_customer_for_phone(ct.phone_norm) IS NOT NULL;

  RETURN jsonb_build_object('phones_inserted', n_ins, 'malformed', n_mal, 'two_numbers', n_two, 'multi_customer', n_multi);
END $$;

-- دمج عميلين (يدوي فقط: مديرة المبيعات أو المدير العام). ينقل روابط cm_ فقط، ولا يمسّ customers/orders.
CREATE OR REPLACE FUNCTION public.cm_merge_customers(_survivor uuid, _merged uuid, _reason text DEFAULT NULL, _review_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_snap jsonb; v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.cm_can_manage() THEN RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF _survivor = _merged THEN RAISE EXCEPTION 'CM_MERGE_SAME_CUSTOMER'; END IF;
  IF EXISTS (SELECT 1 FROM public.cm_customer_merges WHERE merged_customer_id IN (_survivor, _merged) AND undone_at IS NULL) THEN
    RAISE EXCEPTION 'CM_MERGE_ALREADY_MERGED';
  END IF;
  v_snap := jsonb_build_object(
    'contact_phones', coalesce((SELECT jsonb_agg(id) FROM public.cm_contact_phones WHERE customer_id = _merged), '[]'),
    'contacts', coalesce((SELECT jsonb_agg(id) FROM public.cm_contacts WHERE customer_id = _merged), '[]'),
    'conversations', coalesce((SELECT jsonb_agg(id) FROM public.cm_conversations WHERE customer_id = _merged), '[]'),
    'merged_customer', (SELECT to_jsonb(c) FROM public.customers c WHERE id = _merged));
  INSERT INTO public.cm_customer_merges (survivor_customer_id, merged_customer_id, reason, review_id, approved_by, snapshot)
  VALUES (_survivor, _merged, _reason, _review_id, auth.uid(), v_snap) RETURNING id INTO v_id;
  -- نتجاوز التعارض: رقم موجود عند الطرفين يبقى عند المدموج
  UPDATE public.cm_contact_phones p SET customer_id = _survivor WHERE p.customer_id = _merged
    AND NOT EXISTS (SELECT 1 FROM public.cm_contact_phones q WHERE q.customer_id = _survivor AND q.contact_id IS NOT DISTINCT FROM p.contact_id
                    AND q.source = p.source AND q.phone_raw = p.phone_raw);
  v_snap := jsonb_set(v_snap, '{contact_phones}', coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements_text(v_snap->'contact_phones') x
              WHERE EXISTS (SELECT 1 FROM public.cm_contact_phones WHERE id = x::uuid AND customer_id = _survivor)), '[]'));
  UPDATE public.cm_customer_merges SET snapshot = v_snap WHERE id = v_id;
  UPDATE public.cm_contacts SET customer_id = _survivor WHERE customer_id = _merged;
  UPDATE public.cm_conversations SET customer_id = _survivor WHERE customer_id = _merged;
  IF _review_id IS NOT NULL THEN
    UPDATE public.cm_phone_review_queue SET status = 'resolved', resolution = 'merged', resolved_by = auth.uid(), resolved_at = now()
    WHERE id = _review_id;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.cm_undo_merge(_merge_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.cm_customer_merges;
BEGIN
  IF auth.uid() IS NULL OR NOT public.cm_can_manage() THEN RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO m FROM public.cm_customer_merges WHERE id = _merge_id FOR UPDATE;
  IF m.id IS NULL OR m.undone_at IS NOT NULL THEN RAISE EXCEPTION 'CM_MERGE_NOT_ACTIVE'; END IF;
  UPDATE public.cm_contact_phones SET customer_id = m.merged_customer_id
    WHERE id IN (SELECT x::uuid FROM jsonb_array_elements_text(m.snapshot->'contact_phones') x);
  UPDATE public.cm_contacts SET customer_id = m.merged_customer_id
    WHERE id IN (SELECT x::uuid FROM jsonb_array_elements_text(m.snapshot->'contacts') x);
  UPDATE public.cm_conversations SET customer_id = m.merged_customer_id
    WHERE id IN (SELECT x::uuid FROM jsonb_array_elements_text(m.snapshot->'conversations') x);
  UPDATE public.cm_customer_merges SET undone_at = now(), undone_by = auth.uid() WHERE id = m.id;
  IF m.review_id IS NOT NULL THEN
    UPDATE public.cm_phone_review_queue SET status = 'open', resolution = NULL, resolved_by = NULL, resolved_at = NULL WHERE id = m.review_id;
  END IF;
END $$;

-- ───────────── Triggers ─────────────
-- الرسالة تحدّث توقيتات المحادثة (أول وارد، بداية العدّ المؤجَّلة، أول رد، آخر وارد/صادر)
CREATE OR REPLACE FUNCTION public.cm_messages_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.cm_conversations;
BEGIN
  SELECT * INTO c FROM public.cm_conversations WHERE id = NEW.conversation_id FOR UPDATE;
  IF NEW.direction = 'in' THEN
    UPDATE public.cm_conversations SET
      first_inbound_at = coalesce(first_inbound_at, NEW.sent_at),
      clock_started_at = coalesce(clock_started_at, public.cm_clock_start(NEW.sent_at)),
      awaiting_reply_since = coalesce(awaiting_reply_since, public.cm_clock_start(NEW.sent_at)),
      last_inbound_at = greatest(last_inbound_at, NEW.sent_at),
      status = CASE WHEN status = 'closed' THEN 'open' ELSE status END,
      closed_at = CASE WHEN status = 'closed' THEN NULL ELSE closed_at END
    WHERE id = NEW.conversation_id;
  ELSIF NEW.type NOT IN ('system','reaction') THEN
    UPDATE public.cm_conversations SET
      first_reply_at = CASE WHEN first_reply_at IS NULL AND first_inbound_at IS NOT NULL AND NEW.sent_at >= first_inbound_at
                            THEN NEW.sent_at ELSE first_reply_at END,
      first_reply_moderator_id = CASE WHEN first_reply_at IS NULL AND first_inbound_at IS NOT NULL AND NEW.sent_at >= first_inbound_at
                            THEN NEW.sender_moderator_id ELSE first_reply_moderator_id END,
      first_reply_was_cover = CASE WHEN first_reply_at IS NULL AND first_inbound_at IS NOT NULL AND NEW.sent_at >= first_inbound_at
                            THEN NEW.sender_moderator_id IS DISTINCT FROM coalesce(assigned_moderator_id, owner_moderator_id)
                            ELSE first_reply_was_cover END,
      last_outbound_at = greatest(last_outbound_at, NEW.sent_at),
      awaiting_reply_since = NULL
    WHERE id = NEW.conversation_id;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_cm_messages_after_insert ON public.cm_messages;
CREATE TRIGGER trg_cm_messages_after_insert AFTER INSERT ON public.cm_messages
  FOR EACH ROW EXECUTE FUNCTION public.cm_messages_after_insert();

-- إسناد primary جديد يُنهي السابق ويحدّث assigned_moderator_id
CREATE OR REPLACE FUNCTION public.cm_assignments_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.kind = 'primary' THEN
    UPDATE public.cm_conversations SET assigned_moderator_id = NEW.moderator_id WHERE id = NEW.conversation_id;
    -- التغطية تنتهي لمن أصبحت هي المسندة
    UPDATE public.cm_conversation_assignments SET ended_at = now()
    WHERE conversation_id = NEW.conversation_id AND kind = 'cover' AND moderator_id = NEW.moderator_id AND ended_at IS NULL;
  END IF;
  RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION public.cm_assignments_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.kind = 'primary' THEN
    UPDATE public.cm_conversation_assignments SET ended_at = NEW.assigned_at
    WHERE conversation_id = NEW.conversation_id AND kind = 'primary' AND ended_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_cm_assign_before_insert ON public.cm_conversation_assignments;
CREATE TRIGGER trg_cm_assign_before_insert BEFORE INSERT ON public.cm_conversation_assignments
  FOR EACH ROW EXECUTE FUNCTION public.cm_assignments_before_insert();
DROP TRIGGER IF EXISTS trg_cm_assign_after_insert ON public.cm_conversation_assignments;
CREATE TRIGGER trg_cm_assign_after_insert AFTER INSERT ON public.cm_conversation_assignments
  FOR EACH ROW EXECUTE FUNCTION public.cm_assignments_after_insert();

-- المودريتور لا تنقل محادثة ولا تغيّر ملكيتها أو حملتها أو عميلها؛ تغيّر الحالة فقط.
CREATE OR REPLACE FUNCTION public.cm_conversations_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.cm_can_manage() AND pg_trigger_depth() = 1 AND (
       NEW.assigned_moderator_id IS DISTINCT FROM OLD.assigned_moderator_id
    OR NEW.owner_moderator_id IS DISTINCT FROM OLD.owner_moderator_id
    OR NEW.line_id IS DISTINCT FROM OLD.line_id
    OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
    OR NEW.first_reply_at IS DISTINCT FROM OLD.first_reply_at
    OR NEW.clock_started_at IS DISTINCT FROM OLD.clock_started_at
    OR NEW.first_inbound_at IS DISTINCT FROM OLD.first_inbound_at) THEN
    RAISE EXCEPTION 'CM_MODERATOR_CANNOT_REASSIGN' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'closed' AND OLD.status <> 'closed' THEN NEW.closed_at := coalesce(NEW.closed_at, now()); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_cm_conversations_guard ON public.cm_conversations;
CREATE TRIGGER trg_cm_conversations_guard BEFORE UPDATE ON public.cm_conversations
  FOR EACH ROW EXECUTE FUNCTION public.cm_conversations_guard();

-- updated_at + التدقيق (الرسائل بدون تدقيق لكثرتها؛ تاريخها في الجدول نفسه)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cm_contacts','cm_contact_phones','cm_phone_review_queue','cm_customer_merges','cm_campaigns',
    'cm_campaign_ads','cm_campaign_line_map','cm_line_moderator_map','cm_conversations','cm_conversation_assignments','cm_ad_attributions']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_touch ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_touch BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.cm_touch_updated_at()', t);
    IF t NOT IN ('cm_contact_phones') THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON public.%1$I', t);
      EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.cm_audit()', t);
    END IF;
  END LOOP;
END $$;

-- ───────────── RLS ─────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cm_contacts','cm_contact_phones','cm_phone_review_queue','cm_customer_merges','cm_campaigns',
    'cm_campaign_ads','cm_campaign_line_map','cm_line_moderator_map','cm_conversations','cm_messages',
    'cm_conversation_assignments','cm_ad_attributions']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS cm_read ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS cm_write ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS cm_update ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS cm_insert ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS cm_mod_update ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS cm_mod_insert ON public.%I', t);
  END LOOP;
END $$;

-- جهات الاتصال: الكل للقراءة العامة، والمودريتور ما يرتبط بمحادثاتها؛ الكتابة للمدير.
CREATE POLICY cm_read ON public.cm_contacts FOR SELECT TO authenticated USING ((SELECT public.cm_can_read_all())
  OR EXISTS (SELECT 1 FROM public.cm_conversations c WHERE c.contact_id = cm_contacts.id AND public.cm_can_see_conversation(c.id)));
CREATE POLICY cm_write ON public.cm_contacts FOR ALL TO authenticated
  USING ((SELECT public.cm_can_manage())) WITH CHECK ((SELECT public.cm_can_manage()));
CREATE POLICY cm_read ON public.cm_contact_phones FOR SELECT TO authenticated USING ((SELECT public.cm_can_read_all())
  OR EXISTS (SELECT 1 FROM public.cm_conversations c WHERE (c.customer_id = cm_contact_phones.customer_id OR c.contact_id = cm_contact_phones.contact_id)
             AND public.cm_can_see_conversation(c.id)));
CREATE POLICY cm_write ON public.cm_contact_phones FOR ALL TO authenticated
  USING ((SELECT public.cm_can_manage())) WITH CHECK ((SELECT public.cm_can_manage()));

-- طابور المراجعة والدمج: المشرفون (SM, MSM, EM, GM) قراءة؛ SM/GM كتابة. الدمج عبر الدوال فقط.
CREATE POLICY cm_read ON public.cm_phone_review_queue FOR SELECT TO authenticated USING ((SELECT public.cm_is_supervisor()));
CREATE POLICY cm_update ON public.cm_phone_review_queue FOR UPDATE TO authenticated
  USING ((SELECT public.cm_can_manage())) WITH CHECK ((SELECT public.cm_can_manage()));
CREATE POLICY cm_read ON public.cm_customer_merges FOR SELECT TO authenticated USING ((SELECT public.cm_is_supervisor()));

-- الحملات والخرائط: قراءة للكل في الوحدة؛ الكتابة MSM/EM/GM، وخريطة الخط ← مودريتور لـ SM/GM أيضاً.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cm_campaigns','cm_campaign_ads','cm_campaign_line_map','cm_line_moderator_map'] LOOP
    EXECUTE format($p$CREATE POLICY cm_read ON public.%I FOR SELECT TO authenticated
      USING ((SELECT public.cm_can_read_all()) OR (SELECT public.cm_current_moderator_id()) IS NOT NULL)$p$, t);
    EXECUTE format($p$CREATE POLICY cm_write ON public.%I FOR ALL TO authenticated
      USING ((SELECT public.cm_can_manage_campaigns()) OR (%2$L = 'cm_line_moderator_map' AND (SELECT public.cm_can_manage())))
      WITH CHECK ((SELECT public.cm_can_manage_campaigns()) OR (%2$L = 'cm_line_moderator_map' AND (SELECT public.cm_can_manage())))$p$, t, t);
  END LOOP;
END $$;

-- المحادثات
CREATE POLICY cm_read ON public.cm_conversations FOR SELECT TO authenticated USING (
  (SELECT public.cm_can_read_all())
  OR ((SELECT public.cm_current_moderator_id()) IS NOT NULL AND (
        assigned_moderator_id = (SELECT public.cm_current_moderator_id())
     OR owner_moderator_id = (SELECT public.cm_current_moderator_id())
     OR public.cm_can_see_conversation(id))));
CREATE POLICY cm_write ON public.cm_conversations FOR ALL TO authenticated
  USING ((SELECT public.cm_can_manage())) WITH CHECK ((SELECT public.cm_can_manage()));
CREATE POLICY cm_mod_update ON public.cm_conversations FOR UPDATE TO authenticated
  USING ((SELECT public.cm_current_moderator_id()) IS NOT NULL AND public.cm_can_see_conversation(id))
  WITH CHECK ((SELECT public.cm_current_moderator_id()) IS NOT NULL AND public.cm_can_see_conversation(id));

-- الرسائل: قراءة لمن يرى المحادثة؛ المودريتور تضيف رسالة صادرة باسمها فقط. لا تعديل ولا حذف من الواجهة.
CREATE POLICY cm_read ON public.cm_messages FOR SELECT TO authenticated USING (public.cm_can_see_conversation(conversation_id));
CREATE POLICY cm_insert ON public.cm_messages FOR INSERT TO authenticated WITH CHECK (
  (SELECT public.cm_can_manage())
  OR (direction = 'out' AND sender_moderator_id = (SELECT public.cm_current_moderator_id())
      AND public.cm_can_see_conversation(conversation_id)));

-- الإسناد: القراءة لمن يرى المحادثة؛ الإضافة SM/GM فقط (المودريتور لا تُسند).
CREATE POLICY cm_read ON public.cm_conversation_assignments FOR SELECT TO authenticated
  USING (moderator_id = (SELECT public.cm_current_moderator_id()) OR public.cm_can_see_conversation(conversation_id));
CREATE POLICY cm_write ON public.cm_conversation_assignments FOR ALL TO authenticated
  USING ((SELECT public.cm_can_manage())) WITH CHECK ((SELECT public.cm_can_manage()));

-- الإسناد الإعلاني: قراءة لمن يرى المحادثة؛ تصحيح يدوي SM/GM/MSM/EM.
CREATE POLICY cm_read ON public.cm_ad_attributions FOR SELECT TO authenticated USING (public.cm_can_see_conversation(conversation_id));
CREATE POLICY cm_write ON public.cm_ad_attributions FOR ALL TO authenticated
  USING ((SELECT public.cm_can_manage()) OR (SELECT public.cm_can_manage_campaigns()))
  WITH CHECK ((SELECT public.cm_can_manage()) OR (SELECT public.cm_can_manage_campaigns()));

-- ───────────── الصلاحيات ─────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.cm_contacts, public.cm_contact_phones, public.cm_campaigns,
      public.cm_campaign_ads, public.cm_campaign_line_map, public.cm_line_moderator_map, public.cm_conversations,
      public.cm_conversation_assignments, public.cm_ad_attributions TO authenticated;
    GRANT SELECT, UPDATE ON public.cm_phone_review_queue TO authenticated;
    GRANT SELECT ON public.cm_customer_merges TO authenticated;
    GRANT SELECT, INSERT ON public.cm_messages TO authenticated;
    REVOKE UPDATE, DELETE ON public.cm_messages FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON public.cm_contacts, public.cm_contact_phones, public.cm_phone_review_queue, public.cm_customer_merges,
      public.cm_campaigns, public.cm_campaign_ads, public.cm_campaign_line_map, public.cm_line_moderator_map,
      public.cm_conversations, public.cm_messages, public.cm_conversation_assignments, public.cm_ad_attributions TO service_role;
  END IF;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.cm_can_see_conversation(uuid)','public.cm_can_manage_campaigns()','public.cm_is_system_or_manager()',
    'public.cm_clock_start(timestamptz)','public.cm_service_minutes(timestamptz,timestamptz)',
    'public.cm_on_shift_moderators(timestamptz)','public.cm_moderator_available(uuid,timestamptz)',
    'public.cm_line_owner_on(uuid,date)','public.cm_campaign_moderator_on(uuid,date)',
    'public.cm_distribute_conversation(uuid,timestamptz)','public.cm_reassign_conversation(uuid,uuid,text)',
    'public.cm_evaluate_first_reply(uuid,timestamptz)',
    'public.cm_attribute_conversation(uuid,text,text,text,text,text,uuid)','public.cm_customer_for_phone(text)',
    'public.cm_sync_customer_phones()','public.cm_merge_customers(uuid,uuid,text,uuid)','public.cm_undo_merge(uuid)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END IF;
  END LOOP;
END $$;
