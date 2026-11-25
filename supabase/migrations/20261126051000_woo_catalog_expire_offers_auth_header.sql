-- =====================================================================
-- Repo sync of the prod hotfix for private.woo_catalog_invoke_expire_offers().
-- Prod already has this body: when vault project_anon_key is present, the
-- pg_net call sends both apikey and Authorization: Bearer so the function
-- gateway accepts expire_offers while woo-catalog-sync keeps verify_jwt=true.
-- This migration does not insert or update any vault secret. It only reads
-- vault.decrypted_secrets by name at runtime. If project_anon_key is missing
-- or empty, the header block is skipped (the call may get 401 from the
-- gateway, but the function itself no-ops that case safely). Missing
-- woo_catalog_cron_secret or project_url still returns skipped.
-- Idempotent: CREATE OR REPLACE plus existing schema/revoke guards.
-- Do not re-apply as a hotfix on prod; prod already matches this definition.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.woo_catalog_invoke_expire_offers()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE s text; u text; k text; rid bigint; h jsonb;
BEGIN
  SELECT decrypted_secret INTO s FROM vault.decrypted_secrets WHERE name = 'woo_catalog_cron_secret' LIMIT 1;
  IF s IS NULL OR btrim(s) = '' THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'missing_woo_catalog_cron_secret');
  END IF;
  SELECT decrypted_secret INTO u FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
  IF u IS NULL OR btrim(u) = '' THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'missing_project_url');
  END IF;
  SELECT decrypted_secret INTO k FROM vault.decrypted_secrets WHERE name = 'project_anon_key' LIMIT 1;
  h := jsonb_build_object('Content-Type', 'application/json', 'x-woo-catalog-cron-secret', s);
  IF k IS NOT NULL AND btrim(k) <> '' THEN
    h := h || jsonb_build_object('apikey', k, 'Authorization', 'Bearer ' || btrim(k));
  END IF;
  rid := net.http_post(
    url := rtrim(btrim(u), '/') || '/functions/v1/woo-catalog-sync',
    headers := h,
    body := jsonb_build_object('action', 'expire_offers', 'source', 'cron'),
    timeout_milliseconds := 120000
  );
  RETURN jsonb_build_object('ok', true, 'request_id', rid);
END;
$function$;

REVOKE ALL ON FUNCTION private.woo_catalog_invoke_expire_offers() FROM PUBLIC;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION private.woo_catalog_invoke_expire_offers() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON FUNCTION private.woo_catalog_invoke_expire_offers() FROM authenticated;
  END IF;
END $g$;
