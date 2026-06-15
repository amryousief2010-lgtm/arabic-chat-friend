
CREATE TABLE public.slaughter_internal_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name text NOT NULL,
  price_per_kg numeric(14,4) NOT NULL CHECK (price_per_kg >= 0),
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.slaughter_internal_prices TO authenticated;
GRANT ALL ON public.slaughter_internal_prices TO service_role;
ALTER TABLE public.slaughter_internal_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view slaughter internal prices"
  ON public.slaughter_internal_prices FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'accountant'::app_role,'financial_manager'::app_role,'slaughterhouse_manager'::app_role,'production_manager'::app_role]));
CREATE POLICY "manage slaughter internal prices"
  ON public.slaughter_internal_prices FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'financial_manager'::app_role,'slaughterhouse_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'financial_manager'::app_role,'slaughterhouse_manager'::app_role]));

CREATE TABLE public.feed_internal_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_name text NOT NULL,
  feed_code text,
  price_per_kg numeric(14,4) NOT NULL CHECK (price_per_kg >= 0),
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feed_internal_prices TO authenticated;
GRANT ALL ON public.feed_internal_prices TO service_role;
ALTER TABLE public.feed_internal_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view feed internal prices"
  ON public.feed_internal_prices FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'accountant'::app_role,'financial_manager'::app_role,'production_manager'::app_role,'warehouse_supervisor'::app_role]));
CREATE POLICY "manage feed internal prices"
  ON public.feed_internal_prices FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'financial_manager'::app_role,'production_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'financial_manager'::app_role,'production_manager'::app_role]));

CREATE TRIGGER trg_slaughter_internal_prices_updated_at
  BEFORE UPDATE ON public.slaughter_internal_prices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_feed_internal_prices_updated_at
  BEFORE UPDATE ON public.feed_internal_prices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
