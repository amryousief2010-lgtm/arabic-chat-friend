-- إدارة المحادثات — الخطوة 3: استقبال رسائل واتساب (للـ webhook فقط) + أدوات التغطية للمشرفات.
-- إضافة فقط وقابلة لإعادة التشغيل. لا بيانات ولا أرقام هنا. لا ربط بميتا: الدالة لا تُستدعى إلا من
-- الـ edge function ‏whatsapp-webhook بصلاحية service_role، وهي غير منشورة وخاملة حتى تُضبط أسرارها.
-- التراجع اليدوي: DROP FUNCTION public.cm_ingest_whatsapp_message(text,text,text,text,timestamptz,text,text,jsonb,text,text,text,text);
--   DROP FUNCTION public.cm_set_cover(uuid,uuid,boolean);

-- يحفظ رسالة واردة مرة واحدة فقط (حسب provider_message_id) ويُنشئ جهة الاتصال والمحادثة عند الحاجة،
-- ثم يسجّل مصدر الإعلان (ctwa_clid ثم referral.source_id) ويوزّع المحادثة الجديدة.
CREATE OR REPLACE FUNCTION public.cm_ingest_whatsapp_message(
  _phone_number_id text, _wa_id text, _profile_name text, _provider_message_id text, _sent_at timestamptz,
  _type text DEFAULT 'text', _body text DEFAULT NULL, _raw jsonb DEFAULT NULL,
  _ctwa_clid text DEFAULT NULL, _referral_source_id text DEFAULT NULL,
  _referral_source_type text DEFAULT NULL, _referral_headline text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_line uuid; v_norm text; v_contact uuid; v_customer uuid; v_conv uuid; v_new boolean := false;
        v_msg uuid; v_pick uuid; v_via text; v_thread text; v_type text; c public.cm_conversations;
BEGIN
  -- النظام فقط (service_role): لا مستخدم مسجّل، ولا anon/authenticated
  IF auth.uid() IS NOT NULL OR NOT public.cm_is_system_or_manager() THEN
    RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  IF nullif(_provider_message_id, '') IS NULL OR nullif(_wa_id, '') IS NULL THEN
    RAISE EXCEPTION 'CM_BAD_MESSAGE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cm_messages WHERE provider = 'whatsapp' AND provider_message_id = _provider_message_id) THEN
    RETURN jsonb_build_object('duplicate', true);
  END IF;

  SELECT id INTO v_line FROM public.cm_lines WHERE external_id = _phone_number_id LIMIT 1;
  v_norm := public.cm_normalize_phone(_wa_id);

  SELECT id INTO v_contact FROM public.cm_contacts WHERE wa_id = _wa_id;
  IF v_contact IS NULL AND v_norm IS NOT NULL THEN
    SELECT id INTO v_contact FROM public.cm_contacts WHERE phone_norm = v_norm;
    IF v_contact IS NOT NULL THEN UPDATE public.cm_contacts SET wa_id = _wa_id WHERE id = v_contact AND wa_id IS NULL; END IF;
  END IF;
  v_customer := CASE WHEN public.cm_phone_is_valid(v_norm) THEN public.cm_customer_for_phone(v_norm) END;
  IF v_contact IS NULL THEN
    INSERT INTO public.cm_contacts (phone_raw, phone_norm, wa_id, profile_name, customer_id)
    VALUES (_wa_id, v_norm, _wa_id, nullif(_profile_name, ''), v_customer)
    ON CONFLICT DO NOTHING RETURNING id INTO v_contact;
    IF v_contact IS NULL THEN SELECT id INTO v_contact FROM public.cm_contacts WHERE wa_id = _wa_id OR phone_norm = v_norm LIMIT 1; END IF;
  ELSE
    UPDATE public.cm_contacts SET profile_name = coalesce(nullif(_profile_name, ''), profile_name),
      customer_id = coalesce(customer_id, v_customer) WHERE id = v_contact;
  END IF;

  -- محادثة واحدة لكل (رقم الخط، العميل)
  v_thread := 'wa:' || coalesce(_phone_number_id, '-') || ':' || _wa_id;
  INSERT INTO public.cm_conversations (channel, line_id, contact_id, customer_id, phone_norm, external_thread_id, opened_at)
  VALUES ('whatsapp', v_line, v_contact, v_customer, v_norm, v_thread, coalesce(_sent_at, now()))
  ON CONFLICT (channel, external_thread_id) WHERE external_thread_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_conv;
  IF v_conv IS NOT NULL THEN v_new := true;
  ELSE SELECT id INTO v_conv FROM public.cm_conversations WHERE channel = 'whatsapp' AND external_thread_id = v_thread;
  END IF;

  v_type := CASE WHEN _type IN ('text','image','audio','video','document','sticker','location','contacts','reaction',
                                'template','interactive','system') THEN _type ELSE 'unknown' END;
  INSERT INTO public.cm_messages (conversation_id, direction, type, body, provider, provider_message_id, sent_at,
                                  delivery_status, raw)
  VALUES (v_conv, 'in', v_type, _body, 'whatsapp', _provider_message_id, coalesce(_sent_at, now()), 'received', _raw)
  ON CONFLICT DO NOTHING RETURNING id INTO v_msg;
  IF v_msg IS NULL THEN RETURN jsonb_build_object('duplicate', true, 'conversation_id', v_conv); END IF;

  IF v_new THEN
    IF nullif(_ctwa_clid, '') IS NOT NULL OR nullif(_referral_source_id, '') IS NOT NULL THEN
      PERFORM public.cm_attribute_conversation(v_conv, _ctwa_clid, _referral_source_id, _referral_source_type, _referral_headline);
    END IF;
    SELECT d.moderator_id, d.via INTO v_pick, v_via FROM public.cm_distribute_conversation(v_conv, _sent_at) d;
  END IF;

  SELECT * INTO c FROM public.cm_conversations WHERE id = v_conv;
  RETURN jsonb_build_object('duplicate', false, 'conversation_id', v_conv, 'message_id', v_msg,
    'new_conversation', v_new, 'assigned_moderator_id', c.assigned_moderator_id, 'via', v_via,
    'clock_started_at', c.clock_started_at,
    'deferred', coalesce(c.clock_started_at > c.first_inbound_at, false));
END $$;

-- تغطية يدوية: مديرة المبيعات / المدير العام فقط
CREATE OR REPLACE FUNCTION public.cm_set_cover(_conversation_id uuid, _moderator_id uuid, _on boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.cm_can_manage() THEN RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF _on THEN
    INSERT INTO public.cm_conversation_assignments (conversation_id, moderator_id, kind, method, assigned_by, reason)
    VALUES (_conversation_id, _moderator_id, 'cover', 'cover', auth.uid(), 'manual_cover') ON CONFLICT DO NOTHING;
  ELSE
    UPDATE public.cm_conversation_assignments SET ended_at = now()
    WHERE conversation_id = _conversation_id AND moderator_id = _moderator_id AND kind = 'cover' AND ended_at IS NULL;
  END IF;
END $$;

DO $cm_harden$
BEGIN
  REVOKE ALL ON FUNCTION public.cm_ingest_whatsapp_message(text,text,text,text,timestamptz,text,text,jsonb,text,text,text,text) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.cm_set_cover(uuid,uuid,boolean) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.cm_ingest_whatsapp_message(text,text,text,text,timestamptz,text,text,jsonb,text,text,text,text) FROM anon;
    REVOKE ALL ON FUNCTION public.cm_set_cover(uuid,uuid,boolean) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.cm_ingest_whatsapp_message(text,text,text,text,timestamptz,text,text,jsonb,text,text,text,text) FROM authenticated;
    GRANT EXECUTE ON FUNCTION public.cm_set_cover(uuid,uuid,boolean) TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.cm_ingest_whatsapp_message(text,text,text,text,timestamptz,text,text,jsonb,text,text,text,text) TO service_role;
  END IF;
END $cm_harden$;
