CREATE OR REPLACE FUNCTION public.hr_match_employee_by_name(p_name text)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_norm text;
BEGIN
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RETURN NULL;
  END IF;
  v_norm := public.hr_norm_name(p_name);

  SELECT id INTO v_id
  FROM hr_employees
  WHERE public.hr_norm_name(full_name) = v_norm
    AND status = 'active'
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT employee_id INTO v_id
  FROM hr_employee_name_aliases
  WHERE public.hr_norm_name(raw_name) = v_norm
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT employee_id INTO v_id
  FROM hr_employee_name_aliases
  WHERE length(public.hr_norm_name(raw_name)) >= 5
    AND v_norm ILIKE '%' || public.hr_norm_name(raw_name) || '%'
  ORDER BY length(public.hr_norm_name(raw_name)) DESC
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT id INTO v_id
  FROM hr_employees e
  WHERE status = 'active'
    AND public.hr_norm_name(e.full_name) ILIKE '%' || v_norm || '%'
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT id INTO v_id
  FROM hr_employees e
  WHERE status = 'active'
    AND v_norm ILIKE '%' || public.hr_norm_name(e.full_name) || '%'
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT id INTO v_id
  FROM hr_employees e
  WHERE status = 'active'
    AND v_norm ILIKE '%' || split_part(public.hr_norm_name(e.full_name), ' ', 1) || ' ' || split_part(public.hr_norm_name(e.full_name), ' ', 2) || '%'
  LIMIT 1;

  RETURN v_id;
END
$function$;