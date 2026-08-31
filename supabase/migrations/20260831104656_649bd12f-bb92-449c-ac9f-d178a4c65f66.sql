-- 1) Columns (additive, safe)
ALTER TABLE public.internal_messages
  ADD COLUMN IF NOT EXISTS requires_reply boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reply_due_at timestamptz;

ALTER TABLE public.internal_message_recipients
  ADD COLUMN IF NOT EXISTS replied_at timestamptz;

-- 2) Only general managers may create/flag a mandatory message
CREATE OR REPLACE FUNCTION public.im_guard_requires_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.requires_reply IS TRUE
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.requires_reply, false) IS DISTINCT FROM true) THEN
    IF NOT public.has_role(NEW.sender_id, 'general_manager'::app_role) THEN
      RAISE EXCEPTION 'only_general_manager_can_require_reply';
    END IF;
    IF NEW.sender_id <> auth.uid() THEN
      RAISE EXCEPTION 'sender_mismatch';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_im_guard_requires_reply ON public.internal_messages;
CREATE TRIGGER trg_im_guard_requires_reply
BEFORE INSERT OR UPDATE ON public.internal_messages
FOR EACH ROW EXECUTE FUNCTION public.im_guard_requires_reply();

-- 3) Recipient row guard: no manual replied_at, no archiving before reply
CREATE OR REPLACE FUNCTION public.imr_guard_recipient_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requires boolean;
BEGIN
  -- replied_at may only change through the secure reply RPC
  IF NEW.replied_at IS DISTINCT FROM OLD.replied_at
     AND COALESCE(current_setting('app.im_reply_ctx', true), '') <> '1' THEN
    RAISE EXCEPTION 'replied_at_is_readonly';
  END IF;

  -- recipient identity is immutable
  IF NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
     OR NEW.message_id IS DISTINCT FROM OLD.message_id THEN
    RAISE EXCEPTION 'recipient_row_immutable';
  END IF;

  -- cannot archive a mandatory message before replying
  IF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN
    SELECT m.requires_reply INTO v_requires
    FROM public.internal_messages m WHERE m.id = NEW.message_id;
    IF COALESCE(v_requires, false) AND NEW.replied_at IS NULL THEN
      RAISE EXCEPTION 'reply_required_before_archive';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_imr_guard_recipient_update ON public.internal_message_recipients;
CREATE TRIGGER trg_imr_guard_recipient_update
BEFORE UPDATE ON public.internal_message_recipients
FOR EACH ROW EXECUTE FUNCTION public.imr_guard_recipient_update();

-- 4) Secure reply RPC (single transaction)
CREATE OR REPLACE FUNCTION public.im_send_reply(p_message_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_body text := btrim(COALESCE(p_body, ''));
  v_reply_id uuid;
  v_rec_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  IF v_body = '' THEN
    RAISE EXCEPTION 'empty_reply_not_allowed';
  END IF;
  IF NOT public.is_message_participant(p_message_id, v_uid) THEN
    RAISE EXCEPTION 'not_a_participant';
  END IF;

  INSERT INTO public.internal_message_replies (message_id, sender_id, body)
  VALUES (p_message_id, v_uid, v_body)
  RETURNING id INTO v_reply_id;

  PERFORM set_config('app.im_reply_ctx', '1', true);

  UPDATE public.internal_message_recipients
     SET replied_at = COALESCE(replied_at, now()),
         read_at = COALESCE(read_at, now())
   WHERE message_id = p_message_id
     AND recipient_id = v_uid
  RETURNING id INTO v_rec_id;

  PERFORM set_config('app.im_reply_ctx', '0', true);

  RETURN v_reply_id;
END;
$$;

REVOKE ALL ON FUNCTION public.im_send_reply(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.im_send_reply(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.im_guard_requires_reply() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.imr_guard_recipient_update() FROM PUBLIC, anon;