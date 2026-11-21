-- مكالمات الخط الساخن — تعديلات على التصدير الفعلي (عينات 14-10-2026):
-- 1) ANSWERED_SWITCHED نتيجة معروفة (حُوِّلت للموظفات ولم تقبلها أي واحدة) — لا تُعاد كـ unknown_results. لا تغيير في الحالة المشتقة.
-- 2) cm_kpi_missed_calls_v: عمود إضافي ivr_abandoned = «انقطع في القائمة الصوتية» (Call Result = ANSWERED بدون أي محاولة تحويل).
--    عمود إضافي فقط في آخر الـ view؛ عدد الفائتة وتعريف المتابعة كما هما.
-- التراجع: أعد cm_import_hotline_cdr من 20261025160000، وأعد إنشاء cm_kpi_missed_calls_v من 20261025150000 (DROP ثم CREATE).

CREATE OR REPLACE FUNCTION public.cm_import_hotline_cdr(_rows jsonb)
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
    IF v_res <> '' AND v_res NOT IN ('ANSWERED','ANSWERED_BY_AGENT','ANSWERED_SWITCHED','MISSED','ABANDONED','NO_ANSWER','NOANSWER','UNANSWERED','BUSY','FAILED','VOICEMAIL','CANCELLED','REJECTED')
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

CREATE OR REPLACE VIEW public.cm_kpi_missed_calls_v WITH (security_invoker = true) AS
WITH k AS (SELECT coalesce((SELECT missed_call_followup_min FROM public.cm_kpi_settings WHERE id = 1), 60) AS m),
f AS (
  SELECT x.id, x.started_at, x.moderator_id, x.phone_norm, x.followed_up_at,
         (upper(coalesce(x.call_result, '')) = 'ANSWERED' AND coalesce(jsonb_array_length(x.switch_attempts), 0) = 0) AS ivr_abandoned,
         (SELECT min(o.started_at) FROM public.cm_calls o
           WHERE o.phone_norm = x.phone_norm AND o.direction = 'outbound' AND o.started_at > x.started_at) AS callback_at,
         (SELECT min(m.sent_at) FROM public.cm_messages m JOIN public.cm_conversations cv ON cv.id = m.conversation_id
           WHERE cv.phone_norm = x.phone_norm AND m.direction = 'out' AND m.sent_at > x.started_at) AS message_at
  FROM public.cm_calls x WHERE x.status = 'missed' AND x.direction = 'inbound')
SELECT f.id AS call_id, f.started_at, public.cm_local_date(f.started_at) AS kpi_date, f.moderator_id, f.phone_norm,
       least(f.followed_up_at, f.callback_at, f.message_at) AS followup_at,
       coalesce(least(f.followed_up_at, f.callback_at, f.message_at) <= f.started_at + make_interval(mins => k.m), false) AS followed_within_target,
       f.ivr_abandoned
FROM f CROSS JOIN k;
