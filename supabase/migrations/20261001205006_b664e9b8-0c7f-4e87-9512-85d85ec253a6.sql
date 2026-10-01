ALTER TABLE public.social_ads_campaign_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slaughter_output_product_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packaging_store_setting ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_ads_campaign_snapshots, public.slaughter_output_product_map, public.packaging_store_setting FROM anon;
GRANT SELECT ON public.social_ads_campaign_snapshots, public.slaughter_output_product_map, public.packaging_store_setting TO authenticated;
GRANT ALL ON public.social_ads_campaign_snapshots, public.slaughter_output_product_map, public.packaging_store_setting TO service_role;
CREATE POLICY "Signed-in can read social ads snapshots" ON public.social_ads_campaign_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "Signed-in can read slaughter output map" ON public.slaughter_output_product_map FOR SELECT TO authenticated USING (true);
CREATE POLICY "Signed-in can read packaging store setting" ON public.packaging_store_setting FOR SELECT TO authenticated USING (true);