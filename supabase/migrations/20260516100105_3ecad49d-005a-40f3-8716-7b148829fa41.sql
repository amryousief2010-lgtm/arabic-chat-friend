
ALTER TABLE public.slaughter_yield_standards
  ADD COLUMN IF NOT EXISTS price_per_kg NUMERIC,
  ADD COLUMN IF NOT EXISTS material_code TEXT;

CREATE TABLE IF NOT EXISTS public.meat_factory_raw_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_code TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  default_unit TEXT NOT NULL DEFAULT 'كيلو',
  avg_unit_cost NUMERIC NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'spice',
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mfrm_category ON public.meat_factory_raw_materials(category);

CREATE TABLE IF NOT EXISTS public.meat_factory_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code TEXT,
  barcode TEXT UNIQUE,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  functional_name_ar TEXT,
  functional_name_en TEXT,
  package_qty NUMERIC NOT NULL DEFAULT 0.5,
  package_unit TEXT NOT NULL DEFAULT 'كيلو',
  base_cost_unit TEXT,
  cost_per_base_unit NUMERIC,
  cost_price NUMERIC,
  sale_price NUMERIC,
  source_document TEXT,
  source_document_no INTEGER,
  source_date DATE,
  cost_status TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mfp_code ON public.meat_factory_products(product_code);

CREATE TABLE IF NOT EXISTS public.meat_factory_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no INTEGER NOT NULL,
  invoice_date DATE,
  source_document TEXT,
  product_code TEXT,
  product_name_ar TEXT,
  output_qty NUMERIC,
  output_unit TEXT,
  unit_cost NUMERIC,
  output_total NUMERIC,
  input_total NUMERIC,
  labor_total NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mfi_invoice ON public.meat_factory_invoices(invoice_no, product_code);

CREATE TABLE IF NOT EXISTS public.meat_factory_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no INTEGER,
  invoice_date DATE,
  source_document TEXT,
  product_code TEXT NOT NULL,
  product_name_ar TEXT,
  line_type TEXT NOT NULL DEFAULT 'Input',
  material_code TEXT,
  material_name_ar TEXT,
  quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  unit_cost NUMERIC,
  line_total NUMERIC,
  warehouse TEXT,
  labor_total_if_output NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mfr_product ON public.meat_factory_recipes(product_code);
CREATE INDEX IF NOT EXISTS idx_mfr_invoice ON public.meat_factory_recipes(invoice_no);

CREATE TABLE IF NOT EXISTS public.meat_factory_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number TEXT NOT NULL UNIQUE,
  product_code TEXT NOT NULL,
  product_name_ar TEXT,
  planned_qty NUMERIC NOT NULL DEFAULT 0,
  actual_qty NUMERIC,
  unit TEXT NOT NULL DEFAULT 'كيلو',
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed','cancelled')),
  labor_cost NUMERIC NOT NULL DEFAULT 0,
  materials_cost NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC,
  production_date DATE NOT NULL DEFAULT current_date,
  expiry_date DATE,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mfb_product ON public.meat_factory_batches(product_code);
CREATE INDEX IF NOT EXISTS idx_mfb_status ON public.meat_factory_batches(status);

CREATE TRIGGER trg_mfrm_updated BEFORE UPDATE ON public.meat_factory_raw_materials FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_mfp_updated BEFORE UPDATE ON public.meat_factory_products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_mfb_updated BEFORE UPDATE ON public.meat_factory_batches FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.meat_factory_raw_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meat_factory_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meat_factory_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meat_factory_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meat_factory_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view raw materials" ON public.meat_factory_raw_materials FOR SELECT TO authenticated USING (true);
CREATE POLICY "view mf products" ON public.meat_factory_products FOR SELECT TO authenticated USING (true);
CREATE POLICY "view mf invoices" ON public.meat_factory_invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "view mf recipes" ON public.meat_factory_recipes FOR SELECT TO authenticated USING (true);
CREATE POLICY "view mf batches" ON public.meat_factory_batches FOR SELECT TO authenticated USING (true);

CREATE POLICY "manage raw materials" ON public.meat_factory_raw_materials FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'production_manager'::app_role,'warehouse_supervisor'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'production_manager'::app_role,'warehouse_supervisor'::app_role]));
CREATE POLICY "manage mf products" ON public.meat_factory_products FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'production_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'production_manager'::app_role]));
CREATE POLICY "manage mf invoices" ON public.meat_factory_invoices FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'production_manager'::app_role,'accountant'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'production_manager'::app_role,'accountant'::app_role]));
CREATE POLICY "manage mf recipes" ON public.meat_factory_recipes FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'production_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'production_manager'::app_role]));
CREATE POLICY "manage mf batches" ON public.meat_factory_batches FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'production_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'production_manager'::app_role]));
