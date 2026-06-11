
CREATE OR REPLACE FUNCTION public.confirm_main_to_custody_transfer(p_transfer_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_xfer record;
  v_parent_status text;
  v_opening_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF NOT (
    has_role(v_user, 'slaughterhouse_custody_keeper'::app_role)
    OR has_role(v_user, 'general_manager'::app_role)
    OR has_role(v_user, 'executive_manager'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_xfer
  FROM main_treasury_to_custody_transfers
  WHERE id = p_transfer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'transfer_not_found';
  END IF;

  IF v_xfer.received_at IS NOT NULL OR v_xfer.status = 'received' THEN
    RAISE EXCEPTION 'already_received';
  END IF;

  SELECT status INTO v_parent_status FROM main_treasury_transactions WHERE id = v_xfer.main_txn_id;
  IF v_parent_status NOT IN ('posted','approved') THEN
    RAISE EXCEPTION 'parent_not_approved';
  END IF;

  UPDATE main_treasury_to_custody_transfers
  SET received_at = now(), received_by = v_user, status = 'received'
  WHERE id = p_transfer_id;

  -- Add to custody balance as approved opening (idempotent via unique source_main_txn_id)
  INSERT INTO slaughter_custody_opening_balances (
    as_of_date, total_amount, cash_amount, status, notes,
    created_by, approved_by, approved_at, source_main_txn_id
  ) VALUES (
    COALESCE(v_xfer.transfer_date, CURRENT_DATE),
    v_xfer.amount, v_xfer.amount, 'approved',
    'تحويل من الخزنة الرئيسية - ' || COALESCE(v_xfer.notes,''),
    v_user, v_user, now(), v_xfer.main_txn_id
  )
  ON CONFLICT (source_main_txn_id) WHERE source_main_txn_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_opening_id;

  RETURN v_opening_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_main_to_custody_transfer(uuid) TO authenticated;
