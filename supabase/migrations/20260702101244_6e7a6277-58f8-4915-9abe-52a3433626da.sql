
CREATE TABLE public.hr_payroll_payouts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  month SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year SMALLINT NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  pay_day SMALLINT NOT NULL DEFAULT 1,
  base_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  bonus_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  advances_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  penalties_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  absence_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_deductions_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','reversed')),
  notes TEXT,
  paid_by UUID REFERENCES auth.users(id),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, month, year)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_payroll_payouts TO authenticated;
GRANT ALL ON public.hr_payroll_payouts TO service_role;

ALTER TABLE public.hr_payroll_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payroll_payouts_select"
  ON public.hr_payroll_payouts FOR SELECT
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'hr_manager'::app_role,'accountant'::app_role,'financial_manager'::app_role]));

CREATE POLICY "payroll_payouts_insert"
  ON public.hr_payroll_payouts FOR INSERT
  TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'hr_manager'::app_role,'accountant'::app_role,'financial_manager'::app_role]));

CREATE POLICY "payroll_payouts_update"
  ON public.hr_payroll_payouts FOR UPDATE
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role]));

CREATE POLICY "payroll_payouts_delete"
  ON public.hr_payroll_payouts FOR DELETE
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role]));

CREATE INDEX idx_payroll_payouts_period ON public.hr_payroll_payouts(year, month);
CREATE INDEX idx_payroll_payouts_emp ON public.hr_payroll_payouts(employee_id, year, month);

CREATE TRIGGER trg_payroll_payouts_updated_at
  BEFORE UPDATE ON public.hr_payroll_payouts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.audit_hr_payroll_payouts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.hr_audit_log (
    entity_type, entity_id, action, changed_by, old_data, new_data, notes
  ) VALUES (
    'hr_payroll_payouts',
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    auth.uid(),
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END,
    'Payroll payout ' || TG_OP
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_payroll_payouts
  AFTER INSERT OR UPDATE OR DELETE ON public.hr_payroll_payouts
  FOR EACH ROW EXECUTE FUNCTION public.audit_hr_payroll_payouts();
