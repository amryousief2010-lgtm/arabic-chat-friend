
-- 1) Extend treasury_source to include 'deferred' (آجل / بدون دفع حالي)
ALTER TABLE public.chick_trading_batches
  DROP CONSTRAINT IF EXISTS chick_trading_batches_treasury_source_check;
ALTER TABLE public.chick_trading_batches
  ADD CONSTRAINT chick_trading_batches_treasury_source_check
  CHECK (treasury_source = ANY (ARRAY['lab','main','customer_debt','deferred']));

-- 2) Track payment status & paid amount for deferred purchases
ALTER TABLE public.chick_trading_batches
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'paid'
    CHECK (payment_status IN ('paid','deferred','partial')),
  ADD COLUMN IF NOT EXISTS paid_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deferred_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS deferred_payment_treasury text;

-- 3) Update v2 RPC to support 'deferred' (no treasury write, marks payment_status='deferred')
CREATE OR REPLACE FUNCTION public.chick_trading_create_purchase_v2(
  _supplier text, _purchase_date date, _age integer, _count integer, _unit_price numeric,
  _transport numeric, _disinfection numeric, _other numeric, _treasury_source text,
  _main_account_id uuid, _notes text, _attachment_url text,
  _settlement_customer text DEFAULT NULL::text, _settlement_amount numeric DEFAULT 0,
  _diff_treasury_source text DEFAULT NULL::text, _settlement_notes text DEFAULT NULL::text
)
RETURNS chick_trading_batches
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _row public.chick_trading_batches; _total numeric; _actor uuid := auth.uid(); _no text;
  _balance numeric; _diff numeric := 0; _settlement_id uuid; _settlement_no text;
BEGIN
  IF _count <= 0 OR _unit_price < 0 THEN RAISE EXCEPTION 'Invalid count/price'; END IF;
  IF _treasury_source NOT IN ('lab','main','customer_debt','deferred') THEN
    RAISE EXCEPTION 'Invalid treasury_source';
  END IF;

  _total := _count*_unit_price + COALESCE(_transport,0) + COALESCE(_disinfection,0) + COALESCE(_other,0);
  _no := public.next_chick_trading_batch_no(_purchase_date);

  IF _treasury_source = 'deferred' THEN
    -- Role check for deferred purchases
    IF NOT (
      public.has_role(_actor,'general_manager') OR
      public.has_role(_actor,'executive_manager') OR
      public.has_role(_actor,'accountant') OR
      public.has_role(_actor,'hatchery_manager') OR
      public.has_role(_actor,'brooding_manager')
    ) THEN
      RAISE EXCEPTION 'Permission denied: deferred purchase requires GM/Exec/Accountant/Hatchery/Brooding manager';
    END IF;
  END IF;

  IF _treasury_source = 'customer_debt' THEN
    IF NOT (
      public.has_role(_actor,'general_manager') OR
      public.has_role(_actor,'executive_manager') OR
      public.has_role(_actor,'accountant')
    ) THEN
      RAISE EXCEPTION 'Permission denied: customer_debt settlement requires GM/Exec/Accountant';
    END IF;
    IF _settlement_customer IS NULL OR length(trim(_settlement_customer)) = 0 THEN
      RAISE EXCEPTION 'Settlement customer name required';
    END IF;
    IF _settlement_amount IS NULL OR _settlement_amount <= 0 THEN
      RAISE EXCEPTION 'Settlement amount must be > 0';
    END IF;
    _balance := public.chick_trading_customer_balance(_settlement_customer);
    IF _settlement_amount > _balance THEN
      RAISE EXCEPTION 'مبلغ التسوية (%) أكبر من رصيد مديونية العميل (%)', _settlement_amount, _balance;
    END IF;
    _diff := _total - _settlement_amount;
    IF _diff < 0 THEN
      RAISE EXCEPTION 'مبلغ التسوية أكبر من إجمالي الشراء';
    END IF;
    IF _diff > 0 THEN
      IF _diff_treasury_source IS NULL OR _diff_treasury_source NOT IN ('lab','main','none') THEN
        RAISE EXCEPTION 'يجب اختيار طريقة دفع الفرق (lab/main/none)';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.chick_trading_batches(
    batch_no, supplier_name, purchase_date, age_at_purchase, original_count, current_count,
    unit_purchase_price, purchase_total, transport_cost, disinfection_cost, other_costs,
    notes, attachment_url, treasury_source, main_account_id, created_by,
    diff_treasury_source, diff_amount, payment_status, paid_amount
  ) VALUES (
    _no, _supplier, _purchase_date, _age, _count, _count,
    _unit_price, _count*_unit_price, COALESCE(_transport,0), COALESCE(_disinfection,0), COALESCE(_other,0),
    _notes, _attachment_url, _treasury_source, _main_account_id, _actor,
    CASE WHEN _treasury_source='customer_debt' THEN _diff_treasury_source ELSE NULL END,
    CASE WHEN _treasury_source='customer_debt' THEN _diff ELSE 0 END,
    CASE WHEN _treasury_source='deferred' THEN 'deferred' ELSE 'paid' END,
    CASE WHEN _treasury_source='deferred' THEN 0 ELSE _total END
  ) RETURNING * INTO _row;

  IF _treasury_source = 'customer_debt' THEN
    _settlement_no := public.next_chick_trading_settlement_no(_purchase_date);
    INSERT INTO public.chick_trading_debt_settlements(
      settlement_no, customer_name, purchase_batch_id,
      balance_before, settlement_amount, balance_after,
      diff_treasury_source, diff_amount, notes, created_by
    ) VALUES (
      _settlement_no, _settlement_customer, _row.id,
      _balance, _settlement_amount, _balance - _settlement_amount,
      CASE WHEN _diff > 0 THEN _diff_treasury_source ELSE NULL END,
      _diff, _settlement_notes, _actor
    ) RETURNING id INTO _settlement_id;

    UPDATE public.chick_trading_batches SET settlement_id = _settlement_id WHERE id = _row.id;
    _row.settlement_id := _settlement_id;

    IF _diff > 0 AND _diff_treasury_source IN ('lab','main') THEN
      PERFORM public._ct_write_treasury(
        _diff_treasury_source, _main_account_id, 'purchase', _diff,
        'فرق شراء كتاكيت تجارة (تسوية مديونية ' || _settlement_customer || ') دفعة ' || _no,
        'chick_trading_batches', _row.id, _actor
      );
    END IF;
  ELSIF _treasury_source = 'deferred' THEN
    -- No treasury write, no settlement. Just audit.
    INSERT INTO public.chick_trading_audit_log(actor_id, action, entity_type, entity_id, payload)
    VALUES (_actor, 'deferred_purchase', 'chick_trading_batches', _row.id,
      jsonb_build_object('total', _total, 'supplier', _supplier, 'batch_no', _no));
  ELSE
    PERFORM public._ct_write_treasury(
      _treasury_source, _main_account_id, 'purchase', _total,
      'شراء كتاكيت تجارة دفعة ' || _no || ' من ' || _supplier,
      'chick_trading_batches', _row.id, _actor
    );
  END IF;

  RETURN _row;
END;
$function$;

-- 4) RPC to pay (settle) a previously deferred purchase from a treasury
CREATE OR REPLACE FUNCTION public.chick_trading_pay_deferred_purchase(
  _batch_id uuid,
  _treasury text,
  _main_account_id uuid DEFAULT NULL,
  _amount numeric DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS chick_trading_batches
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _row public.chick_trading_batches; _actor uuid := auth.uid();
  _total numeric; _outstanding numeric; _pay numeric; _new_paid numeric; _new_status text;
BEGIN
  SELECT * INTO _row FROM public.chick_trading_batches WHERE id=_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found'; END IF;
  IF _row.treasury_source <> 'deferred' THEN
    RAISE EXCEPTION 'هذه الدفعة ليست شراء آجل';
  END IF;
  IF _row.payment_status = 'paid' THEN
    RAISE EXCEPTION 'هذه الدفعة مدفوعة بالكامل بالفعل';
  END IF;
  IF _treasury NOT IN ('lab','main') THEN
    RAISE EXCEPTION 'Invalid treasury';
  END IF;

  _total := (_row.original_count * _row.unit_purchase_price)
            + COALESCE(_row.transport_cost,0) + COALESCE(_row.disinfection_cost,0) + COALESCE(_row.other_costs,0);
  _outstanding := _total - COALESCE(_row.paid_amount,0);
  _pay := COALESCE(_amount, _outstanding);
  IF _pay <= 0 THEN RAISE EXCEPTION 'مبلغ السداد يجب أن يكون أكبر من صفر'; END IF;
  IF _pay > _outstanding THEN RAISE EXCEPTION 'مبلغ السداد أكبر من المتبقي (%)', _outstanding; END IF;

  PERFORM public._ct_write_treasury(
    _treasury, _main_account_id, 'purchase', _pay,
    'سداد شراء كتاكيت تجارة آجل دفعة ' || _row.batch_no || ' من ' || _row.supplier_name,
    'chick_trading_batches', _row.id, _actor
  );

  _new_paid := COALESCE(_row.paid_amount,0) + _pay;
  _new_status := CASE WHEN _new_paid >= _total THEN 'paid' ELSE 'partial' END;

  UPDATE public.chick_trading_batches
  SET paid_amount = _new_paid,
      payment_status = _new_status,
      deferred_paid_at = CASE WHEN _new_status='paid' THEN now() ELSE deferred_paid_at END,
      deferred_payment_treasury = _treasury
  WHERE id = _row.id
  RETURNING * INTO _row;

  INSERT INTO public.chick_trading_audit_log(actor_id, action, entity_type, entity_id, payload)
  VALUES (_actor, 'deferred_payment', 'chick_trading_batches', _row.id,
    jsonb_build_object('amount', _pay, 'treasury', _treasury, 'new_paid', _new_paid, 'status', _new_status, 'notes', _notes));

  RETURN _row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.chick_trading_pay_deferred_purchase(uuid,text,uuid,numeric,text) TO authenticated;
