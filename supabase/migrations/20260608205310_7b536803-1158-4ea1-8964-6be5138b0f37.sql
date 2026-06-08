
-- Internal Messages System (independent from notifications)

-- 1) internal_messages
CREATE TABLE public.internal_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  body text NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','important','urgent')),
  has_attachments boolean NOT NULL DEFAULT false,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.internal_messages TO authenticated;
GRANT ALL ON public.internal_messages TO service_role;
ALTER TABLE public.internal_messages ENABLE ROW LEVEL SECURITY;

-- 2) internal_message_recipients
CREATE TABLE public.internal_message_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.internal_messages(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at timestamptz NULL,
  archived_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, recipient_id)
);
CREATE INDEX idx_imr_recipient_unread ON public.internal_message_recipients(recipient_id) WHERE read_at IS NULL AND archived_at IS NULL;
CREATE INDEX idx_imr_message ON public.internal_message_recipients(message_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.internal_message_recipients TO authenticated;
GRANT ALL ON public.internal_message_recipients TO service_role;
ALTER TABLE public.internal_message_recipients ENABLE ROW LEVEL SECURITY;

-- 3) internal_message_attachments
CREATE TABLE public.internal_message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.internal_messages(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  file_name text,
  file_type text,
  file_size integer,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ima_message ON public.internal_message_attachments(message_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.internal_message_attachments TO authenticated;
GRANT ALL ON public.internal_message_attachments TO service_role;
ALTER TABLE public.internal_message_attachments ENABLE ROW LEVEL SECURITY;

-- 4) internal_message_replies
CREATE TABLE public.internal_message_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.internal_messages(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_imrep_message ON public.internal_message_replies(message_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.internal_message_replies TO authenticated;
GRANT ALL ON public.internal_message_replies TO service_role;
ALTER TABLE public.internal_message_replies ENABLE ROW LEVEL SECURITY;

-- Security definer: is participant
CREATE OR REPLACE FUNCTION public.is_message_participant(_message_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.internal_messages m WHERE m.id = _message_id AND m.sender_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.internal_message_recipients r WHERE r.message_id = _message_id AND r.recipient_id = _user_id
  )
$$;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_internal_messages_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_internal_messages_updated
BEFORE UPDATE ON public.internal_messages
FOR EACH ROW EXECUTE FUNCTION public.tg_internal_messages_set_updated_at();

-- RLS Policies

-- internal_messages
CREATE POLICY "im_select_participants" ON public.internal_messages
FOR SELECT TO authenticated
USING (sender_id = auth.uid() OR public.is_message_participant(id, auth.uid()));

CREATE POLICY "im_insert_self" ON public.internal_messages
FOR INSERT TO authenticated
WITH CHECK (sender_id = auth.uid());

CREATE POLICY "im_update_sender" ON public.internal_messages
FOR UPDATE TO authenticated
USING (sender_id = auth.uid())
WITH CHECK (sender_id = auth.uid());

-- internal_message_recipients
CREATE POLICY "imr_select_participants" ON public.internal_message_recipients
FOR SELECT TO authenticated
USING (
  recipient_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.internal_messages m WHERE m.id = message_id AND m.sender_id = auth.uid())
);

CREATE POLICY "imr_insert_sender" ON public.internal_message_recipients
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.internal_messages m WHERE m.id = message_id AND m.sender_id = auth.uid())
);

CREATE POLICY "imr_update_self" ON public.internal_message_recipients
FOR UPDATE TO authenticated
USING (recipient_id = auth.uid())
WITH CHECK (recipient_id = auth.uid());

-- internal_message_attachments
CREATE POLICY "ima_select_participants" ON public.internal_message_attachments
FOR SELECT TO authenticated
USING (public.is_message_participant(message_id, auth.uid()));

CREATE POLICY "ima_insert_participants" ON public.internal_message_attachments
FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND public.is_message_participant(message_id, auth.uid())
);

-- internal_message_replies
CREATE POLICY "imrep_select_participants" ON public.internal_message_replies
FOR SELECT TO authenticated
USING (public.is_message_participant(message_id, auth.uid()));

CREATE POLICY "imrep_insert_participants" ON public.internal_message_replies
FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND public.is_message_participant(message_id, auth.uid())
);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.internal_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.internal_message_recipients;
ALTER PUBLICATION supabase_realtime ADD TABLE public.internal_message_replies;
ALTER PUBLICATION supabase_realtime ADD TABLE public.internal_message_attachments;

-- Storage policies for internal-message-attachments bucket
-- (bucket created via tool separately)
CREATE POLICY "ima_storage_insert_authenticated"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'internal-message-attachments' AND owner = auth.uid());

CREATE POLICY "ima_storage_select_owner"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'internal-message-attachments' AND owner = auth.uid());

CREATE POLICY "ima_storage_select_via_attachment"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'internal-message-attachments'
  AND EXISTS (
    SELECT 1 FROM public.internal_message_attachments a
    WHERE a.file_url LIKE '%' || storage.objects.name
      AND public.is_message_participant(a.message_id, auth.uid())
  )
);
