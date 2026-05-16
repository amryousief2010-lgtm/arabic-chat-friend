
-- =========================================
-- SLAUGHTERHOUSE MODULE (PHASE 1)
-- =========================================

-- 1) Live birds receipts (from internal farm or external suppliers)
CREATE TABLE public.slaughter_live_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number TEXT NOT NULL UNIQUE,
  receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
  source_type TEXT NOT NULL DEFAULT 'internal_farm' CHECK (source_type IN ('internal_farm','external_supplier')),
  source_name TEXT,
  farm_transfer_id UUID,
  bird_count INTEGER NOT NULL DEFAULT 0,
  total_weight_kg NUMERIC NOT NULL DEFAULT 0,
  avg_weight_kg NUMERIC GENERATED ALWAYS AS (CASE WHEN bird_count > 0 THEN total_weight_kg / bird_count ELSE 0 END) STORED,
  avg_age_days INTEGER,
  price_per_kg NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC GENERATED ALWAYS AS (total_weight_kg * price_per_kg) STORED,
  dead_on_arrival INTEGER NOT NULL DEFAULT 0,
  vet_check_passed BOOLEAN NOT NULL DEFAULT true,
  vet_notes TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','in_holding','processed','rejected')),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2) Slaughter batches
CREATE TABLE public.slaughter_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number TEXT NOT NULL UNIQUE,
  slaughter_date DATE NOT NULL DEFAULT CURRENT_DATE,
  shift TEXT NOT NULL DEFAULT 'morning' CHECK (shift IN ('morning','evening','night')),
  live_receipt_id UUID REFERENCES public.slaughter_live_receipts(id) ON DELETE SET NULL,
  birds_slaughtered INTEGER NOT NULL DEFAULT 0,
  total_live_weight_kg NUMERIC NOT NULL DEFAULT 0,
  pre_slaughter_dead INTEGER NOT NULL DEFAULT 0,
  rejected_birds INTEGER NOT NULL DEFAULT 0,
  total_meat_kg NUMERIC NOT NULL DEFAULT 0,
  total_waste_kg NUMERIC NOT NULL DEFAULT 0,
  actual_yield_pct NUMERIC GENERATED ALWAYS AS (CASE WHEN total_live_weight_kg > 0 THEN (total_meat_kg / total_live_weight_kg) * 100 ELSE 0 END) STORED,
  cost_per_kg_meat NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','cancelled')),
  start_time TIME,
  end_time TIME,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3) Yield standards (Reference table for expected cuts per bird)
CREATE TABLE public.slaughter_yield_standards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cut_name_ar TEXT NOT NULL,
  cut_name_en TEXT,
  barcode TEXT UNIQUE,
  product_id UUID,
  standard_yield_pct NUMERIC NOT NULL DEFAULT 0,
  package_size_kg NUMERIC,
  category TEXT DEFAULT 'meat' CHECK (category IN ('meat','offal','waste','byproduct')),
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4) Actual outputs per batch (per cut)
CREATE TABLE public.slaughter_batch_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.slaughter_batches(id) ON DELETE CASCADE,
  yield_standard_id UUID REFERENCES public.slaughter_yield_standards(id) ON DELETE SET NULL,
  cut_name_ar TEXT NOT NULL,
  barcode TEXT,
  product_id UUID,
  actual_weight_kg NUMERIC NOT NULL DEFAULT 0,
  package_count INTEGER NOT NULL DEFAULT 0,
  standard_weight_kg NUMERIC NOT NULL DEFAULT 0,
  variance_kg NUMERIC GENERATED ALWAYS AS (actual_weight_kg - standard_weight_kg) STORED,
  variance_pct NUMERIC GENERATED ALWAYS AS (CASE WHEN standard_weight_kg > 0 THEN ((actual_weight_kg - standard_weight_kg) / standard_weight_kg) * 100 ELSE 0 END) STORED,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC GENERATED ALWAYS AS (actual_weight_kg * unit_cost) STORED,
  expiry_date DATE,
  destination TEXT NOT NULL DEFAULT 'warehouse' CHECK (destination IN ('warehouse','meat_factory','direct_sale','waste')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5) Slaughter workers
CREATE TABLE public.slaughter_workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  national_id TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'slaughterer' CHECK (role IN ('slaughterer','cutter','packer','supervisor','quality_inspector')),
  daily_wage NUMERIC NOT NULL DEFAULT 0,
  hire_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6) Worker batch assignment & productivity
CREATE TABLE public.slaughter_worker_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES public.slaughter_workers(id) ON DELETE CASCADE,
  batch_id UUID REFERENCES public.slaughter_batches(id) ON DELETE SET NULL,
  log_date DATE NOT NULL DEFAULT CURRENT_DATE,
  hours_worked NUMERIC NOT NULL DEFAULT 0,
  birds_processed INTEGER NOT NULL DEFAULT 0,
  performance_rating INTEGER CHECK (performance_rating BETWEEN 1 AND 5),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7) Quality checks
CREATE TABLE public.slaughter_quality_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_type TEXT NOT NULL DEFAULT 'post_slaughter' CHECK (check_type IN ('pre_slaughter','post_slaughter','packaging','random')),
  related_receipt_id UUID REFERENCES public.slaughter_live_receipts(id) ON DELETE SET NULL,
  related_batch_id UUID REFERENCES public.slaughter_batches(id) ON DELETE SET NULL,
  check_date DATE NOT NULL DEFAULT CURRENT_DATE,
  inspector_name TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'pass' CHECK (result IN ('pass','warning','fail')),
  temperature_c NUMERIC,
  ph_level NUMERIC,
  visual_inspection TEXT,
  microbiological_result TEXT,
  corrective_action TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================
-- INDEXES
-- =========================================
CREATE INDEX idx_slaughter_receipts_date ON public.slaughter_live_receipts(receipt_date DESC);
CREATE INDEX idx_slaughter_batches_date ON public.slaughter_batches(slaughter_date DESC);
CREATE INDEX idx_slaughter_outputs_batch ON public.slaughter_batch_outputs(batch_id);
CREATE INDEX idx_slaughter_outputs_barcode ON public.slaughter_batch_outputs(barcode);
CREATE INDEX idx_slaughter_quality_batch ON public.slaughter_quality_checks(related_batch_id);
CREATE INDEX idx_slaughter_worker_logs_date ON public.slaughter_worker_logs(log_date DESC);

-- =========================================
-- TRIGGERS
-- =========================================
CREATE TRIGGER trg_slaughter_receipts_updated BEFORE UPDATE ON public.slaughter_live_receipts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_slaughter_batches_updated BEFORE UPDATE ON public.slaughter_batches FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_slaughter_yields_updated BEFORE UPDATE ON public.slaughter_yield_standards FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_slaughter_workers_updated BEFORE UPDATE ON public.slaughter_workers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-recompute batch totals when outputs change
CREATE OR REPLACE FUNCTION public.recompute_slaughter_batch_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch UUID;
  v_meat NUMERIC;
BEGIN
  v_batch := COALESCE(NEW.batch_id, OLD.batch_id);
  IF v_batch IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(actual_weight_kg), 0) INTO v_meat
  FROM public.slaughter_batch_outputs
  WHERE batch_id = v_batch AND destination <> 'waste';
  UPDATE public.slaughter_batches SET total_meat_kg = v_meat, updated_at = now() WHERE id = v_batch;
  RETURN NULL;
END; $$;

CREATE TRIGGER trg_recompute_batch_totals
AFTER INSERT OR UPDATE OR DELETE ON public.slaughter_batch_outputs
FOR EACH ROW EXECUTE FUNCTION public.recompute_slaughter_batch_totals();

-- Notify when actual yield is significantly below standard
CREATE OR REPLACE FUNCTION public.notify_low_yield()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_existing uuid;
BEGIN
  IF NEW.status = 'completed' AND NEW.actual_yield_pct > 0 AND NEW.actual_yield_pct < 40 THEN
    SELECT id INTO v_existing FROM public.notifications
      WHERE type = 'low_yield' AND description LIKE '%' || NEW.batch_number || '%' AND is_read = false LIMIT 1;
    IF v_existing IS NULL THEN
      INSERT INTO public.notifications (title, description, type)
      VALUES ('تنبيه: تصافي منخفض',
              'دفعة الذبح ' || NEW.batch_number || ' تصافيها ' || ROUND(NEW.actual_yield_pct, 1) || '% (أقل من المعياري 40%)',
              'low_yield');
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_notify_low_yield
AFTER UPDATE ON public.slaughter_batches
FOR EACH ROW EXECUTE FUNCTION public.notify_low_yield();

-- =========================================
-- RLS POLICIES
-- =========================================
ALTER TABLE public.slaughter_live_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slaughter_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slaughter_yield_standards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slaughter_batch_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slaughter_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slaughter_worker_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slaughter_quality_checks ENABLE ROW LEVEL SECURITY;

-- View policies (all authenticated can view)
CREATE POLICY "view slaughter receipts" ON public.slaughter_live_receipts FOR SELECT TO authenticated USING (true);
CREATE POLICY "view slaughter batches" ON public.slaughter_batches FOR SELECT TO authenticated USING (true);
CREATE POLICY "view yield standards" ON public.slaughter_yield_standards FOR SELECT TO authenticated USING (true);
CREATE POLICY "view batch outputs" ON public.slaughter_batch_outputs FOR SELECT TO authenticated USING (true);
CREATE POLICY "view slaughter workers" ON public.slaughter_workers FOR SELECT TO authenticated USING (true);
CREATE POLICY "view worker logs" ON public.slaughter_worker_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "view quality checks" ON public.slaughter_quality_checks FOR SELECT TO authenticated USING (true);

-- Manage policies (slaughterhouse_manager + production_manager + admins)
CREATE POLICY "manage slaughter receipts" ON public.slaughter_live_receipts FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'slaughterhouse_manager'::app_role,'production_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'slaughterhouse_manager'::app_role,'production_manager'::app_role]));

CREATE POLICY "manage slaughter batches" ON public.slaughter_batches FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'slaughterhouse_manager'::app_role,'production_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'slaughterhouse_manager'::app_role,'production_manager'::app_role]));

CREATE POLICY "manage yield standards" ON public.slaughter_yield_standards FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'slaughterhouse_manager'::app_role,'production_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'slaughterhouse_manager'::app_role,'production_manager'::app_role]));

CREATE POLICY "manage batch outputs" ON public.slaughter_batch_outputs FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'slaughterhouse_manager'::app_role,'production_manager'::app_role,'warehouse_supervisor'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'slaughterhouse_manager'::app_role,'production_manager'::app_role,'warehouse_supervisor'::app_role]));

CREATE POLICY "manage slaughter workers" ON public.slaughter_workers FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'slaughterhouse_manager'::app_role,'hr_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'slaughterhouse_manager'::app_role,'hr_manager'::app_role]));

CREATE POLICY "manage worker logs" ON public.slaughter_worker_logs FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'slaughterhouse_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'slaughterhouse_manager'::app_role]));

CREATE POLICY "manage quality checks" ON public.slaughter_quality_checks FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'slaughterhouse_manager'::app_role,'quality_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'slaughterhouse_manager'::app_role,'quality_manager'::app_role]));

-- =========================================
-- SEED YIELD STANDARDS (based on official COC barcodes)
-- =========================================
INSERT INTO public.slaughter_yield_standards (cut_name_ar, cut_name_en, barcode, standard_yield_pct, package_size_kg, category, display_order) VALUES
('استيك', 'Slice Steak', '6224003208018', 8.0, 0.5, 'meat', 1),
('لحم مشفي', 'Ostrich Meat', '6224003208025', 25.0, 0.5, 'meat', 2),
('موزة نعام', 'Ostrich Shank', '6224003208032', 6.0, 0.5, 'meat', 3),
('فراشة نعام', 'Ostrich Farasha', '6224003208049', 7.0, 0.5, 'meat', 4),
('طرب نعام', 'Ostrich Gat Wrap', '6224003208261', 3.5, 0.5, 'meat', 5),
('ممبار نعام', 'Ostrich Mombar', '6224003208278', 2.0, 0.5, 'offal', 6),
('دبوس نعام', 'Ostrich Drumstick', '6224003208292', 5.0, 6.0, 'meat', 7);
