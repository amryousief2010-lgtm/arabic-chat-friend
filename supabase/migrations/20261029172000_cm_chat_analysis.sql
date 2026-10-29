-- تحليل محادثات واتساب (29-10-2026) — نفس نمط cm_call_analysis. التحليل عبر Vercel AI Gateway (gemini-2.5-flash) بلا أرقام هواتف.
-- 1) جدول cm_chat_analysis (تكتب الدالة cm-analyze-chat بمفتاح الخدمة فقط؛ القراءة cm_can_manage + cm_gate).
-- 2) cm_chat_metrics_v: مقاييس SQL لكل محادثة (أول رد بدقائق نافذة الخدمة 09:00–01:00، المشرفة = مالكة الخط، عدد الردود، الإعلان).
-- 3) cm_chat_analysis_list / cm_kpi_chat_by_moderator / cm_kpi_chat_by_ad / cm_kpi_chat_categories بفلاتر (مشرفة، تصنيف، حملة).
-- التراجع: DROP FUNCTION cm_chat_analysis_list(date,date,uuid,text,uuid), cm_kpi_chat_by_moderator(date,date,text,uuid),
--          cm_kpi_chat_by_ad(date,date,uuid,text), cm_kpi_chat_categories(date,date,uuid,uuid); DROP VIEW cm_chat_metrics_v; DROP TABLE cm_chat_analysis;

CREATE TABLE IF NOT EXISTS public.cm_chat_analysis (
  conversation_id uuid PRIMARY KEY REFERENCES public.cm_conversations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','error','skipped')),
  analysis_model text,
  analysis jsonb,
  category text CHECK (category IS NULL OR category IN ('price_inquiry','order_request','product_info','availability','delivery_inquiry','complaint','followup','wholesale','other')),
  intent text,
  outcome text CHECK (outcome IS NULL OR outcome IN ('order_placed','order_promised','inquiry_only','not_interested','complaint','no_reply','followup','other')),
  objections text[] NOT NULL DEFAULT '{}',
  quality_score smallint CHECK (quality_score IS NULL OR quality_score BETWEEN 1 AND 5),
  quality_notes text,
  summary_ar text,
  followup_needed boolean,
  messages_analyzed int,
  input_hash text,                     -- لا يُعاد التحليل إن لم تتغير المحادثة
  cost_estimate numeric(10,5),
  error text,
  attempts int NOT NULL DEFAULT 0,
  requested_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  analyzed_at timestamptz
);
CREATE INDEX IF NOT EXISTS cm_chat_analysis_status_idx ON public.cm_chat_analysis (status);
ALTER TABLE public.cm_chat_analysis ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cm_chat_analysis FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cm_chat_analysis TO authenticated;
GRANT ALL ON public.cm_chat_analysis TO service_role;
DROP POLICY IF EXISTS cm_read ON public.cm_chat_analysis;
CREATE POLICY cm_read ON public.cm_chat_analysis FOR SELECT TO authenticated USING ((SELECT public.cm_can_manage()));
DROP POLICY IF EXISTS cm_gate ON public.cm_chat_analysis;
CREATE POLICY cm_gate ON public.cm_chat_analysis AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.cm_gate_allows()) WITH CHECK (public.cm_gate_allows());

-- مقاييس كل محادثة (security_invoker ⇒ RLS المحادثات والرسائل تنطبق على القارئ).
DROP VIEW IF EXISTS public.cm_chat_metrics_v;
CREATE VIEW public.cm_chat_metrics_v WITH (security_invoker = true) AS
SELECT c.id AS conversation_id, c.line_id, l.label AS line_label,
       coalesce(c.owner_moderator_id, l.owner_moderator_id, c.assigned_moderator_id) AS moderator_id,
       c.first_inbound_at, c.first_reply_at,
       public.cm_local_date(coalesce(c.first_inbound_at, c.opened_at, c.created_at)) AS kpi_date,
       CASE WHEN c.first_reply_at IS NOT NULL AND coalesce(c.clock_started_at, c.first_inbound_at) IS NOT NULL
            THEN public.cm_service_minutes(coalesce(c.clock_started_at, c.first_inbound_at), c.first_reply_at) END AS first_response_min,
       (c.first_reply_moderator_id IS NOT NULL AND c.first_reply_moderator_id IS DISTINCT FROM coalesce(c.owner_moderator_id, l.owner_moderator_id)) AS first_reply_by_other,
       coalesce(mc.out_n, 0) AS reply_count, coalesce(mc.in_n, 0) AS inbound_count,
       c.ad_id, c.ad_headline, c.campaign_id, cp.name AS campaign_name, (c.ad_id IS NULL AND c.campaign_id IS NULL) AS is_organic
FROM public.cm_conversations c
LEFT JOIN public.cm_lines l ON l.id = c.line_id
LEFT JOIN public.cm_campaigns cp ON cp.id = c.campaign_id
LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE m.direction = 'out') out_n, count(*) FILTER (WHERE m.direction = 'in') in_n
                   FROM public.cm_messages m WHERE m.conversation_id = c.id) mc ON true;
REVOKE ALL ON public.cm_chat_metrics_v FROM PUBLIC, anon;
GRANT SELECT ON public.cm_chat_metrics_v TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cm_chat_analysis_list(_from date DEFAULT NULL, _to date DEFAULT NULL,
  _moderator uuid DEFAULT NULL, _category text DEFAULT NULL, _campaign uuid DEFAULT NULL)
RETURNS TABLE (conversation_id uuid, kpi_date date, first_inbound_at timestamptz, moderator_id uuid, moderator_name text, line_label text,
  ad_id text, campaign_id uuid, campaign_name text, is_organic boolean, first_response_min numeric, reply_count bigint, inbound_count bigint,
  status text, category text, intent text, outcome text, objections text[], quality_score smallint, quality_notes text,
  summary_ar text, followup_needed boolean, error text, analyzed_at timestamptz)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT v.conversation_id, v.kpi_date, v.first_inbound_at, v.moderator_id, mo.display_name, v.line_label, v.ad_id, v.campaign_id, v.campaign_name,
         v.is_organic, v.first_response_min, v.reply_count, v.inbound_count, a.status, a.category, a.intent, a.outcome, a.objections,
         a.quality_score, a.quality_notes, a.summary_ar, a.followup_needed, a.error, a.analyzed_at
  FROM public.cm_chat_metrics_v v
  LEFT JOIN public.cm_chat_analysis a ON a.conversation_id = v.conversation_id
  LEFT JOIN public.cm_moderators mo ON mo.id = v.moderator_id
  WHERE (public.cm_can_manage() OR public.cm_is_system_or_manager()) AND v.inbound_count > 0
    AND (_from IS NULL OR v.kpi_date >= _from) AND (_to IS NULL OR v.kpi_date <= _to)
    AND (_moderator IS NULL OR v.moderator_id = _moderator) AND (_category IS NULL OR a.category = _category)
    AND (_campaign IS NULL OR v.campaign_id = _campaign)
  ORDER BY v.first_inbound_at DESC NULLS LAST
$$;

CREATE OR REPLACE FUNCTION public.cm_kpi_chat_by_moderator(_from date, _to date, _category text DEFAULT NULL, _campaign uuid DEFAULT NULL)
RETURNS TABLE (moderator_id uuid, display_name text, conversations bigint, replied bigint, avg_first_response_min numeric,
  median_first_response_min numeric, avg_replies numeric, analyzed bigint, avg_quality numeric, order_pct numeric, from_ads bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT l.moderator_id, l.moderator_name, count(*), count(l.first_response_min),
         round(avg(l.first_response_min), 1), round((percentile_cont(0.5) WITHIN GROUP (ORDER BY l.first_response_min))::numeric, 1),
         round(avg(l.reply_count), 1), count(*) FILTER (WHERE l.status = 'done'), round(avg(l.quality_score), 2),
         round(100.0 * count(*) FILTER (WHERE l.outcome IN ('order_placed','order_promised')) / nullif(count(*) FILTER (WHERE l.status = 'done'), 0), 1),
         count(*) FILTER (WHERE NOT l.is_organic)
  FROM public.cm_chat_analysis_list(_from, _to, NULL, _category, _campaign) l
  GROUP BY 1, 2 ORDER BY 3 DESC
$$;

CREATE OR REPLACE FUNCTION public.cm_kpi_chat_by_ad(_from date, _to date, _moderator uuid DEFAULT NULL, _category text DEFAULT NULL)
RETURNS TABLE (campaign_id uuid, campaign_name text, ad_id text, conversations bigint, analyzed bigint, orders bigint,
  avg_first_response_min numeric, avg_quality numeric, top_category text)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT l.campaign_id, coalesce(l.campaign_name, CASE WHEN l.is_organic THEN 'عضوي (بدون إعلان)' END), l.ad_id, count(*),
         count(*) FILTER (WHERE l.status = 'done'), count(*) FILTER (WHERE l.outcome IN ('order_placed','order_promised')),
         round(avg(l.first_response_min), 1), round(avg(l.quality_score), 2),
         mode() WITHIN GROUP (ORDER BY l.category)
  FROM public.cm_chat_analysis_list(_from, _to, _moderator, _category, NULL) l
  GROUP BY 1, 2, 3 ORDER BY 4 DESC
$$;

CREATE OR REPLACE FUNCTION public.cm_kpi_chat_categories(_from date, _to date, _moderator uuid DEFAULT NULL, _campaign uuid DEFAULT NULL)
RETURNS TABLE (category text, conversations bigint, orders bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT l.category, count(*), count(*) FILTER (WHERE l.outcome IN ('order_placed','order_promised'))
  FROM public.cm_chat_analysis_list(_from, _to, _moderator, NULL, _campaign) l WHERE l.status = 'done'
  GROUP BY 1 ORDER BY 2 DESC
$$;

DO $g$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['cm_chat_analysis_list(date,date,uuid,text,uuid)','cm_kpi_chat_by_moderator(date,date,text,uuid)',
                           'cm_kpi_chat_by_ad(date,date,uuid,text)','cm_kpi_chat_categories(date,date,uuid,uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $g$;
