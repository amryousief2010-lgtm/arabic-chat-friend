-- إدارة المحادثات متعددة القنوات: واتساب ← ماسنجر ← إنستجرام ← (تيك توك لاحقاً).
-- idempotent. ربط مباشر مع Meta فقط (بدون وسيط). لا يغيّر سلوك واتساب ولا بياناته.

-- 1) سجل القنوات
ALTER TABLE public.cm_channels DROP CONSTRAINT IF EXISTS cm_channels_kind_check;
ALTER TABLE public.cm_channels ADD CONSTRAINT cm_channels_kind_check
  CHECK (kind IN ('whatsapp','messenger','instagram','tiktok','hotline'));
ALTER TABLE public.cm_channels ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 100;
ALTER TABLE public.cm_channels ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT true;  -- false = «قريبًا»
ALTER TABLE public.cm_channels ADD COLUMN IF NOT EXISTS provider text;  -- meta | tiktok | hotline
INSERT INTO public.cm_channels (kind, name, is_active) VALUES ('tiktok', 'تيك توك', false) ON CONFLICT (kind) DO NOTHING;
UPDATE public.cm_channels SET sort_order = 10, provider = 'meta',    name = 'واتساب'     WHERE kind = 'whatsapp';
UPDATE public.cm_channels SET sort_order = 20, provider = 'meta',    name = 'ماسنجر'     WHERE kind = 'messenger';
UPDATE public.cm_channels SET sort_order = 30, provider = 'meta',    name = 'إنستجرام'   WHERE kind = 'instagram';
UPDATE public.cm_channels SET sort_order = 40, provider = 'tiktok',  name = 'تيك توك', is_enabled = false, is_active = false WHERE kind = 'tiktok';
UPDATE public.cm_channels SET sort_order = 90, provider = 'hotline' WHERE kind = 'hotline';

-- 2) حسابات القنوات (صفحة ماسنجر / حساب إنستجرام) كصفوف في cm_lines؛ external_id = Page ID / IG business account ID
ALTER TABLE public.cm_lines DROP CONSTRAINT IF EXISTS cm_lines_mode_check;
ALTER TABLE public.cm_lines ADD CONSTRAINT cm_lines_mode_check CHECK (mode IN ('coexistence','api','app_only','hotline','page','ig_account'));
CREATE UNIQUE INDEX IF NOT EXISTS cm_lines_ext_uniq ON public.cm_lines (channel_id, external_id) WHERE external_id IS NOT NULL;
INSERT INTO public.cm_lines (channel_id, label, mode, is_api_line, meta_registered, connection_status)
SELECT id, 'صفحة كابيتال أوستريتش — ماسنجر', 'page', true, false, 'not_connected' FROM public.cm_channels WHERE kind = 'messenger'
ON CONFLICT (label) DO NOTHING;
INSERT INTO public.cm_lines (channel_id, label, mode, is_api_line, meta_registered, connection_status)
SELECT id, 'حساب كابيتال أوستريتش — إنستجرام', 'ig_account', true, false, 'not_connected' FROM public.cm_channels WHERE kind = 'instagram'
ON CONFLICT (label) DO NOTHING;

-- 3) جهات الاتصال: معرّف خارجي لكل قناة (PSID / IGSID) واسم ومعرّف ظاهر
ALTER TABLE public.cm_contacts ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp';
ALTER TABLE public.cm_contacts ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.cm_contacts ADD COLUMN IF NOT EXISTS handle text;
ALTER TABLE public.cm_contacts ADD COLUMN IF NOT EXISTS profile_pic_url text;
CREATE UNIQUE INDEX IF NOT EXISTS cm_contacts_ext_uniq ON public.cm_contacts (channel, external_id) WHERE external_id IS NOT NULL;

-- 4) المحادثات
ALTER TABLE public.cm_conversations DROP CONSTRAINT IF EXISTS cm_conversations_channel_check;
ALTER TABLE public.cm_conversations ADD CONSTRAINT cm_conversations_channel_check
  CHECK (channel IN ('whatsapp','messenger','instagram','tiktok'));
ALTER TABLE public.cm_conversations ADD COLUMN IF NOT EXISTS external_contact_id text;
ALTER TABLE public.cm_conversations ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE public.cm_conversations ADD COLUMN IF NOT EXISTS contact_handle text;
ALTER TABLE public.cm_conversations ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS cm_conversations_channel_idx ON public.cm_conversations (channel, last_inbound_at DESC);

-- 5) الرسائل
ALTER TABLE public.cm_messages DROP CONSTRAINT IF EXISTS cm_messages_provider_check;
ALTER TABLE public.cm_messages ADD CONSTRAINT cm_messages_provider_check
  CHECK (provider IN ('whatsapp','messenger','instagram','tiktok','manual','demo'));
ALTER TABLE public.cm_messages DROP CONSTRAINT IF EXISTS cm_messages_type_check;
ALTER TABLE public.cm_messages ADD CONSTRAINT cm_messages_type_check CHECK (type IN ('text','image','audio','video','document',
  'sticker','location','contacts','reaction','template','interactive','system','order','unsupported','media_placeholder','unknown',
  'postback','share','story_mention','story_reply'));
ALTER TABLE public.cm_messages DROP CONSTRAINT IF EXISTS cm_messages_sent_via_check;
ALTER TABLE public.cm_messages ADD CONSTRAINT cm_messages_sent_via_check CHECK (sent_via IN ('business_app','api','manual','page_inbox'));

-- 6) سجل webhook الاجتماعي (ماسنجر/إنستجرام)
CREATE TABLE IF NOT EXISTS public.cm_social_webhook_log (
  id bigserial PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now(),
  object text NOT NULL,           -- page | instagram
  field text NOT NULL,            -- messages | message_echoes | messaging_postbacks | messaging_referrals | message_reads | ...
  account_id text,                -- Page ID / IG account ID
  line_id uuid REFERENCES public.cm_lines(id) ON DELETE SET NULL,
  info jsonb
);
ALTER TABLE public.cm_social_webhook_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cm_social_log_manage_read ON public.cm_social_webhook_log;
CREATE POLICY cm_social_log_manage_read ON public.cm_social_webhook_log FOR SELECT USING (public.cm_can_manage());
REVOKE ALL ON public.cm_social_webhook_log FROM anon;

CREATE OR REPLACE FUNCTION public.cm_log_social_webhook(_object text, _field text, _account_id text, _info jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL OR NOT public.cm_is_system_or_manager() THEN RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.cm_social_webhook_log (object, field, account_id, line_id, info)
  VALUES (_object, _field, _account_id,
    (SELECT l.id FROM public.cm_lines l JOIN public.cm_channels ch ON ch.id = l.channel_id
      WHERE l.external_id = _account_id AND ch.kind = CASE WHEN _object = 'instagram' THEN 'instagram' ELSE 'messenger' END LIMIT 1), _info);
END $$;

-- 7) الاستقبال الموحّد لماسنجر/إنستجرام (وارد + echo صادر من صندوق الصفحة). idempotent بـ (provider, provider_message_id).
CREATE OR REPLACE FUNCTION public.cm_ingest_social_message(
  _channel text, _account_id text, _contact_external_id text, _direction text, _provider_message_id text,
  _sent_at timestamptz, _type text, _body text, _raw jsonb, _profile_name text DEFAULT NULL, _handle text DEFAULT NULL,
  _ad_id text DEFAULT NULL, _ad_source_type text DEFAULT NULL, _ad_headline text DEFAULT NULL, _is_demo boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_line uuid; v_owner uuid; v_contact uuid; v_conv uuid; v_new boolean := false; v_msg uuid; v_type text;
        v_thread text; v_pick uuid; v_via text; c public.cm_conversations;
BEGIN
  IF auth.uid() IS NOT NULL OR NOT public.cm_is_system_or_manager() THEN RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF _channel NOT IN ('messenger','instagram','tiktok') THEN RAISE EXCEPTION 'CM_BAD_CHANNEL'; END IF;
  IF _direction NOT IN ('in','out') OR nullif(_provider_message_id,'') IS NULL OR nullif(_contact_external_id,'') IS NULL THEN
    RAISE EXCEPTION 'CM_BAD_MESSAGE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cm_messages WHERE provider = _channel AND provider_message_id = _provider_message_id) THEN
    RETURN jsonb_build_object('duplicate', true);
  END IF;

  SELECT l.id, l.owner_moderator_id INTO v_line, v_owner FROM public.cm_lines l JOIN public.cm_channels ch ON ch.id = l.channel_id
   WHERE ch.kind = _channel AND (l.external_id = _account_id OR (l.external_id IS NULL AND _is_demo))
   ORDER BY (l.external_id = _account_id) DESC NULLS LAST LIMIT 1;

  INSERT INTO public.cm_contacts (channel, external_id, profile_name, handle)
  VALUES (_channel, _contact_external_id, nullif(_profile_name,''), nullif(_handle,''))
  ON CONFLICT (channel, external_id) WHERE external_id IS NOT NULL
  DO UPDATE SET profile_name = coalesce(EXCLUDED.profile_name, cm_contacts.profile_name),
                handle = coalesce(EXCLUDED.handle, cm_contacts.handle)
  RETURNING id INTO v_contact;

  v_thread := left(_channel, 2) || ':' || coalesce(_account_id, '-') || ':' || _contact_external_id;
  INSERT INTO public.cm_conversations (channel, line_id, contact_id, external_thread_id, external_contact_id, contact_name,
      contact_handle, page_id, ig_user_id, opened_at, is_demo, owner_moderator_id, assigned_moderator_id)
  VALUES (_channel, v_line, v_contact, v_thread, _contact_external_id, nullif(_profile_name,''), nullif(_handle,''),
      CASE WHEN _channel = 'messenger' THEN _account_id END, CASE WHEN _channel = 'instagram' THEN _contact_external_id END,
      coalesce(_sent_at, now()), _is_demo, v_owner, CASE WHEN _direction = 'out' THEN v_owner END)
  ON CONFLICT (channel, external_thread_id) WHERE external_thread_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_conv;
  IF v_conv IS NOT NULL THEN v_new := true;
  ELSE
    SELECT id INTO v_conv FROM public.cm_conversations WHERE channel = _channel AND external_thread_id = v_thread;
    UPDATE public.cm_conversations SET contact_name = coalesce(nullif(_profile_name,''), contact_name),
      contact_handle = coalesce(nullif(_handle,''), contact_handle) WHERE id = v_conv;
  END IF;

  v_type := CASE WHEN _type IN ('text','image','audio','video','document','sticker','location','reaction','template',
    'interactive','system','unsupported','postback','share','story_mention','story_reply') THEN _type ELSE 'unknown' END;
  INSERT INTO public.cm_messages (conversation_id, direction, type, body, provider, provider_message_id, sender_moderator_id,
      sent_via, sent_at, delivery_status, raw)
  VALUES (v_conv, _direction, v_type, _body, _channel, _provider_message_id,
      CASE WHEN _direction = 'out' THEN v_owner END, CASE WHEN _direction = 'out' THEN 'page_inbox' END,
      coalesce(_sent_at, now()), CASE WHEN _direction = 'in' THEN 'received' ELSE 'sent' END, _raw)
  ON CONFLICT DO NOTHING RETURNING id INTO v_msg;
  IF v_msg IS NULL THEN RETURN jsonb_build_object('duplicate', true, 'conversation_id', v_conv); END IF;

  -- إعلان (Click-to-Messenger / Click-to-Instagram): أول لمسة فقط، بنفس منطق ربط الحملات
  IF _direction = 'in' AND nullif(_ad_id,'') IS NOT NULL THEN
    SELECT * INTO c FROM public.cm_conversations WHERE id = v_conv;
    IF c.ad_id IS NULL THEN
      PERFORM public.cm_attribute_conversation(v_conv, NULL, _ad_id, coalesce(_ad_source_type, 'ad'), _ad_headline);
    END IF;
  END IF;
  IF v_new AND _direction = 'in' AND NOT _is_demo THEN
    SELECT d.moderator_id, d.via INTO v_pick, v_via FROM public.cm_distribute_conversation(v_conv, _sent_at) d;
  END IF;

  SELECT * INTO c FROM public.cm_conversations WHERE id = v_conv;
  RETURN jsonb_build_object('duplicate', false, 'conversation_id', v_conv, 'message_id', v_msg, 'new_conversation', v_new,
    'assigned_moderator_id', c.assigned_moderator_id, 'via', v_via,
    'deferred', coalesce(c.clock_started_at > c.first_inbound_at, false));
END $$;

-- إسناد إعلان لاحق (referral بدون رسالة: messaging_referrals) لمحادثة قائمة
CREATE OR REPLACE FUNCTION public.cm_social_referral(_channel text, _account_id text, _contact_external_id text,
  _ad_id text, _ad_source_type text, _ad_headline text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_conv uuid;
BEGIN
  IF auth.uid() IS NOT NULL OR NOT public.cm_is_system_or_manager() THEN RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_conv FROM public.cm_conversations
   WHERE channel = _channel AND external_thread_id = left(_channel, 2) || ':' || coalesce(_account_id, '-') || ':' || _contact_external_id;
  IF v_conv IS NULL OR nullif(_ad_id,'') IS NULL THEN RETURN 'no_conversation'; END IF;
  IF EXISTS (SELECT 1 FROM public.cm_conversations WHERE id = v_conv AND ad_id IS NOT NULL) THEN RETURN 'already'; END IF;
  RETURN public.cm_attribute_conversation(v_conv, NULL, _ad_id, coalesce(_ad_source_type, 'ad'), _ad_headline);
END $$;

-- مقروءة (message_reads): تعليم الصادر حتى watermark كمقروء
CREATE OR REPLACE FUNCTION public.cm_social_mark_read(_channel text, _account_id text, _contact_external_id text, _watermark timestamptz)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF auth.uid() IS NOT NULL OR NOT public.cm_is_system_or_manager() THEN RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  UPDATE public.cm_messages m SET delivery_status = 'read', read_at = coalesce(read_at, _watermark)
   FROM public.cm_conversations c
   WHERE c.id = m.conversation_id AND c.channel = _channel
     AND c.external_thread_id = left(_channel, 2) || ':' || coalesce(_account_id, '-') || ':' || _contact_external_id
     AND m.direction = 'out' AND m.sent_at <= _watermark AND m.delivery_status <> 'read';
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.cm_log_social_webhook(text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cm_ingest_social_message(text,text,text,text,text,timestamptz,text,text,jsonb,text,text,text,text,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cm_social_referral(text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cm_social_mark_read(text,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cm_log_social_webhook(text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cm_ingest_social_message(text,text,text,text,text,timestamptz,text,text,jsonb,text,text,text,text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.cm_social_referral(text,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cm_social_mark_read(text,text,text,timestamptz) TO service_role;
