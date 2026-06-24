
-- ====== Link columns between chick trading and brooding (operational) batches
ALTER TABLE public.chick_trading_batches
  ADD COLUMN IF NOT EXISTS linked_brooding_batch_id uuid
    REFERENCES public.brooding_batches(id) ON DELETE SET NULL;

ALTER TABLE public.brooding_batches
  ADD COLUMN IF NOT EXISTS source_chick_trading_batch_id uuid
    REFERENCES public.chick_trading_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_brooding_batches_src_chick_trading
  ON public.brooding_batches(source_chick_trading_batch_id);

CREATE INDEX IF NOT EXISTS idx_chick_trading_linked_brooding
  ON public.chick_trading_batches(linked_brooding_batch_id);

-- ====== Helper: does a trading batch have any activity?
CREATE OR REPLACE FUNCTION public.chick_trading_batch_has_activity(_batch_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS(SELECT 1 FROM public.chick_trading_sales WHERE batch_id = _batch_id)
      OR EXISTS(SELECT 1 FROM public.chick_trading_mortality WHERE batch_id = _batch_id)
      OR EXISTS(SELECT 1 FROM public.chick_trading_expenses WHERE batch_id = _batch_id);
$$;

-- ====== Create (or return existing) operational brooding batch from a trading batch
CREATE OR REPLACE FUNCTION public.chick_trading_create_operational_batch(_batch_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  b public.chick_trading_batches%ROWTYPE;
  new_id uuid;
  new_no text;
  total_cost_calc numeric;
  per_bird numeric;
BEGIN
  SELECT * INTO b FROM public.chick_trading_batches WHERE id = _batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'دفعة تجارة الكتاكيت غير موجودة';
  END IF;

  IF b.linked_brooding_batch_id IS NOT NULL THEN
    RETURN b.linked_brooding_batch_id;
  END IF;

  new_no := 'CT-' || COALESCE(NULLIF(b.batch_no,''), substr(b.id::text,1,8));

  -- ensure unique batch_number
  IF EXISTS (SELECT 1 FROM public.brooding_batches WHERE batch_number = new_no) THEN
    new_no := new_no || '-' || substr(gen_random_uuid()::text,1,4);
  END IF;

  total_cost_calc := COALESCE(b.original_count,0) * COALESCE(b.unit_purchase_price,0)
                     + COALESCE(b.transport_cost,0)
                     + COALESCE(b.disinfection_cost,0)
                     + COALESCE(b.other_costs,0);
  per_bird := CASE WHEN COALESCE(b.original_count,0) > 0
                   THEN total_cost_calc / b.original_count
                   ELSE 0 END;

  INSERT INTO public.brooding_batches(
    batch_number, received_date, source, source_chick_trading_batch_id,
    age_at_receipt_days, original_count, current_count, mortality_count,
    sold_count, transferred_count, total_cost, cost_per_bird,
    status, rearing_location, notes, created_by
  ) VALUES (
    new_no, b.purchase_date, 'تجارة كتاكيت', b.id,
    COALESCE(b.age_at_purchase,0), COALESCE(b.original_count,0),
    COALESCE(b.current_count,0), COALESCE(b.dead_count,0),
    COALESCE(b.sold_count,0), 0,
    total_cost_calc, per_bird,
    'active'::brooding_batch_status, 'chick_nursery',
    b.notes, auth.uid()
  )
  RETURNING id INTO new_id;

  UPDATE public.chick_trading_batches
     SET linked_brooding_batch_id = new_id, updated_at = now()
   WHERE id = _batch_id;

  RETURN new_id;
END;
$$;

-- ====== Edit a trading batch (blocked if any activity)
CREATE OR REPLACE FUNCTION public.chick_trading_update_batch(
  _batch_id uuid,
  _supplier text,
  _purchase_date date,
  _age int,
  _original_count int,
  _unit_price numeric,
  _treasury_source text,
  _notes text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  b public.chick_trading_batches%ROWTYPE;
  new_total numeric;
  new_per numeric;
BEGIN
  SELECT * INTO b FROM public.chick_trading_batches WHERE id = _batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'دفعة غير موجودة';
  END IF;

  IF public.chick_trading_batch_has_activity(_batch_id) THEN
    RAISE EXCEPTION 'لا يمكن تعديل بيانات مؤثرة بعد وجود حركات على الدفعة. استخدم حركة تصحيح إدارية.';
  END IF;

  UPDATE public.chick_trading_batches SET
    supplier_name       = COALESCE(_supplier, supplier_name),
    purchase_date       = COALESCE(_purchase_date, purchase_date),
    age_at_purchase     = COALESCE(_age, age_at_purchase),
    original_count      = COALESCE(_original_count, original_count),
    current_count       = COALESCE(_original_count, current_count),
    unit_purchase_price = COALESCE(_unit_price, unit_purchase_price),
    purchase_total      = COALESCE(_original_count, original_count) * COALESCE(_unit_price, unit_purchase_price),
    treasury_source     = COALESCE(_treasury_source, treasury_source),
    notes               = _notes,
    updated_at          = now()
  WHERE id = _batch_id;

  IF b.linked_brooding_batch_id IS NOT NULL THEN
    new_total := COALESCE(_original_count,b.original_count) * COALESCE(_unit_price,b.unit_purchase_price)
                 + COALESCE(b.transport_cost,0) + COALESCE(b.disinfection_cost,0) + COALESCE(b.other_costs,0);
    new_per := CASE WHEN COALESCE(_original_count,b.original_count) > 0
                    THEN new_total / COALESCE(_original_count,b.original_count) ELSE 0 END;

    UPDATE public.brooding_batches SET
      received_date       = COALESCE(_purchase_date, received_date),
      age_at_receipt_days = COALESCE(_age, age_at_receipt_days),
      original_count      = COALESCE(_original_count, original_count),
      current_count       = COALESCE(_original_count, current_count),
      total_cost          = new_total,
      cost_per_bird       = new_per,
      notes               = _notes,
      updated_at          = now()
    WHERE id = b.linked_brooding_batch_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.chick_trading_batch_has_activity(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chick_trading_create_operational_batch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chick_trading_update_batch(uuid, text, date, int, int, numeric, text, text) TO authenticated;
