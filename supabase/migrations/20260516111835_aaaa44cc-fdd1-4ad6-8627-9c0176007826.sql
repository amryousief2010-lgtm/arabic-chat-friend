
-- ============================================================
-- FEED FACTORY MODULE — Wave 1 (additive over existing schema)
-- ============================================================

-- ENUMs
DO $$ BEGIN
  CREATE TYPE public.feed_order_status AS ENUM
    ('draft','issued','mixing','packed','qc_pending','approved','needs_review','rejected','posted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.feed_qc_result AS ENUM ('pass','fail','needs_review');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Role-helper functions ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_feed_team(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(_user_id, ARRAY[
    'general_manager'::app_role,'executive_manager'::app_role,
    'feed_factory_manager'::app_role,'warehouse_supervisor'::app_role,
    'quality_manager'::app_role,'accountant'::app_role,
    'production_manager'::app_role,'financial_manager'::app_role
  ])
$$;

CREATE OR REPLACE FUNCTION public.can_manage_feed_recipes(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(_user_id, ARRAY[
    'general_manager'::app_role,'executive_manager'::app_role,'feed_factory_manager'::app_role
  ])
$$;

CREATE OR REPLACE FUNCTION public.can_issue_feed_materials(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(_user_id, ARRAY[
    'general_manager'::app_role,'executive_manager'::app_role,
    'feed_factory_manager'::app_role,'warehouse_supervisor'::app_role
  ])
$$;

CREATE OR REPLACE FUNCTION public.can_approve_feed_qc(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(_user_id, ARRAY[
    'general_manager'::app_role,'executive_manager'::app_role,'quality_manager'::app_role
  ])
$$;

CREATE OR REPLACE FUNCTION public.can_approve_feed_cost(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(_user_id, ARRAY[
    'general_manager'::app_role,'executive_manager'::app_role,
    'feed_factory_manager'::app_role,'accountant'::app_role,'financial_manager'::app_role
  ])
$$;

-- Extend existing tables ----------------------------------------------------
ALTER TABLE public.feed_raw_materials
  ADD COLUMN IF NOT EXISTS item_code text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS cost_low numeric(14,4),
  ADD COLUMN IF NOT EXISTS cost_high numeric(14,4),
  ADD COLUMN IF NOT EXISTS criticality text DEFAULT 'متوسطة',
  ADD COLUMN IF NOT EXISTS is_packaging boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS warehouse_name text DEFAULT 'مخزن أعلاف وأدوية';

CREATE UNIQUE INDEX IF NOT EXISTS feed_raw_materials_item_code_uidx
  ON public.feed_raw_materials(item_code) WHERE item_code IS NOT NULL;

ALTER TABLE public.feed_recipe_items
  ADD COLUMN IF NOT EXISTS unit text DEFAULT 'كيلو',
  ADD COLUMN IF NOT EXISTS unit_cost numeric(14,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inclusion_rate_pct numeric(8,4),
  ADD COLUMN IF NOT EXISTS is_packaging boolean NOT NULL DEFAULT false;

ALTER TABLE public.feed_recipes
  ADD COLUMN IF NOT EXISTS feed_product_id uuid,
  ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS source_invoice text,
  ADD COLUMN IF NOT EXISTS recipe_status text NOT NULL DEFAULT 'draft';

-- New tables ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feed_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_code text UNIQUE NOT NULL,
  name text NOT NULL,
  stage text,
  standard_batch_kg numeric(14,3) NOT NULL DEFAULT 1000,
  default_bag_kg numeric(10,2) NOT NULL DEFAULT 40,
  latest_unit_cost numeric(14,4) NOT NULL DEFAULT 0,
  current_stock numeric(14,3) NOT NULL DEFAULT 0,
  recipe_status text NOT NULL DEFAULT 'draft',
  notes text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feed_recipes
  ADD CONSTRAINT feed_recipes_product_fk
  FOREIGN KEY (feed_product_id) REFERENCES public.feed_products(id) ON DELETE SET NULL
  NOT VALID;

CREATE TABLE IF NOT EXISTS public.feed_production_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no text UNIQUE NOT NULL,
  feed_product_id uuid NOT NULL REFERENCES public.feed_products(id),
  recipe_id uuid REFERENCES public.feed_recipes(id),
  target_output_kg numeric(14,3) NOT NULL,
  status public.feed_order_status NOT NULL DEFAULT 'draft',
  created_by uuid,
  approved_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feed_orders_status ON public.feed_production_orders(status);

CREATE TABLE IF NOT EXISTS public.feed_material_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.feed_production_orders(id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL REFERENCES public.feed_raw_materials(id),
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  unit text NOT NULL DEFAULT 'كيلو',
  unit_cost numeric(14,4) NOT NULL DEFAULT 0,
  total_cost numeric(14,4) GENERATED ALWAYS AS (qty * unit_cost) STORED,
  issued_by uuid,
  issued_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feed_issues_order ON public.feed_material_issues(order_id);

CREATE TABLE IF NOT EXISTS public.feed_invoice_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_no text UNIQUE NOT NULL,
  order_id uuid REFERENCES public.feed_production_orders(id),
  feed_product_id uuid NOT NULL REFERENCES public.feed_products(id),
  invoice_no text,
  invoice_date date,
  output_qty_kg numeric(14,3) NOT NULL DEFAULT 0,
  input_qty_invoice numeric(14,3),
  input_qty_weight_kg numeric(14,3),
  input_cost numeric(14,4) NOT NULL DEFAULT 0,
  operating_cost numeric(14,4) NOT NULL DEFAULT 0,
  invoice_output_total numeric(14,4),
  unit_cost_calc numeric(14,4),
  qty_variance_kg numeric(14,3),
  qty_variance_pct numeric(10,6),
  cost_diff numeric(14,4),
  status public.feed_order_status NOT NULL DEFAULT 'qc_pending',
  warehouse_name text DEFAULT 'مخزن أعلاف وأدوية',
  source_file text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feed_inv_batches_product ON public.feed_invoice_batches(feed_product_id);
CREATE INDEX IF NOT EXISTS idx_feed_inv_batches_status  ON public.feed_invoice_batches(status);

CREATE TABLE IF NOT EXISTS public.feed_qc_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.feed_invoice_batches(id) ON DELETE CASCADE,
  result public.feed_qc_result NOT NULL,
  variance_reason text,
  notes text,
  checked_by uuid,
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feed_qc_batch ON public.feed_qc_checks(batch_id);

CREATE TABLE IF NOT EXISTS public.feed_finished_goods_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.feed_invoice_batches(id),
  feed_product_id uuid NOT NULL REFERENCES public.feed_products(id),
  movement_type text NOT NULL CHECK (movement_type IN ('in','out','transfer','adjustment')),
  qty_kg numeric(14,3) NOT NULL,
  destination text,
  notes text,
  performed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.feed_cost_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.feed_invoice_batches(id) ON DELETE CASCADE,
  reviewed_by uuid,
  decision text NOT NULL CHECK (decision IN ('approved','rework','rejected')),
  notes text,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.feed_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  row_id uuid,
  action text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  performed_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feed_audit_table ON public.feed_audit_log(table_name, created_at DESC);

-- updated_at triggers -------------------------------------------------------
CREATE TRIGGER trg_feed_products_updated BEFORE UPDATE ON public.feed_products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_feed_orders_updated BEFORE UPDATE ON public.feed_production_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_feed_inv_batches_updated BEFORE UPDATE ON public.feed_invoice_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Variance + cost auto-compute on invoice batches ---------------------------
CREATE OR REPLACE FUNCTION public.feed_invoice_batch_compute()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.output_qty_kg > 0 THEN
    NEW.unit_cost_calc := ROUND(((COALESCE(NEW.input_cost,0)+COALESCE(NEW.operating_cost,0)) / NEW.output_qty_kg)::numeric, 4);
  END IF;
  IF NEW.input_qty_weight_kg IS NOT NULL AND NEW.input_qty_weight_kg > 0 THEN
    NEW.qty_variance_kg := NEW.output_qty_kg - NEW.input_qty_weight_kg;
    NEW.qty_variance_pct := ROUND((NEW.qty_variance_kg / NEW.input_qty_weight_kg)::numeric, 6);
    IF NEW.qty_variance_pct > 0.01 AND NEW.status IN ('qc_pending','approved') THEN
      NEW.status := 'needs_review';
    END IF;
  END IF;
  IF NEW.invoice_output_total IS NOT NULL THEN
    NEW.cost_diff := ROUND((NEW.invoice_output_total - (COALESCE(NEW.input_cost,0)+COALESCE(NEW.operating_cost,0)))::numeric, 4);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_feed_inv_batch_compute
  BEFORE INSERT OR UPDATE ON public.feed_invoice_batches
  FOR EACH ROW EXECUTE FUNCTION public.feed_invoice_batch_compute();

-- Stock guard on material issue --------------------------------------------
CREATE OR REPLACE FUNCTION public.feed_apply_issue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stock numeric;
BEGIN
  SELECT stock INTO v_stock FROM public.feed_raw_materials WHERE id = NEW.raw_material_id FOR UPDATE;
  IF v_stock IS NULL THEN RAISE EXCEPTION 'Raw material not found'; END IF;
  IF v_stock < NEW.qty THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: متاح % وطلب %', v_stock, NEW.qty;
  END IF;
  UPDATE public.feed_raw_materials
     SET stock = stock - NEW.qty, updated_at = now()
   WHERE id = NEW.raw_material_id;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_feed_apply_issue
  BEFORE INSERT ON public.feed_material_issues
  FOR EACH ROW EXECUTE FUNCTION public.feed_apply_issue();

-- Audit log trigger ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.feed_log_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.feed_audit_log(table_name,row_id,action,new_value,performed_by)
    VALUES (TG_TABLE_NAME, NEW.id, 'insert', to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(OLD) <> to_jsonb(NEW) THEN
      INSERT INTO public.feed_audit_log(table_name,row_id,action,old_value,new_value,performed_by)
      VALUES (TG_TABLE_NAME, NEW.id, 'update', to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.feed_audit_log(table_name,row_id,action,old_value,performed_by)
    VALUES (TG_TABLE_NAME, OLD.id, 'delete', to_jsonb(OLD), auth.uid());
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_feed_audit_orders
  AFTER INSERT OR UPDATE OR DELETE ON public.feed_production_orders
  FOR EACH ROW EXECUTE FUNCTION public.feed_log_changes();
CREATE TRIGGER trg_feed_audit_inv_batches
  AFTER INSERT OR UPDATE OR DELETE ON public.feed_invoice_batches
  FOR EACH ROW EXECUTE FUNCTION public.feed_log_changes();
CREATE TRIGGER trg_feed_audit_qc
  AFTER INSERT OR UPDATE OR DELETE ON public.feed_qc_checks
  FOR EACH ROW EXECUTE FUNCTION public.feed_log_changes();
CREATE TRIGGER trg_feed_audit_cost
  AFTER INSERT OR UPDATE OR DELETE ON public.feed_cost_reviews
  FOR EACH ROW EXECUTE FUNCTION public.feed_log_changes();

-- RLS -----------------------------------------------------------------------
ALTER TABLE public.feed_products              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_production_orders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_material_issues       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_invoice_batches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_qc_checks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_finished_goods_moves  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_cost_reviews          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_audit_log             ENABLE ROW LEVEL SECURITY;

CREATE POLICY feed_read_products       ON public.feed_products             FOR SELECT TO authenticated USING (public.is_feed_team(auth.uid()));
CREATE POLICY feed_write_products      ON public.feed_products             FOR ALL    TO authenticated USING (public.can_manage_feed_recipes(auth.uid())) WITH CHECK (public.can_manage_feed_recipes(auth.uid()));

CREATE POLICY feed_read_orders         ON public.feed_production_orders    FOR SELECT TO authenticated USING (public.is_feed_team(auth.uid()));
CREATE POLICY feed_write_orders        ON public.feed_production_orders    FOR ALL    TO authenticated USING (public.can_manage_feed_recipes(auth.uid())) WITH CHECK (public.can_manage_feed_recipes(auth.uid()));

CREATE POLICY feed_read_issues         ON public.feed_material_issues      FOR SELECT TO authenticated USING (public.is_feed_team(auth.uid()));
CREATE POLICY feed_write_issues        ON public.feed_material_issues      FOR INSERT TO authenticated WITH CHECK (public.can_issue_feed_materials(auth.uid()));

CREATE POLICY feed_read_inv_batches    ON public.feed_invoice_batches      FOR SELECT TO authenticated USING (public.is_feed_team(auth.uid()));
CREATE POLICY feed_write_inv_batches   ON public.feed_invoice_batches      FOR ALL    TO authenticated USING (public.can_manage_feed_recipes(auth.uid())) WITH CHECK (public.can_manage_feed_recipes(auth.uid()));

CREATE POLICY feed_read_qc             ON public.feed_qc_checks            FOR SELECT TO authenticated USING (public.is_feed_team(auth.uid()));
CREATE POLICY feed_write_qc            ON public.feed_qc_checks            FOR INSERT TO authenticated WITH CHECK (public.can_approve_feed_qc(auth.uid()));

CREATE POLICY feed_read_fg             ON public.feed_finished_goods_moves FOR SELECT TO authenticated USING (public.is_feed_team(auth.uid()));
CREATE POLICY feed_write_fg            ON public.feed_finished_goods_moves FOR INSERT TO authenticated WITH CHECK (public.can_manage_feed_recipes(auth.uid()));

CREATE POLICY feed_read_cost           ON public.feed_cost_reviews         FOR SELECT TO authenticated USING (public.is_feed_team(auth.uid()));
CREATE POLICY feed_write_cost          ON public.feed_cost_reviews         FOR INSERT TO authenticated WITH CHECK (public.can_approve_feed_cost(auth.uid()));

CREATE POLICY feed_read_audit          ON public.feed_audit_log            FOR SELECT TO authenticated USING (public.is_feed_team(auth.uid()));
