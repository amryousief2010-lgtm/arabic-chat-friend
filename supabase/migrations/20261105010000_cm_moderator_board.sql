-- «لوحة البنات»: أرقام لكل مودريتور لفترة (يوم/أسبوع/شهر بتوقيت القاهرة). قراءة فقط، SECURITY INVOKER.
-- نفس قواعد cm_kpi_by_moderator: الملكية = coalesce(assigned_moderator_id, owner_moderator_id)،
-- الحالة = cm_first_reply_kpi_status، اليوم = cm_local_date(first_inbound_at)، وبوابة cm_gate_allows().
-- غير مطبقة — تُطبق فقط بموافقة م. عمرو. الرجوع: 20261105010000_cm_moderator_board_ROLLBACK.sql
CREATE OR REPLACE FUNCTION public.cm_moderator_board(p_from date, p_to date)
RETURNS TABLE(moderator_id uuid, display_name text, sort_order int,
  conversations bigint, unanswered bigint, on_time bigint, cover bigint, late bigint,
  waiting_customer bigint, avg_reply_minutes numeric, orders_registered bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
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
$$;
REVOKE ALL ON FUNCTION public.cm_moderator_board(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_moderator_board(date, date) TO authenticated, service_role;
