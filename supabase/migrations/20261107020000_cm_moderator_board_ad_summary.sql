-- لوحة البنات: ملخص الإعلانات لكل مودريتور (محادثات + رسائل واردة) في فترة Cairo.
-- مصدر الاسم: cm_campaign_ads.name ← cm_campaigns.name ← ad_headline ← «إعلان …XXXXXX».
-- قراءة فقط؛ لا تكتب على cm_ad_attributions.
-- غير مطبّقة — تحتاج موافقة م. عمرو. الرجوع: 20261107020000_cm_moderator_board_ad_summary_ROLLBACK.sql

CREATE OR REPLACE FUNCTION public.cm_moderator_board_ad_summary(p_from date, p_to date)
RETURNS TABLE(
  moderator_id uuid,
  display_name text,
  sort_order int,
  ad_id text,
  ad_name text,
  conversations bigint,
  inbound_messages bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.cm_moderator_board_ad_summary(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_moderator_board_ad_summary(date, date) TO authenticated, service_role;
