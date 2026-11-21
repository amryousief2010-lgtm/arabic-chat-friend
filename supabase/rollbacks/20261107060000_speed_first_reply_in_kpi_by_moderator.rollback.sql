CREATE OR REPLACE FUNCTION public.cm_kpi_by_moderator_core(_from date, _to date)
 RETURNS TABLE(moderator_id uuid, display_name text, conversations bigint, on_time bigint, cover bigint, late bigint, pending bigint, abandoned bigint, converted bigint, missed_calls bigint, missed_followed bigint, orders bigint, delivered bigint, resolved bigint, delivered_value numeric, campaign_delivered bigint, allocated_spend numeric, cost_per_delivered numeric, analyzed_calls bigint, avg_handling_score numeric, order_call_pct numeric, open_followups bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE _lo timestamptz; _hi timestamptz;
BEGIN
  -- structure: each part computed once (MATERIALIZED CTEs); orders part set-based (same logic as cm_kpi_orders_v, gate checked once). dates/bounds are inlined as quoted literals (format %L) so the planner sees constants; no other inputs.
  SELECT b.lo, b.hi INTO _lo, _hi FROM public.cm_kpi_ts_bounds(_from, _to) b;
  RETURN QUERY EXECUTE format($q$  WITH cv AS MATERIALIZED (SELECT * FROM public.cm_kpi_conversations_v WHERE first_inbound_at >= %3$L::timestamptz AND first_inbound_at < %4$L::timestamptz AND kpi_date BETWEEN %1$L::date AND %2$L::date),
  s AS MATERIALIZED (SELECT campaign_id, sum(spend) sp FROM public.cm_ad_spend_daily WHERE spend_date BETWEEN %1$L::date AND %2$L::date GROUP BY 1),
  share AS MATERIALIZED (SELECT campaign_id, moderator_id, count(*)::numeric / sum(count(*)) OVER (PARTITION BY campaign_id) AS w
            FROM cv WHERE campaign_id IS NOT NULL AND moderator_id IS NOT NULL GROUP BY 1, 2),
  alloc AS MATERIALIZED (SELECT sh.moderator_id, sum(s.sp * sh.w) sp FROM share sh JOIN s ON s.campaign_id = sh.campaign_id GROUP BY 1),
  c AS MATERIALIZED (SELECT moderator_id, count(*) n,
               count(*) FILTER (WHERE first_reply_status = 'on_time') ot, count(*) FILTER (WHERE first_reply_status = 'cover') co,
               count(*) FILTER (WHERE first_reply_status = 'late') la, count(*) FILTER (WHERE first_reply_status = 'pending') pe,
               count(*) FILTER (WHERE is_abandoned) ab, count(*) FILTER (WHERE converted_in_window) cn
        FROM cv WHERE moderator_id IS NOT NULL GROUP BY 1),
  mc AS MATERIALIZED (SELECT moderator_id, count(*) n, count(*) FILTER (WHERE followed_within_target) f
         FROM public.cm_kpi_missed_calls_v WHERE started_at >= %3$L::timestamptz AND started_at < %4$L::timestamptz AND kpi_date BETWEEN %1$L::date AND %2$L::date AND moderator_id IS NOT NULL GROUP BY 1),
  odb AS MATERIALIZED (SELECT o.id, o.created_at, o.status, o.moderator_id AS omod, o.customer_id, o.total
         FROM public.orders o WHERE (SELECT public.cm_gate_allows()) AND o.created_at >= %3$L::timestamptz AND o.created_at < %4$L::timestamptz AND public.cm_local_date(o.created_at) BETWEEN %1$L::date AND %2$L::date),
  win AS (SELECT COALESCE((SELECT cm_kpi_settings.conversion_window_days FROM public.cm_kpi_settings WHERE cm_kpi_settings.id = 1), 7) AS w),
  oph AS MATERIALIZED (SELECT b.id AS oid, public.normalize_phone_eg(cu.phone) AS pn FROM odb b JOIN public.customers cu ON cu.id = b.customer_id
         UNION SELECT b.id, public.normalize_phone_eg(cu.phone2) FROM odb b JOIN public.customers cu ON cu.id = b.customer_id WHERE cu.phone2 IS NOT NULL AND btrim(cu.phone2) <> ''
         UNION SELECT b.id, cp.phone_norm FROM odb b JOIN public.cm_contact_phones cp ON cp.customer_id = b.customer_id AND cp.is_valid),
  ocand AS MATERIALIZED (SELECT l.order_id AS oid, 0 AS pri, l.conversation_id, COALESCE(c.assigned_moderator_id, c.owner_moderator_id) AS cmod, a.campaign_id, c.first_inbound_at AS fi, l.created_at AS t
         FROM odb b JOIN public.cm_conversation_orders l ON l.order_id = b.id JOIN public.cm_conversations c ON c.id = l.conversation_id LEFT JOIN public.cm_ad_attributions a ON a.conversation_id = c.id
         UNION ALL
         SELECT b.id, 1, c.id, COALESCE(c.assigned_moderator_id, c.owner_moderator_id), a.campaign_id, c.first_inbound_at, c.first_inbound_at
         FROM odb b CROSS JOIN win JOIN oph p ON p.oid = b.id JOIN public.cm_conversations c ON c.phone_norm = p.pn AND c.first_inbound_at IS NOT NULL
              AND b.created_at >= (c.first_inbound_at - '1 day'::interval) AND b.created_at < (c.first_inbound_at + make_interval(days => win.w))
         LEFT JOIN public.cm_ad_attributions a ON a.conversation_id = c.id WHERE b.customer_id IS NOT NULL),
  olc AS MATERIALIZED (SELECT DISTINCT ON (oid) oid, conversation_id, cmod, campaign_id FROM ocand ORDER BY oid, pri, fi, t),
  ov AS MATERIALIZED (SELECT b.id AS order_id, COALESCE(b.omod, lc.cmod) AS moderator_id, lc.campaign_id,
         public.cm_order_is_delivered(b.status) AS is_delivered, public.cm_order_is_resolved(b.status) AS is_resolved,
         CASE WHEN public.cm_order_is_delivered(b.status) THEN COALESCE(b.total, 0::numeric) ELSE 0::numeric END AS delivered_value
         FROM odb b LEFT JOIN olc lc ON lc.oid = b.id),
  od AS MATERIALIZED (SELECT moderator_id, count(*) n, count(*) FILTER (WHERE is_delivered) d, count(*) FILTER (WHERE is_resolved) r,
                sum(delivered_value) v, count(*) FILTER (WHERE is_delivered AND campaign_id IS NOT NULL) cd
         FROM ov WHERE moderator_id IS NOT NULL GROUP BY 1),
  an AS MATERIALIZED (SELECT k.moderator_id, count(*) n, round(avg(a.handling_score), 2) sc,
                round(100.0 * count(*) FILTER (WHERE a.order_placed_or_promised) / count(*), 1) op,
                count(*) FILTER (WHERE a.followup_needed AND k.followed_up_at IS NULL) fu
         FROM public.cm_call_analysis a JOIN public.cm_calls k ON k.id = a.call_id
         WHERE a.status = 'done' AND k.is_sales AND k.moderator_id IS NOT NULL
           AND k.started_at >= %3$L::timestamptz AND k.started_at < %4$L::timestamptz
           AND public.cm_local_date(k.started_at) BETWEEN %1$L::date AND %2$L::date GROUP BY 1)
  SELECT m.id, m.display_name, coalesce(c.n,0), coalesce(c.ot,0), coalesce(c.co,0), coalesce(c.la,0), coalesce(c.pe,0), coalesce(c.ab,0),
         coalesce(c.cn,0), coalesce(mc.n,0), coalesce(mc.f,0), coalesce(od.n,0), coalesce(od.d,0), coalesce(od.r,0), coalesce(od.v,0),
         coalesce(od.cd,0), round(coalesce(alloc.sp,0), 2),
         CASE WHEN coalesce(od.cd,0) > 0 THEN round(coalesce(alloc.sp,0) / od.cd, 2) END,
         coalesce(an.n,0), an.sc, an.op, coalesce(an.fu,0)
  FROM public.cm_moderators m
  LEFT JOIN c ON c.moderator_id = m.id LEFT JOIN mc ON mc.moderator_id = m.id
  LEFT JOIN od ON od.moderator_id = m.id LEFT JOIN alloc ON alloc.moderator_id = m.id LEFT JOIN an ON an.moderator_id = m.id
  WHERE c.n IS NOT NULL OR mc.n IS NOT NULL OR od.n IS NOT NULL OR alloc.sp IS NOT NULL OR an.n IS NOT NULL
  ORDER BY m.sort_order$q$, _from, _to, _lo, _hi);
END
$function$
;
