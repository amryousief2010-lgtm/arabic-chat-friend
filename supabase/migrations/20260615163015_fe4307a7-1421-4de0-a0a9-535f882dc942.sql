
-- Restrict HR documents view/manage to General Manager + Executive Manager only
CREATE OR REPLACE FUNCTION public.can_view_hr_documents(_uid uuid)
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

CREATE OR REPLACE FUNCTION public.can_manage_hr_documents(_uid uuid)
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

-- RPC that exposes ONLY document status (no file_url, no storage_path)
-- Available to GM, Executive Manager, and Mohamed Shaala
CREATE OR REPLACE FUNCTION public.get_hr_documents_status()
RETURNS TABLE (employee_id uuid, has_id boolean, has_contract boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _allowed boolean;
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  SELECT (
    _uid = 'd1d37093-182a-4ee9-932c-d2a2b45f33ec'::uuid
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _uid
        AND role IN ('general_manager','executive_manager')
    )
  ) INTO _allowed;
  IF NOT _allowed THEN RETURN; END IF;

  RETURN QUERY
    SELECT d.employee_id,
           bool_or(d.document_type = 'national_id_card') AS has_id,
           bool_or(d.document_type = 'work_contract') AS has_contract
      FROM public.hr_employee_documents d
     WHERE d.is_active = true
     GROUP BY d.employee_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_hr_documents_status() TO authenticated;
