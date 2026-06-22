
ALTER TABLE public.chick_trading_sales 
  ADD COLUMN IF NOT EXISTS cost_per_chick_snapshot numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cost_snapshot numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profit_snapshot numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.chick_trading_create_sale(_batch_id uuid, _customer text, _phone text, _address text, _quantity integer, _unit_price numeric, _payment_method text, _treasury_destination text, _main_account_id uuid, _sale_date date, _notes text)
 RETURNS chick_trading_sales
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _row public.chick_trading_sales; _b public.chick_trading_batches; _actor uuid := auth.uid(); _no text; _total numeric;
        _feed numeric:=0; _med numeric:=0; _otherx numeric:=0; _total_cost numeric; _cost_per numeric;
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

  -- Compute current cost-per-chick snapshot from total batch costs / current live count
  SELECT COALESCE(SUM(amount) FILTER (WHERE expense_type='feed'),0),
         COALESCE(SUM(amount) FILTER (WHERE expense_type='medicine'),0),
         COALESCE(SUM(amount) FILTER (WHERE expense_type='other'),0)
    INTO _feed,_med,_otherx
    FROM public.chick_trading_expenses WHERE batch_id=_batch_id;
  _total_cost := (_b.original_count * _b.unit_purchase_price) + _b.transport_cost + _b.disinfection_cost + _b.other_costs + _feed + _med + _otherx;
  _cost_per := CASE WHEN _b.current_count > 0 THEN _total_cost / _b.current_count ELSE 0 END;

  _no := public.next_chick_trading_sale_no();
  _total := _quantity * _unit_price;
  INSERT INTO public.chick_trading_sales(
    sale_no, batch_id, customer_name, phone, address, quantity, unit_price, total,
    payment_method, treasury_destination, main_account_id, sale_date, notes,
    collected, collected_at, collected_by, collection_treasury, collection_main_account_id, created_by,
    cost_per_chick_snapshot, total_cost_snapshot, profit_snapshot
  ) VALUES (
    _no, _batch_id, _customer, _phone, _address, _quantity, _unit_price, _total,
    _payment_method, _treasury_destination, _main_account_id, COALESCE(_sale_date,CURRENT_DATE), _notes,
    (_payment_method<>'credit'),
    CASE WHEN _payment_method<>'credit' THEN now() ELSE NULL END,
    CASE WHEN _payment_method<>'credit' THEN _actor ELSE NULL END,
    CASE WHEN _payment_method<>'credit' THEN _treasury_destination ELSE NULL END,
    CASE WHEN _payment_method<>'credit' THEN _main_account_id ELSE NULL END,
    _actor,
    _cost_per, _cost_per * _quantity, _total - (_cost_per * _quantity)
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
  VALUES ('sale', _row.id, 'create', _actor, jsonb_build_object('qty',_quantity,'total',_total,'payment',_payment_method,'cost_per_chick',_cost_per));
  RETURN _row;
END $function$;
