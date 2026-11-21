-- إدارة المحادثات — الخطوة 4ب: (أ) استيراد CDR بصيغة بوابة الخط الساخن الفعلية (CDR.csv + Switched.csv) وجدول أسماء مستخدمي الهوت لاين،
-- (ب) رفع تسجيلات المكالمات يدوياً (SM/GM) + دالة استقبال للخدمة (تطبيق الموبايل لاحقاً).
-- قرار عمرو 26-10: مديرة المبيعات (آلاء) تصدّر التسجيلات بأي وسيلة وترفعها من صفحة المكالمات.
-- التدفق اليدوي (لا روابط مخزّنة، لا رفع حر إلى الـ bucket):
--   1) cm_begin_recording_upload(call, mime, size, filename) ← يتحقق من الدور/النوع/الحجم ويحجز مساراً + تذكرة صالحة 10 دقائق.
--   2) العميل يرفع إلى storage بالمسار المحجوز فقط (سياسة INSERT تشترط تذكرة معلّقة لنفس المستخدم ونفس المسار).
--   3) cm_complete_recording_upload(upload_id) ← يتأكد أن الملف موجود فعلاً ثم يضبط cm_calls.recording_path ويكتب cm_audit_log.
-- التراجع: DROP TABLE cm_hotline_usernames; ALTER TABLE cm_calls DROP COLUMN call_result, hotline_username, switch_attempts, ended_at, has_vendor_recording;
--          DROP FUNCTION cm_cdr_ts, cm_cdr_duration; أعد cm_import_hotline_cdr من 20261025150000؛ DROP FUNCTION cm_begin_recording_upload, cm_complete_recording_upload, cm_ingest_call_recording, cm_recording_mime_ok,
--          cm_can_upload_recordings; DROP POLICY cm_recordings_upload ON storage.objects; DROP TABLE cm_recording_uploads.

CREATE OR REPLACE FUNCTION public.cm_can_upload_recordings()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(auth.uid(), ARRAY['sales_manager','general_manager']::public.app_role[])
$$;

-- الأنواع المسموحة ← الامتداد المستخدم في المسار. الحد الأقصى 50 ميجا لكل ملف.
CREATE OR REPLACE FUNCTION public.cm_recording_ext(_mime text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(btrim(coalesce(_mime,'')))
    WHEN 'audio/mpeg' THEN 'mp3' WHEN 'audio/mp3' THEN 'mp3'
    WHEN 'audio/mp4' THEN 'm4a' WHEN 'audio/x-m4a' THEN 'm4a' WHEN 'audio/m4a' THEN 'm4a' WHEN 'audio/aac' THEN 'aac'
    WHEN 'audio/wav' THEN 'wav' WHEN 'audio/x-wav' THEN 'wav' WHEN 'audio/wave' THEN 'wav'
    WHEN 'audio/ogg' THEN 'ogg' WHEN 'audio/opus' THEN 'opus' WHEN 'audio/webm' THEN 'webm'
    WHEN 'audio/amr' THEN 'amr' WHEN 'audio/3gpp' THEN '3gp' ELSE NULL END
$$;
CREATE OR REPLACE FUNCTION public.cm_recording_max_bytes() RETURNS bigint LANGUAGE sql IMMUTABLE AS $$ SELECT 52428800::bigint $$;

CREATE TABLE IF NOT EXISTS public.cm_recording_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.cm_calls(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE CHECK (storage_path ~ '^calls/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{2,4}$'),
  mime text NOT NULL CHECK (public.cm_recording_ext(mime) IS NOT NULL),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= public.cm_recording_max_bytes()),
  original_name text CHECK (length(original_name) <= 255),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','service')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS cm_recording_uploads_call_idx ON public.cm_recording_uploads (call_id, created_at DESC);
ALTER TABLE public.cm_recording_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cm_recording_uploads FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cm_recording_uploads TO authenticated;
DROP POLICY IF EXISTS cm_read ON public.cm_recording_uploads;
CREATE POLICY cm_read ON public.cm_recording_uploads FOR SELECT TO authenticated
  USING ((SELECT public.cm_can_upload_recordings()) OR (SELECT public.cm_can_listen_recordings()));

-- 1) حجز رفع يدوي
CREATE OR REPLACE FUNCTION public.cm_begin_recording_upload(_call_id uuid, _mime text, _size_bytes bigint, _original_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ext text := public.cm_recording_ext(_mime); v_started timestamptz; v_path text; v_id uuid := gen_random_uuid();
BEGIN
  IF NOT public.cm_can_upload_recordings() THEN RAISE EXCEPTION 'CM_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT started_at INTO v_started FROM public.cm_calls WHERE id = _call_id;
  IF v_started IS NULL THEN RAISE EXCEPTION 'CM_CALL_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF v_ext IS NULL THEN RAISE EXCEPTION 'CM_BAD_AUDIO_TYPE' USING ERRCODE = '22023'; END IF;
  IF _size_bytes IS NULL OR _size_bytes <= 0 OR _size_bytes > public.cm_recording_max_bytes() THEN
    RAISE EXCEPTION 'CM_BAD_AUDIO_SIZE' USING ERRCODE = '22023'; END IF;
  v_path := format('calls/%s/%s/%s.%s', to_char(v_started AT TIME ZONE 'Africa/Cairo', 'YYYY/MM'), _call_id, v_id, v_ext);
  INSERT INTO public.cm_recording_uploads (id, call_id, storage_path, mime, size_bytes, original_name, uploaded_by)
  VALUES (v_id, _call_id, v_path, lower(btrim(_mime)), _size_bytes, left(_original_name, 255), auth.uid());
  INSERT INTO public.cm_audit_log (actor_id, action, entity, entity_id, after)
  VALUES (auth.uid(), 'recording_upload_started', 'cm_calls', _call_id::text,
          jsonb_build_object('upload_id', v_id, 'path', v_path, 'mime', _mime, 'size_bytes', _size_bytes, 'original_name', left(_original_name, 255)));
  RETURN jsonb_build_object('upload_id', v_id, 'bucket', 'cm-call-recordings', 'path', v_path, 'expires_in', 600);
END $$;

-- ربط ملف مرفوع بالمكالمة (مشترك بين اليدوي والخدمة)
CREATE OR REPLACE FUNCTION public.cm_attach_recording(_upload_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.cm_recording_uploads; v_old text;
BEGIN
  SELECT * INTO u FROM public.cm_recording_uploads WHERE id = _upload_id FOR UPDATE;
  IF to_regclass('storage.objects') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'cm-call-recordings' AND o.name = u.storage_path) THEN
    RAISE EXCEPTION 'CM_UPLOAD_MISSING' USING ERRCODE = '22023'; END IF;
  SELECT recording_path INTO v_old FROM public.cm_calls WHERE id = u.call_id FOR UPDATE;
  UPDATE public.cm_calls SET recording_path = u.storage_path WHERE id = u.call_id;
  UPDATE public.cm_recording_uploads SET status = 'completed', completed_at = now() WHERE id = u.id;
  INSERT INTO public.cm_audit_log (actor_id, action, entity, entity_id, before, after)
  VALUES (auth.uid(), 'recording_attached', 'cm_calls', u.call_id::text, jsonb_build_object('recording_path', v_old),
          jsonb_build_object('recording_path', u.storage_path, 'upload_id', u.id, 'source', u.source, 'size_bytes', u.size_bytes, 'mime', u.mime));
END $$;
REVOKE ALL ON FUNCTION public.cm_attach_recording(uuid) FROM PUBLIC, anon, authenticated;

-- 3) إنهاء الرفع اليدوي: نفس المستخدم، تذكرة معلّقة غير منتهية
CREATE OR REPLACE FUNCTION public.cm_complete_recording_upload(_upload_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.cm_recording_uploads;
BEGIN
  IF NOT public.cm_can_upload_recordings() THEN RAISE EXCEPTION 'CM_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT * INTO u FROM public.cm_recording_uploads WHERE id = _upload_id;
  IF u.id IS NULL OR u.uploaded_by IS DISTINCT FROM auth.uid() OR u.source <> 'manual' THEN
    RAISE EXCEPTION 'CM_UPLOAD_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF u.status <> 'pending' THEN RAISE EXCEPTION 'CM_UPLOAD_ALREADY_DONE' USING ERRCODE = '22023'; END IF;
  IF u.created_at < now() - interval '30 minutes' THEN RAISE EXCEPTION 'CM_UPLOAD_EXPIRED' USING ERRCODE = '22023'; END IF;
  PERFORM public.cm_attach_recording(u.id);
  RETURN jsonb_build_object('call_id', u.call_id, 'path', u.storage_path);
END $$;

-- ── استقبال من الخدمة (service role فقط) — مخصّص لتطبيق موبايل لاحقاً ──
-- الاستخدام: الخدمة ترفع الملف أولاً إلى bucket «cm-call-recordings» بالمسار
--   calls/YYYY/MM/<call_uuid>/<uuid>.<ext>   (احصل عليه من الاستجابة عند تمرير _path = NULL في وضع الحجز، أو ابنه بنفس الصيغة)
-- ثم تستدعي cm_ingest_call_recording مع معرّف المكالمة الخارجي (CDR) أو (الرقم + وقت البدء ±2 دقيقة).
-- _path = NULL ⇒ حجز فقط (يعيد المسار)، و _path مُمرَّر ⇒ ربط ملف موجود. يُرفض أي رابط أو مسار خارج الصيغة.
CREATE OR REPLACE FUNCTION public.cm_ingest_call_recording(
  _external_call_id text, _phone text, _started_at timestamptz, _mime text, _size_bytes bigint, _path text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_call uuid; v_started timestamptz; v_ext text := public.cm_recording_ext(_mime); v_id uuid; v_path text; v_n int;
BEGIN
  IF NOT public.cm_is_service() THEN RAISE EXCEPTION 'CM_SERVICE_ONLY' USING ERRCODE = '42501'; END IF;
  IF v_ext IS NULL THEN RAISE EXCEPTION 'CM_BAD_AUDIO_TYPE' USING ERRCODE = '22023'; END IF;
  IF _size_bytes IS NULL OR _size_bytes <= 0 OR _size_bytes > public.cm_recording_max_bytes() THEN
    RAISE EXCEPTION 'CM_BAD_AUDIO_SIZE' USING ERRCODE = '22023'; END IF;
  IF nullif(btrim(_external_call_id), '') IS NOT NULL THEN
    SELECT id, started_at INTO v_call, v_started FROM public.cm_calls WHERE external_call_id = btrim(_external_call_id);
  ELSE
    SELECT count(*), min(id::text)::uuid INTO v_n, v_call FROM public.cm_calls
     WHERE phone_norm = public.cm_normalize_phone(_phone) AND started_at BETWEEN _started_at - interval '2 minutes' AND _started_at + interval '2 minutes';
    IF v_n > 1 THEN RAISE EXCEPTION 'CM_CALL_AMBIGUOUS' USING ERRCODE = '22023'; END IF;
    SELECT started_at INTO v_started FROM public.cm_calls WHERE id = v_call;
  END IF;
  IF v_call IS NULL THEN RAISE EXCEPTION 'CM_CALL_NOT_FOUND' USING ERRCODE = '22023'; END IF;
  IF _path IS NULL THEN
    v_id := gen_random_uuid();
    v_path := format('calls/%s/%s/%s.%s', to_char(v_started AT TIME ZONE 'Africa/Cairo', 'YYYY/MM'), v_call, v_id, v_ext);
    INSERT INTO public.cm_recording_uploads (id, call_id, storage_path, mime, size_bytes, source)
    VALUES (v_id, v_call, v_path, lower(btrim(_mime)), _size_bytes, 'service');
    RETURN jsonb_build_object('upload_id', v_id, 'call_id', v_call, 'bucket', 'cm-call-recordings', 'path', v_path, 'attached', false);
  END IF;
  SELECT id INTO v_id FROM public.cm_recording_uploads WHERE storage_path = _path AND call_id = v_call AND status = 'pending';
  IF v_id IS NULL THEN
    IF _path !~ ('^calls/[0-9]{4}/[0-9]{2}/' || v_call || '/[0-9a-f-]{36}\.[a-z0-9]{2,4}$') THEN
      RAISE EXCEPTION 'CM_BAD_PATH' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.cm_recording_uploads (call_id, storage_path, mime, size_bytes, source)
    VALUES (v_call, _path, lower(btrim(_mime)), _size_bytes, 'service') RETURNING id INTO v_id;
  END IF;
  PERFORM public.cm_attach_recording(v_id);
  RETURN jsonb_build_object('upload_id', v_id, 'call_id', v_call, 'path', _path, 'attached', true);
END $$;

REVOKE ALL ON FUNCTION public.cm_recording_ext(text), public.cm_recording_max_bytes(), public.cm_can_upload_recordings(), public.cm_begin_recording_upload(uuid,text,bigint,text),
  public.cm_complete_recording_upload(uuid), public.cm_ingest_call_recording(text,text,timestamptz,text,bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_can_upload_recordings(), public.cm_begin_recording_upload(uuid,text,bigint,text),
  public.cm_complete_recording_upload(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cm_ingest_call_recording(text,text,timestamptz,text,bigint,text) TO authenticated, service_role;

-- Storage: حدود الـ bucket (إن وُجدت الأعمدة) + INSERT فقط لمسار محجوز لنفس المستخدم خلال 10 دقائق. لا UPDATE/DELETE.
DO $$ BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'allowed_mime_types') THEN
    EXECUTE $q$UPDATE storage.buckets SET public = false, file_size_limit = 52428800,
      allowed_mime_types = ARRAY['audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/m4a','audio/aac','audio/wav','audio/x-wav',
                                 'audio/wave','audio/ogg','audio/opus','audio/webm','audio/amr','audio/3gpp']
      WHERE id = 'cm-call-recordings'$q$;
  END IF;
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS cm_recordings_upload ON storage.objects;
    CREATE POLICY cm_recordings_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK (
      bucket_id = 'cm-call-recordings' AND public.cm_can_upload_recordings()
      AND EXISTS (SELECT 1 FROM public.cm_recording_uploads u
                  WHERE u.storage_path = storage.objects.name AND u.uploaded_by = auth.uid()
                    AND u.status = 'pending' AND u.source = 'manual' AND u.created_at > now() - interval '10 minutes'));
  END IF;
END $$;

-- ═════════════ (أ) CDR بصيغة البوابة ═════════════
-- CDR.csv:      Cdr Id,A Number,Customer Name,B Number,Call Record,Voicemail,Start Time,End Time,Switched Time,Call Result,Call Duration,Call Direction
-- Switched.csv: Cdr Id,Username,Switch Time,Switching Status,Call Status,Answer Time,End Time   (محاولة رنين لكل مودريتور، مربوطة بـ Cdr Id)
-- Cdr Id هو مفتاح عدم التكرار: إعادة الاستيراد تحدّث نفس المكالمة (سجلات البوابة تنتهي بعد 5 أيام ⇒ المزامنة كل يومين-ثلاثة آمنة).
-- الحالة: answered لو فيه محاولة ACCEPTED؛ وإلا الوارد = missed، والصادر = answered لو Call Result يبدأ بـ ANSWERED وإلا failed.
-- المودريتور: Username للمحاولة المقبولة (أو آخر محاولة رنّت لو فائتة) ← cm_hotline_usernames (يديره SM/GM).
ALTER TABLE public.cm_calls
  ADD COLUMN IF NOT EXISTS call_result text,
  ADD COLUMN IF NOT EXISTS hotline_username text,
  ADD COLUMN IF NOT EXISTS switch_attempts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS line_number text,
  ADD COLUMN IF NOT EXISTS has_vendor_recording boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS cm_calls_hotline_username_idx ON public.cm_calls (lower(hotline_username));

CREATE TABLE IF NOT EXISTS public.cm_hotline_usernames (
  username text PRIMARY KEY CHECK (username = lower(btrim(username)) AND username <> '' AND length(username) <= 100),
  moderator_id uuid NOT NULL REFERENCES public.cm_moderators(id) ON DELETE CASCADE,
  notes text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cm_hotline_usernames ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cm_hotline_usernames FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cm_hotline_usernames TO authenticated;
DROP POLICY IF EXISTS cm_read ON public.cm_hotline_usernames;
DROP POLICY IF EXISTS cm_write ON public.cm_hotline_usernames;
CREATE POLICY cm_read ON public.cm_hotline_usernames FOR SELECT TO authenticated USING ((SELECT public.cm_can_read_all()));
CREATE POLICY cm_write ON public.cm_hotline_usernames FOR ALL TO authenticated
  USING ((SELECT public.cm_can_manage())) WITH CHECK ((SELECT public.cm_can_manage()));

CREATE OR REPLACE FUNCTION public.cm_hotline_username_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN NEW.updated_at := now(); NEW.updated_by := coalesce(auth.uid(), NEW.updated_by); END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
-- تعديل الربط يعيد نسب مكالمات هذا الاسم (الماضية أيضاً) للمودريتور الجديد.
CREATE OR REPLACE FUNCTION public.cm_hotline_username_reattribute()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    UPDATE public.cm_calls SET moderator_id = NULL WHERE lower(hotline_username) = OLD.username; END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN
    UPDATE public.cm_calls SET moderator_id = NEW.moderator_id WHERE lower(hotline_username) = NEW.username; END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_cm_hotline_usernames_touch ON public.cm_hotline_usernames;
CREATE TRIGGER trg_cm_hotline_usernames_touch BEFORE INSERT OR UPDATE ON public.cm_hotline_usernames
  FOR EACH ROW EXECUTE FUNCTION public.cm_hotline_username_sync();
DROP TRIGGER IF EXISTS trg_cm_hotline_usernames_reattr ON public.cm_hotline_usernames;
CREATE TRIGGER trg_cm_hotline_usernames_reattr AFTER INSERT OR UPDATE OR DELETE ON public.cm_hotline_usernames
  FOR EACH ROW EXECUTE FUNCTION public.cm_hotline_username_reattribute();
DROP TRIGGER IF EXISTS trg_cm_hotline_usernames_audit ON public.cm_hotline_usernames;
CREATE TRIGGER trg_cm_hotline_usernames_audit AFTER INSERT OR UPDATE OR DELETE ON public.cm_hotline_usernames
  FOR EACH ROW EXECUTE FUNCTION public.cm_audit();

-- «DD-MM-YYYY HH:MM:SS» بتوقيت القاهرة المحلي، أو ISO بإزاحة صريحة. غير ذلك ⇒ NULL.
CREATE OR REPLACE FUNCTION public.cm_cdr_ts(_v text)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v text := btrim(coalesce(_v, ''));
BEGIN
  IF v = '' THEN RETURN NULL; END IF;
  IF v ~ '^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$' THEN RETURN to_timestamp(v, 'DD-MM-YYYY HH24:MI:SS')::timestamp AT TIME ZONE 'Africa/Cairo'; END IF;
  IF v ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$' THEN RETURN v::timestamptz; END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION public.cm_cdr_duration(_v text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN btrim(coalesce(_v,'')) = '' THEN 0
              WHEN btrim(_v) ~ '^\d{1,3}:\d{2}:\d{2}$' THEN split_part(btrim(_v),':',1)::int*3600 + split_part(btrim(_v),':',2)::int*60 + split_part(btrim(_v),':',3)::int
              WHEN btrim(_v) ~ '^\d+$' THEN btrim(_v)::int ELSE -1 END
$$;

-- _rows: [{cdr_id, a_number, b_number, start_time, end_time, call_result, call_duration, call_direction, call_record,
--          attempts:[{username, switch_time, switching_status, call_status, answer_time, end_time}]}]  (أسماء أعمدة البوابة بصيغة snake_case)
-- يعيد: {inserted, updated, unchanged, rejected[{row,cdr_id,reason}], unknown_results[], unmapped_usernames[]}
DROP FUNCTION IF EXISTS public.cm_import_hotline_cdr(jsonb);
CREATE FUNCTION public.cm_import_hotline_cdr(_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; i int := 0; n_ins int := 0; n_upd int := 0; n_same int := 0; rej jsonb := '[]';
        v_id text; v_dir text; v_res text; v_started timestamptz; v_ended timestamptz; v_dur int; v_err text;
        v_phone_raw text; v_phone text; v_line text; v_att jsonb; v_acc jsonb; v_user text; v_status text; v_ins boolean;
        unknown text[] := '{}'; unmapped text[] := '{}'; seen text[] := '{}';
BEGIN
  IF NOT public.cm_is_system_or_manager() THEN RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(_rows) <> 'array' THEN RAISE EXCEPTION 'CM_ROWS_NOT_ARRAY'; END IF;
  IF jsonb_array_length(_rows) > 5000 THEN RAISE EXCEPTION 'CM_TOO_MANY_ROWS'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    i := i + 1; v_err := NULL;
    v_id := btrim(coalesce(r->>'cdr_id', ''));
    v_dir := lower(btrim(coalesce(r->>'call_direction', '')));
    v_res := upper(btrim(coalesce(r->>'call_result', '')));
    v_started := public.cm_cdr_ts(r->>'start_time'); v_ended := public.cm_cdr_ts(r->>'end_time');
    v_dur := public.cm_cdr_duration(r->>'call_duration');
    v_att := CASE WHEN jsonb_typeof(r->'attempts') = 'array' THEN r->'attempts' ELSE '[]'::jsonb END;
    v_phone_raw := CASE WHEN v_dir = 'outbound' THEN r->>'b_number' ELSE r->>'a_number' END;
    v_line := btrim(CASE WHEN v_dir = 'outbound' THEN r->>'a_number' ELSE r->>'b_number' END);
    v_phone := public.cm_normalize_phone(v_phone_raw);
    IF v_id = '' THEN v_err := 'missing_id';
    ELSIF v_id = ANY (seen) THEN v_err := 'duplicate_in_file';
    ELSIF v_dir NOT IN ('inbound','outbound') THEN v_err := 'bad_direction';
    ELSIF v_started IS NULL THEN v_err := 'bad_started_at';
    ELSIF v_dur < 0 THEN v_err := 'bad_duration';
    ELSIF NOT public.cm_phone_is_valid(v_phone) THEN v_err := 'bad_phone';
    END IF;
    IF v_err IS NOT NULL THEN rej := rej || jsonb_build_object('row', i, 'cdr_id', nullif(v_id, ''), 'reason', v_err); CONTINUE; END IF;
    seen := seen || v_id;
    IF v_res <> '' AND v_res NOT IN ('ANSWERED','ANSWERED_BY_AGENT','MISSED','ABANDONED','NO_ANSWER','NOANSWER','UNANSWERED','BUSY','FAILED','VOICEMAIL','CANCELLED','REJECTED')
       AND NOT v_res = ANY (unknown) THEN unknown := unknown || v_res; END IF;
    SELECT a INTO v_acc FROM jsonb_array_elements(v_att) a WHERE upper(btrim(a->>'switching_status')) = 'ACCEPTED'
      ORDER BY public.cm_cdr_ts(a->>'switch_time') NULLS LAST LIMIT 1;
    IF v_acc IS NOT NULL THEN v_status := 'answered'; v_user := lower(btrim(v_acc->>'username'));
    ELSE
      v_status := CASE WHEN v_dir = 'inbound' THEN 'missed' WHEN v_res LIKE 'ANSWERED%' THEN 'answered' ELSE 'failed' END;
      SELECT lower(btrim(a->>'username')) INTO v_user FROM jsonb_array_elements(v_att) a
       ORDER BY public.cm_cdr_ts(a->>'switch_time') DESC NULLS LAST LIMIT 1;
    END IF;
    v_user := nullif(v_user, '');
    IF v_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.cm_hotline_usernames WHERE username = v_user) AND NOT v_user = ANY (unmapped)
      THEN unmapped := unmapped || v_user; END IF;
    v_ins := NULL;
    INSERT INTO public.cm_calls AS c (external_call_id, line_id, line_number, direction, started_at, ended_at, duration_sec, status, call_result,
                                 phone_raw, phone_norm, contact_id, customer_id, hotline_username, moderator_id, switch_attempts,
                                 has_vendor_recording, imported_by)
    VALUES (v_id, (SELECT id FROM public.cm_lines WHERE external_id = v_line OR label = v_line LIMIT 1), nullif(v_line, ''),
            v_dir, v_started, v_ended, v_dur, v_status, nullif(v_res, ''), v_phone_raw, v_phone,
            (SELECT id FROM public.cm_contacts WHERE phone_norm = v_phone), public.cm_customer_for_phone(v_phone),
            v_user, (SELECT moderator_id FROM public.cm_hotline_usernames WHERE username = v_user), v_att,
            btrim(coalesce(r->>'call_record', '')) <> '', auth.uid())
    ON CONFLICT (external_call_id) DO UPDATE SET
      line_id = EXCLUDED.line_id, line_number = EXCLUDED.line_number, direction = EXCLUDED.direction, started_at = EXCLUDED.started_at,
      ended_at = EXCLUDED.ended_at, duration_sec = EXCLUDED.duration_sec, status = EXCLUDED.status, call_result = EXCLUDED.call_result,
      phone_raw = EXCLUDED.phone_raw, phone_norm = EXCLUDED.phone_norm, contact_id = coalesce(EXCLUDED.contact_id, c.contact_id),
      customer_id = coalesce(EXCLUDED.customer_id, c.customer_id), hotline_username = EXCLUDED.hotline_username,
      moderator_id = EXCLUDED.moderator_id, switch_attempts = EXCLUDED.switch_attempts, has_vendor_recording = EXCLUDED.has_vendor_recording
      -- لا يُلمس: recording_path / followed_up_at / followed_up_by
    WHERE (c.direction, c.started_at, c.ended_at, c.duration_sec, c.status, c.call_result, c.phone_norm, c.hotline_username,
           c.moderator_id, c.switch_attempts, c.has_vendor_recording, c.line_number)
          IS DISTINCT FROM (EXCLUDED.direction, EXCLUDED.started_at, EXCLUDED.ended_at, EXCLUDED.duration_sec, EXCLUDED.status,
           EXCLUDED.call_result, EXCLUDED.phone_norm, EXCLUDED.hotline_username, EXCLUDED.moderator_id, EXCLUDED.switch_attempts,
           EXCLUDED.has_vendor_recording, EXCLUDED.line_number)
    RETURNING (xmax = 0) INTO v_ins;
    IF v_ins IS NULL THEN n_same := n_same + 1; ELSIF v_ins THEN n_ins := n_ins + 1; ELSE n_upd := n_upd + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('inserted', n_ins, 'updated', n_upd, 'unchanged', n_same, 'rejected', rej,
                            'unknown_results', to_jsonb(unknown), 'unmapped_usernames', to_jsonb(unmapped));
END $$;
REVOKE ALL ON FUNCTION public.cm_import_hotline_cdr(jsonb), public.cm_cdr_ts(text), public.cm_cdr_duration(text),
  public.cm_hotline_username_sync(), public.cm_hotline_username_reattribute() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_import_hotline_cdr(jsonb) TO authenticated, service_role;
