
-- 1. Market prices table
CREATE TABLE public.brooding_market_prices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  age_from_days integer NOT NULL,
  age_to_days integer,
  age_label text NOT NULL,
  sale_method text NOT NULL DEFAULT 'per_bird' CHECK (sale_method IN ('per_bird','live_weight')),
  market_price_per_bird numeric(12,2),
  live_weight_price_per_kg numeric(12,2),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brooding_market_prices TO authenticated;
GRANT ALL ON public.brooding_market_prices TO service_role;

ALTER TABLE public.brooding_market_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated can view market prices"
  ON public.brooding_market_prices FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Only GM/EM can insert market prices"
  ON public.brooding_market_prices FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'general_manager') OR
    public.has_role(auth.uid(), 'executive_manager')
  );

CREATE POLICY "Only GM/EM can update market prices"
  ON public.brooding_market_prices FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager') OR
    public.has_role(auth.uid(), 'executive_manager')
  );

CREATE POLICY "Only GM/EM can delete market prices"
  ON public.brooding_market_prices FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager') OR
    public.has_role(auth.uid(), 'executive_manager')
  );

CREATE TRIGGER trg_brooding_market_prices_updated_at
  BEFORE UPDATE ON public.brooding_market_prices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed default price ladder
INSERT INTO public.brooding_market_prices
  (age_from_days, age_to_days, age_label, sale_method, market_price_per_bird, live_weight_price_per_kg, sort_order)
VALUES
  (0,   14,  'عمر أسبوعين (حتى 14 يوم)',          'per_bird',     1800, NULL, 10),
  (15,  45,  'حتى عمر شهر ونصف',                   'per_bird',     2800, NULL, 20),
  (46,  60,  'عمر شهرين',                           'per_bird',     3000, NULL, 30),
  (61,  90,  'عمر 3 شهور',                          'per_bird',     3300, NULL, 40),
  (91,  120, 'عمر 4 شهور',                          'per_bird',     3800, NULL, 50),
  (121, 150, 'عمر 5 شهور',                          'per_bird',     4200, NULL, 60),
  (151, NULL,'أكبر من 5 شهور (بالوزن القائم)',     'live_weight',  NULL, 180,  70);

-- 2. Snapshot fields on chick sales
ALTER TABLE public.brooding_chick_sales
  ADD COLUMN IF NOT EXISTS market_price_at_sale numeric(12,2),
  ADD COLUMN IF NOT EXISTS expected_sale_value numeric(14,2),
  ADD COLUMN IF NOT EXISTS sale_method text DEFAULT 'per_bird',
  ADD COLUMN IF NOT EXISTS live_weight_kg numeric(12,3),
  ADD COLUMN IF NOT EXISTS live_price_per_kg numeric(12,2);

-- 3. Default live-weight price in brooding_settings (for batches > 5 months)
ALTER TABLE public.brooding_settings
  ADD COLUMN IF NOT EXISTS default_live_weight_price_per_kg numeric(12,2) NOT NULL DEFAULT 180;
