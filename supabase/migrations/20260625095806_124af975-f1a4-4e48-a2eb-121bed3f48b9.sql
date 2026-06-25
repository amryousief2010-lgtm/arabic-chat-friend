
CREATE OR REPLACE FUNCTION public.approve_main_warehouse_transfer(_txn_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row public.main_warehouse_treasury_txns%ROWTYPE;
  _account_id uuid;
  _main_id uuid;
  _ref text;
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
  IF _row.status <> 'pending_approval' THEN RAISE EXCEPTION 'transfer is not pending'; END IF;
  IF _row.category NOT IN ('transfer_to_main_treasury','transfer_from_main_warehouse_treasury') THEN
    RAISE EXCEPTION 'not a main-treasury transfer';
  END IF;

  SELECT id INTO _account_id FROM public.main_treasury_accounts
   WHERE account_type = 'cash' AND is_active = true
   ORDER BY created_at LIMIT 1;
  IF _account_id IS NULL THEN RAISE EXCEPTION 'no active cash account found in main treasury'; END IF;

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
     SET status = 'posted', approved_by = _uid, approved_at = now(),
         main_treasury_txn_id = _main_id, updated_at = now()
   WHERE id = _txn_id;

  RETURN _main_id;
END
$function$;
