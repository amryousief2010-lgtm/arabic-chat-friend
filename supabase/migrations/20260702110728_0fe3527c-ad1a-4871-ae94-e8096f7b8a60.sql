
CREATE TABLE public.courier_daily_cash_deposits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  custody_id UUID NOT NULL REFERENCES public.courier_goods_custodies(id) ON DELETE RESTRICT,
  courier_name TEXT NOT NULL,
  deposit_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  orders_count INT NOT NULL DEFAULT 0,
  order_ids UUID[] NOT NULL DEFAULT '{}',
  order_numbers TEXT[] NOT NULL DEFAULT '{}',
  treasury_txn_id UUID REFERENCES public.main_warehouse_treasury_txns(id) ON DELETE SET NULL,
  performed_by UUID REFERENCES auth.users(id),
  performed_by_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (custody_id, deposit_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.courier_daily_cash_deposits TO authenticated;
GRANT ALL ON public.courier_daily_cash_deposits TO service_role;

ALTER TABLE public.courier_daily_cash_deposits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "CDCD read"
  ON public.courier_daily_cash_deposits FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager') OR
    public.has_role(auth.uid(), 'executive_manager') OR
    public.has_role(auth.uid(), 'financial_manager') OR
    public.has_role(auth.uid(), 'main_treasury_accountant') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'warehouse_supervisor')
  );

CREATE POLICY "CDCD insert via rpc only"
  ON public.courier_daily_cash_deposits FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY "CDCD update GM/Exec only"
  ON public.courier_daily_cash_deposits FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'))
  WITH CHECK (public.has_role(auth.uid(), 'general_manager') OR public.has_role(auth.uid(), 'executive_manager'));

CREATE TRIGGER trg_cdcd_updated_at
  BEFORE UPDATE ON public.courier_daily_cash_deposits
  FOR EACH ROW EXECUTE FUNCTION public.set_main_warehouse_treasury_updated_at();

CREATE INDEX idx_cdcd_deposit_date ON public.courier_daily_cash_deposits(deposit_date DESC);
CREATE INDEX idx_cdcd_custody ON public.courier_daily_cash_deposits(custody_id);

-- RPC: deposit a courier's day cash into main warehouse treasury
CREATE OR REPLACE FUNCTION public.deposit_courier_day_cash(
  p_custody_id UUID,
  p_day DATE,
  p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_authorized BOOLEAN;
  v_courier_name TEXT;
  v_existing RECORD;
  v_amount NUMERIC := 0;
  v_orders_count INT := 0;
  v_order_ids UUID[] := '{}';
  v_order_numbers TEXT[] := '{}';
  v_missing_breakdown INT := 0;
  v_undelivered INT := 0;
  v_txn_id UUID;
  v_deposit_id UUID;
  v_performer_name TEXT;
  v_day_label TEXT;
  v_reference TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  v_authorized := public.has_role(v_uid, 'general_manager')
               OR public.has_role(v_uid, 'executive_manager')
               OR public.has_role(v_uid, 'financial_manager')
               OR public.has_role(v_uid, 'main_treasury_accountant')
               OR public.has_role(v_uid, 'warehouse_supervisor');
  IF NOT v_authorized THEN RAISE EXCEPTION 'ليس لديك صلاحية توريد نقدية المندوب'; END IF;

  SELECT courier_name INTO v_courier_name FROM public.courier_goods_custodies WHERE id = p_custody_id;
  IF v_courier_name IS NULL THEN RAISE EXCEPTION 'العهدة غير موجودة'; END IF;

  -- Prevent duplicates
  SELECT * INTO v_existing FROM public.courier_daily_cash_deposits
   WHERE custody_id = p_custody_id AND deposit_date = p_day;
  IF FOUND THEN
    RAISE EXCEPTION 'تم توريد نقدية هذا اليوم بالفعل (رقم الحركة: %)', COALESCE(v_existing.treasury_txn_id::text, '—');
  END IF;

  -- Validate + aggregate: only delivered/collected/completed cash orders (exclude gift/transfer)
  WITH day_asn AS (
    SELECT a.*, o.id AS oid, o.order_number, o.status AS ostatus, o.total,
           o.collection_method, o.update_status_marker, o.courier_cash_due,
           o.vodafone_cash_amount, o.instapay_amount, o.bank_transfer_amount,
           o.other_amount, o.free_amount
      FROM public.courier_order_assignments a
      JOIN public.orders o ON o.id = a.order_id
     WHERE a.custody_id = p_custody_id
       AND (a.assigned_at::date) = p_day
  )
  SELECT
    COALESCE(SUM(CASE
      WHEN ostatus IN ('delivered','collected','completed')
       AND COALESCE(collection_method,'') <> 'transfer'
       AND COALESCE(collection_method,'') <> 'none'
       AND COALESCE(update_status_marker,'') <> 'gift'
      THEN CASE WHEN collection_method = 'mixed_payment'
                THEN COALESCE(courier_cash_due, 0)
                ELSE COALESCE(total, 0) END
      ELSE 0 END), 0),
    COUNT(*) FILTER (WHERE ostatus IN ('delivered','collected','completed')
                       AND COALESCE(collection_method,'') <> 'transfer'
                       AND COALESCE(collection_method,'') <> 'none'
                       AND COALESCE(update_status_marker,'') <> 'gift'),
    COALESCE(ARRAY_AGG(oid) FILTER (WHERE ostatus IN ('delivered','collected','completed')
                       AND COALESCE(collection_method,'') <> 'transfer'
                       AND COALESCE(collection_method,'') <> 'none'
                       AND COALESCE(update_status_marker,'') <> 'gift'), '{}'),
    COALESCE(ARRAY_AGG(order_number) FILTER (WHERE ostatus IN ('delivered','collected','completed')
                       AND COALESCE(collection_method,'') <> 'transfer'
                       AND COALESCE(collection_method,'') <> 'none'
                       AND COALESCE(update_status_marker,'') <> 'gift'), '{}'),
    COUNT(*) FILTER (WHERE ostatus IN ('delivered','collected','completed')
                       AND collection_method = 'mixed_payment'
                       AND ABS(COALESCE(courier_cash_due,0)+COALESCE(vodafone_cash_amount,0)+COALESCE(instapay_amount,0)+COALESCE(bank_transfer_amount,0)+COALESCE(other_amount,0)+COALESCE(free_amount,0) - COALESCE(total,0)) > 0.01),
    COUNT(*) FILTER (WHERE ostatus NOT IN ('delivered','collected','completed','cancelled','partially_returned','fully_returned'))
  INTO v_amount, v_orders_count, v_order_ids, v_order_numbers, v_missing_breakdown, v_undelivered
  FROM day_asn;

  IF v_undelivered > 0 THEN
    RAISE EXCEPTION 'يوجد % أوردر لم يتم تسليمهم بعد — راجع الأوردرات قبل التوريد', v_undelivered;
  END IF;
  IF v_missing_breakdown > 0 THEN
    RAISE EXCEPTION 'يوجد % أوردر دفع مختلط بدون breakdown مضبوط', v_missing_breakdown;
  END IF;
  IF v_orders_count = 0 OR v_amount <= 0 THEN
    RAISE EXCEPTION 'لا توجد نقدية مستحقة للتوريد في هذا اليوم';
  END IF;

  SELECT COALESCE(full_name, email) INTO v_performer_name FROM public.profiles WHERE id = v_uid;
  v_day_label := to_char(p_day, 'DD/MM/YYYY');
  v_reference := 'CASH-' || v_courier_name || '-' || to_char(p_day, 'YYYYMMDD');

  -- Create the treasury movement (incoming, courier_deposit)
  INSERT INTO public.main_warehouse_treasury_txns
    (direction, category, amount, reference, notes, performed_by, courier_name, status, performed_at)
  VALUES
    ('in', 'courier_deposit', v_amount, v_reference,
     COALESCE(p_notes, '') || CASE WHEN COALESCE(p_notes,'')<>'' THEN ' — ' ELSE '' END
       || 'توريد نقدية أوردرات يوم ' || v_day_label || ' — ' || v_courier_name || ' — ' || v_orders_count || ' أوردر',
     v_uid, v_courier_name, 'posted', now())
  RETURNING id INTO v_txn_id;

  -- Record the deposit
  INSERT INTO public.courier_daily_cash_deposits
    (custody_id, courier_name, deposit_date, amount, orders_count, order_ids, order_numbers,
     treasury_txn_id, performed_by, performed_by_name, notes)
  VALUES
    (p_custody_id, v_courier_name, p_day, v_amount, v_orders_count, v_order_ids, v_order_numbers,
     v_txn_id, v_uid, v_performer_name, p_notes)
  RETURNING id INTO v_deposit_id;

  RETURN jsonb_build_object(
    'deposit_id', v_deposit_id,
    'treasury_txn_id', v_txn_id,
    'amount', v_amount,
    'orders_count', v_orders_count,
    'reference', v_reference
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.deposit_courier_day_cash(UUID, DATE, TEXT) TO authenticated;
