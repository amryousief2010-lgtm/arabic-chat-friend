
-- 1) Packaging materials catalog
CREATE TABLE public.packaging_materials (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text UNIQUE,
  barcode text,
  name_ar text NOT NULL,
  unit text NOT NULL DEFAULT 'قطعة',
  stock numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  low_stock_threshold numeric NOT NULL DEFAULT 0,
  module text NOT NULL DEFAULT 'shared' CHECK (module IN ('shared','meat','feed')),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_packaging_module ON public.packaging_materials(module) WHERE is_active;
ALTER TABLE public.packaging_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view packaging" ON public.packaging_materials FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage packaging" ON public.packaging_materials FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','warehouse_supervisor','meat_factory_manager','feed_factory_manager']::app_role[]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','warehouse_supervisor','meat_factory_manager','feed_factory_manager']::app_role[]));

CREATE TRIGGER trg_packaging_updated BEFORE UPDATE ON public.packaging_materials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2) Staging import infrastructure
CREATE TABLE public.import_staging_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  import_type text NOT NULL CHECK (import_type IN ('products','meat_stock','feed_stock','packaging','meat_invoices','feed_invoices','meat_bom','feed_bom')),
  source_filename text,
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','previewing','validated','errors','approved','posted','cancelled')),
  total_rows integer NOT NULL DEFAULT 0,
  valid_rows integer NOT NULL DEFAULT 0,
  error_rows integer NOT NULL DEFAULT 0,
  notes text,
  validation_summary jsonb,
  uploaded_by uuid REFERENCES auth.users(id),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_staging_runs_status ON public.import_staging_runs(status, import_type);
ALTER TABLE public.import_staging_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view staging runs" ON public.import_staging_runs FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','warehouse_supervisor','meat_factory_manager','feed_factory_manager','accountant','financial_manager','production_manager']::app_role[]));
CREATE POLICY "create staging runs" ON public.import_staging_runs FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid() AND has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','warehouse_supervisor','meat_factory_manager','feed_factory_manager']::app_role[]));
CREATE POLICY "update staging runs" ON public.import_staging_runs FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','warehouse_supervisor','meat_factory_manager','feed_factory_manager']::app_role[]));

CREATE TRIGGER trg_staging_runs_updated BEFORE UPDATE ON public.import_staging_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE public.import_staging_rows (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.import_staging_runs(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  raw_data jsonb NOT NULL,
  parsed_data jsonb,
  row_status text NOT NULL DEFAULT 'pending' CHECK (row_status IN ('pending','valid','error','skipped','posted')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_staging_rows_run ON public.import_staging_rows(run_id, row_status);
ALTER TABLE public.import_staging_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view staging rows" ON public.import_staging_rows FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.import_staging_runs r WHERE r.id = run_id
    AND has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','warehouse_supervisor','meat_factory_manager','feed_factory_manager','accountant','financial_manager','production_manager']::app_role[])));
CREATE POLICY "manage staging rows" ON public.import_staging_rows FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','warehouse_supervisor','meat_factory_manager','feed_factory_manager']::app_role[]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','warehouse_supervisor','meat_factory_manager','feed_factory_manager']::app_role[]));

-- 3) Data quality tasks (negative stock, missing barcodes, etc.)
CREATE TABLE public.data_quality_tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_type text NOT NULL CHECK (task_type IN ('negative_stock','missing_barcode','duplicate_item','price_anomaly','recipe_missing','cost_review','other')),
  module text NOT NULL CHECK (module IN ('meat','feed','shared','warehouse')),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  title text NOT NULL,
  description text,
  reference_table text,
  reference_id text,
  current_value jsonb,
  suggested_action text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','dismissed')),
  assigned_to uuid REFERENCES auth.users(id),
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dq_status ON public.data_quality_tasks(status, module);
CREATE INDEX idx_dq_assigned ON public.data_quality_tasks(assigned_to) WHERE status IN ('open','in_progress');
ALTER TABLE public.data_quality_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view dq tasks" ON public.data_quality_tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage dq tasks" ON public.data_quality_tasks FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','warehouse_supervisor','meat_factory_manager','feed_factory_manager','quality_manager','accountant']::app_role[]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','warehouse_supervisor','meat_factory_manager','feed_factory_manager','quality_manager','accountant']::app_role[]));

CREATE TRIGGER trg_dq_tasks_updated BEFORE UPDATE ON public.data_quality_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
