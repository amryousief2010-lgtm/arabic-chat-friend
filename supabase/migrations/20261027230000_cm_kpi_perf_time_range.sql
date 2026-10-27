-- أداء صفحة «مؤشرات الأداء»: كانت cm_kpi_by_moderator / cm_kpi_by_campaign تتجاوز مهلة 8 ثوانٍ
-- السبب: الفلترة على kpi_date = cm_local_date(ts) لكل صف في orders (~16 ألف) ولا تستخدم فهرساً، وcm_local_date
-- تقرأ cm_kpi_settings (عليها RLS بـ cm_gate_allows/cm_can_read_all) لكل صف ⇒ ~0.6ms × كل الطلبات.
-- الإصلاح: شرط مدى زمني إضافي قابل للفهرسة (يوم احتياطي على كل جانب) قبل شرط kpi_date الأصلي الذي يبقى كما هو،
-- فالنتائج مطابقة تماماً ولا يتغير أي منطق عمل. لا تغيير على الجداول أو سياسات orders.

-- حدود زمنية تقريبية واسعة (±يوم) لمدى أيام محلية؛ تُحسب مرة واحدة لكل استدعاء.
CREATE OR REPLACE FUNCTION public.cm_kpi_ts_bounds(_from date, _to date)
RETURNS TABLE (lo timestamptz, hi timestamptz) LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT ((_from - 1)::timestamp AT TIME ZONE z.tz), ((_to + 2)::timestamp AT TIME ZONE z.tz)
  FROM (SELECT coalesce((SELECT timezone FROM public.cm_kpi_settings WHERE id = 1), 'Africa/Cairo') AS tz) z
$$;
REVOKE ALL ON FUNCTION public.cm_kpi_ts_bounds(date, date) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION public.cm_kpi_ts_bounds(date, date) FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN GRANT EXECUTE ON FUNCTION public.cm_kpi_ts_bounds(date, date) TO authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.cm_kpi_ts_bounds(date, date) TO service_role; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cm_kpi_by_moderator(_from date, _to date)
 RETURNS TABLE(moderator_id uuid, display_name text, conversations bigint, on_time bigint, cover bigint, late bigint, pending bigint, abandoned bigint, converted bigint, missed_calls bigint, missed_followed bigint, orders bigint, delivered bigint, resolved bigint, delivered_value numeric, campaign_delivered bigint, allocated_spend numeric, cost_per_delivered numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH cv AS (SELECT * FROM public.cm_kpi_conversations_v WHERE first_inbound_at >= (SELECT lo FROM public.cm_kpi_ts_bounds(_from, _to)) AND first_inbound_at < (SELECT hi FROM public.cm_kpi_ts_bounds(_from, _to)) AND kpi_date BETWEEN _from AND _to),
  s AS (SELECT campaign_id, sum(spend) sp FROM public.cm_ad_spend_daily WHERE spend_date BETWEEN _from AND _to GROUP BY 1),
  share AS (SELECT campaign_id, moderator_id, count(*)::numeric / sum(count(*)) OVER (PARTITION BY campaign_id) AS w
            FROM cv WHERE campaign_id IS NOT NULL AND moderator_id IS NOT NULL GROUP BY 1, 2),
  alloc AS (SELECT sh.moderator_id, sum(s.sp * sh.w) sp FROM share sh JOIN s ON s.campaign_id = sh.campaign_id GROUP BY 1),
  c AS (SELECT moderator_id, count(*) n,
               count(*) FILTER (WHERE first_reply_status = 'on_time') ot, count(*) FILTER (WHERE first_reply_status = 'cover') co,
               count(*) FILTER (WHERE first_reply_status = 'late') la, count(*) FILTER (WHERE first_reply_status = 'pending') pe,
               count(*) FILTER (WHERE is_abandoned) ab, count(*) FILTER (WHERE converted_in_window) cn
        FROM cv WHERE moderator_id IS NOT NULL GROUP BY 1),
  mc AS (SELECT moderator_id, count(*) n, count(*) FILTER (WHERE followed_within_target) f
         FROM public.cm_kpi_missed_calls_v WHERE started_at >= (SELECT lo FROM public.cm_kpi_ts_bounds(_from, _to)) AND started_at < (SELECT hi FROM public.cm_kpi_ts_bounds(_from, _to)) AND kpi_date BETWEEN _from AND _to AND moderator_id IS NOT NULL GROUP BY 1),
  od AS (SELECT moderator_id, count(*) n, count(*) FILTER (WHERE is_delivered) d, count(*) FILTER (WHERE is_resolved) r,
                sum(delivered_value) v, count(*) FILTER (WHERE is_delivered AND campaign_id IS NOT NULL) cd
         FROM public.cm_kpi_orders_v WHERE created_at >= (SELECT lo FROM public.cm_kpi_ts_bounds(_from, _to)) AND created_at < (SELECT hi FROM public.cm_kpi_ts_bounds(_from, _to)) AND kpi_date BETWEEN _from AND _to AND moderator_id IS NOT NULL GROUP BY 1)
  SELECT m.id, m.display_name, coalesce(c.n,0), coalesce(c.ot,0), coalesce(c.co,0), coalesce(c.la,0), coalesce(c.pe,0), coalesce(c.ab,0),
         coalesce(c.cn,0), coalesce(mc.n,0), coalesce(mc.f,0), coalesce(od.n,0), coalesce(od.d,0), coalesce(od.r,0), coalesce(od.v,0),
         coalesce(od.cd,0), round(coalesce(alloc.sp,0), 2),
         CASE WHEN coalesce(od.cd,0) > 0 THEN round(coalesce(alloc.sp,0) / od.cd, 2) END
  FROM public.cm_moderators m
  LEFT JOIN c ON c.moderator_id = m.id LEFT JOIN mc ON mc.moderator_id = m.id
  LEFT JOIN od ON od.moderator_id = m.id LEFT JOIN alloc ON alloc.moderator_id = m.id
  WHERE c.n IS NOT NULL OR mc.n IS NOT NULL OR od.n IS NOT NULL OR alloc.sp IS NOT NULL
  ORDER BY m.sort_order
$function$;

CREATE OR REPLACE FUNCTION public.cm_kpi_by_campaign(_from date, _to date)
 RETURNS TABLE(campaign_id uuid, campaign_name text, spend numeric, conversations bigint, converted bigint, orders bigint, delivered bigint, resolved bigint, delivered_value numeric, cost_per_delivered numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH s AS (SELECT campaign_id, sum(spend) sp FROM public.cm_ad_spend_daily WHERE spend_date BETWEEN _from AND _to GROUP BY 1),
  cv AS (SELECT campaign_id, count(*) n, count(*) FILTER (WHERE converted_in_window) conv
         FROM public.cm_kpi_conversations_v WHERE first_inbound_at >= (SELECT lo FROM public.cm_kpi_ts_bounds(_from, _to)) AND first_inbound_at < (SELECT hi FROM public.cm_kpi_ts_bounds(_from, _to)) AND kpi_date BETWEEN _from AND _to AND campaign_id IS NOT NULL GROUP BY 1),
  od AS (SELECT campaign_id, count(*) n, count(*) FILTER (WHERE is_delivered) d, count(*) FILTER (WHERE is_resolved) r, sum(delivered_value) v
         FROM public.cm_kpi_orders_v WHERE created_at >= (SELECT lo FROM public.cm_kpi_ts_bounds(_from, _to)) AND created_at < (SELECT hi FROM public.cm_kpi_ts_bounds(_from, _to)) AND kpi_date BETWEEN _from AND _to AND campaign_id IS NOT NULL GROUP BY 1),
  ids AS (SELECT campaign_id FROM s UNION SELECT campaign_id FROM cv UNION SELECT campaign_id FROM od)
  SELECT ids.campaign_id, cp.name, coalesce(s.sp, 0), coalesce(cv.n, 0), coalesce(cv.conv, 0), coalesce(od.n, 0), coalesce(od.d, 0),
         coalesce(od.r, 0), coalesce(od.v, 0), CASE WHEN coalesce(od.d, 0) > 0 THEN round(coalesce(s.sp, 0) / od.d, 2) END
  FROM ids LEFT JOIN public.cm_campaigns cp ON cp.id = ids.campaign_id
  LEFT JOIN s ON s.campaign_id = ids.campaign_id LEFT JOIN cv ON cv.campaign_id = ids.campaign_id LEFT JOIN od ON od.campaign_id = ids.campaign_id
  ORDER BY 3 DESC, 2
$function$;
