
-- 1) Defense-in-depth: ignore deferred in the treasury writer
CREATE OR REPLACE FUNCTION public._ct_write_treasury(_source text, _main_account_id uuid, _kind text, _amount numeric, _description text, _source_table text, _source_id uuid, _actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _acct uuid;
BEGIN
  IF _amount IS NULL OR _amount = 0 THEN RETURN; END IF;
  IF _source = 'deferred' OR _source = 'customer_debt' OR _source = 'none' THEN
    RETURN; -- شراء آجل أو تسوية مديونية لا ينشئ حركة خزنة
  END IF;
  IF _source = 'lab' THEN
    INSERT INTO public.lab_treasury_movements(
      movement_type, movement_date, expense_category, income_category,
      amount, payment_method, description, status, created_by, approved_by, approved_at,
      source_table, source_id
    ) VALUES (
      CASE WHEN _kind IN ('purchase','expense') THEN 'expense'::lab_treasury_movement_type ELSE 'income'::lab_treasury_movement_type END,
      CURRENT_DATE,
      CASE WHEN _kind='purchase' THEN 'chick_trading_purchase'::lab_treasury_expense_category
           WHEN _kind='expense'  THEN 'chick_trading_expense'::lab_treasury_expense_category
           ELSE NULL END,
      CASE WHEN _kind='sale' THEN 'chick_trading_sale'::lab_treasury_income_category ELSE NULL END,
      _amount, 'cash'::lab_treasury_payment_method, _description, 'approved'::lab_treasury_status,
      _actor, _actor, now(), _source_table, _source_id
    );
  ELSIF _source = 'main' THEN
    IF _main_account_id IS NULL THEN
      SELECT id INTO _acct FROM public.main_treasury_accounts ORDER BY created_at LIMIT 1;
    ELSE _acct := _main_account_id; END IF;
    IF _acct IS NULL THEN RAISE EXCEPTION 'No main treasury account configured'; END IF;
    INSERT INTO public.main_treasury_transactions(
      account_id, txn_type, amount, txn_date, description, status, requires_dual_approval,
      created_by, posted_at, category_id, counterparty, reference_no
    ) VALUES (
      _acct,
      CASE WHEN _kind IN ('purchase','expense') THEN 'expense' ELSE 'income' END,
      _amount, CURRENT_DATE, _description, 'posted', false, COALESCE(_actor, '00000000-0000-0000-0000-000000000000'::uuid), now(),
      (SELECT id FROM public.main_treasury_expense_categories WHERE code='chick_trading' LIMIT 1),
      _description, _source_table || ':' || _source_id::text
    );
  END IF;
END $function$;

-- 2) Idempotent corrective action for the affected batch
DO $$
DECLARE
  _batch_id uuid := 'ccbce004-d416-4357-86fa-7f63b7aa2a7d';
  _orig_mv uuid := '742c2daa-d5e4-4a42-ad3b-e797610490e4';
  _actor uuid;
  _already boolean;
BEGIN
  SELECT created_by INTO _actor FROM public.lab_treasury_movements WHERE id = _orig_mv;

  -- Skip if reversal already exists
  SELECT EXISTS (
    SELECT 1 FROM public.lab_treasury_movements
    WHERE source_table = 'chick_trading_deferred_reversal' AND source_id = _batch_id
  ) INTO _already;

  IF NOT _already THEN
    INSERT INTO public.lab_treasury_movements(
      movement_type, movement_date, income_category,
      amount, payment_method, description, notes, status, created_by, approved_by, approved_at,
      source_table, source_id, batch_number
    ) VALUES (
      'income'::lab_treasury_movement_type, CURRENT_DATE,
      'other'::lab_treasury_income_category,
      7800, 'cash'::lab_treasury_payment_method,
      'عكس خصم خزنة تم بالخطأ لدفعة شراء آجل TRD-CHICKS-20260624-0001',
      'تم عكس حركة الخزنة رقم 742c2daa-d5e4-4a42-ad3b-e797610490e4 لأنها تخص دفعة شراء آجل بدون دفع حالي، ولا يجب خصمها من أي خزنة وقت الإنشاء.',
      'approved'::lab_treasury_status,
      _actor, _actor, now(),
      'chick_trading_deferred_reversal', _batch_id, 'TRD-CHICKS-20260624-0001'
    );

    -- Correct the batch state
    UPDATE public.chick_trading_batches
    SET payment_status = 'deferred',
        paid_amount = 0,
        treasury_source = 'deferred',
        deferred_paid_at = NULL,
        deferred_payment_treasury = NULL,
        updated_at = now()
    WHERE id = _batch_id;

    -- Audit
    INSERT INTO public.chick_trading_audit_log(entity_type, entity_id, action, actor_id, details)
    VALUES (
      'chick_trading_batches', _batch_id, 'deferred_treasury_reversal', _actor,
      jsonb_build_object(
        'batch_no','TRD-CHICKS-20260624-0001',
        'reversed_movement_id', _orig_mv,
        'reversal_amount', 7800,
        'old_payment_status','paid',
        'new_payment_status','deferred',
        'old_paid_amount', 7800,
        'new_paid_amount', 0,
        'reason','تصحيح دفعة شراء آجل خُصمت من الخزنة بالخطأ',
        'executed_at', now()
      )
    );
  END IF;
END $$;
