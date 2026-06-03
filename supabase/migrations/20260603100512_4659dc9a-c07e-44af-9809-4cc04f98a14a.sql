
-- ===== Enums =====
DO $$ BEGIN
  CREATE TYPE public.brooding_batch_status AS ENUM ('active','completed','transferred','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.brooding_expense_type AS ENUM ('feed','medicine','vitamins','labor','bedding','utilities','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.brooding_movement_type AS ENUM ('opening','mortality','expense','feed_issue','medicine_issue','chick_sale','slaughter_transfer','adjustment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===== Tables =====
CREATE TABLE public.brooding_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number TEXT NOT NULL UNIQUE,
  received_date DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'معمل التفريخ',
  source_hatchery_batch_id UUID,
  age_at_receipt_days INTEGER NOT NULL DEFAULT 0,
  original_count INTEGER NOT NULL CHECK (original_count >= 0),
  current_count INTEGER NOT NULL CHECK (current_count >= 0),
  mortality_count INTEGER NOT NULL DEFAULT 0,
  sold_count INTEGER NOT NULL DEFAULT 0,
  transferred_count INTEGER NOT NULL DEFAULT 0,
  total_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  cost_per_bird NUMERIC(14,4) NOT NULL DEFAULT 0,
  status public.brooding_batch_status NOT NULL DEFAULT 'active',
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brooding_batches TO authenticated;
GRANT ALL ON public.brooding_batches TO service_role;

ALTER TABLE public.brooding_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brooding_batches managers full"
ON public.brooding_batches FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'))
WITH CHECK (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'));

-- Mortality
CREATE TABLE public.brooding_mortality (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.brooding_batches(id) ON DELETE RESTRICT,
  mortality_date DATE NOT NULL DEFAULT CURRENT_DATE,
  count INTEGER NOT NULL CHECK (count > 0),
  reason TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brooding_mortality TO authenticated;
GRANT ALL ON public.brooding_mortality TO service_role;
ALTER TABLE public.brooding_mortality ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brooding_mortality managers full" ON public.brooding_mortality FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'))
WITH CHECK (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'));

-- Expenses
CREATE TABLE public.brooding_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.brooding_batches(id) ON DELETE RESTRICT,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expense_type public.brooding_expense_type NOT NULL,
  item_name TEXT,
  quantity NUMERIC(14,3),
  unit_price NUMERIC(14,2),
  total_amount NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
  payment_source TEXT,
  treasury TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brooding_expenses TO authenticated;
GRANT ALL ON public.brooding_expenses TO service_role;
ALTER TABLE public.brooding_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brooding_expenses managers full" ON public.brooding_expenses FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'))
WITH CHECK (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'));

-- Feed issuance
CREATE TABLE public.brooding_feed_issuance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.brooding_batches(id) ON DELETE RESTRICT,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  feed_name TEXT NOT NULL,
  quantity_kg NUMERIC(14,3) NOT NULL CHECK (quantity_kg > 0),
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  feed_warehouse_product_id UUID,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brooding_feed_issuance TO authenticated;
GRANT ALL ON public.brooding_feed_issuance TO service_role;
ALTER TABLE public.brooding_feed_issuance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brooding_feed managers full" ON public.brooding_feed_issuance FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'))
WITH CHECK (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'));

-- Medicine issuance
CREATE TABLE public.brooding_medicine_issuance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.brooding_batches(id) ON DELETE RESTRICT,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  medicine_name TEXT NOT NULL,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit TEXT,
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brooding_medicine_issuance TO authenticated;
GRANT ALL ON public.brooding_medicine_issuance TO service_role;
ALTER TABLE public.brooding_medicine_issuance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brooding_medicine managers full" ON public.brooding_medicine_issuance FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'))
WITH CHECK (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'));

-- Chick sales
CREATE TABLE public.brooding_chick_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.brooding_batches(id) ON DELETE RESTRICT,
  sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
  customer_name TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  total_amount NUMERIC(14,2) NOT NULL,
  payment_method TEXT,
  treasury TEXT,
  cost_at_sale NUMERIC(14,2) NOT NULL DEFAULT 0,
  profit NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brooding_chick_sales TO authenticated;
GRANT ALL ON public.brooding_chick_sales TO service_role;
ALTER TABLE public.brooding_chick_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brooding_sales managers full" ON public.brooding_chick_sales FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'))
WITH CHECK (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'));

-- Transfers to slaughter
CREATE TABLE public.brooding_to_slaughter_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.brooding_batches(id) ON DELETE RESTRICT,
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  count INTEGER NOT NULL CHECK (count > 0),
  avg_weight_kg NUMERIC(10,3),
  total_weight_kg NUMERIC(12,3),
  transferred_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  slaughter_reference TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brooding_to_slaughter_transfers TO authenticated;
GRANT ALL ON public.brooding_to_slaughter_transfers TO service_role;
ALTER TABLE public.brooding_to_slaughter_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brooding_transfers managers full" ON public.brooding_to_slaughter_transfers FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'))
WITH CHECK (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'));

-- Movements log
CREATE TABLE public.brooding_batch_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.brooding_batches(id) ON DELETE CASCADE,
  movement_type public.brooding_movement_type NOT NULL,
  movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  count_delta INTEGER NOT NULL DEFAULT 0,
  cost_delta NUMERIC(14,2) NOT NULL DEFAULT 0,
  reference_id UUID,
  description TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brooding_batch_movements TO authenticated;
GRANT ALL ON public.brooding_batch_movements TO service_role;
ALTER TABLE public.brooding_batch_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brooding_movements managers full" ON public.brooding_batch_movements FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'))
WITH CHECK (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'));

-- Cost snapshots
CREATE TABLE public.brooding_cost_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.brooding_batches(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  current_count INTEGER NOT NULL,
  total_cost NUMERIC(14,2) NOT NULL,
  cost_per_bird NUMERIC(14,4) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brooding_cost_snapshots TO authenticated;
GRANT ALL ON public.brooding_cost_snapshots TO service_role;
ALTER TABLE public.brooding_cost_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brooding_snapshots managers full" ON public.brooding_cost_snapshots FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'))
WITH CHECK (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'));

-- ===== Recalc function =====
CREATE OR REPLACE FUNCTION public.recalc_brooding_batch(_batch_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current INTEGER;
  v_total_cost NUMERIC(14,2);
  v_cpb NUMERIC(14,4);
  v_original INTEGER;
  v_mortality INTEGER;
  v_sold INTEGER;
  v_transferred INTEGER;
  v_transferred_cost NUMERIC(14,2);
  v_sold_cost NUMERIC(14,2);
  v_expenses NUMERIC(14,2);
  v_feed NUMERIC(14,2);
  v_medicine NUMERIC(14,2);
  v_opening_cost NUMERIC(14,2);
BEGIN
  SELECT original_count INTO v_original FROM public.brooding_batches WHERE id = _batch_id;

  SELECT COALESCE(SUM(count),0) INTO v_mortality FROM public.brooding_mortality WHERE batch_id = _batch_id;
  SELECT COALESCE(SUM(count),0) INTO v_sold FROM public.brooding_chick_sales WHERE batch_id = _batch_id;
  SELECT COALESCE(SUM(count),0) INTO v_transferred FROM public.brooding_to_slaughter_transfers WHERE batch_id = _batch_id;
  SELECT COALESCE(SUM(transferred_cost),0) INTO v_transferred_cost FROM public.brooding_to_slaughter_transfers WHERE batch_id = _batch_id;
  SELECT COALESCE(SUM(cost_at_sale),0) INTO v_sold_cost FROM public.brooding_chick_sales WHERE batch_id = _batch_id;
  SELECT COALESCE(SUM(total_amount),0) INTO v_expenses FROM public.brooding_expenses WHERE batch_id = _batch_id;
  SELECT COALESCE(SUM(total_cost),0) INTO v_feed FROM public.brooding_feed_issuance WHERE batch_id = _batch_id;
  SELECT COALESCE(SUM(total_cost),0) INTO v_medicine FROM public.brooding_medicine_issuance WHERE batch_id = _batch_id;

  SELECT COALESCE(SUM(cost_delta),0) INTO v_opening_cost
  FROM public.brooding_batch_movements
  WHERE batch_id = _batch_id AND movement_type = 'opening';

  v_current := GREATEST(v_original - v_mortality - v_sold - v_transferred, 0);
  v_total_cost := GREATEST(v_opening_cost + v_expenses + v_feed + v_medicine - v_transferred_cost - v_sold_cost, 0);
  v_cpb := CASE WHEN v_current > 0 THEN v_total_cost / v_current ELSE 0 END;

  UPDATE public.brooding_batches
  SET current_count = v_current,
      mortality_count = v_mortality,
      sold_count = v_sold,
      transferred_count = v_transferred,
      total_cost = v_total_cost,
      cost_per_bird = v_cpb,
      status = CASE
        WHEN v_current = 0 AND v_transferred > 0 THEN 'transferred'::brooding_batch_status
        WHEN v_current = 0 THEN 'closed'::brooding_batch_status
        ELSE status
      END,
      updated_at = now()
  WHERE id = _batch_id;
END;
$$;

-- Validation: no negative & no over-draw
CREATE OR REPLACE FUNCTION public.brooding_validate_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_current INTEGER;
BEGIN
  SELECT current_count INTO v_current FROM public.brooding_batches WHERE id = NEW.batch_id;
  IF v_current IS NULL THEN RAISE EXCEPTION 'الدفعة غير موجودة'; END IF;
  IF NEW.count > v_current THEN
    RAISE EXCEPTION 'العدد المطلوب (%) أكبر من العدد الحالي للدفعة (%)', NEW.count, v_current;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER brooding_mortality_validate BEFORE INSERT ON public.brooding_mortality FOR EACH ROW EXECUTE FUNCTION public.brooding_validate_count();
CREATE TRIGGER brooding_sales_validate BEFORE INSERT ON public.brooding_chick_sales FOR EACH ROW EXECUTE FUNCTION public.brooding_validate_count();
CREATE TRIGGER brooding_transfers_validate BEFORE INSERT ON public.brooding_to_slaughter_transfers FOR EACH ROW EXECUTE FUNCTION public.brooding_validate_count();

-- Auto-fill cost_at_sale & profit for sales
CREATE OR REPLACE FUNCTION public.brooding_sale_fill_cost()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_cpb NUMERIC(14,4);
BEGIN
  SELECT cost_per_bird INTO v_cpb FROM public.brooding_batches WHERE id = NEW.batch_id;
  NEW.total_amount := NEW.count * NEW.unit_price;
  NEW.cost_at_sale := ROUND(COALESCE(v_cpb,0) * NEW.count, 2);
  NEW.profit := NEW.total_amount - NEW.cost_at_sale;
  RETURN NEW;
END; $$;
CREATE TRIGGER brooding_sale_fill_cost_trg BEFORE INSERT ON public.brooding_chick_sales FOR EACH ROW EXECUTE FUNCTION public.brooding_sale_fill_cost();

-- Auto-fill transferred_cost
CREATE OR REPLACE FUNCTION public.brooding_transfer_fill_cost()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_cpb NUMERIC(14,4);
BEGIN
  SELECT cost_per_bird INTO v_cpb FROM public.brooding_batches WHERE id = NEW.batch_id;
  IF NEW.transferred_cost IS NULL OR NEW.transferred_cost = 0 THEN
    NEW.transferred_cost := ROUND(COALESCE(v_cpb,0) * NEW.count, 2);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER brooding_transfer_fill_cost_trg BEFORE INSERT ON public.brooding_to_slaughter_transfers FOR EACH ROW EXECUTE FUNCTION public.brooding_transfer_fill_cost();

-- Auto-fill feed/medicine totals
CREATE OR REPLACE FUNCTION public.brooding_feed_fill_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.total_cost = 0 THEN NEW.total_cost := ROUND(NEW.quantity_kg * NEW.unit_cost, 2); END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER brooding_feed_fill BEFORE INSERT ON public.brooding_feed_issuance FOR EACH ROW EXECUTE FUNCTION public.brooding_feed_fill_total();

CREATE OR REPLACE FUNCTION public.brooding_medicine_fill_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.total_cost = 0 THEN NEW.total_cost := ROUND(NEW.quantity * NEW.unit_cost, 2); END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER brooding_medicine_fill BEFORE INSERT ON public.brooding_medicine_issuance FOR EACH ROW EXECUTE FUNCTION public.brooding_medicine_fill_total();

-- After-insert recalc + movement log
CREATE OR REPLACE FUNCTION public.brooding_after_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_type public.brooding_movement_type; v_count INTEGER := 0; v_cost NUMERIC(14,2) := 0; v_desc TEXT := '';
BEGIN
  IF TG_TABLE_NAME = 'brooding_mortality' THEN
    v_type := 'mortality'; v_count := -NEW.count; v_cost := 0; v_desc := 'نافق: ' || COALESCE(NEW.reason,'');
  ELSIF TG_TABLE_NAME = 'brooding_expenses' THEN
    v_type := 'expense'; v_cost := NEW.total_amount; v_desc := 'مصروف: ' || NEW.expense_type::text || ' ' || COALESCE(NEW.item_name,'');
  ELSIF TG_TABLE_NAME = 'brooding_feed_issuance' THEN
    v_type := 'feed_issue'; v_cost := NEW.total_cost; v_desc := 'علف: ' || NEW.feed_name;
  ELSIF TG_TABLE_NAME = 'brooding_medicine_issuance' THEN
    v_type := 'medicine_issue'; v_cost := NEW.total_cost; v_desc := 'دواء: ' || NEW.medicine_name;
  ELSIF TG_TABLE_NAME = 'brooding_chick_sales' THEN
    v_type := 'chick_sale'; v_count := -NEW.count; v_cost := -NEW.cost_at_sale; v_desc := 'بيع كتاكيت لـ ' || NEW.customer_name;
  ELSIF TG_TABLE_NAME = 'brooding_to_slaughter_transfers' THEN
    v_type := 'slaughter_transfer'; v_count := -NEW.count; v_cost := -NEW.transferred_cost; v_desc := 'تحويل للمجزر';
  END IF;

  INSERT INTO public.brooding_batch_movements(batch_id, movement_type, count_delta, cost_delta, reference_id, description, created_by)
  VALUES (NEW.batch_id, v_type, v_count, v_cost, NEW.id, v_desc, NEW.created_by);

  PERFORM public.recalc_brooding_batch(NEW.batch_id);
  RETURN NEW;
END; $$;

CREATE TRIGGER brooding_mortality_after AFTER INSERT ON public.brooding_mortality FOR EACH ROW EXECUTE FUNCTION public.brooding_after_change();
CREATE TRIGGER brooding_expenses_after AFTER INSERT ON public.brooding_expenses FOR EACH ROW EXECUTE FUNCTION public.brooding_after_change();
CREATE TRIGGER brooding_feed_after AFTER INSERT ON public.brooding_feed_issuance FOR EACH ROW EXECUTE FUNCTION public.brooding_after_change();
CREATE TRIGGER brooding_medicine_after AFTER INSERT ON public.brooding_medicine_issuance FOR EACH ROW EXECUTE FUNCTION public.brooding_after_change();
CREATE TRIGGER brooding_sales_after AFTER INSERT ON public.brooding_chick_sales FOR EACH ROW EXECUTE FUNCTION public.brooding_after_change();
CREATE TRIGGER brooding_transfers_after AFTER INSERT ON public.brooding_to_slaughter_transfers FOR EACH ROW EXECUTE FUNCTION public.brooding_after_change();

-- Indexes
CREATE INDEX idx_brooding_mortality_batch ON public.brooding_mortality(batch_id);
CREATE INDEX idx_brooding_expenses_batch ON public.brooding_expenses(batch_id);
CREATE INDEX idx_brooding_feed_batch ON public.brooding_feed_issuance(batch_id);
CREATE INDEX idx_brooding_medicine_batch ON public.brooding_medicine_issuance(batch_id);
CREATE INDEX idx_brooding_sales_batch ON public.brooding_chick_sales(batch_id);
CREATE INDEX idx_brooding_transfers_batch ON public.brooding_to_slaughter_transfers(batch_id);
CREATE INDEX idx_brooding_movements_batch ON public.brooding_batch_movements(batch_id);

-- ===== Seed two opening batches =====
INSERT INTO public.brooding_batches (batch_number, received_date, source, age_at_receipt_days, original_count, current_count, status, notes)
VALUES
  ('BRD-001', (CURRENT_DATE - INTERVAL '60 days')::date, 'معمل التفريخ', 0, 26, 26, 'active', 'دفعة افتتاحية - عمر شهرين'),
  ('BRD-002', (CURRENT_DATE - INTERVAL '45 days')::date, 'معمل التفريخ', 0, 25, 25, 'active', 'دفعة افتتاحية - عمر شهر ونص');

-- log opening movements (no cost)
INSERT INTO public.brooding_batch_movements (batch_id, movement_type, count_delta, cost_delta, description)
SELECT id, 'opening', original_count, 0, 'رصيد افتتاحي' FROM public.brooding_batches WHERE batch_number IN ('BRD-001','BRD-002');
