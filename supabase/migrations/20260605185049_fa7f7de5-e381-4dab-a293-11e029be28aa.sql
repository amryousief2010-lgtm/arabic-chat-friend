
DO $$ BEGIN CREATE TYPE public.lab_treasury_payment_method AS ENUM ('cash','vodafone_cash','instapay','bank_transfer'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.lab_treasury_movement_type AS ENUM ('income','expense'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.lab_treasury_status AS ENUM ('pending','approved','rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.lab_treasury_income_category AS ENUM ('hatching','chick_sales','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.lab_treasury_expense_category AS ENUM ('electricity','maintenance','water','salaries_mother_farm','salaries_hatchery','salaries_brooding','medicine','feed_supplies','tools','transport','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.lab_treasury_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_type public.lab_treasury_movement_type NOT NULL,
  movement_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Cairo')::date,
  income_category public.lab_treasury_income_category,
  expense_category public.lab_treasury_expense_category,
  customer_name text,
  units_count numeric,
  unit_price numeric,
  amount numeric NOT NULL,
  payment_method public.lab_treasury_payment_method NOT NULL,
  description text,
  beneficiary text,
  notes text,
  receipt_url text,
  status public.lab_treasury_status NOT NULL DEFAULT 'pending',
  rejection_reason text,
  balance_after numeric,
  created_by uuid REFERENCES auth.users(id),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lab_treasury_amount_positive CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_lab_treasury_date ON public.lab_treasury_movements(movement_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_treasury_status ON public.lab_treasury_movements(status);
CREATE INDEX IF NOT EXISTS idx_lab_treasury_created_by ON public.lab_treasury_movements(created_by);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_treasury_movements TO authenticated;
GRANT ALL ON public.lab_treasury_movements TO service_role;

ALTER TABLE public.lab_treasury_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lab_treasury_select" ON public.lab_treasury_movements;
CREATE POLICY "lab_treasury_select" ON public.lab_treasury_movements FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'general_manager')
  OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'accountant')
  OR public.has_role(auth.uid(),'financial_manager')
  OR public.has_role(auth.uid(),'lab_treasury_keeper')
  OR created_by = auth.uid()
);

DROP POLICY IF EXISTS "lab_treasury_insert" ON public.lab_treasury_movements;
CREATE POLICY "lab_treasury_insert" ON public.lab_treasury_movements FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND status = 'pending'
  AND (
    public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'accountant')
    OR public.has_role(auth.uid(),'financial_manager')
    OR public.has_role(auth.uid(),'lab_treasury_keeper')
  )
);

DROP POLICY IF EXISTS "lab_treasury_update_managers" ON public.lab_treasury_movements;
CREATE POLICY "lab_treasury_update_managers" ON public.lab_treasury_movements FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager'))
WITH CHECK (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager'));

DROP POLICY IF EXISTS "lab_treasury_delete_gm" ON public.lab_treasury_movements;
CREATE POLICY "lab_treasury_delete_gm" ON public.lab_treasury_movements FOR DELETE TO authenticated
USING (public.has_role(auth.uid(),'general_manager'));

CREATE OR REPLACE FUNCTION public.lab_treasury_validate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.movement_type = 'income' AND NEW.income_category IS NULL THEN
    RAISE EXCEPTION 'income_category مطلوب لحركة إيراد';
  END IF;
  IF NEW.movement_type = 'expense' AND NEW.expense_category IS NULL THEN
    RAISE EXCEPTION 'expense_category مطلوب لحركة مصروف';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'approved' AND NEW.status = 'approved' THEN
    NEW.approved_by := COALESCE(NEW.approved_by, auth.uid());
    NEW.approved_at := COALESCE(NEW.approved_at, now());
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_lab_treasury_validate ON public.lab_treasury_movements;
CREATE TRIGGER trg_lab_treasury_validate BEFORE INSERT OR UPDATE ON public.lab_treasury_movements
FOR EACH ROW EXECUTE FUNCTION public.lab_treasury_validate();

CREATE OR REPLACE FUNCTION public.lab_treasury_recalc_balances()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; running numeric := 0;
BEGIN
  UPDATE public.lab_treasury_movements SET balance_after = NULL WHERE status <> 'approved';
  FOR r IN
    SELECT id, movement_type, amount FROM public.lab_treasury_movements
    WHERE status = 'approved' ORDER BY movement_date ASC, created_at ASC
  LOOP
    IF r.movement_type = 'income' THEN running := running + r.amount;
    ELSE running := running - r.amount; END IF;
    UPDATE public.lab_treasury_movements SET balance_after = running WHERE id = r.id;
  END LOOP;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_lab_treasury_recalc ON public.lab_treasury_movements;
CREATE TRIGGER trg_lab_treasury_recalc
AFTER INSERT OR UPDATE OF status, amount, movement_type, movement_date OR DELETE
ON public.lab_treasury_movements
FOR EACH STATEMENT EXECUTE FUNCTION public.lab_treasury_recalc_balances();

CREATE OR REPLACE VIEW public.v_lab_treasury_balances AS
SELECT
  payment_method,
  COALESCE(SUM(CASE WHEN movement_type='income' AND status='approved' THEN amount
                    WHEN movement_type='expense' AND status='approved' THEN -amount END),0) AS balance_approved,
  COALESCE(SUM(CASE WHEN movement_type='income' AND status IN ('approved','pending') THEN amount
                    WHEN movement_type='expense' AND status IN ('approved','pending') THEN -amount END),0) AS balance_estimated
FROM public.lab_treasury_movements
GROUP BY payment_method;

GRANT SELECT ON public.v_lab_treasury_balances TO authenticated;

CREATE OR REPLACE VIEW public.v_lab_treasury_dashboard AS
WITH today_range AS (SELECT (now() AT TIME ZONE 'Africa/Cairo')::date AS d),
month_range AS (SELECT date_trunc('month', (now() AT TIME ZONE 'Africa/Cairo')::date)::date AS m_start)
SELECT
  COALESCE(SUM(CASE WHEN m.movement_date=(SELECT d FROM today_range) AND m.movement_type='income' AND m.status='approved' THEN m.amount END),0) AS income_today,
  COALESCE(SUM(CASE WHEN m.movement_date=(SELECT d FROM today_range) AND m.movement_type='expense' AND m.status='approved' THEN m.amount END),0) AS expense_today,
  COALESCE(SUM(CASE WHEN m.movement_date>=(SELECT m_start FROM month_range) AND m.movement_type='income' AND m.status='approved' THEN m.amount END),0) AS income_month,
  COALESCE(SUM(CASE WHEN m.movement_date>=(SELECT m_start FROM month_range) AND m.movement_type='expense' AND m.status='approved' THEN m.amount END),0) AS expense_month,
  COALESCE(SUM(CASE WHEN m.income_category='hatching' AND m.status='approved' THEN m.amount END),0) AS total_hatching_income,
  COALESCE(SUM(CASE WHEN m.income_category='chick_sales' AND m.status='approved' THEN m.amount END),0) AS total_chick_sales_income,
  COALESCE(SUM(CASE WHEN m.movement_type='income' AND m.status='approved' THEN m.amount
                    WHEN m.movement_type='expense' AND m.status='approved' THEN -m.amount END),0) AS total_balance
FROM public.lab_treasury_movements m;

GRANT SELECT ON public.v_lab_treasury_dashboard TO authenticated;
