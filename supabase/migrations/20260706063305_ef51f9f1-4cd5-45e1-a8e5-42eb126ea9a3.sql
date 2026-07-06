
CREATE OR REPLACE FUNCTION public.reassign_order_to_company(p_order_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_old_owner uuid;
  v_order_number text;
  v_old_name text;
  v_caller_name text;
  v_audit_id uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.has_any_role(v_caller, ARRAY['general_manager','executive_manager','marketing_sales_manager']::app_role[]) THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;

  SELECT created_by, order_number INTO v_old_owner, v_order_number FROM public.orders WHERE id = p_order_id;
  IF v_order_number IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;

  SELECT full_name INTO v_old_name FROM public.profile_directory WHERE id = v_old_owner;
  SELECT full_name INTO v_caller_name FROM public.profile_directory WHERE id = v_caller;

  UPDATE public.orders
  SET moderator = 'الشركة'
  WHERE id = p_order_id;

  INSERT INTO public.order_owner_reassignment_audit
    (order_id, order_number, old_owner_id, old_owner_name, new_owner_id, new_owner_name, reason, changed_by, changed_by_name)
  VALUES
    (p_order_id, v_order_number, v_old_owner, v_old_name, NULL, 'الشركة', btrim(p_reason), v_caller, v_caller_name)
  RETURNING id INTO v_audit_id;

  RETURN v_audit_id;
END;
$function$;
