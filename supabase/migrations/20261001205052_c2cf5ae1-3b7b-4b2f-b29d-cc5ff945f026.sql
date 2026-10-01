ALTER TABLE public.social_ads_weekly_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_ads_daily_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_ads_weekly_snapshots, public.social_ads_daily_snapshots FROM anon;
GRANT SELECT ON public.social_ads_weekly_snapshots, public.social_ads_daily_snapshots TO authenticated;
GRANT ALL ON public.social_ads_weekly_snapshots, public.social_ads_daily_snapshots TO service_role;
CREATE POLICY "Signed-in can read social ads weekly" ON public.social_ads_weekly_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "Signed-in can read social ads daily" ON public.social_ads_daily_snapshots FOR SELECT TO authenticated USING (true);