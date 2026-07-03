-- Tighten hr_employees SELECT to exclude accountant/financial_manager
DROP POLICY IF EXISTS hr_employees_read_admins ON public.hr_employees;
CREATE POLICY hr_employees_read_admins ON public.hr_employees
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'general_manager'::app_role)
  OR has_role(auth.uid(), 'executive_manager'::app_role)
  OR has_role(auth.uid(), 'hr_manager'::app_role)
  OR user_id = auth.uid()
);

-- Masked view without national_id for accountants/financial managers
CREATE OR REPLACE VIEW public.hr_employees_masked
WITH (security_invoker = on) AS
SELECT
  id, code, full_name, phone, job_title, department, current_location_id,
  employment_type, base_salary, daily_rate, start_date, status, notes,
  user_id, created_by, created_at, updated_at, pay_day,
  is_suspended, suspension_date, suspension_reason, suspension_notes,
  suspension_net_amount, suspended_by, suspended_at
FROM public.hr_employees
WHERE
  has_role(auth.uid(), 'general_manager'::app_role)
  OR has_role(auth.uid(), 'executive_manager'::app_role)
  OR has_role(auth.uid(), 'hr_manager'::app_role)
  OR has_role(auth.uid(), 'accountant'::app_role)
  OR has_role(auth.uid(), 'financial_manager'::app_role)
  OR user_id = auth.uid();

GRANT SELECT ON public.hr_employees_masked TO authenticated;