-- التراجع الكامل عن التنبيهات والتقرير الصباحي (بالترتيب).
SELECT cron.unschedule(j) FROM unnest(ARRAY['cm-ai-alerts-frequent','cm-ai-alerts-daily','cm-ai-morning-report','cm-ai-spend-check','cm-ai-alerts-afternoon']) j
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = j);
DROP FUNCTION IF EXISTS private.cm_ai_invoke_morning_report();
DROP FUNCTION IF EXISTS public.cm_ai_alerts_list(text,int), public.cm_ai_alerts_unread(), public.cm_ai_alert_update(uuid,text),
  public.cm_ai_alert_request_action(uuid,text), public.cm_ai_action_decide(uuid,boolean,text), public.cm_ai_actions_list(int),
  public.cm_ai_rules_list(), public.cm_ai_rule_update(text,boolean,boolean,jsonb), public.cm_ai_morning_report_get(date),
  public.cm_ai_morning_report_dates(int), public.cm_ai_morning_facts(date), public.cm_ai_moderator_eval(date,date),
  public.cm_ai_run_daily(date), public.cm_ai_run_frequent(), public.cm_ai_run_spend_check(), public.cm_ai_run_afternoon(),
  public.cm_ai_emit(text,text,text,text,jsonb,uuid,uuid,date,text), public.cm_ai_p(text,text,numeric);
DROP VIEW IF EXISTS public.cm_ai_orders_v;
DROP FUNCTION IF EXISTS public.cm_ai_norm_ar(text), public.cm_ai_can_view(), public.cm_ai_is_gm(), public.cm_ai_is_service();
DROP TABLE IF EXISTS public.cm_alert_actions, public.cm_alerts, public.cm_alert_runs, public.cm_morning_reports, public.cm_alert_rules;
