
-- 1) Allow courier deposit category + courier_name column
ALTER TABLE public.main_warehouse_treasury_txns
  DROP CONSTRAINT IF EXISTS main_warehouse_treasury_txns_category_check;
ALTER TABLE public.main_warehouse_treasury_txns
  ADD CONSTRAINT main_warehouse_treasury_txns_category_check
  CHECK (category = ANY (ARRAY[
    'direct_sale_cash','courier_deposit','transfer_to_main_treasury',
    'manual_adjust','opening_balance','other'
  ]));

ALTER TABLE public.main_warehouse_treasury_txns
  ADD COLUMN IF NOT EXISTS courier_name text,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS main_treasury_txn_id uuid;

-- 2) Tighten UPDATE policy: creator can edit ONLY drafts (none here), so once
-- submitted (pending_approval / posted / rejected) only approvers can change.
DROP POLICY IF EXISTS "MWT update" ON public.main_warehouse_treasury_txns;
CREATE POLICY "MWT update" ON public.main_warehouse_treasury_txns
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'general_manager'::app_role)
    OR has_role(auth.uid(), 'executive_manager'::app_role)
    OR has_role(auth.uid(), 'financial_manager'::app_role)
    OR has_role(auth.uid(), 'main_treasury_approver'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'general_manager'::app_role)
    OR has_role(auth.uid(), 'executive_manager'::app_role)
    OR has_role(auth.uid(), 'financial_manager'::app_role)
    OR has_role(auth.uid(), 'main_treasury_approver'::app_role)
  );

-- 3) Approve transfer: posts the MWT row AND credits main treasury cash account.
CREATE OR REPLACE FUNCTION public.approve_main_warehouse_transfer(_txn_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.main_warehouse_treasury_txns%ROWTYPE;
  _account_id uuid;
  _main_id uuid;
  _ref text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT (
    has_role(_uid, 'general_manager'::app_role)
    OR has_role(_uid, 'financial_manager'::app_role)
    OR has_role(_uid, 'main_treasury_approver'::app_role)
  ) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  SELECT * INTO _row FROM public.main_warehouse_treasury_txns
   WHERE id = _txn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer not found'; END IF;
  IF _row.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'transfer is not pending';
  END IF;
  IF _row.category <> 'transfer_to_main_treasury' THEN
    RAISE EXCEPTION 'not a main-treasury transfer';
  END IF;

  -- pick default cash account
  SELECT id INTO _account_id FROM public.main_treasury_accounts
   WHERE account_type = 'cash' AND is_active = true
   ORDER BY created_at LIMIT 1;
  IF _account_id IS NULL THEN
    RAISE EXCEPTION 'no active cash account found in main treasury';
  END IF;

  _ref := 'MWT-' || to_char(now(),'YYYYMMDD-HH24MISS') || '-' || substr(_row.id::text,1,8);

  INSERT INTO public.main_treasury_transactions(
    reference_no, account_id, txn_type, amount, txn_date,
    description, status, posted_at, created_by, incoming_source, counterparty
  ) VALUES (
    _ref, _account_id, 'deposit', _row.amount, CURRENT_DATE,
    'تحويل وارد من خزينة المخزن الرئيسي'
      || CASE WHEN _row.notes IS NOT NULL THEN ' — ' || _row.notes ELSE '' END,
    'posted', now(), _uid, 'main_warehouse_treasury',
    'خزينة المخزن الرئيسي'
  ) RETURNING id INTO _main_id;

  UPDATE public.main_warehouse_treasury_txns
     SET status = 'posted',
         approved_by = _uid,
         approved_at = now(),
         main_treasury_txn_id = _main_id,
         updated_at = now()
   WHERE id = _txn_id;

  RETURN _main_id;
END $$;

GRANT EXECUTE ON FUNCTION public.approve_main_warehouse_transfer(uuid) TO authenticated;

-- 4) Reject transfer with reason
CREATE OR REPLACE FUNCTION public.reject_main_warehouse_transfer(_txn_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.main_warehouse_treasury_txns%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT (
    has_role(_uid, 'general_manager'::app_role)
    OR has_role(_uid, 'financial_manager'::app_role)
    OR has_role(_uid, 'main_treasury_approver'::app_role)
  ) THEN RAISE EXCEPTION 'permission denied'; END IF;

  SELECT * INTO _row FROM public.main_warehouse_treasury_txns
   WHERE id = _txn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer not found'; END IF;
  IF _row.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'transfer is not pending';
  END IF;

  UPDATE public.main_warehouse_treasury_txns
     SET status = 'rejected',
         approved_by = _uid,
         approved_at = now(),
         rejection_reason = NULLIF(trim(_reason), ''),
         updated_at = now()
   WHERE id = _txn_id;
END $$;

GRANT EXECUTE ON FUNCTION public.reject_main_warehouse_transfer(uuid, text) TO authenticated;
