-- Faster, more reliable automatic Zodex AWB copy
--
-- PR #16 scheduled sync-zodex-awb-auto every 15 minutes AND the edge function
-- upgraded a scheduled "quick" run to a 30-day full scrape whenever
-- last_full_review_at was null/stale. That full scrape often hit
-- WORKER_RESOURCE_LIMIT, never advanced last_successful_zodex_sync_at, and
-- left new توصيل orders on «+ بوليصة» until someone clicked «مزامنة الآن».
--
-- This migration:
--   1. Keeps the same Vault service-role + verify_jwt path (no JWT weakening)
--   2. Runs the frequent job every 5 minutes in *quick* mode only
--   3. Moves the 30-day review to a separate Sunday weekly job
--
-- Owner check after apply:
--   SELECT jobid, jobname, schedule, active FROM cron.job
--     WHERE jobname LIKE 'sync-zodex-awb%';
--   Vault secret zodex_sync_service_role_key OR email_queue_service_role_key
--   must still be the project service_role JWT.

CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    CREATE EXTENSION pg_cron;
  END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon, authenticated;
GRANT USAGE ON SCHEMA private TO postgres, service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('sync-zodex-awb-auto');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('sync-zodex-awb-weekly-full');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DROP FUNCTION IF EXISTS private.invoke_scheduled_zodex_sync();

CREATE OR REPLACE FUNCTION private.invoke_scheduled_zodex_sync(p_mode text DEFAULT 'quick')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_key text;
  v_url text;
  v_headers jsonb;
  v_ship_id bigint;
  v_mode text;
BEGIN
  v_mode := CASE WHEN lower(btrim(coalesce(p_mode, 'quick'))) = 'full' THEN 'full' ELSE 'quick' END;

  SELECT s.decrypted_secret INTO v_key
  FROM vault.decrypted_secrets s
  WHERE s.name IN (
    'zodex_sync_service_role_key',
    'email_queue_service_role_key',
    'service_role_key'
  )
  ORDER BY CASE s.name
    WHEN 'zodex_sync_service_role_key' THEN 1
    WHEN 'email_queue_service_role_key' THEN 2
    ELSE 3
  END
  LIMIT 1;

  IF v_key IS NULL OR btrim(v_key) = '' THEN
    RAISE WARNING 'zodex auto-sync skipped: add vault secret zodex_sync_service_role_key (or email_queue_service_role_key)';
    RETURN jsonb_build_object('skipped', true, 'reason', 'missing_service_role_vault_secret');
  END IF;

  SELECT s.decrypted_secret INTO v_url
  FROM vault.decrypted_secrets s
  WHERE s.name = 'project_url'
  LIMIT 1;

  IF v_url IS NULL OR btrim(v_url) = '' THEN
    v_url := 'https://ssznmzijopyxkwpctcxw.supabase.co';
  END IF;
  v_url := rtrim(v_url, '/');

  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || v_key
  );

  v_ship_id := net.http_post(
    url := v_url || '/functions/v1/sync-zodex-shipments',
    headers := v_headers,
    body := jsonb_build_object('mode', v_mode),
    timeout_milliseconds := 180000
  );

  RETURN jsonb_build_object(
    'ok', true,
    'mode', v_mode,
    'shipments_request_id', v_ship_id
  );
END;
$$;

REVOKE ALL ON FUNCTION private.invoke_scheduled_zodex_sync(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.invoke_scheduled_zodex_sync(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION private.invoke_scheduled_zodex_sync(text) TO postgres;

COMMENT ON FUNCTION private.invoke_scheduled_zodex_sync(text) IS
  'pg_cron entrypoint: POST sync-zodex-shipments with the Vault service-role JWT. Frequent job uses quick; weekly job passes full. Not exposed on the Data API.';

SELECT cron.schedule(
  'sync-zodex-awb-auto',
  '*/5 * * * *',
  $cron$SELECT private.invoke_scheduled_zodex_sync('quick');$cron$
);

SELECT cron.schedule(
  'sync-zodex-awb-weekly-full',
  '0 0 * * 0',
  $cron$SELECT private.invoke_scheduled_zodex_sync('full');$cron$
);
