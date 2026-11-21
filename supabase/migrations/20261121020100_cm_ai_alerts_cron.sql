-- جدولة التنبيهات والتقرير الصباحي (pg_cron). لم يُطبَّق على الإنتاج؛ يُطبَّق بعد 20261121020000 وبعد موافقة م. عمرو.
-- الأوقات بتوقيت UTC (الرياض = UTC+3):
--   كل 15 دقيقة      → cm_ai_run_frequent()        (M2 التراكم، M5 المكالمات الفايتة، M10 الوقفات)
--   07:00 UTC (10:00) → cm_ai_run_daily()           (A1–A8، M3، M4، M6، M8، M9، M11) بعد تسجيل صرف امبارح
--   07:10 UTC (10:10) → private.cm_ai_invoke_morning_report() → Edge Function cm-morning-report (طلب ذكاء اصطناعي واحد في اليوم)
--   08:30 UTC (11:30) → cm_ai_run_spend_check()     (A9)
--   14:00 UTC (17:00) → cm_ai_run_afternoon()       (M7)
-- كل مهمة: statement_timeout 20 ثانية و lock_timeout ثانية واحدة. المحرك بيكتب في cm_alerts / cm_alert_runs بس.
-- قبل التطبيق: أضف سر الـ vault «cm_ai_cron_secret» (نفس قيمة CM_AI_CRON_SECRET في أسرار Edge Functions). project_url و project_anon_key موجودين بالفعل.
-- التراجع: SELECT cron.unschedule(j) FROM unnest(ARRAY['cm-ai-alerts-frequent','cm-ai-alerts-daily','cm-ai-morning-report','cm-ai-spend-check','cm-ai-alerts-afternoon']) j;
--          DROP FUNCTION private.cm_ai_invoke_morning_report();

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.cm_ai_invoke_morning_report()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE s text; u text; k text; rid bigint; h jsonb;
BEGIN
  SELECT decrypted_secret INTO s FROM vault.decrypted_secrets WHERE name = 'cm_ai_cron_secret' LIMIT 1;
  IF s IS NULL OR btrim(s) = '' THEN RETURN jsonb_build_object('skipped', true, 'reason', 'missing_cm_ai_cron_secret'); END IF;
  SELECT decrypted_secret INTO u FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
  IF u IS NULL OR btrim(u) = '' THEN RETURN jsonb_build_object('skipped', true, 'reason', 'missing_project_url'); END IF;
  SELECT decrypted_secret INTO k FROM vault.decrypted_secrets WHERE name = 'project_anon_key' LIMIT 1;
  h := jsonb_build_object('Content-Type', 'application/json', 'x-cm-ai-cron-secret', s);
  IF k IS NOT NULL AND btrim(k) <> '' THEN h := h || jsonb_build_object('apikey', k); END IF;
  rid := net.http_post(url := rtrim(btrim(u), '/') || '/functions/v1/cm-morning-report', headers := h,
                       body := jsonb_build_object('source', 'cron'), timeout_milliseconds := 120000);
  RETURN jsonb_build_object('ok', true, 'request_id', rid);
END $$;
REVOKE ALL ON FUNCTION private.cm_ai_invoke_morning_report() FROM PUBLIC;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON FUNCTION private.cm_ai_invoke_morning_report() FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON FUNCTION private.cm_ai_invoke_morning_report() FROM authenticated; END IF;
END $g$;

DO $c$
DECLARE j text;
BEGIN
  FOREACH j IN ARRAY ARRAY['cm-ai-alerts-frequent','cm-ai-alerts-daily','cm-ai-morning-report','cm-ai-spend-check','cm-ai-alerts-afternoon'] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN PERFORM cron.unschedule(j); END IF;
  END LOOP;
END $c$;

SELECT cron.schedule('cm-ai-alerts-frequent', '*/15 * * * *',
  $$SET statement_timeout = '20s'; SET lock_timeout = '1s'; SELECT public.cm_ai_run_frequent();$$);
SELECT cron.schedule('cm-ai-alerts-daily', '0 7 * * *',
  $$SET statement_timeout = '20s'; SET lock_timeout = '1s'; SELECT public.cm_ai_run_daily(NULL);$$);
SELECT cron.schedule('cm-ai-morning-report', '10 7 * * *',
  $$SELECT private.cm_ai_invoke_morning_report();$$);
SELECT cron.schedule('cm-ai-spend-check', '30 8 * * *',
  $$SET statement_timeout = '20s'; SET lock_timeout = '1s'; SELECT public.cm_ai_run_spend_check();$$);
SELECT cron.schedule('cm-ai-alerts-afternoon', '0 14 * * *',
  $$SET statement_timeout = '20s'; SET lock_timeout = '1s'; SELECT public.cm_ai_run_afternoon();$$);
