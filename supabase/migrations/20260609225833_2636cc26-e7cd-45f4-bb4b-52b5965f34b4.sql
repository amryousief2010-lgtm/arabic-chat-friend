
-- Extend txn_type to include new internal-transfer + bank types
ALTER TABLE public.main_treasury_transactions DROP CONSTRAINT IF EXISTS main_treasury_transactions_txn_type_check;
ALTER TABLE public.main_treasury_transactions ADD CONSTRAINT main_treasury_transactions_txn_type_check
  CHECK (txn_type = ANY (ARRAY[
    'deposit','withdrawal','expense','transfer_to_custody','adjustment',
    'bank_deposit','bank_withdrawal','bank_fees','loan_installment',
    'transfer_from_custody','transfer_to_sub_treasury','transfer_to_bank',
    'settlement','balance_correction'
  ]));

-- Link both legs of cash<->bank transfer; capture purpose & people
ALTER TABLE public.main_treasury_transactions
  ADD COLUMN IF NOT EXISTS transfer_group_id uuid,
  ADD COLUMN IF NOT EXISTS deposit_purpose text,
  ADD COLUMN IF NOT EXISTS cash_handover_by text,
  ADD COLUMN IF NOT EXISTS bank_depositor_by text;

CREATE INDEX IF NOT EXISTS idx_mtt_transfer_group ON public.main_treasury_transactions(transfer_group_id) WHERE transfer_group_id IS NOT NULL;

-- Update balance view: treat transfer_to_bank as outflow from cash account
CREATE OR REPLACE VIEW public.v_main_treasury_balance AS
SELECT
  a.id AS account_id, a.name, a.account_type, a.bank_name, a.opening_balance,
  COALESCE(sum(CASE
    WHEN t.status='posted' AND t.txn_type = ANY (ARRAY['deposit','bank_deposit','transfer_from_custody','settlement']) THEN t.amount
    WHEN t.status='posted' AND t.txn_type = ANY (ARRAY['withdrawal','expense','bank_withdrawal','bank_fees','loan_installment','transfer_to_custody','transfer_to_sub_treasury','transfer_to_bank']) THEN -t.amount
    WHEN t.status='posted' AND t.txn_type = ANY (ARRAY['adjustment','balance_correction']) THEN t.amount
    ELSE 0 END),0) AS net_movements,
  a.opening_balance + COALESCE(sum(CASE
    WHEN t.status='posted' AND t.txn_type = ANY (ARRAY['deposit','bank_deposit','transfer_from_custody','settlement']) THEN t.amount
    WHEN t.status='posted' AND t.txn_type = ANY (ARRAY['withdrawal','expense','bank_withdrawal','bank_fees','loan_installment','transfer_to_custody','transfer_to_sub_treasury','transfer_to_bank']) THEN -t.amount
    WHEN t.status='posted' AND t.txn_type = ANY (ARRAY['adjustment','balance_correction']) THEN t.amount
    ELSE 0 END),0) AS current_balance,
  COALESCE(sum(CASE WHEN t.status='pending_approval' THEN t.amount ELSE 0 END),0) AS pending_amount,
  count(CASE WHEN t.status='pending_approval' THEN 1 END) AS pending_count
FROM public.main_treasury_accounts a
LEFT JOIN public.main_treasury_transactions t ON t.account_id = a.id
GROUP BY a.id, a.name, a.account_type, a.bank_name, a.opening_balance;

-- RPC: create the linked cash->bank deposit (two legs)
CREATE OR REPLACE FUNCTION public.mt_create_cash_to_bank_transfer(
  p_cash_account_id uuid,
  p_bank_account_id uuid,
  p_amount numeric,
  p_txn_date date,
  p_bank_name text,
  p_bank_account_number text,
  p_deposit_purpose text,
  p_cash_handover_by text,
  p_bank_depositor_by text,
  p_attachment_url text,
  p_description text,
  p_client_uuid uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_group uuid := gen_random_uuid();
  v_cash main_treasury_accounts;
  v_bank main_treasury_accounts;
  v_existing uuid;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر'; END IF;

  -- Duplicate protection via client_uuid
  IF p_client_uuid IS NOT NULL THEN
    SELECT transfer_group_id INTO v_existing FROM main_treasury_transactions WHERE client_uuid = p_client_uuid LIMIT 1;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  END IF;

  SELECT * INTO v_cash FROM main_treasury_accounts WHERE id = p_cash_account_id;
  IF NOT FOUND OR v_cash.account_type <> 'cash' THEN RAISE EXCEPTION 'الحساب المصدر يجب أن يكون نقدية'; END IF;
  SELECT * INTO v_bank FROM main_treasury_accounts WHERE id = p_bank_account_id;
  IF NOT FOUND OR v_bank.account_type <> 'bank' THEN RAISE EXCEPTION 'الحساب الهدف يجب أن يكون بنك'; END IF;

  -- Leg 1: out of cash
  INSERT INTO main_treasury_transactions(
    account_id, txn_type, amount, txn_date, description, counterparty,
    transfer_group_id, deposit_purpose, cash_handover_by, bank_depositor_by,
    bank_account_number, attachment_url, client_uuid, created_by, status
  ) VALUES (
    p_cash_account_id, 'transfer_to_bank', p_amount, p_txn_date,
    COALESCE(p_description, 'إيداع من الخزنة إلى البنك'),
    COALESCE(p_bank_name, v_bank.bank_name),
    v_group, p_deposit_purpose, p_cash_handover_by, p_bank_depositor_by,
    p_bank_account_number, p_attachment_url, p_client_uuid, auth.uid(), 'pending_approval'
  );

  -- Leg 2: into bank
  INSERT INTO main_treasury_transactions(
    account_id, txn_type, amount, txn_date, description, counterparty,
    transfer_group_id, deposit_purpose, cash_handover_by, bank_depositor_by,
    bank_account_number, attachment_url, created_by, status
  ) VALUES (
    p_bank_account_id, 'transfer_from_custody', p_amount, p_txn_date,
    COALESCE(p_description, 'إيداع من الخزنة إلى البنك'),
    'الخزنة النقدية',
    v_group, p_deposit_purpose, p_cash_handover_by, p_bank_depositor_by,
    p_bank_account_number, p_attachment_url, auth.uid(), 'pending_approval'
  );

  RETURN v_group;
END $$;

GRANT EXECUTE ON FUNCTION public.mt_create_cash_to_bank_transfer(uuid,uuid,numeric,date,text,text,text,text,text,text,text,uuid) TO authenticated;

-- RPC: approve entire transfer group (both legs atomically)
CREATE OR REPLACE FUNCTION public.mt_approve_transfer_group(p_group_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  IF NOT public.is_main_treasury_approver(auth.uid()) THEN
    RAISE EXCEPTION 'صلاحية اعتماد الخزنة الرئيسية فقط';
  END IF;
  FOR r IN SELECT id, created_by, status FROM main_treasury_transactions
           WHERE transfer_group_id = p_group_id FOR UPDATE LOOP
    IF r.created_by = auth.uid() THEN RAISE EXCEPTION 'لا يمكن اعتماد حركة سجلتها بنفسك'; END IF;
    IF r.status = 'pending_approval' THEN
      UPDATE main_treasury_transactions
        SET status='posted', posted_at=now(), approver_1_id=auth.uid(), approver_1_at=now()
        WHERE id = r.id;
      n := n + 1;
    END IF;
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION 'لا توجد حركات معلقة بهذا التحويل'; END IF;
  RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION public.mt_approve_transfer_group(uuid) TO authenticated;

-- When approving one leg via mt_approve_txn, auto-approve the sibling too
CREATE OR REPLACE FUNCTION public.mt_approve_txn(p_txn_id uuid)
RETURNS main_treasury_transactions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.main_treasury_transactions;
  sib record;
BEGIN
  IF NOT public.is_main_treasury_approver(auth.uid()) THEN
    RAISE EXCEPTION 'صلاحية اعتماد الخزنة الرئيسية فقط';
  END IF;
  SELECT * INTO t FROM public.main_treasury_transactions WHERE id = p_txn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المعاملة غير موجودة'; END IF;
  IF t.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'المعاملة ليست في حالة انتظار اعتماد (الحالة: %)', t.status;
  END IF;
  IF t.created_by = auth.uid() THEN RAISE EXCEPTION 'لا يمكن اعتماد حركة سجلتها بنفسك'; END IF;

  IF t.requires_dual_approval THEN
    IF t.approver_1_id IS NULL THEN
      UPDATE public.main_treasury_transactions
        SET approver_1_id = auth.uid(), approver_1_at = now()
        WHERE id = p_txn_id RETURNING * INTO t;
      RETURN t;
    ELSIF t.approver_1_id = auth.uid() THEN
      RAISE EXCEPTION 'يلزم اعتماد ثاني من معتمد مختلف';
    ELSE
      UPDATE public.main_treasury_transactions
        SET approver_2_id = auth.uid(), approver_2_at = now(),
            status = 'posted', posted_at = now()
        WHERE id = p_txn_id RETURNING * INTO t;
    END IF;
  ELSE
    UPDATE public.main_treasury_transactions
      SET approver_1_id = auth.uid(), approver_1_at = now(),
          status = 'posted', posted_at = now()
      WHERE id = p_txn_id RETURNING * INTO t;
  END IF;

  -- Auto-post sibling legs (internal transfer)
  IF t.transfer_group_id IS NOT NULL THEN
    FOR sib IN SELECT id FROM public.main_treasury_transactions
               WHERE transfer_group_id = t.transfer_group_id AND id <> t.id AND status='pending_approval' FOR UPDATE LOOP
      UPDATE public.main_treasury_transactions
        SET status='posted', posted_at=now(),
            approver_1_id = COALESCE(approver_1_id, auth.uid()),
            approver_1_at = COALESCE(approver_1_at, now())
        WHERE id = sib.id;
    END LOOP;
  END IF;

  RETURN t;
END $$;
