
CREATE TABLE public.hr_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  deduction_date date NOT NULL DEFAULT current_date,
  month smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  year smallint NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  deduction_type text NOT NULL CHECK (deduction_type IN ('absence','late','penalty','damages','advance_repayment','administrative','other')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  reason text,
  notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reference_id text UNIQUE,
  created_by uuid REFERENCES auth.users(id),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  rejected_by uuid REFERENCES auth.users(id),
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_hr_deductions_emp ON public.hr_deductions(employee_id, year, month);
CREATE INDEX idx_hr_deductions_status ON public.hr_deductions(status);
CREATE INDEX idx_hr_deductions_period ON public.hr_deductions(year, month);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_deductions TO authenticated;
GRANT ALL ON public.hr_deductions TO service_role;

ALTER TABLE public.hr_deductions ENABLE ROW LEVEL SECURITY;

-- Who can view deductions
CREATE OR REPLACE FUNCTION public.can_view_hr_deductions(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid
      AND role IN ('general_manager','executive_manager','hr_manager','accountant','financial_manager')
  );
$$;

-- Who can create/edit (accountants, HR, GM, exec)
CREATE OR REPLACE FUNCTION public.can_record_hr_deductions(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid
      AND role IN ('general_manager','executive_manager','hr_manager','accountant','financial_manager')
  );
$$;

-- Who can approve/reject
CREATE OR REPLACE FUNCTION public.can_approve_hr_deductions(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid
      AND role IN ('general_manager','executive_manager','hr_manager')
  );
$$;

CREATE POLICY "View HR deductions (authorized)"
  ON public.hr_deductions FOR SELECT TO authenticated
  USING (public.can_view_hr_deductions(auth.uid()));

CREATE POLICY "Insert HR deductions"
  ON public.hr_deductions FOR INSERT TO authenticated
  WITH CHECK (public.can_record_hr_deductions(auth.uid()));

CREATE POLICY "Update HR deductions"
  ON public.hr_deductions FOR UPDATE TO authenticated
  USING (public.can_record_hr_deductions(auth.uid()))
  WITH CHECK (public.can_record_hr_deductions(auth.uid()));

CREATE POLICY "Delete HR deductions (approvers)"
  ON public.hr_deductions FOR DELETE TO authenticated
  USING (public.can_approve_hr_deductions(auth.uid()));

CREATE OR REPLACE FUNCTION public.set_hr_deductions_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_hr_deductions_updated_at
  BEFORE UPDATE ON public.hr_deductions
  FOR EACH ROW EXECUTE FUNCTION public.set_hr_deductions_updated_at();
