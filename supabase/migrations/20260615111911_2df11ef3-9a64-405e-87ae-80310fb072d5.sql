
-- Restrict deduction recording to Mohamed Shaala + GM + Executive Manager only
CREATE OR REPLACE FUNCTION public.can_record_hr_deductions(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    _uid = 'd1d37093-182a-4ee9-932c-d2a2b45f33ec'::uuid
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _uid
        AND role IN ('general_manager','executive_manager')
    );
$function$;

-- Approval restricted to GM + Executive Manager only (remove hr_manager)
CREATE OR REPLACE FUNCTION public.can_approve_hr_deductions(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid
      AND role IN ('general_manager','executive_manager')
  );
$function$;

-- Allow Mohamed Shaala to view his own records too
CREATE OR REPLACE FUNCTION public.can_view_hr_deductions(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    _uid = 'd1d37093-182a-4ee9-932c-d2a2b45f33ec'::uuid
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _uid
        AND role IN ('general_manager','executive_manager','hr_manager','accountant','financial_manager')
    );
$function$;
