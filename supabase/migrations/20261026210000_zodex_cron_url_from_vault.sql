-- Remove the hardcoded (Lovable) project URL and anon key from the scheduled Zodex sync.
-- The URL and optional apikey now come from Vault, so the same code works on any project.
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<anon or publishable key>', 'project_anon_key');   -- optional
--   select vault.create_secret('<secret>', 'zodex_cron_secret');                   -- required
-- Cron schedules are NOT changed or enabled here.
CREATE OR REPLACE FUNCTION private.invoke_scheduled_zodex_sync(p_mode text DEFAULT 'quick'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE s text; u text; k text; rid bigint; m text; h jsonb;
BEGIN
 m := CASE WHEN lower(btrim(coalesce(p_mode,'quick')))='full' THEN 'full' ELSE 'quick' END;
 SELECT decrypted_secret INTO s FROM vault.decrypted_secrets WHERE name='zodex_cron_secret' LIMIT 1;
 IF s IS NULL OR btrim(s)='' THEN RETURN jsonb_build_object('skipped',true,'reason','missing_zodex_cron_secret'); END IF;
 SELECT decrypted_secret INTO u FROM vault.decrypted_secrets WHERE name='project_url' LIMIT 1;
 IF u IS NULL OR btrim(u)='' THEN RETURN jsonb_build_object('skipped',true,'reason','missing_project_url'); END IF;
 SELECT decrypted_secret INTO k FROM vault.decrypted_secrets WHERE name='project_anon_key' LIMIT 1;
 h := jsonb_build_object('Content-Type','application/json','x-zodex-cron-secret',s);
 IF k IS NOT NULL AND btrim(k)<>'' THEN h := h || jsonb_build_object('apikey',k); END IF;
 rid := net.http_post(url:=rtrim(btrim(u),'/')||'/functions/v1/sync-zodex-shipments',headers:=h,body:=jsonb_build_object('mode',m),timeout_milliseconds:=180000);
 RETURN jsonb_build_object('ok',true,'mode',m,'shipments_request_id',rid);
END; $function$;
