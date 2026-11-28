-- ============================================================
-- المساعد الصوتي للمديرين (نموذج أولي) — موافقة م. عمرو «نفذ» 28-11-2026، على قاعدة التجربة فقط.
-- الوصول: المدير العام والمدير التنفيذي ومدير المبيعات بس، وكلهم بيشوفوا الأدوات الـ8 كلها بما فيها الخزنة (قرار م. عمرو 28-11-2026).
-- 1) 8 أدوات قراءة فقط (ai_tool_*) بتشتغل بصلاحية المستخدم نفسه (SECURITY INVOKER)
--    فالـ RLS وإخفاء التكلفة بيتطبقوا. كل أداة بتتحقق من الدور جوه القاعدة.
--    مفيش أي أداة بتكتب، ومفيش أرقام موبايل ولا أسماء عملاء ولا تكلفة.
-- 2) توسيع سجل ai_assistant_query_log (النص المفرّغ، الإجابة، الأدوات، التكلفة، الزمن).
--    القراءة للمدير العام بس، والاحتفاظ 12 شهر.
-- ممنوع: cm_ad_attributions (كتابة)، catering_*، جداول Zodex/المحتسب (كلها مش مستخدمة هنا).
-- ============================================================

-- ───── أدوار الأدوات ─────
CREATE OR REPLACE FUNCTION public.ai_asst_require(_roles public.app_role[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.has_any_role(auth.uid(), _roles), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
END $$;

-- فترة آمنة: من <= إلى، وأقصاها 92 يوم.
CREATE OR REPLACE FUNCTION public.ai_asst_range(_from date, _to date)
RETURNS TABLE (d_from date, d_to date) LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  d_to := coalesce(_to, _from);
  d_from := coalesce(_from, d_to);
  IF d_from IS NULL THEN RAISE EXCEPTION 'date_required'; END IF;
  IF d_from > d_to THEN d_from := d_to; END IF;
  IF d_to - d_from > 91 THEN d_from := d_to - 91; END IF;
  RETURN NEXT;
END $$;

-- نسخة من cm_ai_orders_v (نفس منطق cm_ai_norm_ar مكتوب جوه) بصلاحية المستخدم (security_invoker) عشان الأدوات تقرا الطلبات تحت RLS.
-- cm_ai_orders_v نفسها متسابة زي ما هي (للخدمة بس).
CREATE OR REPLACE VIEW public.ai_asst_orders_v WITH (security_invoker = true) AS
SELECT o.id AS order_id, o.created_at, public.cm_local_date(o.created_at) AS kpi_date, o.status,
       (o.status = 'cancelled') AS is_cancelled, coalesce(o.total, 0) AS total,
       coalesce(o.moderator_id, mm.id) AS moderator_id
FROM public.orders o
LEFT JOIN LATERAL (SELECT m.id FROM public.cm_moderators m
  WHERE o.moderator_id IS NULL AND o.moderator IS NOT NULL
    AND (translate(btrim(coalesce(m.display_name, '')), 'أإآة', 'اااه') = translate(btrim(coalesce(o.moderator, '')), 'أإآة', 'اااه')
         OR translate(btrim(coalesce(m.canonical_name, '')), 'أإآة', 'اااه') = translate(btrim(coalesce(o.moderator, '')), 'أإآة', 'اااه'))
  ORDER BY m.is_active DESC LIMIT 1) mm ON true;
REVOKE ALL ON public.ai_asst_orders_v FROM PUBLIC, anon;
GRANT SELECT ON public.ai_asst_orders_v TO authenticated, service_role;

-- 1) المبيعات لفترة + مقارنة بالفترة اللي قبلها بنفس الطول
CREATE OR REPLACE FUNCTION public.ai_tool_sales_summary(_from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE f date; t date; n int; p_from date; p_to date; r jsonb;
BEGIN
  PERFORM public.ai_asst_require(ARRAY['general_manager','executive_manager','sales_manager']::public.app_role[]);
  SELECT d_from, d_to INTO f, t FROM public.ai_asst_range(_from, _to);
  n := t - f + 1; p_to := f - 1; p_from := f - n;
  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', f, 'to', t, 'days', n),
    'currency', 'EGP',
    'orders', count(*) FILTER (WHERE o.kpi_date BETWEEN f AND t AND NOT o.is_cancelled),
    'net_sales', round(coalesce(sum(o.total) FILTER (WHERE o.kpi_date BETWEEN f AND t AND NOT o.is_cancelled), 0)),
    'cancelled_orders', count(*) FILTER (WHERE o.kpi_date BETWEEN f AND t AND o.is_cancelled),
    'avg_daily_net_sales', round(coalesce(sum(o.total) FILTER (WHERE o.kpi_date BETWEEN f AND t AND NOT o.is_cancelled), 0) / n),
    'previous_period', jsonb_build_object('from', p_from, 'to', p_to,
        'orders', count(*) FILTER (WHERE o.kpi_date BETWEEN p_from AND p_to AND NOT o.is_cancelled),
        'net_sales', round(coalesce(sum(o.total) FILTER (WHERE o.kpi_date BETWEEN p_from AND p_to AND NOT o.is_cancelled), 0))),
    'last_order_date_in_data', max(o.kpi_date))
  INTO r FROM public.ai_asst_orders_v o
  WHERE o.created_at >= (p_from - 1)::timestamp AND o.created_at < (t + 2)::timestamp;
  r := r || jsonb_build_object('change_pct', CASE WHEN (r->'previous_period'->>'net_sales')::numeric > 0
          THEN round(((r->>'net_sales')::numeric - (r->'previous_period'->>'net_sales')::numeric) * 100 / (r->'previous_period'->>'net_sales')::numeric, 1) END);
  RETURN r;
END $$;

-- 2) أكتر الأصناف مبيعًا (كمية وقيمة) — من غير تكلفة
CREATE OR REPLACE FUNCTION public.ai_tool_top_products(_from date, _to date, _limit int DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE f date; t date; r jsonb;
BEGIN
  PERFORM public.ai_asst_require(ARRAY['general_manager','executive_manager','sales_manager']::public.app_role[]);
  SELECT d_from, d_to INTO f, t FROM public.ai_asst_range(_from, _to);
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'sales')::numeric DESC), '[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object('product', coalesce(p.name, oi.product_name), 'quantity', round(sum(oi.quantity)::numeric, 1),
                              'sales', round(sum(oi.total_price)), 'orders', count(DISTINCT o.order_id)) x
    FROM public.ai_asst_orders_v o JOIN public.order_items oi ON oi.order_id = o.order_id
    LEFT JOIN public.products p ON p.id = oi.product_id
    WHERE o.kpi_date BETWEEN f AND t AND NOT o.is_cancelled AND NOT coalesce(oi.is_gift, false)
      AND o.created_at >= (f - 1)::timestamp AND o.created_at < (t + 2)::timestamp
    GROUP BY coalesce(p.name, oi.product_name)
    ORDER BY sum(oi.total_price) DESC
    LIMIT least(greatest(coalesce(_limit, 5), 1), 15)) q;
  RETURN jsonb_build_object('period', jsonb_build_object('from', f, 'to', t), 'currency', 'EGP', 'products', r);
END $$;

-- 3) الإعلانات مقابل سقف 6% من صافي المبيعات
CREATE OR REPLACE FUNCTION public.ai_tool_ads_vs_cap(_from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE f date; t date; spend numeric; sales numeric; days_rec int; camp jsonb;
BEGIN
  PERFORM public.ai_asst_require(ARRAY['general_manager','executive_manager','sales_manager']::public.app_role[]);
  SELECT d_from, d_to INTO f, t FROM public.ai_asst_range(_from, _to);
  SELECT coalesce(sum(s.spend), 0), count(DISTINCT s.spend_date) INTO spend, days_rec
    FROM public.cm_ad_spend_daily s WHERE s.spend_date BETWEEN f AND t;
  SELECT coalesce(sum(o.total), 0) INTO sales FROM public.ai_asst_orders_v o
    WHERE o.kpi_date BETWEEN f AND t AND NOT o.is_cancelled AND o.created_at >= (f - 1)::timestamp AND o.created_at < (t + 2)::timestamp;
  SELECT coalesce(jsonb_agg(c ORDER BY (c->>'spend')::numeric DESC), '[]'::jsonb) INTO camp FROM (
    SELECT jsonb_build_object('campaign', cp.name, 'spend', round(sum(s.spend))) c
    FROM public.cm_ad_spend_daily s JOIN public.cm_campaigns cp ON cp.id = s.campaign_id
    WHERE s.spend_date BETWEEN f AND t GROUP BY cp.name HAVING sum(s.spend) > 0
    ORDER BY sum(s.spend) DESC LIMIT 5) q;
  RETURN jsonb_build_object('period', jsonb_build_object('from', f, 'to', t, 'days', t - f + 1), 'currency', 'EGP',
    'cap_pct', 6, 'spend', round(spend), 'net_sales', round(sales),
    'spend_pct_of_sales', CASE WHEN sales > 0 THEN round(spend * 100 / sales, 1) END,
    'under_cap', CASE WHEN sales > 0 THEN spend * 100 / sales <= 6 END,
    'days_with_spend_recorded', days_rec, 'top_campaigns', camp);
END $$;

-- 4) ترتيب المودريتورز (طلبات ومبيعات صافية)
CREATE OR REPLACE FUNCTION public.ai_tool_moderator_ranking(_from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE f date; t date; r jsonb;
BEGIN
  PERFORM public.ai_asst_require(ARRAY['general_manager','executive_manager','sales_manager']::public.app_role[]);
  SELECT d_from, d_to INTO f, t FROM public.ai_asst_range(_from, _to);
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'net_sales')::numeric DESC), '[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object('moderator', m.display_name,
      'orders', count(*) FILTER (WHERE NOT o.is_cancelled),
      'net_sales', round(coalesce(sum(o.total) FILTER (WHERE NOT o.is_cancelled), 0)),
      'cancelled', count(*) FILTER (WHERE o.is_cancelled)) x
    FROM public.ai_asst_orders_v o JOIN public.cm_moderators m ON m.id = o.moderator_id
    WHERE o.kpi_date BETWEEN f AND t AND o.created_at >= (f - 1)::timestamp AND o.created_at < (t + 2)::timestamp
    GROUP BY m.display_name) q;
  RETURN jsonb_build_object('period', jsonb_build_object('from', f, 'to', t), 'currency', 'EGP', 'ranking', r);
END $$;

-- 5) الطلبات المعلّقة أقدم من X ساعة (أرقام طلبات بس، من غير بيانات عملاء)
CREATE OR REPLACE FUNCTION public.ai_tool_pending_orders(_older_than_hours int DEFAULT 72, _as_of timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE h int := least(greatest(coalesce(_older_than_hours, 72), 1), 24 * 60);
        ref timestamptz := coalesce(_as_of, now()); r jsonb;
BEGIN
  PERFORM public.ai_asst_require(ARRAY['general_manager','executive_manager','sales_manager']::public.app_role[]);
  SELECT jsonb_build_object(
    'as_of', ref, 'older_than_hours', h,
    'count', count(*),
    'oldest_age_hours', round(max(extract(epoch FROM ref - o.created_at)) / 3600),
    'oldest_age_days', round(max(extract(epoch FROM ref - o.created_at)) / 86400, 1),
    'sample', coalesce((SELECT jsonb_agg(z) FROM (
        SELECT jsonb_build_object('order_number', o2.order_number, 'age_hours', round(extract(epoch FROM ref - o2.created_at) / 3600)) z
        FROM public.orders o2
        WHERE o2.status = 'pending' AND o2.created_at < ref - make_interval(hours => h) AND o2.created_at > ref - interval '60 days'
        ORDER BY o2.created_at LIMIT 10) s), '[]'::jsonb))
  INTO r FROM public.orders o
  WHERE o.status = 'pending' AND o.created_at < ref - make_interval(hours => h) AND o.created_at > ref - interval '60 days';
  RETURN r;
END $$;

-- 6) الأصناف النشطة اللي رصيدها صفر + الطلب المعلّق عليها (من غير تكلفة)
CREATE OR REPLACE FUNCTION public.ai_tool_zero_stock()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public.ai_asst_require(ARRAY['general_manager','executive_manager','sales_manager']::public.app_role[]);
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'pending_orders')::int DESC, x->>'product'), '[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object('product', p.name, 'stock', coalesce(p.stock, 0),
      'pending_orders', (SELECT count(DISTINCT oi.order_id) FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
                          WHERE oi.product_id = p.id AND o.status = 'pending'),
      'pending_quantity', (SELECT round(coalesce(sum(oi.quantity), 0)::numeric, 1) FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
                          WHERE oi.product_id = p.id AND o.status = 'pending')) x
    FROM public.products p WHERE p.is_active AND coalesce(p.stock, 0) <= 0) q;
  RETURN jsonb_build_object('as_of', now(), 'count', jsonb_array_length(r), 'products', r,
                            'note', 'الرصيد من products.stock (الرصيد الإجمالي)');
END $$;

-- 7) رصيد الخزنة الرئيسية — للتلات أدوار (قرار م. عمرو 28-11-2026)
-- استثناء وحيد: SECURITY DEFINER، لأن RLS جداول الخزنة مش بتسمح لمدير المبيعات، وم. عمرو قرر إنه يشوف الرصيد من المساعد.
-- الدور بيتفحص في أول سطر، والناتج أرصدة مجمعة بس (من غير حركات أو أسماء أشخاص غير اسم الحساب).
CREATE OR REPLACE FUNCTION public.ai_tool_treasury_balance()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public.ai_asst_require(ARRAY['general_manager','executive_manager','sales_manager']::public.app_role[]);
  SELECT jsonb_build_object('as_of', now(), 'currency', 'EGP',
    'total_balance', round(coalesce(sum(b.current_balance), 0)),
    'pending_amount', round(coalesce(sum(b.pending_amount), 0)),
    'pending_count', coalesce(sum(b.pending_count), 0),
    'accounts', coalesce(jsonb_agg(jsonb_build_object('account', b.name, 'type', b.account_type,
        'balance', round(b.current_balance), 'pending_count', b.pending_count) ORDER BY b.current_balance DESC), '[]'::jsonb))
  INTO r FROM public.v_main_treasury_balance b;
  RETURN r;
END $$;

-- 8) جودة المكالمات (أرقام مجمعة + أكتر الاعتراضات)
CREATE OR REPLACE FUNCTION public.ai_tool_calls_quality(_from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE f date; t date; r jsonb; obj jsonb;
BEGIN
  PERFORM public.ai_asst_require(ARRAY['general_manager','executive_manager','sales_manager']::public.app_role[]);
  SELECT d_from, d_to INTO f, t FROM public.ai_asst_range(_from, _to);
  SELECT jsonb_build_object(
    'inbound_answered', count(*) FILTER (WHERE c.direction = 'inbound' AND c.status = 'answered'),
    'inbound_missed', count(*) FILTER (WHERE c.direction = 'inbound' AND c.status = 'missed'),
    'analysed_calls', count(a.call_id) FILTER (WHERE a.status = 'done'),
    'avg_handling_score', round(avg(a.handling_score) FILTER (WHERE a.status = 'done'), 1),
    'orders_placed_or_promised', count(*) FILTER (WHERE a.status = 'done' AND a.order_placed_or_promised),
    'followups_needed', count(*) FILTER (WHERE a.status = 'done' AND a.followup_needed))
  INTO r FROM public.cm_calls c LEFT JOIN public.cm_call_analysis a ON a.call_id = c.id
  WHERE c.started_at >= (f - 1)::timestamp AND c.started_at < (t + 2)::timestamp AND public.cm_local_date(c.started_at) BETWEEN f AND t;
  SELECT coalesce(jsonb_agg(jsonb_build_object('objection', q.txt, 'count', q.n) ORDER BY q.n DESC), '[]'::jsonb) INTO obj FROM (
    SELECT ob.txt, count(*) n FROM public.cm_call_analysis a JOIN public.cm_calls c ON c.id = a.call_id, unnest(a.objections) ob(txt)
    WHERE a.status = 'done' AND c.started_at >= (f - 1)::timestamp AND c.started_at < (t + 2)::timestamp
      AND public.cm_local_date(c.started_at) BETWEEN f AND t
    GROUP BY 1 ORDER BY 2 DESC LIMIT 5) q;
  RETURN r || jsonb_build_object('period', jsonb_build_object('from', f, 'to', t), 'top_objections', obj);
END $$;

-- صلاحيات التنفيذ: المستخدمين المسجلين بس (والدور بيتفحص جوه كل دالة)
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.ai_asst_require(public.app_role[])', 'public.ai_asst_range(date, date)',
    'public.ai_tool_sales_summary(date, date)', 'public.ai_tool_top_products(date, date, int)',
    'public.ai_tool_ads_vs_cap(date, date)', 'public.ai_tool_moderator_ranking(date, date)',
    'public.ai_tool_pending_orders(int, timestamptz)', 'public.ai_tool_zero_stock()',
    'public.ai_tool_treasury_balance()', 'public.ai_tool_calls_quality(date, date)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;

-- ───── سجل المراجعة ─────
ALTER TABLE public.ai_assistant_query_log
  ADD COLUMN IF NOT EXISTS kind text,
  ADD COLUMN IF NOT EXISTS transcript text,
  ADD COLUMN IF NOT EXISTS answer text,
  ADD COLUMN IF NOT EXISTS tools jsonb,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS audio_seconds numeric(8,2),
  ADD COLUMN IF NOT EXISTS cost_usd numeric(10,6),
  ADD COLUMN IF NOT EXISTS latency_ms int;
CREATE INDEX IF NOT EXISTS idx_ai_log_kind_created ON public.ai_assistant_query_log(kind, created_at DESC);

-- القراءة: المدير العام بس (قرار 28-11-2026). الإدخال من الواجهة لنفس المستخدم بيفضل زي ما هو.
DROP POLICY IF EXISTS "users_read_own_ai_log" ON public.ai_assistant_query_log;
DROP POLICY IF EXISTS "managers_read_all_ai_log" ON public.ai_assistant_query_log;
DROP POLICY IF EXISTS "gm_read_ai_log" ON public.ai_assistant_query_log;
CREATE POLICY "gm_read_ai_log" ON public.ai_assistant_query_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'general_manager'::public.app_role));

-- الاحتفاظ 12 شهر
CREATE OR REPLACE FUNCTION public.ai_assistant_purge_logs()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  DELETE FROM public.ai_assistant_query_log WHERE created_at < now() - interval '12 months';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.ai_assistant_purge_logs() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ai-assistant-log-retention';
    PERFORM cron.schedule('ai-assistant-log-retention', '20 3 1 * *', 'SELECT public.ai_assistant_purge_logs()');
  END IF;
END $$;
