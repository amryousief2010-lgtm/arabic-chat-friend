-- Automatic Zodex AWB / waybill sync
--
-- After JWT hardening (PRs #11/#12), scheduled invokes that used the public
-- anon/publishable key are rejected. This restores the automatic path the
-- same way process-email-queue works: pg_cron + pg_net + a Vault-stored
-- service-role JWT. verify_jwt stays true on the edge functions.
--
-- Owner setup (Lovable / Supabase) if the cron no-ops:
--   1. Vault secret `zodex_sync_service_role_key` OR reuse
--      `email_queue_service_role_key` = project service_role JWT
--   2. Optional Vault secret `project_url` = https://<ref>.supabase.co
--   3. Confirm Integrations → Cron job `sync-zodex-awb-auto` is Active
--   4. Disable any old dashboard cron that called these functions with
--      the anon/publishable key
-- To revert: SELECT cron.unschedule('sync-zodex-awb-auto');

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

CREATE OR REPLACE FUNCTION private.invoke_scheduled_zodex_sync()
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
BEGIN
  -- Prefer a dedicated Zodex secret; fall back to the email-queue service-role
  -- key that Lovable already stores for process-email-queue.
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

  -- AWB / waybill copy onto matching app orders (shippings.php).
  -- Deliveries/closed-invoice reconciliation stays on the manual Sync button
  -- so we do not start two Zodex scrapes that share zodex_sync_runs.
  v_ship_id := net.http_post(
    url := v_url || '/functions/v1/sync-zodex-shipments',
    headers := v_headers,
    body := jsonb_build_object('mode', 'quick'),
    timeout_milliseconds := 180000
  );

  RETURN jsonb_build_object(
    'ok', true,
    'shipments_request_id', v_ship_id
  );
END;
$$;

REVOKE ALL ON FUNCTION private.invoke_scheduled_zodex_sync() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.invoke_scheduled_zodex_sync() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION private.invoke_scheduled_zodex_sync() TO postgres;

COMMENT ON FUNCTION private.invoke_scheduled_zodex_sync() IS
  'pg_cron entrypoint: POST sync-zodex-shipments with the Vault service-role JWT to copy ZX waybills onto matching app orders. Not exposed on the Data API.';

DO $$
BEGIN
  PERFORM cron.unschedule('sync-zodex-awb-auto');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'sync-zodex-awb-auto',
  '*/15 * * * *',
  $cron$SELECT private.invoke_scheduled_zodex_sync();$cron$
);
