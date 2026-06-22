
ALTER TYPE public.lab_treasury_expense_category ADD VALUE IF NOT EXISTS 'chick_trading_purchase';
ALTER TYPE public.lab_treasury_expense_category ADD VALUE IF NOT EXISTS 'chick_trading_expense';
ALTER TYPE public.lab_treasury_income_category ADD VALUE IF NOT EXISTS 'chick_trading_sale';

INSERT INTO public.main_treasury_expense_categories (code, label, is_active, sort_order)
VALUES ('chick_trading', 'تجارة كتاكيت', true, 100)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.chick_trading_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_no text NOT NULL UNIQUE,
  supplier_name text NOT NULL,
  purchase_date date NOT NULL DEFAULT CURRENT_DATE,
  age_at_purchase integer NOT NULL DEFAULT 1,
  original_count integer NOT NULL CHECK (original_count > 0),
  current_count integer NOT NULL,
  dead_count integer NOT NULL DEFAULT 0,
  sold_count integer NOT NULL DEFAULT 0,
  unit_purchase_price numeric NOT NULL DEFAULT 0,
  purchase_total numeric NOT NULL DEFAULT 0,
  transport_cost numeric NOT NULL DEFAULT 0,
  disinfection_cost numeric NOT NULL DEFAULT 0,
  other_costs numeric NOT NULL DEFAULT 0,
  notes text,
  attachment_url text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  treasury_source text NOT NULL CHECK (treasury_source IN ('lab','main')),
  main_account_id uuid,
  created_by uuid,
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chick_trading_batches TO authenticated;
GRANT ALL ON public.chick_trading_batches TO service_role;
ALTER TABLE public.chick_trading_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ct_batches_select" ON public.chick_trading_batches FOR SELECT TO authenticated USING (true);
CREATE POLICY "ct_batches_write" ON public.chick_trading_batches FOR ALL TO authenticated USING (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'hatchery_manager') OR public.has_role(auth.uid(),'brooding_manager')
) WITH CHECK (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'hatchery_manager') OR public.has_role(auth.uid(),'brooding_manager')
);

CREATE TABLE IF NOT EXISTS public.chick_trading_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.chick_trading_batches(id) ON DELETE CASCADE,
  expense_type text NOT NULL CHECK (expense_type IN ('feed','medicine','other')),
  amount numeric NOT NULL CHECK (amount >= 0),
  quantity numeric,
  unit text,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  treasury_source text NOT NULL DEFAULT 'lab' CHECK (treasury_source IN ('lab','main','none')),
  main_account_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chick_trading_expenses TO authenticated;
GRANT ALL ON public.chick_trading_expenses TO service_role;
ALTER TABLE public.chick_trading_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ct_exp_select" ON public.chick_trading_expenses FOR SELECT TO authenticated USING (true);
CREATE POLICY "ct_exp_write" ON public.chick_trading_expenses FOR ALL TO authenticated USING (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'hatchery_manager') OR public.has_role(auth.uid(),'brooding_manager')
) WITH CHECK (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'hatchery_manager') OR public.has_role(auth.uid(),'brooding_manager')
);

CREATE TABLE IF NOT EXISTS public.chick_trading_mortality (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.chick_trading_batches(id) ON DELETE CASCADE,
  count integer NOT NULL CHECK (count > 0),
  mortality_date date NOT NULL DEFAULT CURRENT_DATE,
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chick_trading_mortality TO authenticated;
GRANT ALL ON public.chick_trading_mortality TO service_role;
ALTER TABLE public.chick_trading_mortality ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ct_mort_select" ON public.chick_trading_mortality FOR SELECT TO authenticated USING (true);
CREATE POLICY "ct_mort_write" ON public.chick_trading_mortality FOR ALL TO authenticated USING (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'hatchery_manager') OR public.has_role(auth.uid(),'brooding_manager')
) WITH CHECK (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'hatchery_manager') OR public.has_role(auth.uid(),'brooding_manager')
);

CREATE TABLE IF NOT EXISTS public.chick_trading_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_no text NOT NULL UNIQUE,
  batch_id uuid NOT NULL REFERENCES public.chick_trading_batches(id) ON DELETE RESTRICT,
  customer_name text NOT NULL,
  phone text,
  address text,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric NOT NULL CHECK (unit_price >= 0),
  total numeric NOT NULL,
  payment_method text NOT NULL CHECK (payment_method IN ('cash','credit','transfer')),
  treasury_destination text CHECK (treasury_destination IN ('lab','main')),
  main_account_id uuid,
  sale_date date NOT NULL DEFAULT CURRENT_DATE,
  collected boolean NOT NULL DEFAULT false,
  collected_at timestamptz,
  collected_by uuid,
  collection_treasury text CHECK (collection_treasury IN ('lab','main')),
  collection_main_account_id uuid,
  notes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chick_trading_sales TO authenticated;
GRANT ALL ON public.chick_trading_sales TO service_role;
ALTER TABLE public.chick_trading_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ct_sales_select" ON public.chick_trading_sales FOR SELECT TO authenticated USING (true);
CREATE POLICY "ct_sales_write" ON public.chick_trading_sales FOR ALL TO authenticated USING (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'hatchery_manager') OR public.has_role(auth.uid(),'brooding_manager')
) WITH CHECK (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'hatchery_manager') OR public.has_role(auth.uid(),'brooding_manager')
);

CREATE TABLE IF NOT EXISTS public.chick_trading_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  actor_id uuid,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.chick_trading_audit_log TO authenticated;
GRANT ALL ON public.chick_trading_audit_log TO service_role;
ALTER TABLE public.chick_trading_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ct_audit_select" ON public.chick_trading_audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "ct_audit_insert" ON public.chick_trading_audit_log FOR INSERT TO authenticated WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.next_chick_trading_batch_no(_purchase_date date)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE base text; seq int;
BEGIN
  base := 'TRD-CHICKS-' || to_char(_purchase_date,'YYYYMMDD');
  SELECT COALESCE(MAX(NULLIF(regexp_replace(batch_no, '^' || base || '-', ''), '')::int), 0) + 1
    INTO seq FROM public.chick_trading_batches WHERE batch_no LIKE base || '-%';
  RETURN base || '-' || lpad(seq::text, 4, '0');
END $$;

CREATE OR REPLACE FUNCTION public.next_chick_trading_sale_no()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE seq int; BEGIN
  SELECT COUNT(*)+1 INTO seq FROM public.chick_trading_sales WHERE created_at::date = CURRENT_DATE;
  RETURN 'TRD-SALE-' || to_char(now(),'YYYYMMDD') || '-' || lpad(seq::text,4,'0');
END $$;

CREATE OR REPLACE FUNCTION public._ct_write_treasury(
  _source text, _main_account_id uuid, _kind text, _amount numeric, _description text,
  _source_table text, _source_id uuid, _actor uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _acct uuid;
BEGIN
  IF _amount IS NULL OR _amount = 0 THEN RETURN; END IF;
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
END $$;

CREATE OR REPLACE FUNCTION public.chick_trading_create_purchase(
  _supplier text, _purchase_date date, _age int, _count int, _unit_price numeric,
  _transport numeric, _disinfection numeric, _other numeric,
  _treasury_source text, _main_account_id uuid, _notes text, _attachment_url text
) RETURNS public.chick_trading_batches LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _row public.chick_trading_batches; _total numeric; _actor uuid := auth.uid(); _no text;
BEGIN
  IF _count <= 0 OR _unit_price < 0 THEN RAISE EXCEPTION 'Invalid count/price'; END IF;
  IF _treasury_source NOT IN ('lab','main') THEN RAISE EXCEPTION 'Invalid treasury_source'; END IF;
  _total := _count * _unit_price + COALESCE(_transport,0) + COALESCE(_disinfection,0) + COALESCE(_other,0);
  _no := public.next_chick_trading_batch_no(_purchase_date);
  INSERT INTO public.chick_trading_batches(
    batch_no, supplier_name, purchase_date, age_at_purchase, original_count, current_count,
    unit_purchase_price, purchase_total, transport_cost, disinfection_cost, other_costs,
    notes, attachment_url, treasury_source, main_account_id, created_by
  ) VALUES (
    _no, _supplier, _purchase_date, _age, _count, _count,
    _unit_price, _count*_unit_price, COALESCE(_transport,0), COALESCE(_disinfection,0), COALESCE(_other,0),
    _notes, _attachment_url, _treasury_source, _main_account_id, _actor
  ) RETURNING * INTO _row;
  PERFORM public._ct_write_treasury(
    _treasury_source, _main_account_id, 'purchase', _total,
    'شراء كتاكيت تجارة من ' || _supplier || ' (دفعة ' || _no || ')',
    'chick_trading_batches', _row.id, _actor
  );
  INSERT INTO public.chick_trading_audit_log(entity_type, entity_id, action, actor_id, details)
  VALUES ('batch', _row.id, 'create', _actor, jsonb_build_object('total',_total,'treasury',_treasury_source));
  RETURN _row;
END $$;

CREATE OR REPLACE FUNCTION public.chick_trading_add_expense(
  _batch_id uuid, _expense_type text, _amount numeric, _quantity numeric, _unit text,
  _expense_date date, _notes text, _treasury_source text, _main_account_id uuid
) RETURNS public.chick_trading_expenses LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _row public.chick_trading_expenses; _b public.chick_trading_batches; _actor uuid := auth.uid();
BEGIN
  SELECT * INTO _b FROM public.chick_trading_batches WHERE id=_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found'; END IF;
  IF _b.status<>'open' THEN RAISE EXCEPTION 'Batch is %', _b.status; END IF;
  INSERT INTO public.chick_trading_expenses(
    batch_id, expense_type, amount, quantity, unit, expense_date, notes,
    treasury_source, main_account_id, created_by
  ) VALUES (_batch_id, _expense_type, _amount, _quantity, _unit, COALESCE(_expense_date,CURRENT_DATE),
    _notes, COALESCE(_treasury_source,'lab'), _main_account_id, _actor) RETURNING * INTO _row;
  IF _row.treasury_source IN ('lab','main') THEN
    PERFORM public._ct_write_treasury(
      _row.treasury_source, _row.main_account_id, 'expense', _amount,
      'مصروف تجارة كتاكيت — ' || _expense_type || ' (دفعة ' || _b.batch_no || ')',
      'chick_trading_expenses', _row.id, _actor
    );
  END IF;
  INSERT INTO public.chick_trading_audit_log(entity_type, entity_id, action, actor_id, details)
  VALUES ('expense', _row.id, 'create', _actor, jsonb_build_object('type',_expense_type,'amount',_amount));
  RETURN _row;
END $$;

CREATE OR REPLACE FUNCTION public.chick_trading_add_mortality(
  _batch_id uuid, _count int, _mortality_date date, _reason text
) RETURNS public.chick_trading_mortality LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _row public.chick_trading_mortality; _b public.chick_trading_batches; _actor uuid := auth.uid();
BEGIN
  SELECT * INTO _b FROM public.chick_trading_batches WHERE id=_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found'; END IF;
  IF _count <= 0 THEN RAISE EXCEPTION 'count must be > 0'; END IF;
  IF _count > _b.current_count THEN RAISE EXCEPTION 'Mortality (%) exceeds current (%)', _count, _b.current_count; END IF;
  INSERT INTO public.chick_trading_mortality(batch_id, count, mortality_date, reason, created_by)
  VALUES (_batch_id, _count, COALESCE(_mortality_date,CURRENT_DATE), _reason, _actor) RETURNING * INTO _row;
  UPDATE public.chick_trading_batches
     SET current_count = current_count - _count, dead_count = dead_count + _count, updated_at = now()
   WHERE id = _batch_id;
  INSERT INTO public.chick_trading_audit_log(entity_type, entity_id, action, actor_id, details)
  VALUES ('mortality', _row.id, 'create', _actor, jsonb_build_object('count',_count));
  RETURN _row;
END $$;

CREATE OR REPLACE FUNCTION public.chick_trading_create_sale(
  _batch_id uuid, _customer text, _phone text, _address text,
  _quantity int, _unit_price numeric, _payment_method text,
  _treasury_destination text, _main_account_id uuid,
  _sale_date date, _notes text
) RETURNS public.chick_trading_sales LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _row public.chick_trading_sales; _b public.chick_trading_batches; _actor uuid := auth.uid(); _no text; _total numeric;
BEGIN
  SELECT * INTO _b FROM public.chick_trading_batches WHERE id=_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found'; END IF;
  IF _b.status<>'open' THEN RAISE EXCEPTION 'Batch is %', _b.status; END IF;
  IF _quantity <= 0 THEN RAISE EXCEPTION 'quantity must be > 0'; END IF;
  IF _quantity > _b.current_count THEN
    RAISE EXCEPTION 'الكمية المطلوبة (%) أكبر من المتاح (%)', _quantity, _b.current_count;
  END IF;
  IF _payment_method NOT IN ('cash','credit','transfer') THEN RAISE EXCEPTION 'Invalid payment_method'; END IF;
  IF _payment_method <> 'credit' AND _treasury_destination IS NULL THEN
    RAISE EXCEPTION 'treasury_destination is required for non-credit sales';
  END IF;
  _no := public.next_chick_trading_sale_no();
  _total := _quantity * _unit_price;
  INSERT INTO public.chick_trading_sales(
    sale_no, batch_id, customer_name, phone, address, quantity, unit_price, total,
    payment_method, treasury_destination, main_account_id, sale_date, notes,
    collected, collected_at, collected_by, collection_treasury, collection_main_account_id, created_by
  ) VALUES (
    _no, _batch_id, _customer, _phone, _address, _quantity, _unit_price, _total,
    _payment_method, _treasury_destination, _main_account_id, COALESCE(_sale_date,CURRENT_DATE), _notes,
    (_payment_method<>'credit'),
    CASE WHEN _payment_method<>'credit' THEN now() ELSE NULL END,
    CASE WHEN _payment_method<>'credit' THEN _actor ELSE NULL END,
    CASE WHEN _payment_method<>'credit' THEN _treasury_destination ELSE NULL END,
    CASE WHEN _payment_method<>'credit' THEN _main_account_id ELSE NULL END,
    _actor
  ) RETURNING * INTO _row;
  UPDATE public.chick_trading_batches
     SET current_count = current_count - _quantity, sold_count = sold_count + _quantity, updated_at = now()
   WHERE id = _batch_id;
  IF _payment_method <> 'credit' THEN
    PERFORM public._ct_write_treasury(
      _treasury_destination, _main_account_id, 'sale', _total,
      'بيع كتاكيت تجارة للعميل ' || _customer || ' (فاتورة ' || _no || ')',
      'chick_trading_sales', _row.id, _actor
    );
  END IF;
  INSERT INTO public.chick_trading_audit_log(entity_type, entity_id, action, actor_id, details)
  VALUES ('sale', _row.id, 'create', _actor, jsonb_build_object('qty',_quantity,'total',_total,'payment',_payment_method));
  RETURN _row;
END $$;

CREATE OR REPLACE FUNCTION public.chick_trading_collect_sale(
  _sale_id uuid, _treasury text, _main_account_id uuid
) RETURNS public.chick_trading_sales LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _s public.chick_trading_sales; _actor uuid := auth.uid();
BEGIN
  SELECT * INTO _s FROM public.chick_trading_sales WHERE id=_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF _s.status<>'active' THEN RAISE EXCEPTION 'Sale is %', _s.status; END IF;
  IF _s.collected THEN RAISE EXCEPTION 'Already collected'; END IF;
  IF _treasury NOT IN ('lab','main') THEN RAISE EXCEPTION 'Invalid treasury'; END IF;
  UPDATE public.chick_trading_sales
     SET collected=true, collected_at=now(), collected_by=_actor,
         collection_treasury=_treasury, collection_main_account_id=_main_account_id, updated_at=now()
   WHERE id=_sale_id RETURNING * INTO _s;
  PERFORM public._ct_write_treasury(
    _treasury, _main_account_id, 'sale', _s.total,
    'تحصيل بيع كتاكيت تجارة — ' || _s.customer_name || ' (فاتورة ' || _s.sale_no || ')',
    'chick_trading_sales', _s.id, _actor
  );
  INSERT INTO public.chick_trading_audit_log(entity_type, entity_id, action, actor_id, details)
  VALUES ('sale', _s.id, 'collect', _actor, jsonb_build_object('treasury',_treasury,'amount',_s.total));
  RETURN _s;
END $$;

CREATE OR REPLACE FUNCTION public.chick_trading_cancel_sale(_sale_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _s public.chick_trading_sales; _actor uuid := auth.uid();
BEGIN
  SELECT * INTO _s FROM public.chick_trading_sales WHERE id=_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF _s.status<>'active' THEN RAISE EXCEPTION 'Already %', _s.status; END IF;
  UPDATE public.chick_trading_sales SET status='cancelled', cancelled_by=_actor, cancelled_at=now(), cancel_reason=_reason, updated_at=now()
   WHERE id=_sale_id;
  UPDATE public.chick_trading_batches
     SET current_count = current_count + _s.quantity,
         sold_count    = GREATEST(0, sold_count - _s.quantity),
         updated_at = now()
   WHERE id = _s.batch_id;
  IF _s.collected THEN
    PERFORM public._ct_write_treasury(
      _s.collection_treasury, _s.collection_main_account_id, 'purchase', _s.total,
      'إلغاء/استرداد بيع كتاكيت تجارة — ' || _s.customer_name || ' (فاتورة ' || _s.sale_no || ')',
      'chick_trading_sales', _s.id, _actor
    );
  END IF;
  INSERT INTO public.chick_trading_audit_log(entity_type, entity_id, action, actor_id, details)
  VALUES ('sale', _s.id, 'cancel', _actor, jsonb_build_object('reason',_reason));
END $$;

CREATE OR REPLACE FUNCTION public.chick_trading_batch_pnl(_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _b public.chick_trading_batches; _feed numeric:=0; _med numeric:=0; _otherx numeric:=0;
        _sold numeric:=0; _collected numeric:=0; _credit numeric:=0; _total_cost numeric;
BEGIN
  SELECT * INTO _b FROM public.chick_trading_batches WHERE id=_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found'; END IF;
  SELECT COALESCE(SUM(amount) FILTER (WHERE expense_type='feed'),0),
         COALESCE(SUM(amount) FILTER (WHERE expense_type='medicine'),0),
         COALESCE(SUM(amount) FILTER (WHERE expense_type='other'),0)
    INTO _feed, _med, _otherx FROM public.chick_trading_expenses WHERE batch_id=_batch_id;
  SELECT COALESCE(SUM(total) FILTER (WHERE status='active'),0),
         COALESCE(SUM(total) FILTER (WHERE status='active' AND collected),0),
         COALESCE(SUM(total) FILTER (WHERE status='active' AND NOT collected),0)
    INTO _sold,_collected,_credit FROM public.chick_trading_sales WHERE batch_id=_batch_id;
  _total_cost := (_b.original_count * _b.unit_purchase_price) + _b.transport_cost + _b.disinfection_cost + _b.other_costs + _feed + _med + _otherx;
  RETURN jsonb_build_object(
    'batch_no', _b.batch_no,
    'original_count', _b.original_count,
    'current_count', _b.current_count,
    'dead_count', _b.dead_count,
    'sold_count', _b.sold_count,
    'purchase_total', _b.original_count * _b.unit_purchase_price,
    'transport_cost', _b.transport_cost,
    'disinfection_cost', _b.disinfection_cost,
    'other_costs', _b.other_costs,
    'feed_cost', _feed,
    'medicine_cost', _med,
    'other_expenses', _otherx,
    'total_cost', _total_cost,
    'current_cost_per_chick', CASE WHEN _b.current_count>0 THEN _total_cost / _b.current_count ELSE 0 END,
    'sales_total', _sold,
    'collected_total', _collected,
    'credit_total', _credit,
    'net_profit', _sold - _total_cost
  );
END $$;
