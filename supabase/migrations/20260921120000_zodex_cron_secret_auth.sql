-- Zodex AWB auto-sync: cron-secret auth (no service_role JWT required)
--
-- Live diagnosis: pg_cron jobs succeed in Postgres, but net._http_response is
-- HTTP 401 because the stored Edge JWT is invalid or expired. Manual
-- «مزامنة الآن» works (user JWT). The project service_role is not available
-- (Lovable-owned), so scheduled calls use a shared cron secret instead.
--
-- This migration:
--   1. Stores vault secret `zodex_cron_secret` if missing (random 64-hex)
--   2. Rewrites private.invoke_scheduled_zodex_sync to POST
--      sync-zodex-shipments with header x-zodex-cron-secret (and body {mode})
--   3. Does NOT send a service_role Bearer token
--   4. Keeps cron jobs sync-zodex-awb-auto (*/5, quick) and
--      sync-zodex-awb-weekly-full (Sunday, full)
--
-- After apply, copy the vault value into Lovable Cloud Secrets:
--   ZODEX_CRON_SECRET = (SELECT decrypted_secret FROM vault.decrypted_secrets
--                        WHERE name = 'zodex_cron_secret')
-- Do not paste that value into tickets or chat.
--
-- Edge function sync-zodex-shipments must have verify_jwt=false (config.toml)
-- and in-function checks: cron secret OR verified ops user JWT.

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

-- Create the shared cron secret once. Re-applying never rotates an existing value.
DO $$
DECLARE
  v_existing text;
  v_new text;
BEGIN
  SELECT s.decrypted_secret INTO v_existing
  FROM vault.decrypted_secrets s
  WHERE s.name = 'zodex_cron_secret'
  LIMIT 1;

  IF v_existing IS NULL OR btrim(v_existing) = '' THEN
    v_new := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    PERFORM vault.create_secret(
      v_new,
      'zodex_cron_secret',
      'Shared secret for pg_cron Zodex AWB sync. Copy the same value to Lovable Cloud Secrets as ZODEX_CRON_SECRET.'
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.invoke_scheduled_zodex_sync(p_mode text DEFAULT 'quick')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_secret text;
  v_apikey text;
  v_url text;
  v_headers jsonb;
  v_ship_id bigint;
  v_mode text;
BEGIN
  v_mode := CASE WHEN lower(btrim(coalesce(p_mode, 'quick'))) = 'full' THEN 'full' ELSE 'quick' END;

  SELECT s.decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets s
  WHERE s.name = 'zodex_cron_secret'
  LIMIT 1;

  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    RAISE WARNING 'zodex auto-sync skipped: add vault secret zodex_cron_secret';
    RETURN jsonb_build_object('skipped', true, 'reason', 'missing_zodex_cron_secret');
  END IF;

  SELECT s.decrypted_secret INTO v_url
  FROM vault.decrypted_secrets s
  WHERE s.name = 'project_url'
  LIMIT 1;

  IF v_url IS NULL OR btrim(v_url) = '' THEN
    v_url := 'https://ssznmzijopyxkwpctcxw.supabase.co';
  END IF;
  v_url := rtrim(v_url, '/');

  -- Public publishable/anon key is only a Kong gateway pass (not a privilege).
  -- Prefer a vault copy; fall back to this project's public publishable JWT.
  SELECT s.decrypted_secret INTO v_apikey
  FROM vault.decrypted_secrets s
  WHERE s.name IN (
    'anon_key',
    'publishable_key',
    'supabase_anon_key'
  )
  ORDER BY CASE s.name
    WHEN 'anon_key' THEN 1
    WHEN 'publishable_key' THEN 2
    ELSE 3
  END
  LIMIT 1;

  IF v_apikey IS NULL OR btrim(v_apikey) = '' THEN
    v_apikey := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzem5temlqb3B5eGt3cGN0Y3h3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0NjUwMDUsImV4cCI6MjA4MzA0MTAwNX0.YnU9drDx-s5V5T3J3t8zs6fa8F9yFse_Xb3J3e5qYMw';
  END IF;

  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'apikey', v_apikey,
    'x-zodex-cron-secret', v_secret
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
  'pg_cron entrypoint: POST sync-zodex-shipments with vault zodex_cron_secret (header x-zodex-cron-secret). No service_role JWT. Frequent job uses quick; weekly job passes full. Not exposed on the Data API.';

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
