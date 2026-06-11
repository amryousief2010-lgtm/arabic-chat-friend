
-- Link transfer record to the main treasury income transaction it creates
ALTER TABLE public.lab_treasury_to_custody_transfers
  ADD COLUMN IF NOT EXISTS main_txn_id uuid REFERENCES public.main_treasury_transactions(id) ON DELETE SET NULL;

-- Rewrite create: deduct lab + insert PENDING main treasury income txn
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

  -- Pick the primary main treasury cash account
  SELECT id INTO v_main_account_id
  FROM public.main_treasury_accounts
  WHERE account_type = 'cash'
  ORDER BY created_at ASC
  LIMIT 1;
  IF v_main_account_id IS NULL THEN
    RAISE EXCEPTION 'no main treasury account configured';
  END IF;

  -- 1) Deduct from lab treasury immediately (approved expense)
  INSERT INTO public.lab_treasury_movements (
    movement_type, movement_date, expense_category, beneficiary,
    amount, payment_method, description, notes, status,
    created_by, approved_by, approved_at
  ) VALUES (
    'expense', COALESCE(p_transfer_date, CURRENT_DATE), 'other', 'الخزنة الرئيسية للمجزر',
    p_amount, COALESCE(p_payment_method,'cash')::lab_treasury_payment_method,
    'تحويل من خزنة المعمل إلى الخزنة الرئيسية للمجزر',
    p_notes, 'approved',
    v_uid, v_uid, now()
  ) RETURNING id INTO v_mov_id;

  -- 2) Create a PENDING income txn on the main treasury (awaiting receipt confirmation)
  INSERT INTO public.main_treasury_transactions (
    account_id, txn_type, amount, txn_date, counterparty, description,
    status, payment_method, incoming_source, created_by
  ) VALUES (
    v_main_account_id, 'income', p_amount, COALESCE(p_transfer_date, CURRENT_DATE),
    'خزنة المعمل والحضانات',
    'تحويل وارد من خزنة المعمل' || COALESCE(' — ' || p_notes, ''),
    'pending_approval', COALESCE(p_payment_method,'cash'),
    'lab_treasury', v_uid
  ) RETURNING id INTO v_main_txn_id;

  -- 3) Link record between the two
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

-- Rewrite confirm: post main treasury txn instead of crediting custody
CREATE OR REPLACE FUNCTION public.confirm_lab_to_custody_transfer(p_transfer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  r record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT (
    public.has_role(v_uid,'slaughterhouse_custody_keeper')
    OR public.has_role(v_uid,'general_manager')
    OR public.has_role(v_uid,'executive_manager')
    OR public.has_role(v_uid,'main_treasury_accountant')
  ) THEN
    RAISE EXCEPTION 'insufficient privileges to confirm';
  END IF;

  SELECT * INTO r FROM public.lab_treasury_to_custody_transfers
    WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer not found'; END IF;
  IF r.status = 'received' THEN
    RAISE EXCEPTION 'تم تأكيد هذا التحويل من قبل';
  END IF;

  UPDATE public.lab_treasury_to_custody_transfers
    SET status='received', received_at=now(), received_by=v_uid
    WHERE id = p_transfer_id;

  -- Post the linked main treasury income transaction (credits the main balance)
  IF r.main_txn_id IS NOT NULL THEN
    UPDATE public.main_treasury_transactions
      SET status = 'posted',
          posted_at = now(),
          approver_1_id = COALESCE(approver_1_id, v_uid),
          approver_1_at = COALESCE(approver_1_at, now())
      WHERE id = r.main_txn_id
        AND status <> 'posted';
  END IF;
END;
$function$;
