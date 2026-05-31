CREATE OR REPLACE FUNCTION public.cancel_transfer_request(p_transfer_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_transfer record;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  SELECT * INTO v_transfer FROM public.warehouse_transfers WHERE id = p_transfer_id;
  IF v_transfer IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Transfer not found');
  END IF;

  IF v_transfer.created_by <> v_user_id
     AND NOT public.has_any_role(v_user_id, ARRAY['general_manager'::app_role, 'executive_manager'::app_role]) THEN
    RETURN json_build_object('success', false, 'message', 'Only the requester or management can cancel');
  END IF;

  IF v_transfer.status NOT IN ('pending_approval', 'rejected', 'draft') THEN
    RETURN json_build_object('success', false, 'message', 'Cannot cancel a transfer that is already in progress or completed');
  END IF;

  UPDATE public.warehouse_transfers
  SET status = 'cancelled',
      cancelled_by = v_user_id,
      cancelled_at = now()
  WHERE id = p_transfer_id;

  RETURN json_build_object('success', true, 'message', 'Transfer cancelled');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cancel_transfer_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_transfer_request(uuid) TO service_role;