-- Rehearsal verification for the phone-review page. One session, no COMMIT.
--
-- Rehearsal has the older cm_gate_allows and no cm_feature_gate_allowlist.
-- Production's gate also checks that allowlist (and the KPI-viewer clause).
-- This file temporarily installs only that schema, with no live user rows,
-- inside a transaction. Do not apply 20261103140000_chat_gate_allowlist.sql
-- or 20261103180000_marketing_manager_least_privilege.sql: those insert real
-- users and change more than the gate.
--
-- Run as the migration role (table owner), from the repository root:
--   psql "$REHEARSAL_URL" -v ON_ERROR_STOP=1 -f supabase/tests/cm_phone_review_rehearsal.sql
--
-- Order inside this file:
--   1. Snapshot gate, allowlist presence, and pg_cron job text.
--   2. BEGIN.
--   3. Schema-only prod-compatible gate (synthetic allowlist; tests insert synthetic users).
--   4. Page migration (supabase/migrations/20261108213000_cm_phone_review_page.sql).
--   5. Page tests, then rollback-and-reapply tests, sharing this transaction
--      (phone_review_outer_tx). Their own BEGIN/ROLLBACK become savepoints.
--   6. ROLLBACK.
--   7. Fail if the gate function, allowlist presence, or pg_cron job text changed.
--
-- pg_cron: the migration unschedules and reschedules cm-scan-phone-review only
-- when the extension is already installed. Those writes are in this transaction.
-- The check after ROLLBACK refuses to leave a changed job. There is no COMMIT.
--
-- Requires the phone-review queue and helpers (chat step 2). The page migration
-- creates the scanner if PR105's function is not already present.

\set ON_ERROR_STOP on
\unset phone_review_outer_tx

SELECT md5(pg_get_functiondef('public.cm_gate_allows()'::regprocedure)) AS gate_before \gset
SELECT CASE WHEN to_regclass('public.cm_feature_gate_allowlist') IS NULL THEN '0' ELSE '1' END AS allow_before \gset
SELECT CASE WHEN to_regclass('public.cm_kpi_viewer_allowlist') IS NULL THEN '0' ELSE '1' END AS kpi_before \gset
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN '1' ELSE '0' END AS has_cron \gset
\if :has_cron
SELECT md5(coalesce((SELECT command || '|' || schedule FROM cron.job WHERE jobname = 'cm-scan-phone-review'), 'absent')) AS cron_before \gset
\endif

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.cm_phone_review_queue') IS NULL
     OR to_regprocedure('public.cm_split_phone_field(text)') IS NULL
     OR to_regprocedure('public.cm_normalize_phone(text)') IS NULL
     OR to_regprocedure('public.cm_phone_is_valid(text)') IS NULL
     OR to_regclass('public.cm_feature_gate') IS NULL THEN
    RAISE EXCEPTION 'rehearsal is missing the phone-review queue, helpers, or cm_feature_gate';
  END IF;
END $$;

-- Schema only. No rows, and no live user ids.
CREATE TABLE IF NOT EXISTS public.cm_feature_gate_allowlist (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cm_feature_gate_allowlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cm_feature_gate_allowlist FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cm_feature_gate_allowlist TO authenticated;
DROP POLICY IF EXISTS cm_gate_allowlist_gm ON public.cm_feature_gate_allowlist;
CREATE POLICY cm_gate_allowlist_gm ON public.cm_feature_gate_allowlist
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['general_manager']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['general_manager']::public.app_role[]));

CREATE TABLE IF NOT EXISTS public.cm_kpi_viewer_allowlist (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.cm_kpi_viewer_allows()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.cm_kpi_viewer_allowlist WHERE user_id = auth.uid())
$$;

-- Production cm_gate_allows, including the allowlist. No allowlist rows are copied.
CREATE OR REPLACE FUNCTION public.cm_gate_allows()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (auth.uid() IS NULL
          AND coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                       nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role')
              NOT IN ('anon','authenticated'))
      OR coalesce((SELECT access_mode FROM public.cm_feature_gate WHERE id), 'general_manager_only') = 'roles'
      OR public.has_any_role(auth.uid(), ARRAY['general_manager']::public.app_role[])
      OR (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.cm_feature_gate_allowlist a WHERE a.user_id = auth.uid()))
      OR (current_setting('cm.kpiv_ctx', true) = '1' AND public.cm_kpi_viewer_allows())
$$;
REVOKE ALL ON FUNCTION public.cm_gate_allows() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_gate_allows() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.cm_kpi_viewer_allows() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cm_kpi_viewer_allows() TO authenticated, service_role;

\ir ../migrations/20261108213000_cm_phone_review_page.sql

\set phone_review_outer_tx 1
\ir cm_phone_review_page.sql
\ir cm_phone_review_rollback.sql
\unset phone_review_outer_tx

ROLLBACK;

SELECT CASE WHEN md5(pg_get_functiondef('public.cm_gate_allows()'::regprocedure)) = :'gate_before'
            THEN '1' ELSE '0' END AS gate_same \gset
\if :gate_same
\else
\echo cm_gate_allows changed after the rehearsal script
\quit 1
\endif
SELECT CASE WHEN (CASE WHEN to_regclass('public.cm_feature_gate_allowlist') IS NULL THEN '0' ELSE '1' END) = :'allow_before'
            THEN '1' ELSE '0' END AS allow_same \gset
\if :allow_same
\else
\echo cm_feature_gate_allowlist presence changed after the rehearsal script
\quit 1
\endif
SELECT CASE WHEN (CASE WHEN to_regclass('public.cm_kpi_viewer_allowlist') IS NULL THEN '0' ELSE '1' END) = :'kpi_before'
            THEN '1' ELSE '0' END AS kpi_same \gset
\if :kpi_same
\else
\echo cm_kpi_viewer_allowlist presence changed after the rehearsal script
\quit 1
\endif
\if :has_cron
SELECT CASE WHEN md5(coalesce((SELECT command || '|' || schedule FROM cron.job WHERE jobname = 'cm-scan-phone-review'), 'absent')) = :'cron_before'
            THEN '1' ELSE '0' END AS cron_same \gset
\if :cron_same
\else
\echo pg_cron job cm-scan-phone-review changed after the rehearsal script
\quit 1
\endif
\endif

\echo rehearsal phone-review verification rolled back; gate and cron fingerprints match
