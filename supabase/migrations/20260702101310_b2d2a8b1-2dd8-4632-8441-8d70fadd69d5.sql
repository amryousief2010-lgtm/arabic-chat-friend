
CREATE OR REPLACE FUNCTION public.audit_hr_payroll_payouts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.hr_audit_log (
    entity_type, entity_id, employee_id, action, performed_by, before_data, after_data, reason
  ) VALUES (
    'hr_payroll_payouts',
    COALESCE(NEW.id, OLD.id),
    COALESCE(NEW.employee_id, OLD.employee_id),
    TG_OP,
    auth.uid(),
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END,
    'Payroll payout ' || TG_OP
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;
