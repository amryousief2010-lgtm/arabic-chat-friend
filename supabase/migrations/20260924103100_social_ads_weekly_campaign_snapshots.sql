-- Document the live Meta ads weekly + campaign snapshot tables.
-- CREATE TABLE IF NOT EXISTS only: if the live tables already exist this
-- migration does not add columns, constraints, indexes, policies, or grants,
-- and it never drops or alters them.
-- No GRANTs here on purpose — privilege changes would run even when the
-- table already exists.

CREATE TABLE IF NOT EXISTS public.social_ads_weekly_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
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
  cost_per_messaging_result numeric,
  active_campaigns integer,
  top_spend_campaign text,
  best_cpr_campaign text,
  best_cpr_value numeric,
  page_visits bigint,
  page_new_follows bigint,
  page_unfollows bigint,
  page_messages_started bigint,
  page_new_contacts bigint,
  notes text,
  source_system text,
  exported_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.social_ads_campaign_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  account_id text NOT NULL,
  campaign_name text,
  status text,
  spend_egp numeric,
  results numeric,
  result_type text,
  cost_per_result numeric,
  impressions bigint,
  reach bigint,
  link_clicks bigint,
  ctr_all_pct numeric,
  cpc_all numeric,
  cpm numeric,
  purchases numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
