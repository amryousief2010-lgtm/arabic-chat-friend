-- تفريغ وتحليل مكالمات المبيعات (موافقة م. عمرو 28-10-2026): تفريغ خارجي عبر Vercel AI Gateway فقط
-- (elevenlabs/scribe-v2 للتفريغ، google/gemini-3.5-flash للتحليل). تكتب الدالة cm-analyze-call بمفتاح الخدمة فقط.
-- القراءة مثل التسجيلات تماماً: cm_can_listen_recordings() (م.ع / م.ت / مديرة المبيعات) + سياسة cm_gate (المدير العام فقط حالياً).
-- 1) جدول cm_call_analysis   2) cm_call_analysis_get / cm_call_analysis_list   3) cm_kpi_by_moderator + 3 أعمدة في النهاية (إضافة فقط)
-- 4) cm_kpi_call_objections (أكثر الاعتراضات).
-- التراجع: DROP FUNCTION cm_call_analysis_get(uuid), cm_call_analysis_list(date,date), cm_kpi_call_objections(date,date,int);
--          DROP FUNCTION cm_kpi_by_moderator(date,date); أعد إنشاءها من 20261027230000 (مع منح EXECUTE لـ authenticated/service_role
--          وإعادة تغليف البوابة غير مطلوب لأنها لا تُغلَّف)؛ DROP TABLE cm_call_analysis.

CREATE TABLE IF NOT EXISTS public.cm_call_analysis (
  call_id uuid PRIMARY KEY REFERENCES public.cm_calls(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','error')),
  asr_model text, analysis_model text,
  transcript_text text,
  transcript_segments jsonb,            -- [{speaker, start, end, text}]
  speaker_roles jsonb,                  -- {"speaker_0":"moderator","speaker_1":"customer"} يستنتجها التحليل
  audio_seconds numeric,
  analysis jsonb,
  summary_ar text, caller_intent text,
  is_sales_inquiry boolean, order_placed_or_promised boolean,
  outcome text CHECK (outcome IS NULL OR outcome IN ('order_placed','order_promised','inquiry_only','not_interested','complaint','followup','other')),
  objections text[] NOT NULL DEFAULT '{}',
  handling_score smallint CHECK (handling_score IS NULL OR handling_score BETWEEN 1 AND 5),
  handling_notes text,
  followup_needed boolean, followup_reason text,
  cost_estimate numeric(10,5),
  error text,
  attempts int NOT NULL DEFAULT 0,
  requested_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  analyzed_at timestamptz
);
CREATE INDEX IF NOT EXISTS cm_call_analysis_status_idx ON public.cm_call_analysis (status);
ALTER TABLE public.cm_call_analysis ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cm_call_analysis FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cm_call_analysis TO authenticated;
GRANT ALL ON public.cm_call_analysis TO service_role;
DROP POLICY IF EXISTS cm_read ON public.cm_call_analysis;
CREATE POLICY cm_read ON public.cm_call_analysis FOR SELECT TO authenticated USING ((SELECT public.cm_can_listen_recordings()));
DROP POLICY IF EXISTS cm_gate ON public.cm_call_analysis;
CREATE POLICY cm_gate ON public.cm_call_analysis AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.cm_gate_allows()) WITH CHECK (public.cm_gate_allows());

-- تفاصيل مكالمة واحدة (للنافذة)
CREATE OR REPLACE FUNCTION public.cm_call_analysis_get(_call_id uuid)
RETURNS public.cm_call_analysis LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT a.* FROM public.cm_call_analysis a WHERE a.call_id = _call_id
$$;
-- ملخص خفيف لكل المكالمات في مدى (للجدول) — بدون النص الكامل
CREATE OR REPLACE FUNCTION public.cm_call_analysis_list(_from date DEFAULT NULL, _to date DEFAULT NULL)
RETURNS TABLE (call_id uuid, status text, outcome text, handling_score smallint, followup_needed boolean,
               order_placed_or_promised boolean, summary_ar text, error text, analyzed_at timestamptz)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT a.call_id, a.status, a.outcome, a.handling_score, a.followup_needed, a.order_placed_or_promised, a.summary_ar, a.error, a.analyzed_at
  FROM public.cm_call_analysis a JOIN public.cm_calls c ON c.id = a.call_id
  WHERE (_from IS NULL OR public.cm_local_date(c.started_at) >= _from) AND (_to IS NULL OR public.cm_local_date(c.started_at) <= _to)
$$;
-- أكثر الاعتراضات
CREATE OR REPLACE FUNCTION public.cm_kpi_call_objections(_from date, _to date, _limit int DEFAULT 10)
RETURNS TABLE (objection text, calls bigint) LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT o, count(*) FROM public.cm_call_analysis a JOIN public.cm_calls c ON c.id = a.call_id, unnest(a.objections) o
  WHERE a.status = 'done' AND c.started_at >= (SELECT lo FROM public.cm_kpi_ts_bounds(_from, _to))
    AND c.started_at < (SELECT hi FROM public.cm_kpi_ts_bounds(_from, _to)) AND public.cm_local_date(c.started_at) BETWEEN _from AND _to
  GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT greatest(coalesce(_limit, 10), 1)
$$;

-- cm_kpi_by_moderator: نفس الأعمدة والسلوك + analyzed_calls, avg_handling_score, order_call_pct, open_followups في النهاية.
DROP FUNCTION IF EXISTS public.cm_kpi_by_moderator(date, date);
CREATE FUNCTION public.cm_kpi_by_moderator(_from date, _to date)
 RETURNS TABLE(moderator_id uuid, display_name text, conversations bigint, on_time bigint, cover bigint, late bigint, pending bigint, abandoned bigint, converted bigint, missed_calls bigint, missed_followed bigint, orders bigint, delivered bigint, resolved bigint, delivered_value numeric, campaign_delivered bigint, allocated_spend numeric, cost_per_delivered numeric,
               analyzed_calls bigint, avg_handling_score numeric, order_call_pct numeric, open_followups bigint)
 LANGUAGE sql STABLE SET search_path TO 'public'
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
         FROM public.cm_kpi_orders_v WHERE created_at >= (SELECT lo FROM public.cm_kpi_ts_bounds(_from, _to)) AND created_at < (SELECT hi FROM public.cm_kpi_ts_bounds(_from, _to)) AND kpi_date BETWEEN _from AND _to AND moderator_id IS NOT NULL GROUP BY 1),
  an AS (SELECT k.moderator_id, count(*) n, round(avg(a.handling_score), 2) sc,
                round(100.0 * count(*) FILTER (WHERE a.order_placed_or_promised) / count(*), 1) op,
                count(*) FILTER (WHERE a.followup_needed AND k.followed_up_at IS NULL) fu
         FROM public.cm_call_analysis a JOIN public.cm_calls k ON k.id = a.call_id
         WHERE a.status = 'done' AND k.is_sales AND k.moderator_id IS NOT NULL
           AND k.started_at >= (SELECT lo FROM public.cm_kpi_ts_bounds(_from, _to)) AND k.started_at < (SELECT hi FROM public.cm_kpi_ts_bounds(_from, _to))
           AND public.cm_local_date(k.started_at) BETWEEN _from AND _to GROUP BY 1)
  SELECT m.id, m.display_name, coalesce(c.n,0), coalesce(c.ot,0), coalesce(c.co,0), coalesce(c.la,0), coalesce(c.pe,0), coalesce(c.ab,0),
         coalesce(c.cn,0), coalesce(mc.n,0), coalesce(mc.f,0), coalesce(od.n,0), coalesce(od.d,0), coalesce(od.r,0), coalesce(od.v,0),
         coalesce(od.cd,0), round(coalesce(alloc.sp,0), 2),
         CASE WHEN coalesce(od.cd,0) > 0 THEN round(coalesce(alloc.sp,0) / od.cd, 2) END,
         coalesce(an.n,0), an.sc, an.op, coalesce(an.fu,0)
  FROM public.cm_moderators m
  LEFT JOIN c ON c.moderator_id = m.id LEFT JOIN mc ON mc.moderator_id = m.id
  LEFT JOIN od ON od.moderator_id = m.id LEFT JOIN alloc ON alloc.moderator_id = m.id LEFT JOIN an ON an.moderator_id = m.id
  WHERE c.n IS NOT NULL OR mc.n IS NOT NULL OR od.n IS NOT NULL OR alloc.sp IS NOT NULL OR an.n IS NOT NULL
  ORDER BY m.sort_order
$function$;

DO $g$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['cm_kpi_by_moderator(date,date)','cm_call_analysis_get(uuid)','cm_call_analysis_list(date,date)','cm_kpi_call_objections(date,date,int)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f); END IF;
  END LOOP;
END $g$;
