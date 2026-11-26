-- wa_ingest_lock_fix — applied to coceg-prod 2026-11-20 ~20:55 Riyadh (version 20261120175428) after GM approval.
-- Project: coceg-prod (ppmahkofcpanjmpvmclv)
-- Change: two row locks on cm_conversations go from FOR UPDATE to FOR NO KEY UPDATE.
-- Why: inserting into cm_messages makes the foreign key take FOR KEY SHARE on the
-- conversation row. The trigger then asks for FOR UPDATE on that same row, and FOR UPDATE
-- conflicts with every other in-flight insert's KEY SHARE. Two or more concurrent messages in one
-- conversation then deadlock every time. FOR NO KEY UPDATE does not conflict with KEY SHARE,
-- but it still serialises the writers against each other, so the conversation counters stay
-- correct. No key columns are changed by these functions.
-- CREATE OR REPLACE FUNCTION takes no lock on any table, so it is safe to run during the incident.
SET LOCAL lock_timeout = '5s';

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

CREATE OR REPLACE FUNCTION public.cm_distribute_conversation(_conversation_id uuid, _at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(moderator_id uuid, via text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.cm_conversations; ds public.cm_distribution_settings; t timestamptz; d date;
        v_owner uuid; v_pick uuid; v_via text; v_method text; v_cover uuid;
BEGIN
  PERFORM public.cm_gate_assert();  -- بوابة القسم
  IF NOT public.cm_is_system_or_manager() THEN
    RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.cm_conversations WHERE id = _conversation_id FOR NO KEY UPDATE;  -- was FOR UPDATE: conflicted with FK KEY SHARE locks -> deadlocks (2026-11-20)
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
END $function$;

