-- مكالمات الخط الساخن — إظهار رقم العميل (مع سجل تدقيق) + فلترة من الخادم. طلب م. عمرو 28-10-2026.
-- السبب: الصفحة كانت تعرض الرقم مقنّعاً دائماً بلا أي وسيلة لإظهاره (للفائتة خصوصاً لا يوجد تحليل يعرض شيئاً).
-- 1) cm_phone_reveal_log + cm_reveal_call_phone(_call_id): لمن يملك صلاحية الاستماع (GM/EM/SM)، كل إظهار يُسجَّل.
-- 2) cm_calls_search / cm_calls_search_summary: فلترة بالموظفة/نوع التحليل/الحالة/التاريخ، والرقم يرجع مقنّعاً فقط.
-- التراجع: DROP FUNCTION cm_calls_search, cm_calls_search_summary, cm_reveal_call_phone, cm_calls_filter_ids; DROP TABLE cm_phone_reveal_log;
CREATE TABLE IF NOT EXISTS public.cm_phone_reveal_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.cm_calls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  revealed_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS cm_phone_reveal_log_idx ON public.cm_phone_reveal_log (call_id, revealed_at DESC);
ALTER TABLE public.cm_phone_reveal_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cm_gm_read ON public.cm_phone_reveal_log;
CREATE POLICY cm_gm_read ON public.cm_phone_reveal_log FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['general_manager']::public.app_role[]));

CREATE OR REPLACE FUNCTION public.cm_reveal_call_phone(_call_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.cm_can_listen_recordings() OR NOT public.cm_gate_allows() THEN
    RAISE EXCEPTION 'CM_NOT_ALLOWED' USING ERRCODE = '42501'; END IF;
  SELECT phone_norm INTO v FROM public.cm_calls WHERE id = _call_id;
  IF v IS NULL THEN RAISE EXCEPTION 'CM_NO_PHONE'; END IF;
  INSERT INTO public.cm_phone_reveal_log (call_id, user_id) VALUES (_call_id, auth.uid());
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.cm_reveal_call_phone(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_reveal_call_phone(uuid) TO authenticated;

-- الفئة: answered / missed (مبيعات فائتة) / ivr (انقطعت في القائمة الصوتية) / non_sales
CREATE OR REPLACE FUNCTION public.cm_call_category(c public.cm_calls)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN NOT c.is_sales THEN 'non_sales'
    WHEN c.direction = 'inbound' AND upper(coalesce(c.call_result,'')) = 'ANSWERED' AND coalesce(jsonb_array_length(c.switch_attempts),0) = 0 THEN 'ivr'
    WHEN c.status = 'missed' THEN 'missed' WHEN c.status = 'answered' THEN 'answered' ELSE c.status END
$$;

-- المكالمات المطابقة (SECURITY INVOKER: RLS على cm_calls/cm_call_analysis تسري)
-- _moderator: uuid نصاً أو 'none'؛ _outcome: قيمة outcome أو 'followup_needed' أو 'not_analyzed'؛ _category كما أعلاه.
CREATE OR REPLACE FUNCTION public.cm_calls_filter_ids(_from date, _to date, _moderator text, _outcome text, _category text)
RETURNS TABLE (id uuid) LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT c.id FROM public.cm_calls c LEFT JOIN public.cm_call_analysis a ON a.call_id = c.id
  WHERE (_from IS NULL OR public.cm_local_date(c.started_at) >= _from) AND (_to IS NULL OR public.cm_local_date(c.started_at) <= _to)
    AND (_moderator IS NULL OR (_moderator = 'none' AND c.moderator_id IS NULL) OR c.moderator_id::text = _moderator)
    AND (_outcome IS NULL
         OR (_outcome = 'not_analyzed' AND (a.call_id IS NULL OR a.status <> 'done'))
         OR (_outcome = 'followup_needed' AND a.status = 'done' AND a.followup_needed)
         OR (a.status = 'done' AND a.outcome = _outcome))
    AND (_category IS NULL OR public.cm_call_category(c) = _category)
$$;

CREATE OR REPLACE FUNCTION public.cm_calls_search(_from date DEFAULT NULL, _to date DEFAULT NULL, _moderator text DEFAULT NULL,
  _outcome text DEFAULT NULL, _category text DEFAULT NULL, _limit int DEFAULT 100, _offset int DEFAULT 0)
RETURNS TABLE (id uuid, external_call_id text, direction text, started_at timestamptz, duration_sec int, status text, phone_masked text,
  has_phone boolean, moderator_id uuid, recording_path text, followed_up_at timestamptz, is_sales boolean, category text)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT c.id, c.external_call_id, c.direction, c.started_at, c.duration_sec::int, c.status,
    CASE WHEN c.phone_norm IS NULL THEN NULL WHEN length(c.phone_norm) <= 5 THEN c.phone_norm
      ELSE left(c.phone_norm,3) || repeat('•', length(c.phone_norm)-6) || right(c.phone_norm,3) END,
    c.phone_norm IS NOT NULL, c.moderator_id, c.recording_path, c.followed_up_at, c.is_sales, public.cm_call_category(c)
  FROM public.cm_calls c WHERE c.id IN (SELECT f.id FROM public.cm_calls_filter_ids(_from,_to,_moderator,_outcome,_category) f)
  ORDER BY c.started_at DESC, c.id LIMIT least(greatest(coalesce(_limit,100),1),500) OFFSET greatest(coalesce(_offset,0),0)
$$;

CREATE OR REPLACE FUNCTION public.cm_calls_search_summary(_from date DEFAULT NULL, _to date DEFAULT NULL, _moderator text DEFAULT NULL,
  _outcome text DEFAULT NULL, _category text DEFAULT NULL)
RETURNS TABLE (calls bigint, analyzed bigint, avg_score numeric, order_pct numeric, open_followups bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT count(*), count(*) FILTER (WHERE a.status='done'),
    round(avg(a.handling_score) FILTER (WHERE a.status='done'), 2),
    round(100.0 * count(*) FILTER (WHERE a.status='done' AND a.order_placed_or_promised) / nullif(count(*) FILTER (WHERE a.status='done'),0), 1),
    count(*) FILTER (WHERE a.status='done' AND a.followup_needed AND c.followed_up_at IS NULL)
  FROM public.cm_calls c LEFT JOIN public.cm_call_analysis a ON a.call_id = c.id
  WHERE c.id IN (SELECT f.id FROM public.cm_calls_filter_ids(_from,_to,_moderator,_outcome,_category) f)
$$;
REVOKE ALL ON FUNCTION public.cm_calls_filter_ids(date,date,text,text,text), public.cm_calls_search(date,date,text,text,text,int,int),
  public.cm_calls_search_summary(date,date,text,text,text), public.cm_call_category(public.cm_calls) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_calls_filter_ids(date,date,text,text,text), public.cm_calls_search(date,date,text,text,text,int,int),
  public.cm_calls_search_summary(date,date,text,text,text), public.cm_call_category(public.cm_calls) TO authenticated;
