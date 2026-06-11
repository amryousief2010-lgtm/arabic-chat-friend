CREATE OR REPLACE FUNCTION public.create_lab_to_custody_transfer(p_amount numeric, p_transfer_date date, p_custody_keeper_id uuid, p_payment_method text DEFAULT 'cash'::text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_mov_id uuid;
  v_xfer_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (
    public.has_role(v_uid,'general_manager')
    OR public.has_role(v_uid,'executive_manager')
    OR public.has_role(v_uid,'lab_treasury_approver')
    OR public.has_role(v_uid,'lab_treasury_keeper')
  ) THEN
    RAISE EXCEPTION 'insufficient privileges to transfer from lab treasury';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0';
  END IF;

  INSERT INTO public.lab_treasury_movements (
    movement_type, movement_date, expense_category, beneficiary,
    amount, payment_method, description, notes, status,
    created_by, approved_by, approved_at
  ) VALUES (
    'expense', COALESCE(p_transfer_date, CURRENT_DATE), 'other', 'خزنة عهدة المجزر',
    p_amount, COALESCE(p_payment_method,'cash')::lab_treasury_payment_method,
    'تحويل من خزنة المعمل إلى خزنة عهدة المجزر',
    p_notes, 'approved',
    v_uid, v_uid, now()
  ) RETURNING id INTO v_mov_id;

  INSERT INTO public.lab_treasury_to_custody_transfers (
    lab_movement_id, custody_keeper_id, amount, payment_method,
    transfer_date, status, notes, created_by
  ) VALUES (
    v_mov_id, p_custody_keeper_id, p_amount, COALESCE(p_payment_method,'cash'),
    COALESCE(p_transfer_date, CURRENT_DATE), 'sent', p_notes, v_uid
  ) RETURNING id INTO v_xfer_id;

  RETURN v_xfer_id;
END;
$function$;