CREATE OR REPLACE FUNCTION public.enforce_hr_deduction_approval_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only restrict transitions that actually change status to approved/rejected
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('approved','rejected') THEN
    IF NOT public.can_approve_hr_deductions(auth.uid()) THEN
      RAISE EXCEPTION 'Only General Manager or Executive Manager can approve/reject HR deductions';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_hr_deduction_approval_role ON public.hr_deductions;
CREATE TRIGGER trg_enforce_hr_deduction_approval_role
  BEFORE UPDATE ON public.hr_deductions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_hr_deduction_approval_role();