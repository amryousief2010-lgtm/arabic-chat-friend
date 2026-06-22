
-- Carryover dough balances (meat factory)
CREATE TABLE public.meat_factory_carryover_dough (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_invoice_id uuid REFERENCES public.meat_manufacturing_invoices(id) ON DELETE SET NULL,
  source_invoice_no text,
  source_product_name text NOT NULL,
  production_date date NOT NULL DEFAULT CURRENT_DATE,
  original_qty_kg numeric NOT NULL CHECK (original_qty_kg > 0),
  remaining_qty_kg numeric NOT NULL CHECK (remaining_qty_kg >= 0),
  unit_cost numeric NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  total_value numeric GENERATED ALWAYS AS (remaining_qty_kg * unit_cost) STORED,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','partial','used','damaged')),
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_by_name text,
  damaged_by uuid REFERENCES auth.users(id),
  damaged_by_name text,
  damaged_at timestamptz,
  damaged_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mfcd_status ON public.meat_factory_carryover_dough(status);
CREATE INDEX idx_mfcd_source ON public.meat_factory_carryover_dough(source_invoice_id);

GRANT SELECT, INSERT, UPDATE ON public.meat_factory_carryover_dough TO authenticated;
GRANT ALL ON public.meat_factory_carryover_dough TO service_role;

ALTER TABLE public.meat_factory_carryover_dough ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read carryover dough"
  ON public.meat_factory_carryover_dough FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "auth insert carryover dough"
  ON public.meat_factory_carryover_dough FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "auth update carryover dough"
  ON public.meat_factory_carryover_dough FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);


-- Usage log of carryover dough in subsequent manufacturing invoices
CREATE TABLE public.meat_factory_carryover_dough_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carryover_id uuid NOT NULL REFERENCES public.meat_factory_carryover_dough(id) ON DELETE RESTRICT,
  used_in_invoice_id uuid REFERENCES public.meat_manufacturing_invoices(id) ON DELETE SET NULL,
  used_in_invoice_no text,
  used_qty_kg numeric NOT NULL CHECK (used_qty_kg > 0),
  unit_cost_at_use numeric NOT NULL DEFAULT 0,
  used_by uuid REFERENCES auth.users(id),
  used_by_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mfcdu_carry ON public.meat_factory_carryover_dough_usage(carryover_id);
CREATE INDEX idx_mfcdu_inv ON public.meat_factory_carryover_dough_usage(used_in_invoice_id);

GRANT SELECT, INSERT ON public.meat_factory_carryover_dough_usage TO authenticated;
GRANT ALL ON public.meat_factory_carryover_dough_usage TO service_role;

ALTER TABLE public.meat_factory_carryover_dough_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read carryover usage"
  ON public.meat_factory_carryover_dough_usage FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "auth insert carryover usage"
  ON public.meat_factory_carryover_dough_usage FOR INSERT
  TO authenticated WITH CHECK (true);


-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_meat_carryover_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_mfcd_updated_at
BEFORE UPDATE ON public.meat_factory_carryover_dough
FOR EACH ROW EXECUTE FUNCTION public.tg_meat_carryover_updated_at();
