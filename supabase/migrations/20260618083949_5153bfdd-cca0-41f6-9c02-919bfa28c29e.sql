
-- 1) Allow 'days_deduction' as a valid deduction_type
ALTER TABLE public.hr_deductions DROP CONSTRAINT IF EXISTS hr_deductions_deduction_type_check;
ALTER TABLE public.hr_deductions ADD CONSTRAINT hr_deductions_deduction_type_check
  CHECK (deduction_type = ANY (ARRAY[
    'absence','late','penalty','damages',
    'advance_repayment','administrative','days_deduction','other'
  ]));

-- 2) Approval enforcement + auto-stamp + audit log on status change
CREATE OR REPLACE FUNCTION public.trg_hr_deductions_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_is_approver boolean;
BEGIN
  v_uid := auth.uid();
  v_is_approver := COALESCE(
    public.has_role(v_uid, 'general_manager'::app_role) OR
    public.has_role(v_uid, 'executive_manager'::app_role), false);

  IF TG_OP = 'INSERT' THEN
    -- New rows must start pending unless approver inserts an approved one
    IF NEW.status = 'approved' AND NOT v_is_approver THEN
      NEW.status := 'pending';
    END IF;
    IF NEW.status = 'rejected' AND NOT v_is_approver THEN
      RAISE EXCEPTION 'غير مصرح: فقط المدير العام أو التنفيذي يمكنه رفض الخصم';
    END IF;
    IF NEW.created_by IS NULL THEN NEW.created_by := v_uid; END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.status <> OLD.status THEN
    IF NEW.status IN ('approved','rejected') AND NOT v_is_approver THEN
      RAISE EXCEPTION 'غير مصرح: فقط المدير العام أو التنفيذي يمكنه اعتماد أو رفض الخصم';
    END IF;
    IF NEW.status = 'approved' THEN
      NEW.approved_by := COALESCE(NEW.approved_by, v_uid);
      NEW.approved_at := COALESCE(NEW.approved_at, now());
    ELSIF NEW.status = 'rejected' THEN
      NEW.rejected_by := COALESCE(NEW.rejected_by, v_uid);
      NEW.rejected_at := COALESCE(NEW.rejected_at, now());
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_hr_deductions_guard ON public.hr_deductions;
CREATE TRIGGER trg_hr_deductions_guard
BEFORE INSERT OR UPDATE ON public.hr_deductions
FOR EACH ROW EXECUTE FUNCTION public.trg_hr_deductions_guard();

-- 3) Audit log on insert + status change
CREATE OR REPLACE FUNCTION public.trg_hr_deductions_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO hr_audit_log(entity_type, entity_id, employee_id, action, after_data, reason, performed_by)
    VALUES ('hr_deduction', NEW.id, NEW.employee_id, 'create',
            to_jsonb(NEW), NEW.reason, auth.uid());
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO hr_audit_log(entity_type, entity_id, employee_id, action, before_data, after_data, reason, performed_by)
    VALUES ('hr_deduction', NEW.id, NEW.employee_id,
            CASE NEW.status WHEN 'approved' THEN 'approve' WHEN 'rejected' THEN 'reject' ELSE 'update' END,
            to_jsonb(OLD), to_jsonb(NEW),
            COALESCE(NEW.rejection_reason, NEW.reason),
            auth.uid());
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_hr_deductions_audit ON public.hr_deductions;
CREATE TRIGGER trg_hr_deductions_audit
AFTER INSERT OR UPDATE OF status ON public.hr_deductions
FOR EACH ROW EXECUTE FUNCTION public.trg_hr_deductions_audit();

-- 4) Monthly payroll view (approved deductions only)
CREATE OR REPLACE VIEW public.v_hr_employee_monthly_payroll AS
WITH months AS (
  SELECT employee_id, month, year FROM hr_deductions GROUP BY 1,2,3
), agg AS (
  SELECT
    employee_id, month, year,
    SUM(CASE WHEN status='approved' AND deduction_type='advance_repayment' THEN amount ELSE 0 END) AS advances_approved,
    SUM(CASE WHEN status='approved' AND deduction_type='absence' THEN amount ELSE 0 END) AS absence_approved,
    SUM(CASE WHEN status='approved' AND deduction_type='days_deduction' THEN amount ELSE 0 END) AS days_deduction_approved,
    SUM(CASE WHEN status='approved' AND deduction_type NOT IN ('advance_repayment','absence','days_deduction') THEN amount ELSE 0 END) AS other_deductions_approved,
    SUM(CASE WHEN status='approved' THEN amount ELSE 0 END) AS total_deductions_approved,
    SUM(CASE WHEN status='pending' THEN amount ELSE 0 END) AS pending_total
  FROM hr_deductions
  GROUP BY employee_id, month, year
)
SELECT
  e.id AS employee_id,
  e.full_name AS employee_name,
  e.department,
  a.month, a.year,
  COALESCE(e.base_salary, 0) AS base_salary,
  COALESCE(a.advances_approved,0) AS advances_approved,
  COALESCE(a.absence_approved,0) AS absence_approved,
  COALESCE(a.days_deduction_approved,0) AS days_deduction_approved,
  COALESCE(a.other_deductions_approved,0) AS other_deductions_approved,
  COALESCE(a.total_deductions_approved,0) AS total_deductions_approved,
  COALESCE(a.pending_total,0) AS pending_total,
  GREATEST(COALESCE(e.base_salary,0) - COALESCE(a.total_deductions_approved,0), 0) AS net_salary
FROM hr_employees e
JOIN agg a ON a.employee_id = e.id;

GRANT SELECT ON public.v_hr_employee_monthly_payroll TO authenticated;
