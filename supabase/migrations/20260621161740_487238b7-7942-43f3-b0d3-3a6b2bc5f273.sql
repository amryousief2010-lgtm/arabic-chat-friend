
CREATE OR REPLACE FUNCTION public.can_record_hr_deductions(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid
      AND role IN ('general_manager','executive_manager','hr_manager','accountant','financial_manager')
  );
$function$;
