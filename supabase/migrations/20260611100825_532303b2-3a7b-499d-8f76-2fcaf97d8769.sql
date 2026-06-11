
CREATE OR REPLACE FUNCTION public.confirm_lab_to_custody_transfer(p_transfer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  r record;
  v_cash numeric := 0; v_vc numeric := 0; v_ip numeric := 0; v_bt numeric := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT (
    public.has_role(v_uid,'slaughterhouse_custody_keeper')
    OR public.has_role(v_uid,'general_manager')
    OR public.has_role(v_uid,'executive_manager')
  ) THEN
    RAISE EXCEPTION 'insufficient privileges to confirm';
  END IF;

  SELECT * INTO r FROM public.lab_treasury_to_custody_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer not found'; END IF;
  IF r.status = 'received' THEN
    RAISE EXCEPTION 'تم تأكيد هذا التحويل من قبل';
  END IF;

  UPDATE public.lab_treasury_to_custody_transfers
    SET status='received', received_at=now(), received_by=v_uid
    WHERE id = p_transfer_id;

  IF r.payment_method = 'vodafone_cash' THEN v_vc := r.amount;
  ELSIF r.payment_method = 'instapay' THEN v_ip := r.amount;
  ELSIF r.payment_method = 'bank_transfer' THEN v_bt := r.amount;
  ELSE v_cash := r.amount; END IF;

  INSERT INTO public.slaughter_custody_opening_balances (
    as_of_date, total_amount, cash_amount, vodafone_cash_amount,
    instapay_amount, bank_transfer_amount, status, notes,
    created_by, approved_by, approved_at, source_lab_movement_id
  ) VALUES (
    r.transfer_date, r.amount, v_cash, v_vc, v_ip, v_bt,
    'approved',
    'تحويل وارد من خزنة المعمل' || COALESCE(' — ' || r.notes, ''),
    v_uid, v_uid, now(), r.lab_movement_id
  )
  ON CONFLICT (source_lab_movement_id) DO NOTHING;
END;
$$;
