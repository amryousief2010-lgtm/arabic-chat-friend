
CREATE OR REPLACE FUNCTION public.create_lab_to_custody_transfer(
  p_amount numeric,
  p_transfer_date date,
  p_custody_keeper_id uuid,
  p_payment_method text DEFAULT 'cash'::text,
  p_notes text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_mov_id uuid;
  v_xfer_id uuid;
  v_main_account_id uuid;
  v_main_txn_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
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

  SELECT id INTO v_main_account_id
  FROM public.main_treasury_accounts
  WHERE account_type = 'cash'
  ORDER BY created_at ASC LIMIT 1;
  IF v_main_account_id IS NULL THEN
    RAISE EXCEPTION 'no main treasury account configured';
  END IF;

  -- 1) Deduct from lab treasury immediately
  INSERT INTO public.lab_treasury_movements (
    movement_type, movement_date, expense_category, beneficiary,
    amount, payment_method, description, notes, status,
    created_by, approved_by, approved_at
  ) VALUES (
    'expense', COALESCE(p_transfer_date, CURRENT_DATE), 'other', 'الخزنة الرئيسية للمجزر',
    p_amount, COALESCE(p_payment_method,'cash')::lab_treasury_payment_method,
    'تحويل من خزنة المعمل إلى الخزنة الرئيسية للمجزر',
    p_notes, 'approved', v_uid, v_uid, now()
  ) RETURNING id INTO v_mov_id;

  -- 2) Insert PENDING deposit on main treasury (override any auto-post by approval rule)
  INSERT INTO public.main_treasury_transactions (
    account_id, txn_type, amount, txn_date, counterparty, description,
    status, payment_method, incoming_source, created_by
  ) VALUES (
    v_main_account_id, 'deposit', p_amount, COALESCE(p_transfer_date, CURRENT_DATE),
    'خزنة المعمل والحضانات',
    'تحويل وارد من خزنة المعمل' || COALESCE(' — ' || p_notes, ''),
    'pending_approval', COALESCE(p_payment_method,'cash'),
    'lab_treasury', v_uid
  ) RETURNING id INTO v_main_txn_id;

  -- BEFORE INSERT trigger may auto-post small amounts — force back to pending
  UPDATE public.main_treasury_transactions
    SET status = 'pending_approval', posted_at = NULL
    WHERE id = v_main_txn_id AND status <> 'pending_approval';

  -- 3) Link record
  INSERT INTO public.lab_treasury_to_custody_transfers (
    lab_movement_id, custody_keeper_id, amount, payment_method,
    transfer_date, status, notes, created_by, main_txn_id
  ) VALUES (
    v_mov_id, p_custody_keeper_id, p_amount, COALESCE(p_payment_method,'cash'),
    COALESCE(p_transfer_date, CURRENT_DATE), 'sent', p_notes, v_uid, v_main_txn_id
  ) RETURNING id INTO v_xfer_id;

  RETURN v_xfer_id;
END;
$function$;
