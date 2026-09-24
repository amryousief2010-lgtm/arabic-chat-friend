-- Daily Meta ads snapshots for the marketing dashboard (account 584894453725328).
-- Idempotent. Does not drop or alter existing rows.
-- The live table may already exist; CREATE TABLE IF NOT EXISTS is a no-op then.
-- RLS is intentionally not force-enabled here: the live snapshot is already
-- readable by the dashboard, and enabling RLS without the existing policy set
-- would block reads. Fresh databases still receive the same grants as the
-- weekly ads snapshots (anon / authenticated select, service_role all).

CREATE TABLE IF NOT EXISTS public.social_ads_daily_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day date NOT NULL,
  account_id text NOT NULL,
  account_name text,
  currency text,
  spend numeric,
  impressions bigint,
  reach_sum_not_deduped bigint,
  link_clicks bigint,
  messaging_results numeric,
  meta_purchases numeric,
  ctr_pct numeric,
  cpc numeric,
  cpm numeric,
  notes text,
  source_system text,
  exported_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS social_ads_daily_snapshots_day_account_id_key
  ON public.social_ads_daily_snapshots (day, account_id);

GRANT SELECT ON TABLE public.social_ads_daily_snapshots TO anon, authenticated;
GRANT ALL ON TABLE public.social_ads_daily_snapshots TO service_role;
