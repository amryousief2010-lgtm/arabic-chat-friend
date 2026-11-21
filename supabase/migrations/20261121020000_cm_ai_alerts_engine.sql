-- التنبيهات الاستباقية + التقرير الصباحي + تقييم المودريتورز من المكالمات (موافقة م. عمرو 21-11-2026، كارت t495s2213).
-- لم يُطبَّق على الإنتاج. يحتاج موافقة صريحة من م. عمرو قبل التطبيق.
-- المبادئ:
--   * المحرك يقرأ فقط من جداول التشغيل، ويكتب فقط في جداول cm_alert_* و cm_morning_reports (لا يلمس الطلبات ولا الإعلانات ولا cm_ad_attributions).
--   * كل «زرار تنفيذ» يسجّل طلب موافقة في cm_alert_actions فقط؛ لا شيء يُنفَّذ تلقائياً.
--   * لا أرقام هواتف في أي عنوان أو نص تنبيه (المعرّفات فقط داخل data).
--   * القراءة من الواجهة عبر دوال SECURITY DEFINER فقط، للمدير العام ومدير المبيعات (cm_ai_can_view).
--   * كل القواعد تبدأ shadow=true (أسبوع تشغيل في الخلفية): تتسجل ولا تظهر في الجرس، والمدير العام يراها في فلتر «تجريبي».
-- التراجع: راجع docs/ai-alerts/ROLLBACK.sql

-- ───────────── الجداول ─────────────
CREATE TABLE IF NOT EXISTS public.cm_alert_rules (
  code text PRIMARY KEY,
  category text NOT NULL CHECK (category IN ('ads','moderators')),
  name_ar text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('danger','warning','info')),
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  audience text[] NOT NULL,
  suggested_action text,
  cadence text NOT NULL CHECK (cadence IN ('daily','weekly','frequent','afternoon','late_morning')),
  enabled boolean NOT NULL DEFAULT true,
  shadow boolean NOT NULL DEFAULT true,
  notes text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cm_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_code text NOT NULL REFERENCES public.cm_alert_rules(code) ON DELETE CASCADE,
  severity text NOT NULL CHECK (severity IN ('danger','warning','info')),
  title text NOT NULL,
  body text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  moderator_id uuid REFERENCES public.cm_moderators(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES public.cm_campaigns(id) ON DELETE SET NULL,
  kpi_date date,
  dedupe_key text NOT NULL UNIQUE,
  audience text[] NOT NULL,
  shadow boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','seen','snoozed','resolved')),
  snoozed_until timestamptz,
  seen_by uuid, seen_at timestamptz,
  resolved_by uuid, resolved_at timestamptz, auto_resolved boolean NOT NULL DEFAULT false,
  ai_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cm_alerts_status_idx ON public.cm_alerts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS cm_alerts_rule_idx ON public.cm_alerts (rule_code, created_at DESC);

CREATE TABLE IF NOT EXISTS public.cm_alert_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES public.cm_alerts(id) ON DELETE CASCADE,
  action_text text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected')),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid, decided_at timestamptz, decision_note text
);
CREATE INDEX IF NOT EXISTS cm_alert_actions_alert_idx ON public.cm_alert_actions (alert_id);

CREATE TABLE IF NOT EXISTS public.cm_alert_runs (
  id bigserial PRIMARY KEY,
  cadence text NOT NULL,
  run_for date,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  emitted int NOT NULL DEFAULT 0,
  error text
);

CREATE TABLE IF NOT EXISTS public.cm_morning_reports (
  report_date date PRIMARY KEY,
  facts jsonb NOT NULL,
  report jsonb,                 -- ناتج الذكاء الاصطناعي {headline[], sections{}, decisions[], moderators[]}
  status text NOT NULL DEFAULT 'facts_only' CHECK (status IN ('facts_only','done','error')),
  model text, prompt_tokens int, completion_tokens int, cost_usd numeric(10,5),
  error text,
  generated_by text,            -- 'cron' أو معرّف المستخدم
  regen_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $g$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cm_alert_rules','cm_alerts','cm_alert_actions','cm_alert_runs','cm_morning_reports'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon', t); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE format('GRANT ALL ON public.%I TO service_role', t); END IF;
  END LOOP;
END $g$;
REVOKE ALL ON SEQUENCE public.cm_alert_runs_id_seq FROM PUBLIC;

-- ───────────── مساعدات ─────────────
-- من يرى الصفحة: المدير العام ومدير المبيعات فقط (بدون بوابة cm_gate عشان م. آلاء تشوفها).
CREATE OR REPLACE FUNCTION public.cm_ai_can_view()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND coalesce(public.has_any_role(auth.uid(), ARRAY['general_manager','sales_manager']::public.app_role[]), false)
$$;
CREATE OR REPLACE FUNCTION public.cm_ai_is_gm()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND coalesce(public.has_role(auth.uid(), 'general_manager'::public.app_role), false)
$$;
-- خدمة/كرون فقط (بدون مستخدم).
CREATE OR REPLACE FUNCTION public.cm_ai_is_service()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT auth.uid() IS NULL AND coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') NOT IN ('anon','authenticated')
$$;

-- توحيد الاسم العربي (أية = آية، ة = ه) لربط عمود orders.moderator المكتوب يدوياً.
CREATE OR REPLACE FUNCTION public.cm_ai_norm_ar(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT translate(btrim(coalesce(_t, '')), 'أإآة', 'اااه')
$$;

-- الطلبات مع المودريتور المستنتج (moderator_id أولاً، وإلا الاسم المكتوب).
CREATE OR REPLACE VIEW public.cm_ai_orders_v WITH (security_invoker = true) AS
  SELECT o.id AS order_id, o.created_at, o.updated_at, public.cm_local_date(o.created_at) AS kpi_date,
         o.status, (o.status = 'cancelled') AS is_cancelled, coalesce(o.total, 0) AS total,
         coalesce(o.moderator_id, mm.id) AS moderator_id
  FROM public.orders o
  LEFT JOIN LATERAL (
    SELECT m.id FROM public.cm_moderators m
    WHERE o.moderator_id IS NULL AND o.moderator IS NOT NULL
      AND (public.cm_ai_norm_ar(m.display_name) = public.cm_ai_norm_ar(o.moderator)
           OR public.cm_ai_norm_ar(m.canonical_name) = public.cm_ai_norm_ar(o.moderator))
    ORDER BY m.is_active DESC LIMIT 1
  ) mm ON true;
REVOKE ALL ON public.cm_ai_orders_v FROM PUBLIC;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.cm_ai_orders_v FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.cm_ai_orders_v FROM authenticated; END IF;
END $g$;

CREATE OR REPLACE FUNCTION public.cm_ai_p(_code text, _key text, _default numeric)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce((SELECT (params ->> _key)::numeric FROM public.cm_alert_rules WHERE code = _code), _default)
$$;

-- يسجّل تنبيه (أو يحدّث أرقامه لو لسه مفتوح). يرجع 1 لو جديد.
CREATE OR REPLACE FUNCTION public.cm_ai_emit(_code text, _key text, _title text, _body text, _data jsonb,
  _moderator uuid DEFAULT NULL, _campaign uuid DEFAULT NULL, _date date DEFAULT NULL, _severity text DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.cm_alert_rules; ins boolean;
BEGIN
  SELECT * INTO r FROM public.cm_alert_rules WHERE code = _code;
  IF NOT FOUND OR NOT r.enabled THEN RETURN 0; END IF;
  INSERT INTO public.cm_alerts AS a (rule_code, severity, title, body, data, moderator_id, campaign_id, kpi_date, dedupe_key, audience, shadow)
  VALUES (_code, coalesce(_severity, r.severity), _title, _body, coalesce(_data, '{}'::jsonb), _moderator, _campaign, _date, _key, r.audience, r.shadow)
  ON CONFLICT (dedupe_key) DO UPDATE
    SET body = EXCLUDED.body, data = EXCLUDED.data, severity = EXCLUDED.severity, title = EXCLUDED.title, updated_at = now()
    WHERE a.status <> 'resolved'
  RETURNING (xmax = 0) INTO ins;
  RETURN CASE WHEN coalesce(ins, false) THEN 1 ELSE 0 END;
END $$;

-- ───────────── القواعد (الـ 20 من صفحة التنبيهات) ─────────────
INSERT INTO public.cm_alert_rules (code, category, name_ar, severity, params, audience, suggested_action, cadence, enabled, notes) VALUES
 ('A1','ads','نسبة الإعلانات فوق السقف امبارح','danger','{"warn_pct":6,"danger_pct":10}','{general_manager,sales_manager}','جهّز خطة تخفيض الميزانية (بتعرض الحملات الأغلى، والتنفيذ بموافقة المدير العام)','daily',true,NULL),
 ('A2','ads','الشهر ماشي فوق السقف','warning','{"cap_pct":6}','{general_manager}','اعرض الحملات مرتبة بتكلفة الطلب','weekly',true,'جرس يوم السبت بس، والرقم في التقرير الصباحي كل يوم'),
 ('A3','ads','حملة صرفت من غير طلبات','warning','{"min_spend":700}','{general_manager,sales_manager}','اقترح إيقاف الحملة (الإيقاف يدوي على ميتا بموافقة المدير العام)','daily',true,NULL),
 ('A4','ads','تكلفة الطلب عالية 3 أيام','danger','{"min_spend":1500,"max_cpo":1000}','{general_manager}','قلّل الميزانية 30% (بموافقة المدير العام)','daily',true,NULL),
 ('A5','ads','حملة بتصرف ومش متتبعة','danger','{}','{general_manager}','اربط الحملة بخط (الحفظ بموافقة المدير العام)','daily',true,'جرس أول مرة، وبعدها تذكير في التقرير الصباحي'),
 ('A6','ads','تكلفة المحادثة قفزت','info','{"min_spend":300,"factor":2}','{sales_manager}','راجع الإعلان','daily',true,NULL),
 ('A7','ads','تحويل ضعيف من الحملة','warning','{"min_convs":60,"min_conv_pct":2}','{sales_manager}','اعرض عينة محادثات','daily',true,NULL),
 ('A8','ads','إعلان جديد مش مربوط بحملة','warning','{"min_convs":5}','{general_manager}','اربط الإعلان بحملته','daily',true,'تجميعة واحدة في اليوم'),
 ('A9','ads','صرف امبارح ماتسجلش','warning','{}','{general_manager}','سجّل صرف امبارح','late_morning',true,NULL),
 ('M1','moderators','عميل مستني رد أكتر من ساعة','info','{"minutes":60}','{moderator}','افتح المحادثة','frequent',false,'للمودريتور نفسها؛ متوقف لحد ما يتقرر صندوق المودريتورز (الصفحة الحالية للمدير العام ومدير المبيعات بس)'),
 ('M2','moderators','تراكم عند مودريتور','danger','{"warn_count":10,"danger_count":15,"wait_minutes":60}','{sales_manager,general_manager}','وزّع 5 محادثات على مودريتور فاضية (بموافقة م. آلاء)','frequent',true,NULL),
 ('M3','moderators','رد أول متأخر','warning','{"late_pct":25,"min_convs":20}','{sales_manager}','ابعت ملاحظة للمودريتور','daily',true,NULL),
 ('M4','moderators','محادثات متروكة','warning','{"abandoned_pct":15,"min_convs":20}','{sales_manager}','اعرض المحادثات المتروكة','daily',true,NULL),
 ('M5','moderators','مكالمات فايتة محتاجة رجوع','warning','{"after_minutes":60}','{sales_manager}','اتصل بالعميل، وعلّم إن المتابعة اتعملت','frequent',true,'قايمة واحدة لكل مودريتور في اليوم بتتحدث'),
 ('M6','moderators','نسبة فايت عالية في الخط الساخن','warning','{"min_calls":8,"missed_pct":50}','{sales_manager}','راجع جدول المودريتور','daily',true,NULL),
 ('M7','moderators','مفيش ولا طلب لحد 5 العصر','info','{}','{sales_manager}','افتح قايمة العملاء القدام للمتابعة','afternoon',true,NULL),
 ('M8','moderators','إلغاءات كتير','warning','{"min_cancels":4}','{sales_manager}','اعرض أسباب الإلغاء','daily',true,NULL),
 ('M9','moderators','طلبات معلقة أكتر من 72 ساعة','warning','{"hours":72}','{sales_manager}','تابع مع شركة الشحن','daily',true,NULL),
 ('M10','moderators','وقفة رد وقت الشغل','warning','{"silence_minutes":90,"min_waiting":3}','{sales_manager}','كلّم المودريتور','frequent',true,NULL),
 ('M11','moderators','الهدف الشهري متأخر','info','{"pace_pct":85}','{sales_manager,general_manager}','اعرض العملاء اللي ممكن يطلبوا','daily',true,'مبدئي: sales_targets بالجنيه، وأهداف نوفمبر لسه مش متسجلة')
ON CONFLICT (code) DO NOTHING;

-- ───────────── التقييم اليومي (10:00 الصبح بتوقيت الرياض) ─────────────
CREATE OR REPLACE FUNCTION public.cm_ai_run_daily(_d date DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d date := coalesce(_d, public.cm_local_date(now()) - 1);
        n int := 0; run_id bigint; rec record;
        spend numeric; sales numeric; pct numeric; mspend numeric; msales numeric; dim int; proj numeric;
BEGIN
  IF NOT (public.cm_ai_is_service() OR public.cm_ai_is_gm()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO public.cm_alert_runs (cadence, run_for) VALUES ('daily', d) RETURNING id INTO run_id;

  -- A1
  SELECT coalesce(sum(s.spend),0) INTO spend FROM public.cm_ad_spend_daily s WHERE s.spend_date = d;
  SELECT coalesce(sum(o.total),0) INTO sales FROM public.cm_ai_orders_v o WHERE o.kpi_date = d AND NOT o.is_cancelled;
  IF spend > 0 THEN
    pct := CASE WHEN sales > 0 THEN round(spend * 100 / sales, 1) END;
    IF pct IS NULL OR pct > public.cm_ai_p('A1','warn_pct',6) THEN
      n := n + public.cm_ai_emit('A1', 'A1:'||d,
        'الإعلانات '||coalesce(pct::text||'%','بدون مبيعات')||' من مبيعات '||to_char(d,'DD/MM'),
        'صرف '||round(spend)||' جنيه مقابل مبيعات '||round(sales)||' جنيه. السقف '||public.cm_ai_p('A1','warn_pct',6)||'%.',
        jsonb_build_object('spend',spend,'sales',sales,'pct',pct), NULL, NULL, d,
        CASE WHEN pct IS NULL OR pct > public.cm_ai_p('A1','danger_pct',10) THEN 'danger' ELSE 'warning' END);
    END IF;
  END IF;

  -- A2 (السبت بس)
  IF extract(isodow FROM d + 1) = 6 THEN
    SELECT coalesce(sum(s.spend),0) INTO mspend FROM public.cm_ad_spend_daily s WHERE s.spend_date BETWEEN date_trunc('month', d)::date AND d;
    SELECT coalesce(sum(o.total),0) INTO msales FROM public.cm_ai_orders_v o WHERE o.kpi_date BETWEEN date_trunc('month', d)::date AND d AND NOT o.is_cancelled;
    dim := extract(day FROM (date_trunc('month', d) + interval '1 month - 1 day'))::int;
    IF msales > 0 AND mspend * 100 / msales > public.cm_ai_p('A2','cap_pct',6) THEN
      proj := round(mspend / extract(day FROM d) * dim);
      n := n + public.cm_ai_emit('A2', 'A2:'||d, 'الشهر ماشي على '||round(mspend*100/msales,1)||'% إعلانات',
        'صرف الشهر '||round(mspend)||' جنيه من مبيعات '||round(msales)||' جنيه. لو المعدل فضل كده، صرف آخر الشهر حوالي '||proj||' جنيه.',
        jsonb_build_object('mtd_spend',mspend,'mtd_sales',msales,'projected_spend',proj), NULL, NULL, d);
    END IF;
  END IF;

  -- إحصاءات الحملات (امبارح وآخر 3 أيام وآخر 7 أيام قبل امبارح)
  FOR rec IN
    WITH sp AS (
      SELECT s.campaign_id,
             sum(s.spend) FILTER (WHERE s.spend_date = d) AS sp1,
             sum(s.spend) FILTER (WHERE s.spend_date BETWEEN d-2 AND d) AS sp3,
             sum(s.spend) FILTER (WHERE s.spend_date BETWEEN d-7 AND d-1) AS sp7
      FROM public.cm_ad_spend_daily s WHERE s.spend_date BETWEEN d-7 AND d AND s.campaign_id IS NOT NULL GROUP BY 1),
    cv AS (
      SELECT c.campaign_id,
             count(*) FILTER (WHERE public.cm_local_date(c.first_inbound_at) = d) AS c1,
             count(*) FILTER (WHERE public.cm_local_date(c.first_inbound_at) BETWEEN d-2 AND d) AS c3,
             count(*) FILTER (WHERE public.cm_local_date(c.first_inbound_at) BETWEEN d-7 AND d-1) AS c7
      FROM public.cm_conversations c
      WHERE c.campaign_id IS NOT NULL AND c.first_inbound_at >= (d - 9)::timestamp AND coalesce(c.is_demo,false) = false GROUP BY 1),
    od AS (
      SELECT k.campaign_id,
             count(*) FILTER (WHERE k.kpi_date = d) AS o1,
             count(*) FILTER (WHERE k.kpi_date BETWEEN d-2 AND d) AS o3
      FROM public.cm_kpi_orders_v k WHERE k.kpi_date BETWEEN d-2 AND d AND k.campaign_id IS NOT NULL AND NOT coalesce(k.is_cancelled,false) GROUP BY 1)
    SELECT cp.id, cp.name, coalesce(sp.sp1,0) sp1, coalesce(sp.sp3,0) sp3, coalesce(sp.sp7,0) sp7,
           coalesce(cv.c1,0) c1, coalesce(cv.c3,0) c3, coalesce(cv.c7,0) c7, coalesce(od.o1,0) o1, coalesce(od.o3,0) o3,
           EXISTS (SELECT 1 FROM public.cm_campaign_line_map m WHERE m.campaign_id = cp.id
                   AND (m.valid_from IS NULL OR m.valid_from <= d) AND (m.valid_to IS NULL OR m.valid_to >= d)) AS mapped
    FROM sp JOIN public.cm_campaigns cp ON cp.id = sp.campaign_id
    LEFT JOIN cv ON cv.campaign_id = sp.campaign_id LEFT JOIN od ON od.campaign_id = sp.campaign_id
  LOOP
    -- A3
    IF rec.mapped AND rec.sp1 >= public.cm_ai_p('A3','min_spend',700) AND rec.o1 = 0 THEN
      n := n + public.cm_ai_emit('A3', 'A3:'||rec.id||':'||d, 'حملة «'||rec.name||'» صرفت '||round(rec.sp1)||' جنيه من غير طلبات',
        'صفر طلبات غير ملغية منسوبة للحملة يوم '||to_char(d,'DD/MM')||'.', jsonb_build_object('spend',rec.sp1,'conversations',rec.c1), NULL, rec.id, d);
    END IF;
    -- A4
    IF rec.sp3 >= public.cm_ai_p('A4','min_spend',1500) AND (rec.o3 = 0 OR rec.sp3 / rec.o3 > public.cm_ai_p('A4','max_cpo',1000)) THEN
      n := n + public.cm_ai_emit('A4', 'A4:'||rec.id||':'||d, 'تكلفة الطلب في «'||rec.name||'» '||CASE WHEN rec.o3 = 0 THEN 'بدون طلبات' ELSE round(rec.sp3/rec.o3)||' جنيه' END||' آخر 3 أيام',
        'صرف '||round(rec.sp3)||' جنيه و'||rec.o3||' طلب في آخر 3 أيام. الحد '||public.cm_ai_p('A4','max_cpo',1000)||' جنيه للطلب.',
        jsonb_build_object('spend3',rec.sp3,'orders3',rec.o3), NULL, rec.id, d);
    END IF;
    -- A5 (جرس أول مرة بس: المفتاح من غير تاريخ)
    IF rec.sp1 > 0 AND rec.c1 = 0 AND NOT rec.mapped THEN
      n := n + public.cm_ai_emit('A5', 'A5:'||rec.id, 'حملة «'||rec.name||'» بتصرف ومش متتبعة',
        'صرفت '||round(rec.sp1)||' جنيه يوم '||to_char(d,'DD/MM')||' من غير ولا محادثة منسوبة ومالهاش ربط بخط.',
        jsonb_build_object('spend',rec.sp1,'last_seen',d), NULL, rec.id, d);
    END IF;
    -- A6
    IF rec.sp1 >= public.cm_ai_p('A6','min_spend',300) AND rec.c1 > 0 AND rec.c7 > 0 AND rec.sp7 > 0
       AND (rec.sp1 / rec.c1) > public.cm_ai_p('A6','factor',2) * (rec.sp7 / rec.c7) THEN
      n := n + public.cm_ai_emit('A6', 'A6:'||rec.id||':'||d, 'تكلفة المحادثة في «'||rec.name||'» قفزت لـ '||round(rec.sp1/rec.c1)||' جنيه',
        'متوسط الأسبوع اللي قبلها '||round(rec.sp7/rec.c7)||' جنيه للمحادثة.', jsonb_build_object('cpc',round(rec.sp1/rec.c1,2),'cpc7',round(rec.sp7/rec.c7,2)), NULL, rec.id, d);
    END IF;
    -- A7
    IF rec.c3 >= public.cm_ai_p('A7','min_convs',60) AND rec.o3 * 100.0 / rec.c3 < public.cm_ai_p('A7','min_conv_pct',2) THEN
      n := n + public.cm_ai_emit('A7', 'A7:'||rec.id||':'||d, 'تحويل «'||rec.name||'» '||round(rec.o3*100.0/rec.c3,1)||'% آخر 3 أيام',
        rec.o3||' طلب من '||rec.c3||' محادثة. المتوسط حوالي 3%.', jsonb_build_object('orders3',rec.o3,'convs3',rec.c3), NULL, rec.id, d);
    END IF;
  END LOOP;

  -- A8: إعلانات تلقائية جديدة جابت محادثات
  FOR rec IN
    SELECT cp.id, cp.name, count(c.id) AS convs
    FROM public.cm_campaigns cp JOIN public.cm_conversations c ON c.campaign_id = cp.id
    WHERE cp.product_tag = 'AUTO_AD' AND public.cm_local_date(cp.created_at) = d AND coalesce(c.is_demo,false) = false
    GROUP BY 1,2 HAVING count(c.id) >= public.cm_ai_p('A8','min_convs',5)
  LOOP
    n := n + public.cm_ai_emit('A8', 'A8:'||rec.id, 'إعلان جديد «'||rec.name||'» جاب '||rec.convs||' محادثة من غير حملة',
      'اتسجل تلقائي يوم '||to_char(d,'DD/MM')||'.', jsonb_build_object('conversations',rec.convs), NULL, rec.id, d);
  END LOOP;

  -- M3 / M4: أول رد متأخر والمتروك
  FOR rec IN
    SELECT k.moderator_id, m.display_name, count(*) AS convs,
           count(*) FILTER (WHERE k.first_reply_status = 'late') AS late,
           count(*) FILTER (WHERE k.is_abandoned) AS abandoned
    FROM public.cm_kpi_conversations_v k JOIN public.cm_moderators m ON m.id = k.moderator_id
    WHERE k.kpi_date = d GROUP BY 1,2
  LOOP
    IF rec.convs >= public.cm_ai_p('M3','min_convs',20) AND rec.late * 100.0 / rec.convs > public.cm_ai_p('M3','late_pct',25) THEN
      n := n + public.cm_ai_emit('M3', 'M3:'||rec.moderator_id||':'||d, rec.display_name||': '||round(rec.late*100.0/rec.convs)||'% أول رد متأخر',
        rec.late||' من '||rec.convs||' محادثة يوم '||to_char(d,'DD/MM')||'.', jsonb_build_object('late',rec.late,'convs',rec.convs), rec.moderator_id, NULL, d);
    END IF;
    IF rec.convs >= public.cm_ai_p('M4','min_convs',20) AND rec.abandoned * 100.0 / rec.convs > public.cm_ai_p('M4','abandoned_pct',15) THEN
      n := n + public.cm_ai_emit('M4', 'M4:'||rec.moderator_id||':'||d, rec.display_name||': '||round(rec.abandoned*100.0/rec.convs)||'% محادثات متروكة',
        rec.abandoned||' من '||rec.convs||' محادثة ماتردّش عليها في 30 دقيقة.', jsonb_build_object('abandoned',rec.abandoned,'convs',rec.convs), rec.moderator_id, NULL, d);
    END IF;
  END LOOP;

  -- M6: نسبة الفايت في الخط الساخن
  FOR rec IN
    SELECT c.moderator_id, m.display_name, count(*) AS calls, count(*) FILTER (WHERE c.status = 'missed') AS missed
    FROM public.cm_calls c JOIN public.cm_moderators m ON m.id = c.moderator_id
    WHERE c.direction = 'inbound' AND c.started_at >= (d - 1)::timestamp AND c.started_at < (d + 2)::timestamp AND public.cm_local_date(c.started_at) = d
    GROUP BY 1,2
  LOOP
    IF rec.calls >= public.cm_ai_p('M6','min_calls',8) AND rec.missed * 100.0 / rec.calls > public.cm_ai_p('M6','missed_pct',50) THEN
      n := n + public.cm_ai_emit('M6', 'M6:'||rec.moderator_id||':'||d, rec.display_name||': فاتها '||round(rec.missed*100.0/rec.calls)||'% من المكالمات',
        rec.missed||' فايتة من '||rec.calls||' مكالمة يوم '||to_char(d,'DD/MM')||'.', jsonb_build_object('missed',rec.missed,'calls',rec.calls), rec.moderator_id, NULL, d);
    END IF;
  END LOOP;

  -- M8: إلغاءات
  FOR rec IN
    SELECT o.moderator_id, m.display_name, count(*) AS n
    FROM public.cm_ai_orders_v o JOIN public.cm_moderators m ON m.id = o.moderator_id
    WHERE o.is_cancelled AND o.updated_at >= (d - 1)::timestamp AND public.cm_local_date(o.updated_at) = d GROUP BY 1,2
    HAVING count(*) >= public.cm_ai_p('M8','min_cancels',4)
  LOOP
    n := n + public.cm_ai_emit('M8', 'M8:'||rec.moderator_id||':'||d, rec.display_name||': '||rec.n||' طلبات اتلغت',
      'يوم '||to_char(d,'DD/MM')||'.', jsonb_build_object('cancelled',rec.n), rec.moderator_id, NULL, d);
  END LOOP;

  -- M9: معلق أكتر من 72 ساعة (قايمة لكل مودريتور)
  FOR rec IN
    SELECT o.moderator_id, coalesce(m.display_name,'بدون مودريتور') AS display_name, count(*) AS n,
           count(*) FILTER (WHERE o.created_at < now() - interval '7 days') AS n7,
           (array_agg(o.order_id ORDER BY o.created_at))[1:30] AS ids
    FROM public.cm_ai_orders_v o LEFT JOIN public.cm_moderators m ON m.id = o.moderator_id
    WHERE o.status = 'pending' AND o.created_at < now() - make_interval(hours => public.cm_ai_p('M9','hours',72)::int)
      AND o.created_at > now() - interval '60 days'
    GROUP BY 1,2
  LOOP
    n := n + public.cm_ai_emit('M9', 'M9:'||coalesce(rec.moderator_id::text,'none')||':'||(d+1), rec.display_name||': '||rec.n||' طلب معلق أكتر من 72 ساعة',
      rec.n7||' منهم أكتر من 7 أيام.', jsonb_build_object('count',rec.n,'over7d',rec.n7,'order_ids',to_jsonb(rec.ids)), rec.moderator_id, NULL, d + 1);
  END LOOP;

  -- قايمة M9 الجديدة بتقفل قايمة امبارح لنفس المودريتور (عشان مايتكررش الجرس كل يوم لنفس الطلبات).
  UPDATE public.cm_alerts SET status = 'resolved', resolved_at = now(), auto_resolved = true, updated_at = now()
  WHERE rule_code = 'M9' AND status <> 'resolved' AND kpi_date < d + 1;

  -- M11: الهدف الشهري (sales_targets بالجنيه، للمودريتورز المربوطين بحساب بس)
  FOR rec IN
    SELECT m.id, m.display_name, t.target_amount,
           (SELECT coalesce(sum(o.total),0) FROM public.cm_ai_orders_v o
             WHERE o.moderator_id = m.id AND NOT o.is_cancelled AND o.kpi_date BETWEEN date_trunc('month', d)::date AND d) AS achieved,
           extract(day FROM d)::numeric / extract(day FROM (date_trunc('month', d) + interval '1 month - 1 day')) AS frac
    FROM public.cm_moderators m JOIN public.sales_targets t ON t.user_id = m.user_id
      AND t.month = extract(month FROM d)::int AND t.year = extract(year FROM d)::int
    WHERE m.is_active AND t.target_amount > 0
  LOOP
    IF rec.achieved < rec.target_amount * rec.frac * public.cm_ai_p('M11','pace_pct',85) / 100 THEN
      n := n + public.cm_ai_emit('M11', 'M11:'||rec.id||':'||d, rec.display_name||': '||round(rec.achieved*100/(rec.target_amount*rec.frac))||'% من المفروض لحد النهارده',
        'المحقق '||round(rec.achieved)||' جنيه، والمفروض '||round(rec.target_amount*rec.frac)||' جنيه من هدف '||round(rec.target_amount)||'.',
        jsonb_build_object('achieved',rec.achieved,'expected',round(rec.target_amount*rec.frac),'target',rec.target_amount), rec.id, NULL, d);
    END IF;
  END LOOP;

  UPDATE public.cm_alert_runs SET finished_at = now(), emitted = n WHERE id = run_id;
  RETURN n;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.cm_alert_runs SET finished_at = now(), error = left(SQLERRM, 500) WHERE id = run_id;
  RAISE;
END $$;

-- ───────────── كل 15 دقيقة: التراكم (M2)، المكالمات الفايتة (M5)، الوقفات (M10) ─────────────
CREATE OR REPLACE FUNCTION public.cm_ai_run_frequent()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int := 0; run_id bigint; rec record; today date := public.cm_local_date(now());
        h int := extract(hour FROM (now() AT TIME ZONE 'Asia/Riyadh'))::int;
        wait_min int := public.cm_ai_p('M2','wait_minutes',60)::int;
        over uuid[] := '{}';
BEGIN
  IF NOT (public.cm_ai_is_service() OR public.cm_ai_is_gm()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO public.cm_alert_runs (cadence, run_for) VALUES ('frequent', today) RETURNING id INTO run_id;

  -- العملاء المستنيين: آخر رسالة من العميل من ساعة لـ 12 ساعة، ومش رسالة قصيرة لوحدها (زي «شكراً»).
  CREATE TEMP TABLE IF NOT EXISTS _cm_ai_waiting (moderator_id uuid, conversation_id uuid, since timestamptz) ON COMMIT DROP;
  TRUNCATE _cm_ai_waiting;
  INSERT INTO _cm_ai_waiting
  SELECT coalesce(c.assigned_moderator_id, c.owner_moderator_id, l.owner_moderator_id), c.id, c.last_inbound_at
  FROM public.cm_conversations c LEFT JOIN public.cm_lines l ON l.id = c.line_id
  WHERE c.last_inbound_at > now() - interval '12 hours' AND c.last_inbound_at < now() - make_interval(mins => wait_min)
    AND (c.last_outbound_at IS NULL OR c.last_outbound_at < c.last_inbound_at)
    AND coalesce(c.is_demo,false) = false AND coalesce(c.status,'') <> 'closed'
    AND NOT EXISTS (
      SELECT 1 FROM LATERAL (SELECT m.body, m.direction FROM public.cm_messages m WHERE m.conversation_id = c.id ORDER BY m.sent_at DESC LIMIT 2) x
      GROUP BY () HAVING count(*) FILTER (WHERE x.direction = 'in') = 1 AND max(length(btrim(x.body))) FILTER (WHERE x.direction = 'in') <= 12);

  -- M2: بين 10 الصبح و2 بالليل بتوقيت الرياض
  IF h >= 10 OR h < 2 THEN
    FOR rec IN
      SELECT w.moderator_id, m.display_name, count(*) AS waiting
      FROM _cm_ai_waiting w JOIN public.cm_moderators m ON m.id = w.moderator_id
      GROUP BY 1,2 HAVING count(*) >= public.cm_ai_p('M2','warn_count',10)
    LOOP
      over := over || rec.moderator_id;
      IF NOT EXISTS (SELECT 1 FROM public.cm_alerts a WHERE a.rule_code = 'M2' AND a.moderator_id = rec.moderator_id AND a.status <> 'resolved') THEN
        n := n + public.cm_ai_emit('M2', 'M2:'||rec.moderator_id||':'||to_char(now(),'YYYYMMDDHH24MI'),
          rec.display_name||': '||rec.waiting||' عميل مستنيين أكتر من ساعة',
          'التنبيه بيتقفل لوحده لما العدد ينزل تحت الحد.', jsonb_build_object('waiting',rec.waiting), rec.moderator_id, NULL, today,
          CASE WHEN rec.waiting >= public.cm_ai_p('M2','danger_count',15) THEN 'danger' ELSE 'warning' END);
      ELSE
        UPDATE public.cm_alerts SET data = jsonb_build_object('waiting',rec.waiting), title = rec.display_name||': '||rec.waiting||' عميل مستنيين أكتر من ساعة',
               severity = CASE WHEN rec.waiting >= public.cm_ai_p('M2','danger_count',15) THEN 'danger' ELSE 'warning' END, updated_at = now()
        WHERE rule_code = 'M2' AND moderator_id = rec.moderator_id AND status <> 'resolved';
      END IF;
    END LOOP;
  END IF;
  UPDATE public.cm_alerts SET status = 'resolved', resolved_at = now(), auto_resolved = true, updated_at = now()
  WHERE rule_code = 'M2' AND status <> 'resolved' AND NOT (moderator_id = ANY (over));

  -- M10: خط المودريتور ساكت 90 دقيقة وعندها 3 مستنيين أو أكتر (12 الضهر لـ 12 بالليل بتوقيت الرياض)
  IF h >= 12 THEN
    FOR rec IN
      WITH lastout AS (
        SELECT l.owner_moderator_id AS moderator_id, max(c.last_outbound_at) AS last_out
        FROM public.cm_lines l JOIN public.cm_conversations c ON c.line_id = l.id
        WHERE l.owner_moderator_id IS NOT NULL AND c.last_inbound_at > now() - interval '12 hours'
        GROUP BY 1)
      SELECT lo.moderator_id, m.display_name, lo.last_out, (SELECT count(*) FROM _cm_ai_waiting w WHERE w.moderator_id = lo.moderator_id) AS waiting
      FROM lastout lo JOIN public.cm_moderators m ON m.id = lo.moderator_id
      WHERE (lo.last_out IS NULL OR lo.last_out < now() - make_interval(mins => public.cm_ai_p('M10','silence_minutes',90)::int))
    LOOP
      IF rec.waiting >= public.cm_ai_p('M10','min_waiting',3) THEN
        n := n + public.cm_ai_emit('M10', 'M10:'||rec.moderator_id||':'||coalesce(to_char(rec.last_out,'YYYYMMDDHH24MI'),today::text),
          rec.display_name||': مفيش رد من الخط من '||coalesce(to_char(rec.last_out AT TIME ZONE 'Asia/Riyadh','HH24:MI'),'الصبح')||' (بتوقيت الرياض)',
          rec.waiting||' عملاء مستنيين.', jsonb_build_object('waiting',rec.waiting,'last_outbound_at',rec.last_out), rec.moderator_id, NULL, today);
      END IF;
    END LOOP;
  END IF;

  -- M5: مكالمات فايتة النهارده عدّت عليها ساعة ومفيش مكالمة متردّ عليها من نفس الرقم (قايمة لكل مودريتور، من غير أرقام في النص)
  FOR rec IN
    SELECT k.moderator_id, coalesce(m.display_name,'بدون مودريتور') AS display_name, count(*) AS n,
           (array_agg(k.call_id ORDER BY k.started_at DESC))[1:50] AS ids
    FROM public.cm_kpi_missed_calls_v k LEFT JOIN public.cm_moderators m ON m.id = k.moderator_id
    WHERE k.kpi_date = today AND NOT coalesce(k.ivr_abandoned,false)
      AND k.started_at < now() - make_interval(mins => public.cm_ai_p('M5','after_minutes',60)::int)
      AND k.followup_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.cm_calls a WHERE a.phone_norm = k.phone_norm AND a.status = 'answered'
                      AND a.started_at BETWEEN k.started_at - interval '2 hours' AND k.started_at + interval '1 hour')
    GROUP BY 1,2
  LOOP
    n := n + public.cm_ai_emit('M5', 'M5:'||coalesce(rec.moderator_id::text,'none')||':'||today,
      rec.display_name||': '||rec.n||' مكالمة فايتة محتاجة رجوع', 'بيتحدث كل ربع ساعة.',
      jsonb_build_object('count',rec.n,'call_ids',to_jsonb(rec.ids)), rec.moderator_id, NULL, today);
  END LOOP;

  UPDATE public.cm_alerts SET status = 'resolved', resolved_at = now(), auto_resolved = true, updated_at = now()
  WHERE rule_code = 'M5' AND status <> 'resolved' AND kpi_date < today;

  UPDATE public.cm_alert_runs SET finished_at = now(), emitted = n WHERE id = run_id;
  RETURN n;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.cm_alert_runs SET finished_at = now(), error = left(SQLERRM, 500) WHERE id = run_id;
  RAISE;
END $$;

-- ───────────── 11:30 الصبح بتوقيت الرياض: صرف امبارح اتسجل؟ (A9) ─────────────
CREATE OR REPLACE FUNCTION public.cm_ai_run_spend_check()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d date := public.cm_local_date(now()) - 1;
BEGIN
  IF NOT (public.cm_ai_is_service() OR public.cm_ai_is_gm()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF EXISTS (SELECT 1 FROM public.cm_ad_spend_daily WHERE spend_date = d) THEN RETURN 0; END IF;
  RETURN public.cm_ai_emit('A9', 'A9:'||d, 'صرف إعلانات '||to_char(d,'DD/MM')||' ماتسجلش لحد دلوقتي',
    'الصرف بيتسجل عادة بين 9:26 و9:42 الصبح بتوقيت الرياض.', jsonb_build_object('spend_date', d), NULL, NULL, d);
END $$;

-- ───────────── 5 العصر بتوقيت الرياض: مفيش ولا طلب (M7) ─────────────
CREATE OR REPLACE FUNCTION public.cm_ai_run_afternoon()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int := 0; rec record; today date := public.cm_local_date(now()); has_roster boolean;
BEGIN
  IF NOT (public.cm_ai_is_service() OR public.cm_ai_is_gm()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  has_roster := EXISTS (SELECT 1 FROM public.cm_shift_assignments WHERE work_date = today);
  FOR rec IN
    SELECT m.id, m.display_name FROM public.cm_moderators m
    WHERE m.is_active AND (m.start_date IS NULL OR m.start_date <= today) AND (m.end_date IS NULL OR m.end_date >= today)
      AND (NOT has_roster OR EXISTS (SELECT 1 FROM public.cm_shift_assignments s WHERE s.work_date = today AND s.moderator_id = m.id))
      AND NOT EXISTS (SELECT 1 FROM public.cm_ai_orders_v o WHERE o.moderator_id = m.id AND o.kpi_date = today AND o.created_at > now() - interval '1 day')
  LOOP
    n := n + public.cm_ai_emit('M7', 'M7:'||rec.id||':'||today, rec.display_name||': مفيش ولا طلب لحد 5 العصر',
      CASE WHEN has_roster THEN 'في شيفت النهارده.' ELSE 'جدول الشيفتات مش متحدث، فممكن تكون إجازة.' END,
      jsonb_build_object('roster', has_roster), rec.id, NULL, today);
  END LOOP;
  RETURN n;
END $$;

-- ───────────── تقييم المودريتورز من المكالمات المحللة ─────────────
CREATE OR REPLACE FUNCTION public.cm_ai_moderator_eval(_from date, _to date)
RETURNS TABLE (moderator_id uuid, display_name text, analysed_calls bigint, avg_score numeric, score_dist jsonb,
               sales_inquiries bigint, orders_won bigint, win_pct numeric, outcomes jsonb, followups bigint,
               top_objections jsonb, recent_notes jsonb, avg_call_sec numeric, small_sample boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.cm_ai_can_view() OR public.cm_ai_is_service()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  WITH base AS (
    SELECT c.moderator_id AS mid, a.* FROM public.cm_call_analysis a JOIN public.cm_calls c ON c.id = a.call_id
    WHERE a.status = 'done' AND c.moderator_id IS NOT NULL
      AND c.started_at >= (SELECT lo FROM public.cm_kpi_ts_bounds(_from, _to)) AND c.started_at < (SELECT hi FROM public.cm_kpi_ts_bounds(_from, _to))
      AND public.cm_local_date(c.started_at) BETWEEN _from AND _to),
  obj AS (
    SELECT o.mid, jsonb_agg(jsonb_build_object('text', o.t, 'n', o.cnt) ORDER BY o.cnt DESC) AS j FROM (
      SELECT b2.mid, x.t, count(*) AS cnt, row_number() OVER (PARTITION BY b2.mid ORDER BY count(*) DESC) AS rn
      FROM base b2, unnest(b2.objections) x(t) GROUP BY 1,2) o
    WHERE o.rn <= 5 GROUP BY 1),
  notes AS (
    SELECT n.mid, jsonb_agg(jsonb_build_object('score', n.handling_score, 'outcome', n.outcome, 'note', left(n.handling_notes, 300)) ORDER BY n.analyzed_at DESC) AS j
    FROM (SELECT b3.*, row_number() OVER (PARTITION BY b3.mid ORDER BY b3.analyzed_at DESC) rn FROM base b3 WHERE b3.handling_notes IS NOT NULL) n
    WHERE n.rn <= 5 GROUP BY 1),
  oc AS (SELECT b4.mid, jsonb_object_agg(b4.outcome, b4.n) AS j FROM (SELECT mid, coalesce(outcome,'other') outcome, count(*) n FROM base GROUP BY 1,2) b4 GROUP BY 1),
  sd AS (SELECT b5.mid, jsonb_object_agg(b5.s::text, b5.n) AS j FROM (SELECT mid, handling_score s, count(*) n FROM base WHERE handling_score IS NOT NULL GROUP BY 1,2) b5 GROUP BY 1)
  SELECT m.id, m.display_name, count(b.call_id), round(avg(b.handling_score), 2), coalesce(sd.j, '{}'::jsonb),
         count(*) FILTER (WHERE b.is_sales_inquiry), count(*) FILTER (WHERE b.order_placed_or_promised),
         CASE WHEN count(*) FILTER (WHERE b.is_sales_inquiry) > 0
              THEN round(100.0 * count(*) FILTER (WHERE b.order_placed_or_promised AND b.is_sales_inquiry) / count(*) FILTER (WHERE b.is_sales_inquiry), 1) END,
         coalesce(oc.j, '{}'::jsonb), count(*) FILTER (WHERE b.followup_needed),
         coalesce(obj.j, '[]'::jsonb), coalesce(notes.j, '[]'::jsonb), round(avg(b.audio_seconds), 0), count(b.call_id) < 5
  FROM base b JOIN public.cm_moderators m ON m.id = b.mid
  LEFT JOIN obj ON obj.mid = b.mid LEFT JOIN notes ON notes.mid = b.mid LEFT JOIN oc ON oc.mid = b.mid LEFT JOIN sd ON sd.mid = b.mid
  GROUP BY m.id, m.display_name, m.sort_order, sd.j, oc.j, obj.j, notes.j
  ORDER BY m.sort_order;
END $$;

-- ───────────── حقائق التقرير الصباحي (أرقام فقط، من غير ذكاء اصطناعي) ─────────────
CREATE OR REPLACE FUNCTION public.cm_ai_morning_facts(_d date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE d date := coalesce(_d, public.cm_local_date(now()) - 1);
        m0 date := date_trunc('month', d)::date; r jsonb := '{}'::jsonb; x jsonb;
        spend numeric; sales numeric; mspend numeric; msales numeric; dim int;
BEGIN
  IF NOT (public.cm_ai_can_view() OR public.cm_ai_is_service()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  dim := extract(day FROM (date_trunc('month', d) + interval '1 month - 1 day'))::int;
  r := r || jsonb_build_object('date', d, 'currency', 'EGP', 'ads_cap_pct', 6, 'day_of_month', extract(day FROM d)::int, 'days_in_month', dim);

  -- المبيعات
  SELECT jsonb_build_object(
    'orders', count(*) FILTER (WHERE o.kpi_date = d AND NOT o.is_cancelled),
    'net_sales', round(coalesce(sum(o.total) FILTER (WHERE o.kpi_date = d AND NOT o.is_cancelled),0)),
    'cancelled', count(*) FILTER (WHERE o.kpi_date = d AND o.is_cancelled),
    'avg7_orders', round(count(*) FILTER (WHERE o.kpi_date BETWEEN d-7 AND d-1 AND NOT o.is_cancelled) / 7.0, 1),
    'avg7_net_sales', round(coalesce(sum(o.total) FILTER (WHERE o.kpi_date BETWEEN d-7 AND d-1 AND NOT o.is_cancelled),0) / 7.0),
    'mtd_net_sales', round(coalesce(sum(o.total) FILTER (WHERE o.kpi_date BETWEEN m0 AND d AND NOT o.is_cancelled),0)),
    'mtd_orders', count(*) FILTER (WHERE o.kpi_date BETWEEN m0 AND d AND NOT o.is_cancelled))
  INTO x FROM public.cm_ai_orders_v o WHERE o.created_at >= (least(m0, d-7) - 1)::timestamp;
  r := r || jsonb_build_object('sales', x);
  sales := (x->>'net_sales')::numeric; msales := (x->>'mtd_net_sales')::numeric;

  -- الإعلانات
  SELECT coalesce(sum(s.spend) FILTER (WHERE s.spend_date = d),0), coalesce(sum(s.spend) FILTER (WHERE s.spend_date BETWEEN m0 AND d),0)
  INTO spend, mspend FROM public.cm_ad_spend_daily s WHERE s.spend_date BETWEEN m0 AND d;
  r := r || jsonb_build_object('ads', jsonb_build_object(
    'spend_recorded', EXISTS (SELECT 1 FROM public.cm_ad_spend_daily WHERE spend_date = d),
    'spend', round(spend), 'pct', CASE WHEN sales > 0 THEN round(spend*100/sales,1) END,
    'mtd_spend', round(mspend), 'mtd_pct', CASE WHEN msales > 0 THEN round(mspend*100/msales,1) END,
    'campaigns_3d', (
      SELECT coalesce(jsonb_agg(c ORDER BY (c->>'spend')::numeric DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('name', cp.name, 'spend', round(sum(s.spend)),
               'orders', (SELECT count(*) FROM public.cm_kpi_orders_v k WHERE k.campaign_id = cp.id AND k.kpi_date BETWEEN d-2 AND d AND NOT coalesce(k.is_cancelled,false)),
               'conversations', (SELECT count(*) FROM public.cm_conversations cv WHERE cv.campaign_id = cp.id AND cv.first_inbound_at >= (d-3)::timestamp AND public.cm_local_date(cv.first_inbound_at) BETWEEN d-2 AND d),
               'tracked', EXISTS (SELECT 1 FROM public.cm_campaign_line_map mm WHERE mm.campaign_id = cp.id AND (mm.valid_to IS NULL OR mm.valid_to >= d-2))) AS c
        FROM public.cm_ad_spend_daily s JOIN public.cm_campaigns cp ON cp.id = s.campaign_id
        WHERE s.spend_date BETWEEN d-2 AND d GROUP BY cp.id, cp.name HAVING sum(s.spend) > 0) q)));

  -- المودريتورز امبارح
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', m.display_name,
      'conversations', (SELECT count(*) FROM public.cm_kpi_conversations_v k WHERE k.moderator_id = m.id AND k.kpi_date = d),
      'late_first_reply', (SELECT count(*) FROM public.cm_kpi_conversations_v k WHERE k.moderator_id = m.id AND k.kpi_date = d AND k.first_reply_status = 'late'),
      'abandoned', (SELECT count(*) FROM public.cm_kpi_conversations_v k WHERE k.moderator_id = m.id AND k.kpi_date = d AND k.is_abandoned),
      'orders', (SELECT count(*) FROM public.cm_ai_orders_v o WHERE o.moderator_id = m.id AND o.kpi_date = d AND NOT o.is_cancelled AND o.created_at >= (d-1)::timestamp),
      'cancelled', (SELECT count(*) FROM public.cm_ai_orders_v o WHERE o.moderator_id = m.id AND o.kpi_date = d AND o.is_cancelled AND o.created_at >= (d-1)::timestamp),
      'mtd_net_sales', (SELECT round(coalesce(sum(o.total),0)) FROM public.cm_ai_orders_v o WHERE o.moderator_id = m.id AND o.kpi_date BETWEEN m0 AND d AND NOT o.is_cancelled AND o.created_at >= (m0-1)::timestamp),
      'calls_answered', (SELECT count(*) FROM public.cm_calls c WHERE c.moderator_id = m.id AND c.direction = 'inbound' AND c.status = 'answered' AND c.started_at >= (d-1)::timestamp AND public.cm_local_date(c.started_at) = d),
      'calls_missed', (SELECT count(*) FROM public.cm_calls c WHERE c.moderator_id = m.id AND c.direction = 'inbound' AND c.status = 'missed' AND c.started_at >= (d-1)::timestamp AND public.cm_local_date(c.started_at) = d),
      'pending_over_72h', (SELECT count(*) FROM public.cm_ai_orders_v o WHERE o.moderator_id = m.id AND o.status = 'pending' AND o.created_at < now() - interval '72 hours' AND o.created_at > now() - interval '60 days'),
      'target', (SELECT t.target_amount FROM public.sales_targets t WHERE m.user_id IS NOT NULL AND t.user_id = m.user_id AND t.month = extract(month FROM d)::int AND t.year = extract(year FROM d)::int LIMIT 1)
    ) ORDER BY m.sort_order), '[]'::jsonb)
  INTO x FROM public.cm_moderators m WHERE m.is_active;
  r := r || jsonb_build_object('moderators', x);

  -- تقييم المكالمات آخر 7 أيام (من cm_call_analysis)
  SELECT coalesce(jsonb_agg(jsonb_build_object('name', e.display_name, 'analysed_calls', e.analysed_calls, 'avg_score', e.avg_score,
           'win_pct', e.win_pct, 'followups', e.followups, 'top_objections', e.top_objections,
           'notes', (SELECT coalesce(jsonb_agg(left(n->>'note', 200)), '[]'::jsonb) FROM (SELECT jsonb_array_elements(e.recent_notes) n LIMIT 3) z),
           'small_sample', e.small_sample)), '[]'::jsonb)
  INTO x FROM public.cm_ai_moderator_eval(d - 6, d) e;
  r := r || jsonb_build_object('call_eval_7d', x);
  SELECT coalesce(jsonb_agg(jsonb_build_object('text', t, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO x FROM (
    SELECT o.t, count(*) n FROM public.cm_call_analysis a JOIN public.cm_calls c ON c.id = a.call_id, unnest(a.objections) o(t)
    WHERE a.status = 'done' AND c.started_at >= (d - 7)::timestamp AND public.cm_local_date(c.started_at) BETWEEN d-6 AND d
    GROUP BY 1 ORDER BY 2 DESC LIMIT 8) q;
  r := r || jsonb_build_object('top_objections_7d', x);

  -- المتابعات المفتوحة
  r := r || jsonb_build_object('followups', jsonb_build_object(
    'pending_over_72h', (SELECT count(*) FROM public.orders o WHERE o.status = 'pending' AND o.created_at < now() - interval '72 hours' AND o.created_at > now() - interval '60 days'),
    'pending_over_7d', (SELECT count(*) FROM public.orders o WHERE o.status = 'pending' AND o.created_at < now() - interval '7 days' AND o.created_at > now() - interval '60 days'),
    'missed_calls_no_callback', (SELECT count(*) FROM public.cm_kpi_missed_calls_v k WHERE k.kpi_date = d AND NOT coalesce(k.ivr_abandoned,false) AND k.followup_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.cm_calls a WHERE a.phone_norm = k.phone_norm AND a.status = 'answered' AND a.started_at BETWEEN k.started_at - interval '2 hours' AND k.started_at + interval '1 hour')),
    'call_followups_needed_7d', (SELECT count(*) FROM public.cm_call_analysis a JOIN public.cm_calls c ON c.id = a.call_id WHERE a.followup_needed AND c.started_at >= (d - 7)::timestamp)));

  -- التنبيهات المفتوحة (للشرح في نفس طلب الذكاء الاصطناعي)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'rule', a.rule_code, 'severity', a.severity, 'title', a.title, 'body', a.body) ORDER BY a.severity, a.created_at DESC), '[]'::jsonb)
  INTO x FROM (SELECT * FROM public.cm_alerts WHERE status IN ('open','seen') AND created_at > now() - interval '36 hours' AND severity IN ('danger','warning') ORDER BY created_at DESC LIMIT 15) a;
  r := r || jsonb_build_object('open_alerts', x);
  RETURN r;
END $$;

-- ───────────── دوال الواجهة ─────────────
CREATE OR REPLACE FUNCTION public.cm_ai_alerts_list(_scope text DEFAULT 'active', _limit int DEFAULT 200)
RETURNS TABLE (id uuid, rule_code text, rule_name text, category text, severity text, title text, body text, ai_note text,
               status text, shadow boolean, moderator_name text, campaign_name text, kpi_date date, suggested_action text,
               action_status text, created_at timestamptz, updated_at timestamptz, data jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE gm boolean := public.cm_ai_is_gm();
BEGIN
  IF NOT public.cm_ai_can_view() THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  SELECT a.id, a.rule_code, r.name_ar, r.category, a.severity, a.title, a.body, a.ai_note, a.status, a.shadow,
         m.display_name, c.name, a.kpi_date, r.suggested_action,
         (SELECT x.status FROM public.cm_alert_actions x WHERE x.alert_id = a.id ORDER BY x.requested_at DESC LIMIT 1),
         a.created_at, a.updated_at, a.data - 'order_ids' - 'call_ids'
  FROM public.cm_alerts a JOIN public.cm_alert_rules r ON r.code = a.rule_code
  LEFT JOIN public.cm_moderators m ON m.id = a.moderator_id LEFT JOIN public.cm_campaigns c ON c.id = a.campaign_id
  WHERE (gm OR 'sales_manager' = ANY (a.audience))
    AND (gm OR NOT a.shadow)
    AND CASE _scope
          WHEN 'active' THEN a.status IN ('open','seen') OR (a.status = 'snoozed' AND a.snoozed_until <= now())
          WHEN 'shadow' THEN a.shadow
          WHEN 'resolved' THEN a.status = 'resolved'
          ELSE true END
    AND (_scope = 'shadow' OR NOT a.shadow OR _scope = 'all')
  ORDER BY CASE a.severity WHEN 'danger' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, a.created_at DESC
  LIMIT least(greatest(coalesce(_limit,200),1),500);
END $$;

CREATE OR REPLACE FUNCTION public.cm_ai_alerts_unread()
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN NOT public.cm_ai_can_view() THEN 0 ELSE (
    SELECT count(*)::int FROM public.cm_alerts a
    WHERE NOT a.shadow AND (a.status = 'open' OR (a.status = 'snoozed' AND a.snoozed_until <= now()))
      AND ((public.cm_ai_is_gm() AND 'general_manager' = ANY (a.audience))
           OR (public.has_role(auth.uid(), 'sales_manager'::public.app_role) AND 'sales_manager' = ANY (a.audience)))) END
$$;

CREATE OR REPLACE FUNCTION public.cm_ai_alert_update(_id uuid, _op text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.cm_ai_can_view() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT public.cm_ai_is_gm() AND NOT EXISTS (SELECT 1 FROM public.cm_alerts WHERE id = _id AND 'sales_manager' = ANY (audience)) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _op = 'seen' THEN
    UPDATE public.cm_alerts SET status = 'seen', seen_by = auth.uid(), seen_at = now(), updated_at = now() WHERE id = _id AND status IN ('open','snoozed');
  ELSIF _op = 'snooze' THEN
    UPDATE public.cm_alerts SET status = 'snoozed', snoozed_until = now() + interval '1 hour', updated_at = now() WHERE id = _id AND status <> 'resolved';
  ELSIF _op = 'resolve' THEN
    UPDATE public.cm_alerts SET status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), updated_at = now() WHERE id = _id;
  ELSE RAISE EXCEPTION 'bad op';
  END IF;
END $$;

-- «الزرار المقترح»: بيسجّل طلب موافقة بس. مفيش أي تنفيذ تلقائي.
CREATE OR REPLACE FUNCTION public.cm_ai_alert_request_action(_id uuid, _note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE aid uuid; act text;
BEGIN
  IF NOT public.cm_ai_can_view() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT r.suggested_action INTO act FROM public.cm_alerts a JOIN public.cm_alert_rules r ON r.code = a.rule_code
  WHERE a.id = _id AND (public.cm_ai_is_gm() OR 'sales_manager' = ANY (a.audience));
  IF act IS NULL THEN RAISE EXCEPTION 'not found'; END IF;
  INSERT INTO public.cm_alert_actions (alert_id, action_text, note, requested_by) VALUES (_id, act, left(_note, 1000), auth.uid()) RETURNING id INTO aid;
  UPDATE public.cm_alerts SET status = CASE WHEN status = 'open' THEN 'seen' ELSE status END, seen_by = coalesce(seen_by, auth.uid()), seen_at = coalesce(seen_at, now()), updated_at = now() WHERE id = _id;
  RETURN aid;
END $$;

-- موافقة/رفض المدير العام على الطلب (تسجيل القرار فقط؛ التنفيذ يدوي).
CREATE OR REPLACE FUNCTION public.cm_ai_action_decide(_action_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.cm_ai_is_gm() THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.cm_alert_actions SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
         decided_by = auth.uid(), decided_at = now(), decision_note = left(_note, 1000)
  WHERE id = _action_id AND status = 'requested';
END $$;

CREATE OR REPLACE FUNCTION public.cm_ai_actions_list(_limit int DEFAULT 50)
RETURNS TABLE (id uuid, alert_id uuid, alert_title text, action_text text, note text, status text, requested_at timestamptz, decided_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.cm_ai_can_view() THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY SELECT x.id, x.alert_id, a.title, x.action_text, x.note, x.status, x.requested_at, x.decided_at
  FROM public.cm_alert_actions x JOIN public.cm_alerts a ON a.id = x.alert_id
  WHERE public.cm_ai_is_gm() OR x.requested_by = auth.uid()
  ORDER BY (x.status = 'requested') DESC, x.requested_at DESC LIMIT least(greatest(coalesce(_limit,50),1),200);
END $$;

CREATE OR REPLACE FUNCTION public.cm_ai_rules_list()
RETURNS SETOF public.cm_alert_rules LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.cm_ai_can_view() THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY SELECT * FROM public.cm_alert_rules ORDER BY category, length(code), code;
END $$;

-- تعديل القاعدة (تشغيل/إيقاف، تجريبي، الحدود): المدير العام بس.
CREATE OR REPLACE FUNCTION public.cm_ai_rule_update(_code text, _enabled boolean DEFAULT NULL, _shadow boolean DEFAULT NULL, _params jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.cm_ai_is_gm() THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.cm_alert_rules SET enabled = coalesce(_enabled, enabled), shadow = coalesce(_shadow, shadow),
         params = CASE WHEN _params IS NULL THEN params ELSE params || _params END, updated_by = auth.uid(), updated_at = now()
  WHERE code = _code;
  IF _shadow IS NOT NULL THEN UPDATE public.cm_alerts SET shadow = _shadow WHERE rule_code = _code AND status <> 'resolved'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cm_ai_morning_report_get(_d date DEFAULT NULL)
RETURNS SETOF public.cm_morning_reports LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.cm_ai_can_view() THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY SELECT * FROM public.cm_morning_reports WHERE (_d IS NULL OR report_date = _d) ORDER BY report_date DESC LIMIT 1;
END $$;

CREATE OR REPLACE FUNCTION public.cm_ai_morning_report_dates(_limit int DEFAULT 30)
RETURNS TABLE (report_date date, status text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.cm_ai_can_view() THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY SELECT r.report_date, r.status FROM public.cm_morning_reports r ORDER BY r.report_date DESC LIMIT least(greatest(coalesce(_limit,30),1),120);
END $$;

-- ───────────── الصلاحيات ─────────────
DO $g$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'cm_ai_can_view()','cm_ai_is_gm()','cm_ai_alerts_list(text,int)','cm_ai_alerts_unread()','cm_ai_alert_update(uuid,text)',
    'cm_ai_alert_request_action(uuid,text)','cm_ai_action_decide(uuid,boolean,text)','cm_ai_actions_list(int)','cm_ai_rules_list()',
    'cm_ai_rule_update(text,boolean,boolean,jsonb)','cm_ai_morning_report_get(date)','cm_ai_morning_report_dates(int)',
    'cm_ai_moderator_eval(date,date)','cm_ai_morning_facts(date)','cm_ai_run_daily(date)','cm_ai_run_frequent()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f); END IF;
  END LOOP;
  -- داخلية: خدمة/كرون بس
  FOREACH f IN ARRAY ARRAY['cm_ai_emit(text,text,text,text,jsonb,uuid,uuid,date,text)','cm_ai_run_spend_check()','cm_ai_run_afternoon()','cm_ai_is_service()','cm_ai_p(text,text,numeric)','cm_ai_norm_ar(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f); END IF;
  END LOOP;
END $g$;
