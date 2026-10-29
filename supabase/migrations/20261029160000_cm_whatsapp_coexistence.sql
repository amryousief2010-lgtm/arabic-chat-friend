-- Coexistence (واتساب للأعمال + Cloud API): ردود التطبيق (smb_message_echoes)، التاريخ (history)،
-- جهات الاتصال (smb_app_state_sync)، وحالات التسليم (statuses). idempotent بالكامل.
-- كل الدوال: security definer + search_path ثابت + service_role فقط (نفس أسلوب cm_ingest_whatsapp_message).

-- 1) أعمدة وأنواع جديدة
ALTER TABLE public.cm_messages ADD COLUMN IF NOT EXISTS media_id text;
ALTER TABLE public.cm_messages ADD COLUMN IF NOT EXISTS is_history boolean NOT NULL DEFAULT false;
ALTER TABLE public.cm_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.cm_messages ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE public.cm_contacts ADD COLUMN IF NOT EXISTS saved_name text;          -- الاسم في دفتر عناوين تطبيق البيزنس
ALTER TABLE public.cm_contacts ADD COLUMN IF NOT EXISTS saved_name_synced_at timestamptz;

ALTER TABLE public.cm_messages DROP CONSTRAINT IF EXISTS cm_messages_type_check;
ALTER TABLE public.cm_messages ADD CONSTRAINT cm_messages_type_check CHECK (type = ANY (ARRAY[
  'text','image','audio','video','document','sticker','location','contacts','reaction','template','interactive',
  'system','order','unsupported','media_placeholder','unknown']));

-- الرسالتان القديمتان من نوع unsupported (خطأ 131060 «الرسالة غير متاحة») كانتا تُحفظان unknown
UPDATE public.cm_messages SET type = 'unsupported'
 WHERE type = 'unknown' AND provider = 'whatsapp' AND raw->>'type' = 'unsupported';

-- 2) سجل أحداث الويب هوك غير الرسائل (تقدّم التاريخ، الرفض، الحقول غير المعروفة) — لا بيانات عملاء
CREATE TABLE IF NOT EXISTS public.cm_whatsapp_webhook_log (
  id bigserial PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now(),
  field text NOT NULL,
  phone_number_id text,
  line_id uuid REFERENCES public.cm_lines(id) ON DELETE SET NULL,
  phase int, chunk_order int, progress int,
  error_code int,
  info jsonb
);
ALTER TABLE public.cm_whatsapp_webhook_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cm_wa_log_manage_read ON public.cm_whatsapp_webhook_log;
CREATE POLICY cm_wa_log_manage_read ON public.cm_whatsapp_webhook_log FOR SELECT TO authenticated USING (public.cm_can_manage());
REVOKE ALL ON public.cm_whatsapp_webhook_log FROM anon, authenticated;
GRANT SELECT ON public.cm_whatsapp_webhook_log TO authenticated;

-- 3) تعبئة media_id / media_mime من raw تلقائياً لأي مسار
CREATE OR REPLACE FUNCTION public.cm_messages_fill_media()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE k text := NEW.raw->>'type';
BEGIN
  IF NEW.raw IS NOT NULL AND k IN ('image','audio','video','document','sticker') THEN
    NEW.media_id := coalesce(NEW.media_id, NEW.raw->k->>'id');
    NEW.media_mime := coalesce(NEW.media_mime, NEW.raw->k->>'mime_type');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_cm_messages_fill_media ON public.cm_messages;
CREATE TRIGGER trg_cm_messages_fill_media BEFORE INSERT OR UPDATE OF raw ON public.cm_messages
  FOR EACH ROW EXECUTE FUNCTION public.cm_messages_fill_media();

-- 4) رسائل التاريخ لا تحرّك عدّاد الرد ولا الانتظار ولا التنبيهات
CREATE OR REPLACE FUNCTION public.cm_messages_after_insert()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c public.cm_conversations;
BEGIN
  IF NEW.is_history THEN RETURN NULL; END IF;
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
      awaiting_reply_since = CASE WHEN NEW.sent_at >= coalesce(last_inbound_at, '-infinity') THEN NULL ELSE awaiting_reply_since END
    WHERE id = NEW.conversation_id;
  END IF;
  RETURN NULL;
END $function$;

-- 5) الوارد: نفس الدالة مع قائمة الأنواع الموسعة
CREATE OR REPLACE FUNCTION public.cm_ingest_whatsapp_message(_phone_number_id text, _wa_id text, _profile_name text, _provider_message_id text, _sent_at timestamp with time zone, _type text DEFAULT 'text'::text, _body text DEFAULT NULL::text, _raw jsonb DEFAULT NULL::jsonb, _ctwa_clid text DEFAULT NULL::text, _referral_source_id text DEFAULT NULL::text, _referral_source_type text DEFAULT NULL::text, _referral_headline text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_line uuid; v_norm text; v_contact uuid; v_customer uuid; v_conv uuid; v_new boolean := false;
        v_msg uuid; v_pick uuid; v_via text; v_thread text; v_type text; c public.cm_conversations;
BEGIN
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

  v_thread := 'wa:' || coalesce(_phone_number_id, '-') || ':' || _wa_id;
  INSERT INTO public.cm_conversations (channel, line_id, contact_id, customer_id, phone_norm, external_thread_id, opened_at)
  VALUES ('whatsapp', v_line, v_contact, v_customer, v_norm, v_thread, coalesce(_sent_at, now()))
  ON CONFLICT (channel, external_thread_id) WHERE external_thread_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_conv;
  IF v_conv IS NOT NULL THEN v_new := true;
  ELSE SELECT id INTO v_conv FROM public.cm_conversations WHERE channel = 'whatsapp' AND external_thread_id = v_thread;
  END IF;

  v_type := CASE WHEN _type IN ('text','image','audio','video','document','sticker','location','contacts','reaction',
                                'template','interactive','system','order','unsupported','media_placeholder') THEN _type ELSE 'unknown' END;
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
END $function$;

-- 6) مساعد: جهة اتصال + محادثة على الخط بدون توزيع (للرد من التطبيق والتاريخ)
CREATE OR REPLACE FUNCTION public.cm_wa_thread_for(_phone_number_id text, _wa_id text, _history boolean, _at timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_line uuid; v_owner uuid; v_norm text; v_contact uuid; v_customer uuid; v_conv uuid; v_thread text;
BEGIN
  IF auth.uid() IS NOT NULL OR NOT public.cm_is_system_or_manager() THEN
    RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  SELECT id, owner_moderator_id INTO v_line, v_owner FROM public.cm_lines WHERE external_id = _phone_number_id LIMIT 1;
  v_norm := public.cm_normalize_phone(_wa_id);
  v_thread := 'wa:' || coalesce(_phone_number_id, '-') || ':' || _wa_id;
  SELECT id INTO v_conv FROM public.cm_conversations WHERE channel = 'whatsapp' AND external_thread_id = v_thread;
  IF v_conv IS NULL AND v_norm IS NOT NULL THEN   -- رقم العميل في echo قد لا يطابق wa_id حرفياً
    SELECT id INTO v_conv FROM public.cm_conversations
     WHERE channel = 'whatsapp' AND line_id IS NOT DISTINCT FROM v_line AND phone_norm = v_norm ORDER BY opened_at LIMIT 1;
  END IF;
  IF v_conv IS NOT NULL THEN RETURN v_conv; END IF;

  SELECT id INTO v_contact FROM public.cm_contacts WHERE wa_id = _wa_id OR (v_norm IS NOT NULL AND phone_norm = v_norm) LIMIT 1;
  v_customer := CASE WHEN public.cm_phone_is_valid(v_norm) THEN public.cm_customer_for_phone(v_norm) END;
  IF v_contact IS NULL THEN
    INSERT INTO public.cm_contacts (phone_raw, phone_norm, wa_id, customer_id)
    VALUES (_wa_id, v_norm, _wa_id, v_customer) ON CONFLICT DO NOTHING RETURNING id INTO v_contact;
    IF v_contact IS NULL THEN SELECT id INTO v_contact FROM public.cm_contacts WHERE wa_id = _wa_id OR phone_norm = v_norm LIMIT 1; END IF;
  END IF;
  INSERT INTO public.cm_conversations (channel, line_id, contact_id, customer_id, phone_norm, external_thread_id, opened_at,
                                       owner_moderator_id, assigned_moderator_id, status, closed_at)
  VALUES ('whatsapp', v_line, v_contact, v_customer, v_norm, v_thread, coalesce(_at, now()), v_owner,
          CASE WHEN _history THEN NULL ELSE v_owner END,
          CASE WHEN _history THEN 'closed' ELSE 'open' END, CASE WHEN _history THEN coalesce(_at, now()) END)
  ON CONFLICT (channel, external_thread_id) WHERE external_thread_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_conv;
  IF v_conv IS NULL THEN SELECT id INTO v_conv FROM public.cm_conversations WHERE channel = 'whatsapp' AND external_thread_id = v_thread; END IF;
  RETURN v_conv;
END $$;

-- 7) smb_message_echoes: رد صاحبة الخط من تطبيق واتساب للأعمال = رد صادر يوقف عدّاد الرد
CREATE OR REPLACE FUNCTION public.cm_ingest_whatsapp_echo(_phone_number_id text, _to text, _provider_message_id text,
  _sent_at timestamptz, _type text, _body text, _raw jsonb, _original_message_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_conv uuid; v_owner uuid; v_msg uuid; v_n int; v_type text;
BEGIN
  IF auth.uid() IS NOT NULL OR NOT public.cm_is_system_or_manager() THEN
    RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  IF nullif(_provider_message_id, '') IS NULL OR nullif(_to, '') IS NULL THEN RAISE EXCEPTION 'CM_BAD_MESSAGE'; END IF;

  IF _type = 'revoke' THEN    -- حذف رسالة سابقة: نعلّمها ولا نمسحها
    UPDATE public.cm_messages SET revoked_at = coalesce(revoked_at, _sent_at)
     WHERE provider = 'whatsapp' AND provider_message_id = _original_message_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN jsonb_build_object('duplicate', false, 'revoked', v_n);
  ELSIF _type = 'edit' THEN
    UPDATE public.cm_messages SET body = coalesce(_body, body), edited_at = _sent_at,
           raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('last_edit', _raw)
     WHERE provider = 'whatsapp' AND provider_message_id = _original_message_id
       AND (edited_at IS NULL OR edited_at <= _sent_at);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN jsonb_build_object('duplicate', false, 'edited', v_n);
  END IF;

  IF EXISTS (SELECT 1 FROM public.cm_messages WHERE provider = 'whatsapp' AND provider_message_id = _provider_message_id) THEN
    RETURN jsonb_build_object('duplicate', true);
  END IF;
  SELECT owner_moderator_id INTO v_owner FROM public.cm_lines WHERE external_id = _phone_number_id LIMIT 1;
  v_conv := public.cm_wa_thread_for(_phone_number_id, regexp_replace(_to, '\D', '', 'g'), false, _sent_at);
  v_type := CASE WHEN _type IN ('text','image','audio','video','document','sticker','location','contacts','reaction',
                                'template','interactive','system','order','unsupported') THEN _type ELSE 'unknown' END;
  INSERT INTO public.cm_messages (conversation_id, direction, type, body, provider, provider_message_id, sender_moderator_id,
                                  sent_via, sent_at, delivery_status, raw)
  VALUES (v_conv, 'out', v_type, _body, 'whatsapp', _provider_message_id, v_owner, 'business_app',
          coalesce(_sent_at, now()), 'sent', _raw)
  ON CONFLICT DO NOTHING RETURNING id INTO v_msg;
  RETURN jsonb_build_object('duplicate', v_msg IS NULL, 'conversation_id', v_conv, 'message_id', v_msg);
END $$;

-- 8) history: دفعة رسائل لمحادثة واحدة. _messages = [{id, direction, sent_at, type, body, raw, status}]
--    لا تحرّك عداد/انتظار/تنبيهات (is_history=true يتخطاه التريجر)، والمحادثة الجديدة تُنشأ مغلقة.
--    إن وصلت رسالة بنفس المعرف وهي media_placeholder تُستبدل بمحتواها (webhook الوسائط اللاحق).
CREATE OR REPLACE FUNCTION public.cm_ingest_whatsapp_history(_phone_number_id text, _wa_id text, _messages jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_conv uuid; v_owner uuid; m jsonb; v_ins int := 0; v_upd int := 0; v_dup int := 0; v_skip int := 0; v_n int;
        v_at timestamptz; v_dir text; v_type text; v_first timestamptz;
BEGIN
  IF auth.uid() IS NOT NULL OR NOT public.cm_is_system_or_manager() THEN
    RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  SELECT owner_moderator_id INTO v_owner FROM public.cm_lines WHERE external_id = _phone_number_id LIMIT 1;
  FOR m IN SELECT * FROM jsonb_array_elements(coalesce(_messages, '[]'::jsonb)) LOOP
    IF nullif(m->>'id', '') IS NULL THEN v_skip := v_skip + 1; CONTINUE; END IF;
    v_type := CASE WHEN m->>'type' IN ('text','image','audio','video','document','sticker','location','contacts','reaction',
                   'template','interactive','system','order','unsupported','media_placeholder') THEN m->>'type' ELSE 'unknown' END;
    -- تحديث placeholder موجود بمحتوى الوسائط
    UPDATE public.cm_messages SET type = v_type, body = coalesce(m->>'body', body), raw = m->'raw'
     WHERE provider = 'whatsapp' AND provider_message_id = m->>'id' AND type = 'media_placeholder' AND v_type <> 'media_placeholder';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN v_upd := v_upd + 1; CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.cm_messages WHERE provider = 'whatsapp' AND provider_message_id = m->>'id') THEN
      v_dup := v_dup + 1; CONTINUE;
    END IF;
    IF nullif(_wa_id, '') IS NULL THEN v_skip := v_skip + 1; CONTINUE; END IF;  -- وسائط لاحقة لرسالة غير معروفة
    v_at := coalesce((m->>'sent_at')::timestamptz, now());
    v_first := least(coalesce(v_first, v_at), v_at);
    IF v_conv IS NULL THEN v_conv := public.cm_wa_thread_for(_phone_number_id, _wa_id, true, v_at); END IF;
    v_dir := CASE WHEN m->>'direction' = 'out' THEN 'out' ELSE 'in' END;
    INSERT INTO public.cm_messages (conversation_id, direction, type, body, provider, provider_message_id, sender_moderator_id,
                                    sent_via, sent_at, delivery_status, raw, is_history)
    VALUES (v_conv, v_dir, v_type, m->>'body', 'whatsapp', m->>'id', CASE WHEN v_dir = 'out' THEN v_owner END,
            CASE WHEN v_dir = 'out' THEN 'business_app' END, v_at,
            CASE WHEN v_dir = 'in' THEN 'received'
                 ELSE CASE lower(coalesce(m->>'status', '')) WHEN 'read' THEN 'read' WHEN 'played' THEN 'read'
                      WHEN 'delivered' THEN 'delivered' WHEN 'error' THEN 'failed' WHEN 'pending' THEN 'pending' ELSE 'sent' END END,
            m->'raw', true)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN v_ins := v_ins + 1; ELSE v_dup := v_dup + 1; END IF;
  END LOOP;
  -- التاريخ أقدم من فتح المحادثة؟ نرجّع opened_at فقط (لا first_inbound/clock/awaiting)
  IF v_conv IS NOT NULL AND v_first IS NOT NULL THEN
    UPDATE public.cm_conversations SET opened_at = least(opened_at, v_first) WHERE id = v_conv AND opened_at > v_first;
  END IF;
  RETURN jsonb_build_object('conversation_id', v_conv, 'inserted', v_ins, 'media_updated', v_upd, 'duplicates', v_dup, 'skipped', v_skip);
END $$;

-- 9) smb_app_state_sync: أسماء جهات الاتصال من دفتر عناوين تطبيق البيزنس
--    _contacts = [{phone, full_name, first_name, action, ts}]
CREATE OR REPLACE FUNCTION public.cm_sync_whatsapp_contacts(_phone_number_id text, _contacts jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb; v_wa text; v_norm text; v_id uuid; v_name text; v_ts timestamptz; v_up int := 0; v_new int := 0; v_rm int := 0;
BEGIN
  IF auth.uid() IS NOT NULL OR NOT public.cm_is_system_or_manager() THEN
    RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  FOR c IN SELECT * FROM jsonb_array_elements(coalesce(_contacts, '[]'::jsonb)) LOOP
    v_wa := nullif(regexp_replace(coalesce(c->>'phone', ''), '\D', '', 'g'), '');
    IF v_wa IS NULL THEN CONTINUE; END IF;
    v_norm := public.cm_normalize_phone(v_wa);
    v_ts := coalesce((c->>'ts')::timestamptz, now());
    v_name := nullif(btrim(coalesce(c->>'full_name', c->>'first_name', '')), '');
    SELECT id INTO v_id FROM public.cm_contacts WHERE wa_id = v_wa OR (v_norm IS NOT NULL AND phone_norm = v_norm) LIMIT 1;
    IF c->>'action' = 'remove' THEN
      IF v_id IS NOT NULL THEN
        UPDATE public.cm_contacts SET saved_name = NULL, saved_name_synced_at = v_ts
         WHERE id = v_id AND (saved_name_synced_at IS NULL OR saved_name_synced_at <= v_ts) AND saved_name IS NOT NULL;
        IF FOUND THEN v_rm := v_rm + 1; END IF;
      END IF;
    ELSIF v_id IS NULL THEN
      INSERT INTO public.cm_contacts (phone_raw, phone_norm, wa_id, saved_name, saved_name_synced_at, customer_id)
      VALUES (v_wa, v_norm, v_wa, v_name, v_ts, CASE WHEN public.cm_phone_is_valid(v_norm) THEN public.cm_customer_for_phone(v_norm) END)
      ON CONFLICT DO NOTHING;
      IF FOUND THEN v_new := v_new + 1; END IF;
    ELSE
      UPDATE public.cm_contacts SET saved_name = v_name, saved_name_synced_at = v_ts
       WHERE id = v_id AND (saved_name_synced_at IS NULL OR saved_name_synced_at <= v_ts)
         AND saved_name IS DISTINCT FROM v_name;
      IF FOUND THEN v_up := v_up + 1; END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('created', v_new, 'updated', v_up, 'removed', v_rm);
END $$;

-- 10) statuses[]: sent → delivered → read (لا يرجع للخلف)، failed مع السبب
CREATE OR REPLACE FUNCTION public.cm_update_whatsapp_status(_provider_message_id text, _status text, _at timestamptz, _error text DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n int;
BEGIN
  IF auth.uid() IS NOT NULL OR NOT public.cm_is_system_or_manager() THEN
    RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  UPDATE public.cm_messages SET
    delivery_status = CASE
      WHEN _status = 'failed' THEN 'failed'
      WHEN _status IN ('sent','delivered','read')
       AND array_position(ARRAY['pending','sent','delivered','read'], _status)
           > coalesce(array_position(ARRAY['pending','sent','delivered','read'], delivery_status), 0) THEN _status
      ELSE delivery_status END,
    delivered_at = CASE WHEN _status IN ('delivered','read') THEN coalesce(delivered_at, _at) ELSE delivered_at END,
    read_at = CASE WHEN _status = 'read' THEN coalesce(read_at, _at) ELSE read_at END,
    failed_reason = CASE WHEN _status = 'failed' THEN coalesce(_error, failed_reason) ELSE failed_reason END
  WHERE provider = 'whatsapp' AND provider_message_id = _provider_message_id AND direction = 'out';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- 11) سجل الأحداث
CREATE OR REPLACE FUNCTION public.cm_log_whatsapp_webhook(_field text, _phone_number_id text, _phase int, _chunk_order int,
  _progress int, _error_code int, _info jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NOT NULL OR NOT public.cm_is_system_or_manager() THEN
    RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.cm_whatsapp_webhook_log (field, phone_number_id, line_id, phase, chunk_order, progress, error_code, info)
  VALUES (_field, _phone_number_id, (SELECT id FROM public.cm_lines WHERE external_id = _phone_number_id LIMIT 1),
          _phase, _chunk_order, _progress, _error_code, _info);
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY[
    'cm_wa_thread_for(text,text,boolean,timestamptz)',
    'cm_ingest_whatsapp_echo(text,text,text,timestamptz,text,text,jsonb,text)',
    'cm_ingest_whatsapp_history(text,text,jsonb)',
    'cm_sync_whatsapp_contacts(text,jsonb)',
    'cm_update_whatsapp_status(text,text,timestamptz,text)',
    'cm_log_whatsapp_webhook(text,text,int,int,int,int,jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;
