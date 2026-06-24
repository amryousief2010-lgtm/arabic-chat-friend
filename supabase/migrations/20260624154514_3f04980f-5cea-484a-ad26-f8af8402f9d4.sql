
-- Allow new funding source 'customer_debt' on chick trading batches
ALTER TABLE public.chick_trading_batches
  DROP CONSTRAINT IF EXISTS chick_trading_batches_treasury_source_check;
ALTER TABLE public.chick_trading_batches
  ADD CONSTRAINT chick_trading_batches_treasury_source_check
  CHECK (treasury_source = ANY (ARRAY['lab','main','customer_debt']));

-- Track settlement diff (when purchase > customer debt)
ALTER TABLE public.chick_trading_batches
  ADD COLUMN IF NOT EXISTS settlement_id uuid,
  ADD COLUMN IF NOT EXISTS diff_treasury_source text,
  ADD COLUMN IF NOT EXISTS diff_amount numeric NOT NULL DEFAULT 0;

-- ============ Debt settlements table ============
CREATE TABLE IF NOT EXISTS public.chick_trading_debt_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_no text NOT NULL UNIQUE,
  customer_name text NOT NULL,
  purchase_batch_id uuid NOT NULL REFERENCES public.chick_trading_batches(id) ON DELETE RESTRICT,
  balance_before numeric NOT NULL,
  settlement_amount numeric NOT NULL CHECK (settlement_amount > 0),
  balance_after numeric NOT NULL,
  diff_treasury_source text CHECK (diff_treasury_source IN ('lab','main','none')),
  diff_amount numeric NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chick_trading_debt_settlements TO authenticated;
GRANT ALL ON public.chick_trading_debt_settlements TO service_role;

ALTER TABLE public.chick_trading_debt_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ctds_select" ON public.chick_trading_debt_settlements
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ctds_write" ON public.chick_trading_debt_settlements
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'general_manager') OR
    public.has_role(auth.uid(),'executive_manager') OR
    public.has_role(auth.uid(),'accountant') OR
    public.has_role(auth.uid(),'hatchery_manager') OR
    public.has_role(auth.uid(),'brooding_manager')
  )
  WITH CHECK (
    public.has_role(auth.uid(),'general_manager') OR
    public.has_role(auth.uid(),'executive_manager') OR
    public.has_role(auth.uid(),'accountant') OR
    public.has_role(auth.uid(),'hatchery_manager') OR
    public.has_role(auth.uid(),'brooding_manager')
  );

CREATE INDEX IF NOT EXISTS ctds_customer_idx ON public.chick_trading_debt_settlements(customer_name);
CREATE INDEX IF NOT EXISTS ctds_batch_idx ON public.chick_trading_debt_settlements(purchase_batch_id);

-- ============ Customer balance helper ============
CREATE OR REPLACE FUNCTION public.chick_trading_customer_balance(_customer text)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE((
      SELECT SUM(total) FROM public.chick_trading_sales
      WHERE customer_name = _customer
        AND payment_method = 'credit'
        AND collected = false
        AND status = 'active'
    ), 0)
    -
    COALESCE((
      SELECT SUM(settlement_amount) FROM public.chick_trading_debt_settlements
      WHERE customer_name = _customer
    ), 0);
$$;

-- ============ List customers with outstanding debt ============
CREATE OR REPLACE FUNCTION public.chick_trading_customers_with_debt()
RETURNS TABLE(customer_name text, balance numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH credit AS (
    SELECT customer_name, SUM(total) AS owed
    FROM public.chick_trading_sales
    WHERE payment_method='credit' AND collected=false AND status='active'
    GROUP BY customer_name
  ),
  settled AS (
    SELECT customer_name, SUM(settlement_amount) AS s
    FROM public.chick_trading_debt_settlements
    GROUP BY customer_name
  )
  SELECT c.customer_name, (c.owed - COALESCE(s.s,0))::numeric AS balance
  FROM credit c LEFT JOIN settled s USING (customer_name)
  WHERE (c.owed - COALESCE(s.s,0)) > 0
  ORDER BY balance DESC;
$$;

-- ============ Settlement number sequence ============
CREATE OR REPLACE FUNCTION public.next_chick_trading_settlement_no(_date date)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE _n int;
BEGIN
  SELECT COALESCE(MAX((regexp_replace(settlement_no,'^CTS-\d{8}-','','g'))::int),0)+1
    INTO _n
  FROM public.chick_trading_debt_settlements
  WHERE settlement_no LIKE 'CTS-' || to_char(_date,'YYYYMMDD') || '-%';
  RETURN 'CTS-' || to_char(_date,'YYYYMMDD') || '-' || lpad(_n::text,3,'0');
END $$;

-- ============ Purchase v2: supports customer_debt funding source ============
CREATE OR REPLACE FUNCTION public.chick_trading_create_purchase_v2(
  _supplier text, _purchase_date date, _age integer, _count integer, _unit_price numeric,
  _transport numeric, _disinfection numeric, _other numeric,
  _treasury_source text, _main_account_id uuid,
  _notes text, _attachment_url text,
  _settlement_customer text DEFAULT NULL,
  _settlement_amount numeric DEFAULT 0,
  _diff_treasury_source text DEFAULT NULL,
  _settlement_notes text DEFAULT NULL
) RETURNS public.chick_trading_batches
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row public.chick_trading_batches; _total numeric; _actor uuid := auth.uid(); _no text;
  _balance numeric; _diff numeric := 0; _settlement_id uuid; _settlement_no text;
BEGIN
  IF _count <= 0 OR _unit_price < 0 THEN RAISE EXCEPTION 'Invalid count/price'; END IF;
  IF _treasury_source NOT IN ('lab','main','customer_debt') THEN
    RAISE EXCEPTION 'Invalid treasury_source';
  END IF;

  _total := _count*_unit_price + COALESCE(_transport,0) + COALESCE(_disinfection,0) + COALESCE(_other,0);
  _no := public.next_chick_trading_batch_no(_purchase_date);

  IF _treasury_source = 'customer_debt' THEN
    -- Role check
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
    diff_treasury_source, diff_amount
  ) VALUES (
    _no, _supplier, _purchase_date, _age, _count, _count,
    _unit_price, _count*_unit_price, COALESCE(_transport,0), COALESCE(_disinfection,0), COALESCE(_other,0),
    _notes, _attachment_url, _treasury_source, _main_account_id, _actor,
    CASE WHEN _treasury_source='customer_debt' THEN _diff_treasury_source ELSE NULL END,
    CASE WHEN _treasury_source='customer_debt' THEN _diff ELSE 0 END
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

    -- Treasury: only for the cash diff (if any), and not for the settled portion
    IF _diff > 0 AND _diff_treasury_source IN ('lab','main') THEN
      PERFORM public._ct_write_treasury(
        _diff_treasury_source, _main_account_id, 'purchase', _diff,
        'فرق شراء كتاكيت تجارة (تسوية مديونية ' || _settlement_customer || ') دفعة ' || _no,
        'chick_trading_batches', _row.id, _actor
      );
    END IF;
  ELSE
    PERFORM public._ct_write_treasury(
      _treasury_source, _main_account_id, 'purchase', _total,
      'شراء كتاكيت تجارة من ' || _supplier || ' (دفعة ' || _no || ')',
      'chick_trading_batches', _row.id, _actor
    );
  END IF;

  INSERT INTO public.chick_trading_audit_log(entity_type, entity_id, action, actor_id, details)
  VALUES (
    'batch', _row.id, 'create', _actor,
    jsonb_build_object(
      'total', _total,
      'treasury', _treasury_source,
      'settlement_customer', _settlement_customer,
      'settlement_amount', _settlement_amount,
      'balance_before', _balance,
      'balance_after', CASE WHEN _balance IS NOT NULL THEN _balance - _settlement_amount ELSE NULL END,
      'diff_amount', _diff,
      'diff_treasury_source', _diff_treasury_source
    )
  );

  RETURN _row;
END $$;

GRANT EXECUTE ON FUNCTION public.chick_trading_create_purchase_v2(text,date,integer,integer,numeric,numeric,numeric,numeric,text,uuid,text,text,text,numeric,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chick_trading_customer_balance(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chick_trading_customers_with_debt() TO authenticated;

-- updated_at trigger
DROP TRIGGER IF EXISTS ctds_updated_at ON public.chick_trading_debt_settlements;
CREATE TRIGGER ctds_updated_at BEFORE UPDATE ON public.chick_trading_debt_settlements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
