
ALTER TABLE public.hr_employees
  ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspension_date date,
  ADD COLUMN IF NOT EXISTS suspension_reason text,
  ADD COLUMN IF NOT EXISTS suspension_notes text,
  ADD COLUMN IF NOT EXISTS suspension_net_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS suspended_by uuid,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz;

CREATE TABLE IF NOT EXISTS public.hr_employee_suspensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('suspend','reactivate')),
  suspension_date date NOT NULL,
  reason text NOT NULL,
  notes text,
  base_salary numeric(12,2) NOT NULL DEFAULT 0,
  daily_value numeric(12,2) NOT NULL DEFAULT 0,
  days_count numeric(6,2) NOT NULL DEFAULT 0,
  gross_amount numeric(12,2) NOT NULL DEFAULT 0,
  deductions_amount numeric(12,2) NOT NULL DEFAULT 0,
  advances_amount numeric(12,2) NOT NULL DEFAULT 0,
  net_amount numeric(12,2) NOT NULL DEFAULT 0,
  performed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_employee_suspensions_emp ON public.hr_employee_suspensions(employee_id, created_at DESC);

GRANT SELECT, INSERT ON public.hr_employee_suspensions TO authenticated;
GRANT ALL ON public.hr_employee_suspensions TO service_role;

ALTER TABLE public.hr_employee_suspensions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "managers read suspensions" ON public.hr_employee_suspensions;
CREATE POLICY "managers read suspensions" ON public.hr_employee_suspensions
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'general_manager') OR
    public.has_role(auth.uid(),'executive_manager') OR
    public.has_role(auth.uid(),'hr_manager')
  );

DROP POLICY IF EXISTS "managers insert suspensions" ON public.hr_employee_suspensions;
CREATE POLICY "managers insert suspensions" ON public.hr_employee_suspensions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'general_manager') OR
    public.has_role(auth.uid(),'executive_manager') OR
    public.has_role(auth.uid(),'hr_manager')
  );
