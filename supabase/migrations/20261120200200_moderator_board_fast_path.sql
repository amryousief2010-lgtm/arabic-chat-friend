-- moderator board perf — applied to coceg-prod after GM approval 2026-11-20 23:00 Asia/Riyadh.
-- Root cause: both RPCs are SECURITY INVOKER, so for a logged-in user every row of cm_conversations
-- (whole table, ~7.6k rows, because the date bounds come from a function and cannot filter the scan)
-- runs the RLS policy cm_gate_allows() + cm_local_date() per row (~0.8 ms/row), and the ad summary also
-- runs cm_can_see_conversation() per cm_messages row. Board viewers (GM x2, م. آلاء, أ. أحمد الجمل) all
-- have cm_can_read_all() = true, so RLS filters nothing for them — it only costs time.
-- Fix: fast SECURITY DEFINER versions (guarded by cm_can_read_all()), set-based KPI status, constant date
-- bounds. Public RPC names/signatures unchanged; anyone without read-all falls back to the exact old logic.
SET LOCAL lock_timeout = '3s';

-- 1) exact copies of the current functions (fallback for callers without read-all; RLS applies)
CREATE OR REPLACE FUNCTION public.cm_moderator_board_rls(p_from date, p_to date)
 RETURNS TABLE(moderator_id uuid, display_name text, sort_order integer, conversations bigint, unanswered bigint, on_time bigint, cover bigint, late bigint, waiting_customer bigint, avg_reply_minutes numeric, orders_registered bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH b AS (SELECT lo, hi FROM public.cm_kpi_ts_bounds(p_from, p_to)),
  g AS (SELECT public.cm_gate_allows() AS ok),
  cv AS MATERIALIZED (
    SELECT COALESCE(c.assigned_moderator_id, c.owner_moderator_id) AS mid,
           public.cm_first_reply_kpi_status(c.clock_started_at, c.first_reply_at, c.first_reply_was_cover,
                                            COALESCE(c.assigned_moderator_id, c.owner_moderator_id)) AS st,
           (c.status IN ('open','pending') AND c.last_outbound_at IS NOT NULL
             AND (c.last_inbound_at IS NULL OR c.last_outbound_at >= c.last_inbound_at)) AS waiting,
           CASE WHEN c.first_reply_at IS NOT NULL AND c.clock_started_at IS NOT NULL
                THEN greatest(0, extract(epoch FROM (c.first_reply_at - c.clock_started_at)) / 60.0) END AS reply_min
    FROM public.cm_conversations c CROSS JOIN b CROSS JOIN g
    LEFT JOIN public.cm_ad_attributions a ON a.conversation_id = c.id  -- نفس صفوف cm_kpi_conversations_v
    WHERE g.ok AND c.first_inbound_at IS NOT NULL
      AND c.first_inbound_at >= b.lo AND c.first_inbound_at < b.hi
      AND public.cm_local_date(c.first_inbound_at) BETWEEN p_from AND p_to),
  c AS (SELECT mid, count(*) n,
          count(*) FILTER (WHERE st = 'pending') un, count(*) FILTER (WHERE st = 'on_time') ot,
          count(*) FILTER (WHERE st = 'cover') co, count(*) FILTER (WHERE st = 'late') la,
          count(*) FILTER (WHERE waiting) wa, round(avg(reply_min)::numeric, 1) ar
        FROM cv WHERE mid IS NOT NULL GROUP BY 1),
  od AS (SELECT o.moderator_id AS mid, count(*) n
         FROM public.orders o CROSS JOIN b CROSS JOIN g
         WHERE g.ok AND o.moderator_id IS NOT NULL AND o.created_at >= b.lo AND o.created_at < b.hi
           AND public.cm_local_date(o.created_at) BETWEEN p_from AND p_to
         GROUP BY 1)
  SELECT m.id AS moderator_id, m.display_name, m.sort_order,
         coalesce(c.n,0) AS conversations, coalesce(c.un,0) AS unanswered, coalesce(c.ot,0) AS on_time,
         coalesce(c.co,0) AS cover, coalesce(c.la,0) AS late,
         coalesce(c.wa,0) AS waiting_customer, c.ar AS avg_reply_minutes, coalesce(od.n,0) AS orders_registered
  FROM public.cm_moderators m
  LEFT JOIN c ON c.mid = m.id LEFT JOIN od ON od.mid = m.id
  WHERE m.chat_active OR c.n IS NOT NULL OR od.n IS NOT NULL
  ORDER BY m.sort_order
$function$;

CREATE OR REPLACE FUNCTION public.cm_moderator_board_ad_summary_rls(p_from date, p_to date)
 RETURNS TABLE(moderator_id uuid, display_name text, sort_order integer, ad_id text, ad_name text, conversations bigint, inbound_messages bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH b AS (SELECT lo, hi FROM public.cm_kpi_ts_bounds(p_from, p_to)),
  g AS (SELECT public.cm_gate_allows() AS ok),
  conv AS (
    SELECT
      c.id AS conversation_id,
      COALESCE(c.assigned_moderator_id, c.owner_moderator_id) AS mid,
      c.ad_id,
      coalesce(
        nullif(btrim(ads.name), ''),
        nullif(btrim(camp.name), ''),
        nullif(regexp_replace(coalesce(c.ad_headline, ''), '^[\u064B-\u0652\s]+', ''), ''),
        CASE WHEN nullif(c.ad_id, '') IS NOT NULL THEN 'إعلان …' || right(c.ad_id, 6) END,
        'بدون إعلان'
      ) AS ad_name
    FROM public.cm_conversations c
    CROSS JOIN b CROSS JOIN g
    LEFT JOIN public.cm_campaign_ads ads ON ads.meta_ad_id = c.ad_id
    LEFT JOIN public.cm_campaigns camp ON camp.id = coalesce(c.campaign_id, ads.campaign_id)
    WHERE g.ok
      AND COALESCE(c.is_demo, false) IS NOT TRUE
      AND c.first_inbound_at IS NOT NULL
      AND c.first_inbound_at >= b.lo AND c.first_inbound_at < b.hi
      AND public.cm_local_date(c.first_inbound_at) BETWEEN p_from AND p_to
  ),
  msg AS (
    SELECT m.conversation_id, count(*) AS inbound_messages
    FROM public.cm_messages m
    JOIN conv ON conv.conversation_id = m.conversation_id
    WHERE m.direction = 'in'
    GROUP BY 1
  ),
  agg AS (
    SELECT
      conv.mid,
      conv.ad_id,
      conv.ad_name,
      count(*)::bigint AS conversations,
      coalesce(sum(msg.inbound_messages), 0)::bigint AS inbound_messages
    FROM conv
    LEFT JOIN msg ON msg.conversation_id = conv.conversation_id
    WHERE conv.mid IS NOT NULL
    GROUP BY 1, 2, 3
  )
  SELECT
    m.id AS moderator_id,
    m.display_name,
    m.sort_order,
    a.ad_id,
    a.ad_name,
    a.conversations,
    a.inbound_messages
  FROM agg a
  JOIN public.cm_moderators m ON m.id = a.mid
  WHERE m.chat_active OR a.conversations > 0
  ORDER BY m.sort_order, a.conversations DESC, a.ad_name;
$function$;

-- 2) fast paths (bypass RLS only after cm_can_read_all() passes)
CREATE OR REPLACE FUNCTION public.cm_moderator_board_fast(p_from date, p_to date)
 RETURNS TABLE(moderator_id uuid, display_name text, sort_order integer, conversations bigint, unanswered bigint, on_time bigint, cover bigint, late bigint, waiting_customer bigint, avg_reply_minutes numeric, orders_registered bigint)
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH g AS MATERIALIZED (SELECT public.cm_can_read_all() AS ok),
  s AS MATERIALIZED (
    SELECT k.timezone AS raw_tz,
           coalesce(k.timezone, 'Africa/Cairo') AS tz,
           coalesce(k.first_reply_target_on_shift_min, 15) AS t_on,
           coalesce(k.first_reply_target_off_shift_min, 60) AS t_off,
           k.service_window_start AS sws, k.service_window_end AS swe
    FROM (SELECT 1) one LEFT JOIN public.cm_kpi_settings k ON k.id = 1),
  b AS MATERIALIZED (
    SELECT ((p_from - 1)::timestamp AT TIME ZONE s.tz) AS lo, ((p_to + 2)::timestamp AT TIME ZONE s.tz) AS hi FROM s),
  base AS MATERIALIZED (
    SELECT COALESCE(c.assigned_moderator_id, c.owner_moderator_id) AS mid,
           c.clock_started_at AS clk, c.first_reply_at AS fr, c.first_reply_was_cover AS cov,
           (c.status IN ('open','pending') AND c.last_outbound_at IS NOT NULL
             AND (c.last_inbound_at IS NULL OR c.last_outbound_at >= c.last_inbound_at)) AS waiting,
           CASE WHEN c.first_reply_at IS NOT NULL AND c.clock_started_at IS NOT NULL
                THEN greatest(0, extract(epoch FROM (c.first_reply_at - c.clock_started_at)) / 60.0) END AS reply_min
    FROM public.cm_conversations c
    WHERE c.first_inbound_at IS NOT NULL
      AND c.first_inbound_at >= (SELECT lo FROM b) AND c.first_inbound_at < (SELECT hi FROM b)
      AND (c.first_inbound_at AT TIME ZONE (SELECT tz FROM s))::date BETWEEN p_from AND p_to),
  cv AS (
    SELECT x.mid, x.waiting, x.reply_min,
           CASE WHEN x.clk IS NULL THEN NULL
                WHEN x.fr IS NOT NULL AND x.cov THEN 'cover'
                WHEN (CASE WHEN coalesce(x.fr, now()) <= x.clk THEN 0 ELSE sm.v END)
                     <= (CASE WHEN x.mid IS NOT NULL AND EXISTS (
                            SELECT 1
                            FROM public.cm_shift_assignments a
                            JOIN public.cm_moderators m ON m.id = a.moderator_id
                            CROSS JOIN LATERAL (SELECT (x.clk AT TIME ZONE s.tz) AS lt) l
                            WHERE a.moderator_id = x.mid
                              AND a.work_date BETWEEN l.lt::date - 1 AND l.lt::date
                              AND m.is_active AND m.chat_active
                              AND (m.end_date IS NULL OR m.end_date >= l.lt::date)
                              AND l.lt >= a.work_date + a.starts_at
                              AND l.lt < a.work_date + a.ends_at + CASE WHEN a.ends_at <= a.starts_at THEN interval '1 day' ELSE interval '0' END)
                          THEN s.t_on ELSE s.t_off END)
                  THEN CASE WHEN x.fr IS NULL THEN 'pending' ELSE 'on_time' END
                ELSE 'late' END AS st
    FROM base x CROSS JOIN s
    LEFT JOIN LATERAL (
      SELECT round(coalesce(sum(extract(epoch FROM least(w.we_ts, t.bb) - greatest(w.ws_ts, t.aa)) / 60)
                            FILTER (WHERE least(w.we_ts, t.bb) > greatest(w.ws_ts, t.aa)), 0), 2) AS v
      FROM (SELECT x.clk AT TIME ZONE s.raw_tz AS aa, coalesce(x.fr, now()) AT TIME ZONE s.raw_tz AS bb) t
      CROSS JOIN LATERAL generate_series(t.aa::date - 1, t.bb::date, interval '1 day') g(d)
      CROSS JOIN LATERAL (SELECT g.d::date + s.sws AS ws_ts,
                                 g.d::date + s.swe + CASE WHEN s.swe <= s.sws THEN interval '1 day' ELSE interval '0' END AS we_ts) w
      WHERE x.clk IS NOT NULL AND NOT (x.fr IS NOT NULL AND x.cov IS TRUE)
    ) sm ON true),
  c AS (SELECT mid, count(*) n,
          count(*) FILTER (WHERE st = 'pending') un, count(*) FILTER (WHERE st = 'on_time') ot,
          count(*) FILTER (WHERE st = 'cover') co, count(*) FILTER (WHERE st = 'late') la,
          count(*) FILTER (WHERE waiting) wa, round(avg(reply_min)::numeric, 1) ar
        FROM cv WHERE mid IS NOT NULL GROUP BY 1),
  od AS (SELECT o.moderator_id AS mid, count(*) n
         FROM public.orders o
         WHERE o.moderator_id IS NOT NULL
           AND o.created_at >= (SELECT lo FROM b) AND o.created_at < (SELECT hi FROM b)
           AND (o.created_at AT TIME ZONE (SELECT tz FROM s))::date BETWEEN p_from AND p_to
         GROUP BY 1)
  SELECT m.id AS moderator_id, m.display_name, m.sort_order,
         coalesce(c.n,0) AS conversations, coalesce(c.un,0) AS unanswered, coalesce(c.ot,0) AS on_time,
         coalesce(c.co,0) AS cover, coalesce(c.la,0) AS late,
         coalesce(c.wa,0) AS waiting_customer, c.ar AS avg_reply_minutes, coalesce(od.n,0) AS orders_registered
  FROM public.cm_moderators m
  LEFT JOIN c ON c.mid = m.id LEFT JOIN od ON od.mid = m.id
  WHERE (SELECT ok FROM g) AND (m.chat_active OR c.n IS NOT NULL OR od.n IS NOT NULL)
  ORDER BY m.sort_order
$function$;

CREATE OR REPLACE FUNCTION public.cm_moderator_board_ad_summary_fast(p_from date, p_to date)
 RETURNS TABLE(moderator_id uuid, display_name text, sort_order integer, ad_id text, ad_name text, conversations bigint, inbound_messages bigint)
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH g AS MATERIALIZED (SELECT public.cm_can_read_all() AS ok),
  s AS MATERIALIZED (
    SELECT coalesce((SELECT timezone FROM public.cm_kpi_settings WHERE id = 1), 'Africa/Cairo') AS tz),
  b AS MATERIALIZED (
    SELECT ((p_from - 1)::timestamp AT TIME ZONE s.tz) AS lo, ((p_to + 2)::timestamp AT TIME ZONE s.tz) AS hi FROM s),
  conv AS MATERIALIZED (
    SELECT
      c.id AS conversation_id,
      COALESCE(c.assigned_moderator_id, c.owner_moderator_id) AS mid,
      c.ad_id,
      coalesce(
        nullif(btrim(ads.name), ''),
        nullif(btrim(camp.name), ''),
        nullif(regexp_replace(coalesce(c.ad_headline, ''), '^[\u064B-\u0652\s]+', ''), ''),
        CASE WHEN nullif(c.ad_id, '') IS NOT NULL THEN 'إعلان …' || right(c.ad_id, 6) END,
        'بدون إعلان'
      ) AS ad_name
    FROM public.cm_conversations c
    LEFT JOIN public.cm_campaign_ads ads ON ads.meta_ad_id = c.ad_id
    LEFT JOIN public.cm_campaigns camp ON camp.id = coalesce(c.campaign_id, ads.campaign_id)
    WHERE COALESCE(c.is_demo, false) IS NOT TRUE
      AND c.first_inbound_at IS NOT NULL
      AND c.first_inbound_at >= (SELECT lo FROM b) AND c.first_inbound_at < (SELECT hi FROM b)
      AND (c.first_inbound_at AT TIME ZONE (SELECT tz FROM s))::date BETWEEN p_from AND p_to
  ),
  msg AS (
    SELECT m.conversation_id, count(*) AS inbound_messages
    FROM public.cm_messages m
    JOIN conv ON conv.conversation_id = m.conversation_id
    WHERE m.direction = 'in'
    GROUP BY 1
  ),
  agg AS (
    SELECT conv.mid, conv.ad_id, conv.ad_name,
           count(*)::bigint AS conversations,
           coalesce(sum(msg.inbound_messages), 0)::bigint AS inbound_messages
    FROM conv
    LEFT JOIN msg ON msg.conversation_id = conv.conversation_id
    WHERE conv.mid IS NOT NULL
    GROUP BY 1, 2, 3
  )
  SELECT m.id AS moderator_id, m.display_name, m.sort_order, a.ad_id, a.ad_name, a.conversations, a.inbound_messages
  FROM agg a
  JOIN public.cm_moderators m ON m.id = a.mid
  WHERE (SELECT ok FROM g) AND (m.chat_active OR a.conversations > 0)
  ORDER BY m.sort_order, a.conversations DESC, a.ad_name
$function$;

-- 3) public RPCs become thin dispatchers (same name, args, columns; still SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.cm_moderator_board(p_from date, p_to date)
 RETURNS TABLE(moderator_id uuid, display_name text, sort_order integer, conversations bigint, unanswered bigint, on_time bigint, cover bigint, late bigint, waiting_customer bigint, avg_reply_minutes numeric, orders_registered bigint)
 LANGUAGE plpgsql STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.cm_can_read_all() THEN
    RETURN QUERY SELECT * FROM public.cm_moderator_board_fast(p_from, p_to);
  ELSE
    RETURN QUERY SELECT * FROM public.cm_moderator_board_rls(p_from, p_to);
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.cm_moderator_board_ad_summary(p_from date, p_to date)
 RETURNS TABLE(moderator_id uuid, display_name text, sort_order integer, ad_id text, ad_name text, conversations bigint, inbound_messages bigint)
 LANGUAGE plpgsql STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.cm_can_read_all() THEN
    RETURN QUERY SELECT * FROM public.cm_moderator_board_ad_summary_fast(p_from, p_to);
  ELSE
    RETURN QUERY SELECT * FROM public.cm_moderator_board_ad_summary_rls(p_from, p_to);
  END IF;
END
$function$;

-- 4) grants: same as today (authenticated + service_role), nothing for anon/public
REVOKE ALL ON FUNCTION public.cm_moderator_board_rls(date,date), public.cm_moderator_board_ad_summary_rls(date,date),
                       public.cm_moderator_board_fast(date,date), public.cm_moderator_board_ad_summary_fast(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_moderator_board_rls(date,date), public.cm_moderator_board_ad_summary_rls(date,date),
                          public.cm_moderator_board_fast(date,date), public.cm_moderator_board_ad_summary_fast(date,date) TO authenticated, service_role;
