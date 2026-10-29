-- وسائط واتساب داخل النظام — 29-10-2026.
-- bucket خاص cm-chat-media (25MB، بدون public). القراءة بـ signed URL فقط لمن يرى المحادثة (cm_can_see_conversation يشمل cm_gate والمدير العام).
-- الرفع/التعديل عبر service role فقط (دالة cm-chat-media). حالة التنزيل على cm_messages للمحاولة من جديد.
-- التراجع: DROP POLICY cm_chat_media_read ON storage.objects; DELETE FROM storage.objects WHERE bucket_id='cm-chat-media' (من الـ API)؛
--          DELETE FROM storage.buckets WHERE id='cm-chat-media'; DROP FUNCTION cm_media_pending(int), cm_set_media_result(uuid,text,text,text,text,bigint);
--          ALTER TABLE cm_messages DROP COLUMN media_status, media_attempts, media_error, media_size, media_fetched_at;

ALTER TABLE public.cm_messages
  ADD COLUMN IF NOT EXISTS media_status text,
  ADD COLUMN IF NOT EXISTS media_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS media_error text,
  ADD COLUMN IF NOT EXISTS media_size bigint,
  ADD COLUMN IF NOT EXISTS media_fetched_at timestamptz;
DO $$ BEGIN
  ALTER TABLE public.cm_messages ADD CONSTRAINT cm_messages_media_status_chk
    CHECK (media_status IS NULL OR media_status IN ('pending','done','error','too_large','expired'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
UPDATE public.cm_messages SET media_status = 'pending'
  WHERE media_id IS NOT NULL AND media_path IS NULL AND media_status IS NULL;
CREATE INDEX IF NOT EXISTS cm_messages_media_pending_idx ON public.cm_messages (sent_at) WHERE media_status IN ('pending','error');

-- الرسائل الجديدة ذات media_id تبدأ pending (trigger التعبئة الموجود يملأ media_id من raw).
CREATE OR REPLACE FUNCTION public.cm_messages_media_status_trg()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.media_id IS NOT NULL AND NEW.media_path IS NULL AND NEW.media_status IS NULL THEN NEW.media_status := 'pending'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_cm_messages_media_status ON public.cm_messages;
CREATE TRIGGER trg_cm_messages_media_status BEFORE INSERT OR UPDATE OF media_id ON public.cm_messages
  FOR EACH ROW EXECUTE FUNCTION public.cm_messages_media_status_trg();

-- طابور المحاولة: pending أو error بمحاولات < 5، وmedia_id صالح 30 يوماً فقط.
CREATE OR REPLACE FUNCTION public.cm_media_pending(_limit int DEFAULT 10)
RETURNS TABLE (id uuid, conversation_id uuid, media_id text, media_mime text, type text, attempts int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.conversation_id, m.media_id, m.media_mime, m.type, m.media_attempts FROM public.cm_messages m
  WHERE m.media_status IN ('pending','error') AND m.media_attempts < 5 AND m.media_id IS NOT NULL
    AND m.sent_at > now() - interval '30 days'
  ORDER BY m.media_attempts, m.sent_at DESC LIMIT least(greatest(coalesce(_limit, 10), 1), 50)
$$;
CREATE OR REPLACE FUNCTION public.cm_set_media_result(_message_id uuid, _status text, _path text DEFAULT NULL,
  _mime text DEFAULT NULL, _error text DEFAULT NULL, _size bigint DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL OR NOT public.cm_is_system_or_manager() THEN RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  UPDATE public.cm_messages SET media_status = _status, media_path = coalesce(_path, media_path),
    media_mime = coalesce(_mime, media_mime), media_error = left(_error, 300), media_size = coalesce(_size, media_size),
    media_attempts = media_attempts + 1, media_fetched_at = CASE WHEN _status = 'done' THEN now() ELSE media_fetched_at END
  WHERE id = _message_id;
END $$;
REVOKE ALL ON FUNCTION public.cm_media_pending(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cm_set_media_result(uuid,text,text,text,text,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cm_media_pending(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.cm_set_media_result(uuid,text,text,text,text,bigint) TO service_role;

DO $$ BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('cm-chat-media', 'cm-chat-media', false, 26214400)
    ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 26214400;
  END IF;
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS cm_chat_media_read ON storage.objects;
    -- المسار = <conversation_id>/<message_id>.<ext>؛ القراءة (ومنها إنشاء signed URL) لمن يرى المحادثة فقط.
    CREATE POLICY cm_chat_media_read ON storage.objects FOR SELECT TO authenticated USING (
      bucket_id = 'cm-chat-media'
      AND EXISTS (SELECT 1 FROM public.cm_messages m WHERE m.media_path = storage.objects.name
                  AND public.cm_can_see_conversation(m.conversation_id)));
    -- لا سياسة INSERT/UPDATE/DELETE للمستخدمين: الرفع عبر service role فقط.
  END IF;
END $$;
