-- ============================================================
-- المساعد الصوتي: 3 أدوات لقسم المحادثات (قرار م. عمرو «نفذ وانشر» 28-11-2026)
--   ai_tool_chat_response_by_moderator(_from,_to) : سرعة أول رد لكل مودريتور + غير المردود عليه
--   ai_tool_chat_summary(_from,_to)               : ملخص المحادثات لفترة ومقارنة بالفترة اللي قبلها
--   ai_tool_chats_waiting_now(_older_than_minutes,_as_of) : محادثات مستنية رد دلوقتي
-- قراءة فقط، أرقام مجمعة بس (من غير أسماء عملاء ولا تليفونات ولا نصوص رسايل).
-- SECURITY DEFINER (قراءة مجمّعة فقط) لأن RLS على cm_conversations بيستدعي cm_gate_allows() لكل صف (~1.1 ثانية للمسح الواحد على الإنتاج).
-- الحماية جوه كل أداة: ai_asst_require (GM / المدير التنفيذي / مدير المبيعات) + cm_can_read_all() (نفس شرط «اقرأ كل المحادثات» في RLS)،
-- ولو مش متاحة الأداة بترجّع forbidden بدل أصفار مضللة. ممنوع تنفيذ لـ anon/PUBLIC.
-- بتقرا cm_conversations مباشرة، ودقايق أول رد بتتحسب بنفس نافذة الخدمة (cm_kpi_settings) لكن مرة واحدة
-- لكل المحادثات بدل دالة لكل صف (cm_chat_metrics_v كانت بتاخد ~35 ثانية على الإنتاج).
-- ممنوع: cm_ad_attributions (كتابة)، catering_*.
-- ============================================================

-- دقايق الخدمة بين وقتين (نفس نتيجة cm_service_minutes) بمعادلة مغلقة بدل لفّة لكل يوم:
-- دقايق الخدمة المتراكمة f(t) = (عدد الأيام × طول النافذة) + أقل من (طول النافذة، الدقايق من بداية النافذة في اليوم)، والفرق f(b) - f(a).
-- معاملات الإعدادات بتتمرر جاهزة عشان ما يقراش cm_kpi_settings لكل صف.
CREATE OR REPLACE FUNCTION public.ai_asst_service_cum(_l timestamp, _ws time, _wl numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT floor(e / 86400) * _wl + least(_wl, (e - floor(e / 86400) * 86400) / 60)
  FROM (SELECT extract(epoch FROM (_l - (_ws - time '00:00') - timestamp '2000-01-01')) AS e) x
$$;

CREATE OR REPLACE FUNCTION public.ai_asst_service_minutes(_from timestamptz, _to timestamptz, _tz text, _ws time, _we time)
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN _from IS NULL OR _to IS NULL THEN NULL WHEN _to <= _from THEN 0::numeric
    ELSE round(
      public.ai_asst_service_cum(_to AT TIME ZONE _tz, _ws,
        (extract(epoch FROM (_we - _ws)) / 60) + CASE WHEN _we <= _ws THEN 1440 ELSE 0 END)
      - public.ai_asst_service_cum(_from AT TIME ZONE _tz, _ws,
        (extract(epoch FROM (_we - _ws)) / 60) + CASE WHEN _we <= _ws THEN 1440 ELSE 0 END), 2) END
$$;

-- 1) سرعة أول رد لكل مودريتور
CREATE OR REPLACE FUNCTION public.ai_tool_chat_response_by_moderator(_from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE f date; t date; s public.cm_kpi_settings; r jsonb;
BEGIN
  PERFORM public.ai_asst_require(ARRAY['general_manager','executive_manager','sales_manager']::public.app_role[]);
  IF NOT public.cm_can_read_all() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF; -- نفس شرط قراءة كل المحادثات في RLS (البوابة + مشرف/مشاهد)
  SELECT d_from, d_to INTO f, t FROM public.ai_asst_range(_from, _to);
  SELECT * INTO s FROM public.cm_kpi_settings WHERE id = 1;
  WITH base AS (
    SELECT coalesce(c.owner_moderator_id, l.owner_moderator_id, c.assigned_moderator_id) AS mid,
           c.first_reply_at,
           public.ai_asst_service_minutes(coalesce(c.clock_started_at, c.first_inbound_at), c.first_reply_at, s.timezone, s.service_window_start, s.service_window_end) AS mins
    FROM public.cm_conversations c LEFT JOIN public.cm_lines l ON l.id = c.line_id
    WHERE NOT coalesce(c.is_demo, false)
      AND coalesce(c.first_inbound_at, c.opened_at, c.created_at) >= (f - 1)::timestamp
      AND coalesce(c.first_inbound_at, c.opened_at, c.created_at) <  (t + 2)::timestamp
      AND (coalesce(c.first_inbound_at, c.opened_at, c.created_at) AT TIME ZONE s.timezone)::date BETWEEN f AND t
  ), per AS (
    SELECT coalesce(m.display_name, 'غير موزّعة') AS moderator, count(*) AS chats,
           count(b.first_reply_at) AS answered, count(*) FILTER (WHERE b.first_reply_at IS NULL) AS unanswered,
           round(avg(b.mins), 1) AS avg_first_reply_min,
           round((percentile_cont(0.9) WITHIN GROUP (ORDER BY b.mins))::numeric, 1) AS p90_first_reply_min
    FROM base b LEFT JOIN public.cm_moderators m ON m.id = b.mid
    GROUP BY 1)
  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', f, 'to', t),
    'metric_note', 'أول رد بدقايق ساعات الخدمة (من 9 صباحًا لـ1 بعد منتصف الليل)، المحادثات اللي ماتردش عليها بتتعد غير مردود عليها',
    'total_chats', (SELECT count(*) FROM base),
    'total_unanswered', (SELECT count(*) FROM base WHERE first_reply_at IS NULL),
    'overall_avg_first_reply_min', (SELECT round(avg(mins), 1) FROM base),
    'slowest_moderator_by_avg', (SELECT jsonb_build_object('moderator', moderator, 'avg_first_reply_min', avg_first_reply_min, 'chats', chats)
                                 FROM per WHERE chats >= 20 AND avg_first_reply_min IS NOT NULL ORDER BY avg_first_reply_min DESC LIMIT 1),
    'most_unanswered_moderator', (SELECT jsonb_build_object('moderator', moderator, 'unanswered', unanswered, 'chats', chats)
                                  FROM per WHERE unanswered > 0 ORDER BY unanswered DESC LIMIT 1),
    'moderators', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.avg_first_reply_min DESC NULLS LAST) FROM (SELECT * FROM per ORDER BY chats DESC LIMIT 10) p), '[]'::jsonb))
  INTO r;
  RETURN r;
END $$;

-- 2) ملخص المحادثات لفترة + مقارنة بالفترة اللي قبلها بنفس الطول
CREATE OR REPLACE FUNCTION public.ai_tool_chat_summary(_from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE f date; t date; n int; p_from date; p_to date; s public.cm_kpi_settings; r jsonb;
BEGIN
  PERFORM public.ai_asst_require(ARRAY['general_manager','executive_manager','sales_manager']::public.app_role[]);
  IF NOT public.cm_can_read_all() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF; -- نفس شرط قراءة كل المحادثات في RLS (البوابة + مشرف/مشاهد)
  SELECT d_from, d_to INTO f, t FROM public.ai_asst_range(_from, _to);
  n := t - f + 1; p_to := f - 1; p_from := f - n;
  SELECT * INTO s FROM public.cm_kpi_settings WHERE id = 1;
  WITH base AS (
    SELECT (coalesce(c.first_inbound_at, c.opened_at, c.created_at) AT TIME ZONE s.timezone)::date AS d,
           c.first_reply_at, (c.ad_id IS NOT NULL OR c.campaign_id IS NOT NULL) AS from_ads,
           public.ai_asst_service_minutes(coalesce(c.clock_started_at, c.first_inbound_at), c.first_reply_at, s.timezone, s.service_window_start, s.service_window_end) AS mins
    FROM public.cm_conversations c
    WHERE NOT coalesce(c.is_demo, false)
      AND coalesce(c.first_inbound_at, c.opened_at, c.created_at) >= (p_from - 1)::timestamp
      AND coalesce(c.first_inbound_at, c.opened_at, c.created_at) <  (t + 2)::timestamp)
  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', f, 'to', t, 'days', n),
    'chats', count(*) FILTER (WHERE d BETWEEN f AND t),
    'answered', count(*) FILTER (WHERE d BETWEEN f AND t AND first_reply_at IS NOT NULL),
    'unanswered', count(*) FILTER (WHERE d BETWEEN f AND t AND first_reply_at IS NULL),
    'avg_first_reply_min', round(avg(mins) FILTER (WHERE d BETWEEN f AND t), 1),
    'median_first_reply_min', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY mins) FILTER (WHERE d BETWEEN f AND t))::numeric, 1),
    'replied_within_15min_pct', round(100.0 * count(*) FILTER (WHERE d BETWEEN f AND t AND mins <= 15) / nullif(count(*) FILTER (WHERE d BETWEEN f AND t AND mins IS NOT NULL), 0), 1),
    'from_ads', count(*) FILTER (WHERE d BETWEEN f AND t AND from_ads),
    'organic', count(*) FILTER (WHERE d BETWEEN f AND t AND NOT from_ads),
    'avg_chats_per_day', round(count(*) FILTER (WHERE d BETWEEN f AND t)::numeric / n, 1),
    'previous_period', jsonb_build_object('from', p_from, 'to', p_to,
        'chats', count(*) FILTER (WHERE d BETWEEN p_from AND p_to),
        'avg_first_reply_min', round(avg(mins) FILTER (WHERE d BETWEEN p_from AND p_to), 1)))
  INTO r FROM base WHERE d BETWEEN p_from AND t;
  r := r || jsonb_build_object('chats_change_pct', CASE WHEN (r->'previous_period'->>'chats')::numeric > 0
          THEN round(((r->>'chats')::numeric - (r->'previous_period'->>'chats')::numeric) * 100 / (r->'previous_period'->>'chats')::numeric, 1) END);
  RETURN r;
END $$;

-- 3) محادثات مستنية رد دلوقتي (آخر 7 أيام؛ الأقدم منها بيتعد لوحده)
CREATE OR REPLACE FUNCTION public.ai_tool_chats_waiting_now(_older_than_minutes int DEFAULT 30, _as_of timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE mins int := least(greatest(coalesce(_older_than_minutes, 30), 1), 7 * 24 * 60);
        ref timestamptz := coalesce(_as_of, now()); s public.cm_kpi_settings; r jsonb;
BEGIN
  PERFORM public.ai_asst_require(ARRAY['general_manager','executive_manager','sales_manager']::public.app_role[]);
  IF NOT public.cm_can_read_all() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF; -- نفس شرط قراءة كل المحادثات في RLS (البوابة + مشرف/مشاهد)
  SELECT * INTO s FROM public.cm_kpi_settings WHERE id = 1;
  WITH w AS (
    SELECT coalesce(c.owner_moderator_id, l.owner_moderator_id, c.assigned_moderator_id) AS mid, c.awaiting_reply_since,
           public.ai_asst_service_minutes(c.awaiting_reply_since, ref, s.timezone, s.service_window_start, s.service_window_end) AS wait_min
    FROM public.cm_conversations c LEFT JOIN public.cm_lines l ON l.id = c.line_id
    WHERE NOT coalesce(c.is_demo, false) AND c.status = 'open' AND c.awaiting_reply_since IS NOT NULL
      AND c.awaiting_reply_since > ref - interval '7 days' AND c.awaiting_reply_since <= ref
  ), x AS (SELECT * FROM w WHERE wait_min >= mins), per AS (
    SELECT coalesce(m.display_name, 'غير موزّعة') AS moderator, count(*) AS waiting,
           round(max(extract(epoch FROM ref - x.awaiting_reply_since)) / 3600, 1) AS oldest_wait_hours
    FROM x LEFT JOIN public.cm_moderators m ON m.id = x.mid GROUP BY 1)
  SELECT jsonb_build_object(
    'as_of', ref, 'older_than_minutes', mins,
    'metric_note', 'المنتظر بدقايق ساعات الخدمة، ومحادثات آخر 7 أيام بس',
    'waiting_count', (SELECT count(*) FROM x),
    'oldest_wait_hours', (SELECT round(max(extract(epoch FROM ref - awaiting_reply_since)) / 3600, 1) FROM x),
    'waiting_over_24h', (SELECT count(*) FROM x WHERE awaiting_reply_since < ref - interval '24 hours'),
    'older_than_7_days_waiting', (SELECT count(*) FROM public.cm_conversations c WHERE NOT coalesce(c.is_demo, false) AND c.status = 'open'
                                   AND c.awaiting_reply_since IS NOT NULL AND c.awaiting_reply_since <= ref - interval '7 days'),
    'by_moderator', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.waiting DESC) FROM (SELECT * FROM per ORDER BY waiting DESC LIMIT 10) p), '[]'::jsonb))
  INTO r;
  RETURN r;
END $$;

-- الصلاحيات: المستخدمين المسجلين بس (والدور بيتفحص جوه كل أداة)
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.ai_tool_chat_response_by_moderator(date, date)', 'public.ai_tool_chat_summary(date, date)',
    'public.ai_tool_chats_waiting_now(int, timestamptz)',
    'public.ai_asst_service_minutes(timestamptz, timestamptz, text, time, time)',
    'public.ai_asst_service_cum(timestamp, time, numeric)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;
