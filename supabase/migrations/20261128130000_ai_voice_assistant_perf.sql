-- سرعة أدوات المساعد الصوتي على بيانات الإنتاج (28-11-2026)
-- 1) ai_asst_orders_v: ربط اسم المودريتور القديم بقى hash join على جدول أسماء مُطبَّعة بدل LATERAL لكل أوردر
--    (ملخص المبيعات كان بياخد 7–18 ثانية على الإنتاج).
--    + kpi_date بيتحسب بالمنطقة الزمنية مرة واحدة بدل cm_local_date() لكل صف (الدالة مش inlinable وبتقرا cm_kpi_settings بـRLS كل مرة).
-- 2) ai_tool_zero_stock: تجميع الأوردرات المعلقة مرة واحدة بدل subquery لكل صنف.
-- 3) ai_tool_calls_quality: نفس فكرة المنطقة الزمنية (كانت 10 ثواني على 92 يوم).
-- مفيش تغيير في الصلاحيات ولا في شكل النتيجة.

CREATE OR REPLACE VIEW public.ai_asst_orders_v WITH (security_invoker = true) AS
SELECT o.id AS order_id, o.created_at, (o.created_at AT TIME ZONE z.tz)::date AS kpi_date, o.status,
       (o.status = 'cancelled') AS is_cancelled, coalesce(o.total, 0) AS total,
       coalesce(o.moderator_id, mm.id) AS moderator_id
FROM public.orders o
CROSS JOIN (SELECT coalesce((SELECT k.timezone FROM public.cm_kpi_settings k WHERE k.id = 1), 'Africa/Cairo') AS tz) z
LEFT JOIN (
  SELECT DISTINCT ON (s.k) s.k, s.id
  FROM (
    SELECT m.id, m.is_active, translate(btrim(coalesce(m.display_name, '')), 'أإآة', 'اااه') AS k FROM public.cm_moderators m
    UNION ALL
    SELECT m.id, m.is_active, translate(btrim(coalesce(m.canonical_name, '')), 'أإآة', 'اااه') FROM public.cm_moderators m
  ) s
  WHERE s.k <> ''
  ORDER BY s.k, s.is_active DESC
) mm ON o.moderator_id IS NULL AND o.moderator IS NOT NULL
     AND mm.k = translate(btrim(coalesce(o.moderator, '')), 'أإآة', 'اااه');
REVOKE ALL ON public.ai_asst_orders_v FROM PUBLIC, anon;
GRANT SELECT ON public.ai_asst_orders_v TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ai_tool_zero_stock()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public.ai_asst_require(ARRAY['general_manager','executive_manager','sales_manager']::public.app_role[]);
  WITH pend AS (
    SELECT oi.product_id, count(DISTINCT oi.order_id) AS orders, round(coalesce(sum(oi.quantity), 0)::numeric, 1) AS qty
    FROM public.orders o JOIN public.order_items oi ON oi.order_id = o.id
    WHERE o.status = 'pending' AND oi.product_id IS NOT NULL
    GROUP BY oi.product_id)
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'pending_orders')::int DESC, x->>'product'), '[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object('product', p.name, 'stock', coalesce(p.stock, 0),
      'pending_orders', coalesce(pd.orders, 0), 'pending_quantity', coalesce(pd.qty, 0)) x
    FROM public.products p LEFT JOIN pend pd ON pd.product_id = p.id
    WHERE p.is_active AND coalesce(p.stock, 0) <= 0) q;
  RETURN jsonb_build_object('as_of', now(), 'count', jsonb_array_length(r), 'products', r,
                            'note', 'الرصيد من products.stock (الرصيد الإجمالي)');
END $$;
REVOKE ALL ON FUNCTION public.ai_tool_zero_stock() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_tool_zero_stock() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ai_tool_calls_quality(_from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE f date; t date; r jsonb; obj jsonb; tz text;
BEGIN
  PERFORM public.ai_asst_require(ARRAY['general_manager','executive_manager','sales_manager']::public.app_role[]);
  SELECT d_from, d_to INTO f, t FROM public.ai_asst_range(_from, _to);
  tz := coalesce((SELECT k.timezone FROM public.cm_kpi_settings k WHERE k.id = 1), 'Africa/Cairo');
  SELECT jsonb_build_object(
    'inbound_answered', count(*) FILTER (WHERE c.direction = 'inbound' AND c.status = 'answered'),
    'inbound_missed', count(*) FILTER (WHERE c.direction = 'inbound' AND c.status = 'missed'),
    'analysed_calls', count(a.call_id) FILTER (WHERE a.status = 'done'),
    'avg_handling_score', round(avg(a.handling_score) FILTER (WHERE a.status = 'done'), 1),
    'orders_placed_or_promised', count(*) FILTER (WHERE a.status = 'done' AND a.order_placed_or_promised),
    'followups_needed', count(*) FILTER (WHERE a.status = 'done' AND a.followup_needed))
  INTO r FROM public.cm_calls c LEFT JOIN public.cm_call_analysis a ON a.call_id = c.id
  WHERE c.started_at >= (f - 1)::timestamp AND c.started_at < (t + 2)::timestamp AND (c.started_at AT TIME ZONE tz)::date BETWEEN f AND t;
  SELECT coalesce(jsonb_agg(jsonb_build_object('objection', q.txt, 'count', q.n) ORDER BY q.n DESC), '[]'::jsonb) INTO obj FROM (
    SELECT ob.txt, count(*) n FROM public.cm_call_analysis a JOIN public.cm_calls c ON c.id = a.call_id, unnest(a.objections) ob(txt)
    WHERE a.status = 'done' AND c.started_at >= (f - 1)::timestamp AND c.started_at < (t + 2)::timestamp
      AND (c.started_at AT TIME ZONE tz)::date BETWEEN f AND t
    GROUP BY 1 ORDER BY 2 DESC LIMIT 5) q;
  RETURN r || jsonb_build_object('period', jsonb_build_object('from', f, 'to', t), 'top_objections', obj);
END $$;
REVOKE ALL ON FUNCTION public.ai_tool_calls_quality(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_tool_calls_quality(date, date) TO authenticated, service_role;
