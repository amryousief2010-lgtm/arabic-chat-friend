-- تقرير أداء الموديراتور لفترة (قراءة فقط). لا يكتب أي جدول، ولا يُرجع أرقام هواتف أو نص رسائل.
-- محادثات / رسائل / خط ساخن / إعلانات: المدير العام + المدير التنفيذي + مديرة المبيعات، وبعد cm_gate_allows().
-- مبيعات وكيلو وتحصيل: نفس أدوار صفحة «أداء الموديراتور».
-- غير مطبّقة من هنا. الرجوع: supabase/rollbacks/20261110203000_cm_moderator_period_report_ROLLBACK.sql

-- نفس ترتيب classifyPayrollProduct ثم هدايا الكيلو غير المصنّفة، والرقاب خارج العدّاد (قرار 4/11).
CREATE OR REPLACE FUNCTION public.cm_report_kg_bucket(_name text, _is_gift boolean, _unit text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.normalize_ar_name(_name) ~ 'رقب' THEN NULL
    WHEN public.normalize_ar_name(_name) LIKE ANY (ARRAY[
      '%دبوس بالعظم%', '%دبوس 6%', '%فخده%', '%فخذه%', '%نعامه صندوق%'
    ]) THEN 'bone'
    WHEN public.normalize_ar_name(_name) LIKE ANY (ARRAY[
      '%شاورما%', '%شيش%', '%كفته%', '%سجق%', '%برجر%', '%طرب%', '%حواشي%', '%حواوشي%', '%مفروم%'
    ]) THEN 'processed'
    WHEN public.normalize_ar_name(_name) LIKE ANY (ARRAY[
      '%قطع%', '%استيك%', '%موزه%', '%فراشه%', '%قطعيه%', '%تربيانكو%', '%اسكالوب%', '%رول%', '%كباب%'
    ]) THEN 'meat'
    WHEN coalesce(_is_gift, false)
      AND (nullif(btrim(coalesce(_unit, '')), '') IS NULL OR _unit LIKE '%كيلو%' OR _unit LIKE '%كجم%')
      THEN 'gifts'
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.cm_moderator_period_report(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_page boolean;
  v_chat boolean;
  v_lo timestamptz;
  v_hi timestamptz;
  v_mods jsonb;
  v_daily jsonb := '[]'::jsonb;
  v_hours jsonb := '[]'::jsonb;
  v_ads jsonb := '[]'::jsonb;
BEGIN
  v_page := public.has_any_role(auth.uid(), ARRAY[
    'general_manager', 'executive_manager', 'sales_manager',
    'marketing_sales_manager', 'marketing_sales_viewer'
  ]::public.app_role[]);
  v_chat := public.has_any_role(auth.uid(), ARRAY[
    'general_manager', 'executive_manager', 'sales_manager'
  ]::public.app_role[]) AND public.cm_gate_allows();
  IF NOT v_page AND NOT v_chat THEN
    RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR (p_to - p_from) > 366 THEN
    RAISE EXCEPTION 'CM_BAD_RANGE' USING ERRCODE = '22023';
  END IF;

  SELECT b.lo, b.hi INTO v_lo, v_hi FROM public.cm_kpi_ts_bounds(p_from, p_to) b;

  WITH girls AS (
    SELECT m.id, m.slug, m.display_name,
           CASE m.slug WHEN 'aya' THEN 1 WHEN 'noura' THEN 2 WHEN 'manal' THEN 3
                       WHEN 'mariam' THEN 4 WHEN 'soha' THEN 5 ELSE 9 END AS ord
    FROM public.cm_moderators m
    WHERE m.slug IN ('aya', 'noura', 'manal', 'mariam', 'soha')
  ),
  ord AS (
    SELECT o.id, o.status, o.total, o.collection_status, o.created_at,
           coalesce(o.moderator_id, al.moderator_id) AS mid
    FROM public.orders o
    LEFT JOIN LATERAL (
      SELECT a.moderator_id
      FROM public.cm_moderator_aliases a
      JOIN girls g ON g.id = a.moderator_id
      WHERE o.moderator_id IS NULL
        AND a.alias_norm = public.normalize_ar_name(coalesce(o.moderator, ''))
      LIMIT 1
    ) al ON true
    WHERE o.created_at >= v_lo AND o.created_at < v_hi
      AND public.cm_local_date(o.created_at) BETWEEN p_from AND p_to
      AND NOT public.cm_order_is_cancelled(o.status)
      AND coalesce(o.moderator_id, al.moderator_id) IN (SELECT id FROM girls)
  ),
  sales AS (
    SELECT g.id AS mid,
           count(*)::bigint AS orders_registered,
           count(*) FILTER (WHERE public.cm_order_is_delivered(o.status))::bigint AS orders_delivered,
           coalesce(sum(o.total) FILTER (WHERE public.cm_order_is_delivered(o.status)), 0)::numeric AS delivered_value,
           coalesce(sum(o.total), 0)::numeric AS registered_value,
           count(*) FILTER (WHERE lower(btrim(coalesce(o.collection_status, ''))) = 'collected')::bigint AS collected,
           count(*) FILTER (WHERE lower(btrim(coalesce(o.collection_status, ''))) IN ('not_collected', ''))::bigint AS not_collected,
           count(*) FILTER (WHERE lower(btrim(coalesce(o.collection_status, ''))) NOT IN ('collected', 'not_collected', ''))::bigint AS collection_other
    FROM girls g
    LEFT JOIN ord o ON o.mid = g.id
    GROUP BY g.id
  ),
  kg AS (
    SELECT o.mid,
           coalesce(sum(i.quantity) FILTER (WHERE b.bucket = 'meat'), 0)::numeric AS meat_req,
           coalesce(sum(i.quantity) FILTER (WHERE b.bucket = 'bone'), 0)::numeric AS bone_req,
           coalesce(sum(i.quantity) FILTER (WHERE b.bucket = 'processed'), 0)::numeric AS processed_req,
           coalesce(sum(i.quantity) FILTER (WHERE b.bucket = 'gifts'), 0)::numeric AS gifts_req,
           coalesce(sum(i.quantity) FILTER (WHERE b.bucket = 'meat' AND public.cm_order_is_delivered(o.status)), 0)::numeric AS meat_del,
           coalesce(sum(i.quantity) FILTER (WHERE b.bucket = 'bone' AND public.cm_order_is_delivered(o.status)), 0)::numeric AS bone_del,
           coalesce(sum(i.quantity) FILTER (WHERE b.bucket = 'processed' AND public.cm_order_is_delivered(o.status)), 0)::numeric AS processed_del,
           coalesce(sum(i.quantity) FILTER (WHERE b.bucket = 'gifts' AND public.cm_order_is_delivered(o.status)), 0)::numeric AS gifts_del
    FROM ord o
    JOIN public.order_items i ON i.order_id = o.id
    LEFT JOIN public.products pr ON pr.id = i.product_id
    CROSS JOIN LATERAL (
      SELECT public.cm_report_kg_bucket(i.product_name, i.is_gift, pr.unit) AS bucket
    ) b
    GROUP BY o.mid
  ),
  days AS (
    SELECT gs::date AS day FROM generate_series(p_from, p_to, interval '1 day') gs
  ),
  daily_orders AS (
    SELECT public.cm_local_date(o.created_at) AS day, o.mid, count(*)::bigint AS n
    FROM ord o
    GROUP BY 1, 2
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'slug', g.slug,
           'name', g.display_name,
           'orders_registered', coalesce(s.orders_registered, 0),
           'orders_delivered', coalesce(s.orders_delivered, 0),
           'delivered_value', round(coalesce(s.delivered_value, 0), 2),
           'average_order_value', CASE WHEN coalesce(s.orders_registered, 0) > 0
             THEN round(s.registered_value / s.orders_registered, 2) END,
           'collection_collected', coalesce(s.collected, 0),
           'collection_not_collected', coalesce(s.not_collected, 0),
           'collection_other', coalesce(s.collection_other, 0),
           'kg_requested', jsonb_build_object(
             'meat', round(coalesce(k.meat_req, 0), 3),
             'bone', round(coalesce(k.bone_req, 0), 3),
             'processed', round(coalesce(k.processed_req, 0), 3),
             'gifts', round(coalesce(k.gifts_req, 0), 3)),
           'kg_delivered', jsonb_build_object(
             'meat', round(coalesce(k.meat_del, 0), 3),
             'bone', round(coalesce(k.bone_del, 0), 3),
             'processed', round(coalesce(k.processed_del, 0), 3),
             'gifts', round(coalesce(k.gifts_del, 0), 3))
         ) ORDER BY g.ord), '[]'::jsonb),
         coalesce((
           SELECT jsonb_agg(jsonb_build_object(
                    'day', d.day,
                    'slug', g.slug,
                    'orders', coalesce(od.n, 0)) ORDER BY d.day, g.ord)
           FROM days d CROSS JOIN girls g
           LEFT JOIN daily_orders od ON od.day = d.day AND od.mid = g.id
         ), '[]'::jsonb)
  INTO v_mods, v_daily
  FROM girls g
  LEFT JOIN sales s ON s.mid = g.id
  LEFT JOIN kg k ON k.mid = g.id;

  IF v_chat THEN
    WITH girls AS (
      SELECT m.id, m.slug,
             CASE m.slug WHEN 'aya' THEN 1 WHEN 'noura' THEN 2 WHEN 'manal' THEN 3
                         WHEN 'mariam' THEN 4 WHEN 'soha' THEN 5 ELSE 9 END AS ord
      FROM public.cm_moderators m
      WHERE m.slug IN ('aya', 'noura', 'manal', 'mariam', 'soha')
    ),
    cv AS (
      SELECT c.id, coalesce(c.assigned_moderator_id, c.owner_moderator_id) AS mid,
             public.cm_first_reply_kpi_status(
               c.clock_started_at, c.first_reply_at, c.first_reply_was_cover,
               coalesce(c.assigned_moderator_id, c.owner_moderator_id)) AS st,
             (c.status IN ('open', 'pending') AND c.last_outbound_at IS NOT NULL
               AND (c.last_inbound_at IS NULL OR c.last_outbound_at >= c.last_inbound_at)) AS waiting,
             CASE WHEN c.first_reply_at IS NOT NULL AND c.clock_started_at IS NOT NULL
                  THEN greatest(0, extract(epoch FROM (c.first_reply_at - c.clock_started_at)) / 60.0) END AS reply_min,
             public.cm_local_date(c.first_inbound_at) AS day,
             extract(hour FROM (c.first_inbound_at AT TIME ZONE
               coalesce((SELECT timezone FROM public.cm_kpi_settings WHERE id = 1), 'Africa/Cairo')))::int AS hr
      FROM public.cm_conversations c
      WHERE c.first_inbound_at IS NOT NULL
        AND c.first_inbound_at >= v_lo AND c.first_inbound_at < v_hi
        AND public.cm_local_date(c.first_inbound_at) BETWEEN p_from AND p_to
        AND coalesce(c.assigned_moderator_id, c.owner_moderator_id) IN (SELECT id FROM girls)
    ),
    chat AS (
      SELECT mid,
             count(*)::bigint AS conversations,
             count(*) FILTER (WHERE st = 'on_time')::bigint AS on_time,
             count(*) FILTER (WHERE st = 'cover')::bigint AS cover,
             count(*) FILTER (WHERE st = 'late')::bigint AS late,
             count(*) FILTER (WHERE st = 'pending')::bigint AS unreplied,
             count(*) FILTER (WHERE waiting)::bigint AS waiting_customer,
             round(avg(reply_min)::numeric, 1) AS avg_first_reply_min,
             round((percentile_cont(0.5) WITHIN GROUP (ORDER BY reply_min))::numeric, 1) AS median_first_reply_min
      FROM cv
      GROUP BY mid
    ),
    msgs AS (
      SELECT coalesce(c.assigned_moderator_id, c.owner_moderator_id) AS mid,
             count(*) FILTER (WHERE m.direction = 'in')::bigint AS inbound_messages,
             count(*) FILTER (WHERE m.direction = 'out')::bigint AS outbound_messages
      FROM public.cm_messages m
      JOIN public.cm_conversations c ON c.id = m.conversation_id
      WHERE m.sent_at >= v_lo AND m.sent_at < v_hi
        AND public.cm_local_date(m.sent_at) BETWEEN p_from AND p_to
        AND coalesce(c.assigned_moderator_id, c.owner_moderator_id) IN (SELECT id FROM girls)
      GROUP BY 1
    ),
    calls AS (
      SELECT c.moderator_id AS mid,
             count(*) FILTER (WHERE c.status = 'answered')::bigint AS answered,
             count(*) FILTER (WHERE c.status = 'missed')::bigint AS missed,
             count(*) FILTER (WHERE c.status = 'answered' AND c.duration_sec < 60)::bigint AS under_1_min,
             count(*) FILTER (WHERE c.status = 'answered' AND c.duration_sec >= 60 AND c.duration_sec < 300)::bigint AS from_1_to_5_min,
             count(*) FILTER (WHERE c.status = 'answered' AND c.duration_sec >= 300)::bigint AS over_5_min,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM public.orders o
               WHERE NOT public.cm_order_is_cancelled(o.status)
                 AND o.created_at >= c.started_at - interval '1 day'
                 AND o.created_at < c.started_at + interval '7 days'
                 AND (
                   (c.customer_id IS NOT NULL AND o.customer_id = c.customer_id)
                   OR (c.phone_norm IS NOT NULL AND EXISTS (
                     SELECT 1 FROM public.customers cu
                     WHERE cu.id = o.customer_id
                       AND (public.cm_normalize_phone(cu.phone) = c.phone_norm
                         OR public.cm_normalize_phone(cu.phone2) = c.phone_norm)
                   ))
                 )
             ))::bigint AS matched_order
      FROM public.cm_calls c
      WHERE c.moderator_id IN (SELECT id FROM girls)
        AND c.started_at >= v_lo AND c.started_at < v_hi
        AND public.cm_local_date(c.started_at) BETWEEN p_from AND p_to
      GROUP BY c.moderator_id
    ),
    enriched AS (
      SELECT g.slug, g.ord,
             coalesce(ch.conversations, 0) AS conversations,
             coalesce(ch.on_time, 0) AS on_time,
             coalesce(ch.cover, 0) AS cover,
             coalesce(ch.late, 0) AS late,
             coalesce(ch.unreplied, 0) AS unreplied,
             coalesce(ch.waiting_customer, 0) AS waiting_customer,
             coalesce(ms.inbound_messages, 0) AS inbound_messages,
             coalesce(ms.outbound_messages, 0) AS outbound_messages,
             ch.avg_first_reply_min,
             ch.median_first_reply_min,
             CASE WHEN coalesce(ch.conversations, 0) > 0 THEN round(100.0 * (
               SELECT (x->>'orders_registered')::numeric FROM jsonb_array_elements(v_mods) x
               WHERE x->>'slug' = g.slug LIMIT 1
             ) / ch.conversations, 1) END AS conversion_pct,
             jsonb_build_object(
               'answered', coalesce(ca.answered, 0),
               'missed', coalesce(ca.missed, 0),
               'under_1_min', coalesce(ca.under_1_min, 0),
               'from_1_to_5_min', coalesce(ca.from_1_to_5_min, 0),
               'over_5_min', coalesce(ca.over_5_min, 0),
               'matched_order', coalesce(ca.matched_order, 0),
               'answer_rate', CASE WHEN coalesce(ca.answered, 0) + coalesce(ca.missed, 0) > 0
                 THEN round(100.0 * ca.answered / (ca.answered + ca.missed), 1) END
             ) AS calls
      FROM girls g
      LEFT JOIN chat ch ON ch.mid = g.id
      LEFT JOIN msgs ms ON ms.mid = g.id
      LEFT JOIN calls ca ON ca.mid = g.id
    )
    SELECT (
      SELECT coalesce(jsonb_agg(
        m.elem || jsonb_build_object(
          'conversations', e.conversations,
          'on_time', e.on_time,
          'cover', e.cover,
          'late', e.late,
          'unreplied', e.unreplied,
          'waiting_customer', e.waiting_customer,
          'inbound_messages', e.inbound_messages,
          'outbound_messages', e.outbound_messages,
          'avg_first_reply_min', e.avg_first_reply_min,
          'median_first_reply_min', e.median_first_reply_min,
          'conversion_pct', e.conversion_pct,
          'calls', e.calls
        ) ORDER BY e.ord), '[]'::jsonb)
      FROM enriched e
      JOIN LATERAL (SELECT elem FROM jsonb_array_elements(v_mods) elem WHERE elem->>'slug' = e.slug) m ON true
    ) INTO v_mods;

    WITH girls AS (
      SELECT m.id, m.slug,
             CASE m.slug WHEN 'aya' THEN 1 WHEN 'noura' THEN 2 WHEN 'manal' THEN 3
                         WHEN 'mariam' THEN 4 WHEN 'soha' THEN 5 ELSE 9 END AS ord
      FROM public.cm_moderators m
      WHERE m.slug IN ('aya', 'noura', 'manal', 'mariam', 'soha')
    ),
    cv AS (
      SELECT coalesce(c.assigned_moderator_id, c.owner_moderator_id) AS mid, c.id,
             public.cm_local_date(c.first_inbound_at) AS day,
             public.cm_first_reply_kpi_status(
               c.clock_started_at, c.first_reply_at, c.first_reply_was_cover,
               coalesce(c.assigned_moderator_id, c.owner_moderator_id)) AS st,
             extract(hour FROM (c.first_inbound_at AT TIME ZONE
               coalesce((SELECT timezone FROM public.cm_kpi_settings WHERE id = 1), 'Africa/Cairo')))::int AS hr
      FROM public.cm_conversations c
      WHERE c.first_inbound_at IS NOT NULL
        AND c.first_inbound_at >= v_lo AND c.first_inbound_at < v_hi
        AND public.cm_local_date(c.first_inbound_at) BETWEEN p_from AND p_to
        AND coalesce(c.assigned_moderator_id, c.owner_moderator_id) IN (SELECT id FROM girls)
    )
    SELECT
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'day', d.day::date, 'slug', g.slug,
                 'conversations', coalesce(n.n, 0),
                 'orders', coalesce((
                   SELECT (x->>'orders')::int FROM jsonb_array_elements(v_daily) x
                   WHERE x->>'slug' = g.slug AND (x->>'day')::date = d.day::date LIMIT 1
                 ), 0)) ORDER BY d.day, g.ord)
        FROM generate_series(p_from, p_to, interval '1 day') d(day)
        CROSS JOIN girls g
        LEFT JOIN (
          SELECT day, mid, count(*)::int AS n FROM cv GROUP BY 1, 2
        ) n ON n.day = d.day::date AND n.mid = g.id
      ), '[]'::jsonb),
      coalesce((
        SELECT jsonb_agg(jsonb_build_object('hour', hr, 'slug', g.slug, 'late', n) ORDER BY hr, g.ord)
        FROM (
          SELECT cv.hr, cv.mid, count(*)::int AS n
          FROM cv WHERE cv.st = 'late'
          GROUP BY 1, 2
        ) h
        JOIN girls g ON g.id = h.mid
      ), '[]'::jsonb),
      coalesce((
        SELECT jsonb_agg(jsonb_build_object('ad_name', ad_name, 'slug', slug, 'conversations', n) ORDER BY n DESC, ad_name)
        FROM (
          SELECT left(coalesce(nullif(btrim(ad.name), ''), nullif(btrim(cp.name), ''),
                      nullif(btrim(a.referral_headline), ''), 'بدون إعلان'), 120) AS ad_name,
                 g.slug, count(*)::int AS n
          FROM cv
          JOIN public.cm_ad_attributions a ON a.conversation_id = cv.id
          JOIN girls g ON g.id = cv.mid
          LEFT JOIN public.cm_campaign_ads ad ON ad.meta_ad_id = a.ad_id
          LEFT JOIN public.cm_campaigns cp ON cp.id = coalesce(a.campaign_id, ad.campaign_id)
          GROUP BY 1, 2
          ORDER BY 3 DESC
          LIMIT 80
        ) z
      ), '[]'::jsonb)
    INTO v_daily, v_hours, v_ads;
  END IF;

  RETURN jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'conversations_visible', v_chat,
    'moderators', v_mods,
    'daily', v_daily,
    'late_by_hour', v_hours,
    'ads', v_ads
  );
END $$;

REVOKE ALL ON FUNCTION public.cm_report_kg_bucket(text, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cm_moderator_period_report(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_report_kg_bucket(text, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cm_moderator_period_report(date, date) TO authenticated, service_role;
