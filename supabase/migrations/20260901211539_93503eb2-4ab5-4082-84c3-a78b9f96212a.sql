CREATE TABLE public.sales_kg_price_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  meat_price numeric NOT NULL DEFAULT 390,
  bone_meat_price numeric NOT NULL DEFAULT 350,
  processed_price numeric NOT NULL DEFAULT 160,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.sales_kg_price_settings TO authenticated;
GRANT ALL ON public.sales_kg_price_settings TO service_role;

ALTER TABLE public.sales_kg_price_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view kg prices"
ON public.sales_kg_price_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Managers can insert kg prices"
ON public.sales_kg_price_settings FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'general_manager')
  OR public.has_role(auth.uid(), 'executive_manager')
  OR public.has_role(auth.uid(), 'sales_manager')
  OR public.has_role(auth.uid(), 'marketing_sales_manager')
);

CREATE POLICY "Managers can update kg prices"
ON public.sales_kg_price_settings FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'general_manager')
  OR public.has_role(auth.uid(), 'executive_manager')
  OR public.has_role(auth.uid(), 'sales_manager')
  OR public.has_role(auth.uid(), 'marketing_sales_manager')
)
WITH CHECK (
  public.has_role(auth.uid(), 'general_manager')
  OR public.has_role(auth.uid(), 'executive_manager')
  OR public.has_role(auth.uid(), 'sales_manager')
  OR public.has_role(auth.uid(), 'marketing_sales_manager')
);

CREATE TRIGGER trg_sales_kg_price_settings_updated_at
BEFORE UPDATE ON public.sales_kg_price_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.sales_kg_price_settings (singleton, meat_price, bone_meat_price, processed_price)
VALUES (true, 390, 350, 160)
ON CONFLICT (singleton) DO NOTHING;

ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_kg_price_settings;