-- cm_awaiting_reply_late_inbound_fix (approved by GM 2026-11-20 21:08 Riyadh). Based on live def incl. FOR NO KEY UPDATE.
CREATE OR REPLACE FUNCTION public.cm_messages_after_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.cm_conversations;
BEGIN
  IF NEW.is_history THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.cm_conversations WHERE id = NEW.conversation_id FOR NO KEY UPDATE;  -- was FOR UPDATE: conflicted with FK KEY SHARE locks -> deadlocks (2026-11-20)
  IF NEW.direction = 'in' THEN
    UPDATE public.cm_conversations SET
      first_inbound_at = coalesce(first_inbound_at, NEW.sent_at),
      clock_started_at = coalesce(clock_started_at, public.cm_clock_start(NEW.sent_at)),
      -- 2026-11-20: a late (backlog) inbound older than the last reply must not reopen the reply clock
      awaiting_reply_since = CASE WHEN NEW.sent_at > coalesce(last_outbound_at, '-infinity')
                                  THEN coalesce(awaiting_reply_since, public.cm_clock_start(NEW.sent_at))
                                  ELSE awaiting_reply_since END,
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

-- one-time correction: only these 4 rows, only awaiting_reply_since
UPDATE public.cm_conversations c SET awaiting_reply_since = (
  SELECT public.cm_clock_start(min(m.sent_at)) FROM public.cm_messages m
  WHERE m.conversation_id = c.id AND m.direction = 'in' AND NOT m.is_history
    AND m.sent_at > coalesce(c.last_outbound_at, '-infinity'))
WHERE c.id IN ('4a78a585-d35a-4e7f-9801-74480d9abd82','5c1e5c33-20bf-44fb-80a2-5026e379e28a','8eb2c204-98e4-4579-b55c-446b34132bfe','9424d072-21d9-4b47-8043-896b54f0022e');
